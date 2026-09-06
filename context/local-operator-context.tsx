import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { LocalUserRecord } from '@/database/models';
import { useSupabaseAuth } from '@/context/supabase-auth-context';
import { getOrCreateLocalDeviceId } from '@/database/repositories/device-repository';
import {
  clearLocalUserPinFailures,
  getLocalUserPinCredentials,
  listActiveLocalUsers,
  recordLocalUserPinFailure,
  setLocalUserPin,
} from '@/database/repositories/local-user-repository';
import {
  hashPin,
  isValidNewPinFormat,
  isValidPinFormat,
  LEGACY_PIN_ALGORITHM_ID,
  verifyPin,
} from '@/database/pin';
import { DEFAULT_STORE_ID, DEMO_ADMIN_USER_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';
import { getOperatorErrorMessage } from '@/lib/user-facing-error';

type UnlockError = {
  message: string;
  code:
    | 'invalid_pin'
    | 'pin_already_set'
    | 'pin_required'
    | 'temporarily_locked';
} | null;

type LocalOperatorContextValue = {
  users: LocalUserRecord[];
  selectedUser: LocalUserRecord | null;
  selectedUserId: string;
  deviceId: string;
  pendingUser: LocalUserRecord | null;
  isLoading: boolean;
  error: Error | null;
  unlockError: UnlockError;
  isUnlocking: boolean;
  reload: () => Promise<void>;
  requestSelectUser: (userId: string) => void;
  lockSelectedUser: () => void;
  cancelPending: () => void;
  verifyPendingPin: (pin: string) => Promise<boolean>;
  createPendingPin: (pin: string) => Promise<boolean>;
};

const LocalOperatorContext = createContext<LocalOperatorContextValue | null>(null);

export function LocalOperatorProvider({ children }: PropsWithChildren) {
  const database = useLocalDatabase();
  const { activateOperator } = useSupabaseAuth();
  const [users, setUsers] = useState<LocalUserRecord[]>([]);
  const [selectedUser, setSelectedUser] = useState<LocalUserRecord | null>(null);
  const [pendingUser, setPendingUser] = useState<LocalUserRecord | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [unlockError, setUnlockError] = useState<UnlockError>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [localUsers, localDeviceId] = await Promise.all([
        listActiveLocalUsers(database, DEFAULT_STORE_ID),
        getOrCreateLocalDeviceId(database),
      ]);
      setUsers(localUsers);
      setDeviceId(localDeviceId);

      let activeUser = localUsers.find((user) => user.id === selectedUser?.id);
      if (!activeUser && localUsers.length > 0) {
        activeUser = localUsers[0];
      }
      setSelectedUser(activeUser ?? null);
      if (activeUser) {
        void activateOperator(activeUser);
      }
      setPendingUser(null);
    } catch (caughtError) {
      setError(
        new Error(
          getOperatorErrorMessage(
            caughtError,
            'No se pudieron cargar los usuarios locales.'
          )
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [activateOperator, database, selectedUser?.id]);

  useEffect(() => {
    void reload();
  }, [database]);

  const requestSelectUser = useCallback(
    (userId: string) => {
      setUnlockError(null);
      if (selectedUser?.id === userId) return;
      const user = users.find((candidate) => candidate.id === userId);
      if (!user) return;
      setPendingUser(user);
    },
    [selectedUser?.id, users]
  );

  const lockSelectedUser = useCallback(() => {
    if (!selectedUser) return;
    setUnlockError(null);
    setPendingUser(selectedUser);
    setSelectedUser(null);
  }, [selectedUser]);

  const cancelPending = useCallback(() => {
    setPendingUser(null);
    setUnlockError(null);
  }, []);

  const refreshUsers = useCallback(async () => {
    const localUsers = await listActiveLocalUsers(database, DEFAULT_STORE_ID);
    setUsers(localUsers);
    return localUsers;
  }, [database]);

  const verifyPendingPin = useCallback(
    async (pin: string): Promise<boolean> => {
    if (!pendingUser) return false;
    if (!isValidPinFormat(pin)) {
      setUnlockError({ message: 'Ingresa un PIN de 4 a 8 dígitos.', code: 'invalid_pin' });
      return false;
    }
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const credentials = await getLocalUserPinCredentials(
        database,
        DEFAULT_STORE_ID,
        pendingUser.id
      );
      if (!credentials?.pinHash || !credentials.pinSalt || !credentials.pinAlgorithm) {
        setUnlockError({
          message: 'El usuario aún no tiene un PIN configurado.',
          code: 'pin_required',
        });
        return false;
      }
      const now = new Date();
      if (
        credentials.lockedUntil &&
        Date.parse(credentials.lockedUntil) > now.getTime()
      ) {
        const remainingSeconds = Math.max(
          1,
          Math.ceil((Date.parse(credentials.lockedUntil) - now.getTime()) / 1000)
        );
        setUnlockError({
          message: `Demasiados intentos. Espera ${remainingSeconds} segundos.`,
          code: 'temporarily_locked',
        });
        return false;
      }
      const payload = {
        pinHash: credentials.pinHash,
        pinSalt: credentials.pinSalt,
        pinAlgorithm: credentials.pinAlgorithm,
      };
      const matches = await verifyPin(pin, payload);
      if (!matches) {
        const failure = await recordLocalUserPinFailure(
          database,
          DEFAULT_STORE_ID,
          pendingUser.id,
          now.toISOString()
        );
        if (failure.lockedUntil) {
          const remainingSeconds = Math.max(
            1,
            Math.ceil((Date.parse(failure.lockedUntil) - now.getTime()) / 1000)
          );
          setUnlockError({
            message: `PIN incorrecto. Acceso bloqueado por ${remainingSeconds} segundos.`,
            code: 'temporarily_locked',
          });
        } else {
          setUnlockError({
            message: `PIN incorrecto. Intento ${failure.failedAttempts} de 5.`,
            code: 'invalid_pin',
          });
        }
        return false;
      }
      await clearLocalUserPinFailures(
        database,
        DEFAULT_STORE_ID,
        pendingUser.id,
        now.toISOString()
      );
      if (
        credentials.pinAlgorithm === LEGACY_PIN_ALGORITHM_ID &&
        isValidNewPinFormat(pin)
      ) {
        await setLocalUserPin(
          database,
          DEFAULT_STORE_ID,
          pendingUser.id,
          await hashPin(pin)
        );
      }
      const refreshed = await refreshUsers();
      const unlocked = refreshed.find((user) => user.id === pendingUser.id) ?? null;
      setPendingUser(null);
      setSelectedUser(unlocked);
      if (unlocked) void activateOperator(unlocked);
      return true;
    } catch (caughtError) {
      setUnlockError({
        message: getOperatorErrorMessage(
          caughtError,
          'No se pudo verificar el PIN.'
        ),
        code: 'invalid_pin',
      });
      return false;
    } finally {
      setIsUnlocking(false);
    }
    },
    [activateOperator, database, pendingUser, refreshUsers]
  );

  const createPendingPin = useCallback(
    async (pin: string): Promise<boolean> => {
    if (!pendingUser) return false;
    if (!isValidNewPinFormat(pin)) {
      setUnlockError({ message: 'Ingresa un PIN de 6 a 8 dígitos.', code: 'invalid_pin' });
      return false;
    }
    const demoBootstrapEnabled =
      process.env.NODE_ENV !== 'production' &&
      process.env.EXPO_PUBLIC_ENABLE_DEMO_DATA === 'true';
    if (!pendingUser.authUserId && !demoBootstrapEnabled) {
      setUnlockError({
        message: 'Este operador debe aprovisionarse primero con su cuenta Supabase.',
        code: 'pin_required',
      });
      return false;
    }
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const credentials = await getLocalUserPinCredentials(
        database,
        DEFAULT_STORE_ID,
        pendingUser.id
      );
      if (credentials?.pinHash) {
        setUnlockError({
          message: 'Este usuario ya tiene un PIN configurado.',
          code: 'pin_already_set',
        });
        return false;
      }
      const newCredentials = await hashPin(pin);
      await setLocalUserPin(database, DEFAULT_STORE_ID, pendingUser.id, newCredentials);
      const refreshed = await refreshUsers();
      const unlocked = refreshed.find((user) => user.id === pendingUser.id) ?? null;
      setPendingUser(null);
      setSelectedUser(unlocked);
      if (unlocked) void activateOperator(unlocked);
      return true;
    } catch (caughtError) {
      setUnlockError({
        message: getOperatorErrorMessage(caughtError, 'No se pudo crear el PIN.'),
        code: 'invalid_pin',
      });
      return false;
    } finally {
      setIsUnlocking(false);
    }
    },
    [activateOperator, database, pendingUser, refreshUsers]
  );

  const selectedUserId = selectedUser?.id ?? '';

  const value = useMemo<LocalOperatorContextValue>(
    () => ({
      users,
      selectedUser,
      selectedUserId,
      deviceId,
      pendingUser,
      isLoading,
      error,
      unlockError,
      isUnlocking,
      reload,
      requestSelectUser,
      lockSelectedUser,
      cancelPending,
      verifyPendingPin,
      createPendingPin,
    }),
    [users, selectedUser, selectedUserId, deviceId, pendingUser, isLoading, error, unlockError, isUnlocking, cancelPending, createPendingPin, lockSelectedUser, reload, requestSelectUser, verifyPendingPin]
  );

  return (
    <LocalOperatorContext.Provider value={value}>
      {children}
    </LocalOperatorContext.Provider>
  );
}

export function useLocalOperator() {
  const value = useContext(LocalOperatorContext);
  if (!value) {
    throw new Error('useLocalOperator debe usarse dentro de LocalOperatorProvider.');
  }
  return value;
}
