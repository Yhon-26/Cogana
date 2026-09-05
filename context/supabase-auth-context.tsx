import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { getSupabaseClient, getSupabasePublicConfig } from '@/auth/supabase-client';
import { getSupabaseAuthErrorMessage } from '@/auth/customer-auth-error';
import {
  deleteOperatorRefreshToken,
  readOperatorRefreshToken,
  saveOperatorRefreshToken,
} from '@/auth/operator-session-storage';
import type { DatabaseAdapter } from '@/database/contracts';
import type { LocalUserRecord, LocalUserRole } from '@/database/models';
import { hashPin } from '@/database/pin';
import { getOrCreateLocalDeviceId } from '@/database/repositories/device-repository';
import {
  linkLocalUserToAuth,
  provisionFirstLocalOperator,
  unlinkLocalUserFromAuth,
} from '@/database/repositories/local-user-repository';
import { useLocalDatabase } from '@/hooks/use-local-database';
import {
  ensureStoreDeviceAuthorized,
  type OperatorDevicePlatform,
} from '@/online/operator-device-api';

type AuthState =
  | 'unconfigured'
  | 'local_only'
  | 'connecting'
  | 'authenticated'
  | 'offline'
  | 'error';

type LinkCredentials = {
  email: string;
  password: string;
};

type ProvisionCredentials = LinkCredentials & {
  storeId: string;
  pin?: string;
};

type OperatorContext = {
  authUserId: string;
  fullName: string | null;
  storeRole: string;
};

type SupabaseAuthContextValue = {
  state: AuthState;
  message: string | null;
  authUserId: string | null;
  activeLocalUserId: string | null;
  isConfigured: boolean;
  activateOperator: (user: LocalUserRecord) => Promise<void>;
  linkOperator: (
    user: LocalUserRecord,
    credentials: LinkCredentials
  ) => Promise<void>;
  provisionFirstOperator: (
    credentials: ProvisionCredentials
  ) => Promise<LocalUserRecord>;
  unlinkOperator: (user: LocalUserRecord) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

function roleMatches(localRole: LocalUserRole, backendRole: string) {
  if (localRole === 'administrator') {
    return backendRole === 'owner' || backendRole === 'admin';
  }
  return backendRole === 'seller';
}

async function requireMembership(
  client: SupabaseClient,
  user: LocalUserRecord,
  authUserId: string
): Promise<OperatorContext> {
  const { data, error } = await client
    .rpc('get_my_operator_context', { p_store_id: user.storeId })
    .single();
  if (error) throw error;
  const context = data as {
    auth_user_id?: unknown;
    full_name?: unknown;
    store_role?: unknown;
  } | null;
  if (!context || context.auth_user_id !== authUserId) {
    throw new Error('La sesión no coincide con la identidad Supabase.');
  }
  if (
    typeof context.store_role !== 'string' ||
    !roleMatches(user.role, context.store_role)
  ) {
    throw new Error('El rol de Supabase no coincide con el operador local.');
  }
  return {
    authUserId,
    fullName: typeof context.full_name === 'string' ? context.full_name : null,
    storeRole: context.store_role,
  };
}

async function requireAdministrativeMembership(
  client: SupabaseClient,
  storeId: string,
  authUserId: string
): Promise<OperatorContext> {
  const { data, error } = await client
    .rpc('get_my_operator_context', { p_store_id: storeId })
    .single();
  if (error) throw error;
  const context = data as {
    auth_user_id?: unknown;
    full_name?: unknown;
    store_role?: unknown;
  } | null;
  if (!context || context.auth_user_id !== authUserId) {
    throw new Error('La sesion no coincide con la identidad Supabase.');
  }
  if (context.store_role !== 'owner' && context.store_role !== 'admin') {
    throw new Error('Solo un owner o administrador puede aprovisionar el dispositivo.');
  }
  return {
    authUserId,
    fullName: typeof context.full_name === 'string' ? context.full_name : null,
    storeRole: context.store_role,
  };
}

async function registerCurrentDeviceIfAdmin(
  client: SupabaseClient,
  database: DatabaseAdapter,
  user: LocalUserRecord
) {
  if (user.role !== 'administrator') return;
  const platform: OperatorDevicePlatform =
    Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
      ? Platform.OS
      : 'web';
  try {
    const deviceId = await getOrCreateLocalDeviceId(database);
    await ensureStoreDeviceAuthorized(client, {
      storeId: user.storeId,
      deviceId,
      platform,
    });
  } catch {
    // El registro del dispositivo no debe bloquear la sesión del operador.
  }
}

export function SupabaseAuthProvider({ children }: PropsWithChildren) {
  const database = useLocalDatabase();
  const [state, setState] = useState<AuthState>(
    getSupabasePublicConfig().isConfigured ? 'local_only' : 'unconfigured'
  );
  const [message, setMessage] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [activeLocalUserId, setActiveLocalUserId] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const activeUserRef = useRef<LocalUserRecord | null>(null);
  const activationVersionRef = useRef(0);
  const client = getSupabaseClient();
  const canPersistSession = Platform.OS === 'android' || Platform.OS === 'ios';

  const clearMemorySession = useCallback(() => {
    sessionRef.current = null;
    setAuthUserId(null);
  }, []);

  const activateOperator = useCallback(
    async (user: LocalUserRecord) => {
      const activationVersion = activationVersionRef.current + 1;
      activationVersionRef.current = activationVersion;
      activeUserRef.current = user;
      setActiveLocalUserId(user.id);
      clearMemorySession();
      setMessage(null);
      if (!client) {
        setState('unconfigured');
        return;
      }
      if (!canPersistSession) {
        setState('local_only');
        setMessage('El vínculo seguro de operadores requiere Android o iOS.');
        return;
      }
      if (!user.authUserId) {
        setState('local_only');
        return;
      }
      const refreshToken = await readOperatorRefreshToken(user.id);
      if (!refreshToken) {
        setState('local_only');
        return;
      }

      setState('connecting');
      try {
        const { data, error } = await client.auth.refreshSession({
          refresh_token: refreshToken,
        });
        if (error) throw error;
        if (activationVersionRef.current !== activationVersion) return;
        if (!data.session || data.user?.id !== user.authUserId) {
          throw new Error('La sesión guardada no corresponde al operador seleccionado.');
        }
        await requireMembership(client, user, data.user.id);
        if (activationVersionRef.current !== activationVersion) return;
        await saveOperatorRefreshToken(user.id, data.session.refresh_token);
        sessionRef.current = data.session;
        setAuthUserId(data.user.id);
        setState('authenticated');
        void registerCurrentDeviceIfAdmin(client, database, user);
      } catch (error) {
        if (activationVersionRef.current !== activationVersion) return;
        clearMemorySession();
        setState('offline');
        setMessage(
          `Operación local disponible. Sin sincronización: ${getSupabaseAuthErrorMessage(error)}`
        );
      }
    },
    [canPersistSession, clearMemorySession, client, database]
  );

  const linkOperator = useCallback(
    async (user: LocalUserRecord, credentials: LinkCredentials) => {
      if (!client) {
        throw new Error('Configura la URL y la clave pública de Supabase.');
      }
      if (!canPersistSession) {
        throw new Error('El vínculo seguro de operadores requiere Android o iOS.');
      }
      const activationVersion = activationVersionRef.current + 1;
      activationVersionRef.current = activationVersion;
      const email = credentials.email.trim().toLocaleLowerCase('en-US');
      if (!email || !credentials.password) {
        throw new Error('Correo y contraseña son obligatorios.');
      }
      setState('connecting');
      setMessage(null);
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password: credentials.password,
        });
        if (error) throw error;
        if (!data.user || !data.session) {
          throw new Error('Supabase no devolvió una sesión válida.');
        }
        if (user.authUserId && user.authUserId !== data.user.id) {
          throw new Error('Este operador ya está vinculado a otra cuenta Supabase.');
        }
        await requireMembership(client, user, data.user.id);
        if (activationVersionRef.current !== activationVersion) {
          throw new Error('El operador cambió durante la vinculación.');
        }
        await linkLocalUserToAuth(database, user.storeId, user.id, data.user.id);
        await saveOperatorRefreshToken(user.id, data.session.refresh_token);
        activeUserRef.current = { ...user, authUserId: data.user.id };
        setActiveLocalUserId(user.id);
        sessionRef.current = data.session;
        setAuthUserId(data.user.id);
        setState('authenticated');
        void registerCurrentDeviceIfAdmin(client, database, user);
      } catch (error) {
        if (activationVersionRef.current === activationVersion) {
          clearMemorySession();
          setState('error');
          setMessage(getSupabaseAuthErrorMessage(error));
        }
        throw error;
      }
    },
    [canPersistSession, clearMemorySession, client, database]
  );

  const provisionFirstOperator = useCallback(
    async (credentials: ProvisionCredentials) => {
      if (!client) {
        throw new Error('Configura la URL y la clave publica de Supabase.');
      }
      if (!canPersistSession) {
        throw new Error('El aprovisionamiento seguro requiere Android o iOS.');
      }
      const email = credentials.email.trim().toLocaleLowerCase('en-US');
      if (!email || !credentials.password || !credentials.storeId) {
        throw new Error('Tienda, correo y contrasena son obligatorios.');
      }
      const activationVersion = activationVersionRef.current + 1;
      activationVersionRef.current = activationVersion;
      setState('connecting');
      setMessage(null);
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password: credentials.password,
        });
        if (error) throw error;
        if (!data.user || !data.session) {
          throw new Error('Supabase no devolvio una sesion valida.');
        }
        const membership = await requireAdministrativeMembership(
          client,
          credentials.storeId,
          data.user.id
        );
        const localUser = await provisionFirstLocalOperator(database, {
          id: data.user.id,
          storeId: credentials.storeId,
          authUserId: data.user.id,
          displayName:
            membership.fullName?.trim() ||
            data.user.email?.trim() ||
            'Administrador',
          credentials: credentials.pin
            ? await hashPin(credentials.pin)
            : null,
        });
        if (activationVersionRef.current !== activationVersion) {
          throw new Error('El operador cambio durante el aprovisionamiento.');
        }
        await saveOperatorRefreshToken(localUser.id, data.session.refresh_token);
        activeUserRef.current = localUser;
        setActiveLocalUserId(localUser.id);
        sessionRef.current = data.session;
        setAuthUserId(data.user.id);
        setState('authenticated');
        void registerCurrentDeviceIfAdmin(client, database, localUser);
        return localUser;
      } catch (error) {
        if (activationVersionRef.current === activationVersion) {
          clearMemorySession();
          setState('error');
          setMessage(getSupabaseAuthErrorMessage(error));
        }
        throw error;
      }
    },
    [canPersistSession, clearMemorySession, client, database]
  );

  const unlinkOperator = useCallback(
    async (user: LocalUserRecord) => {
      activationVersionRef.current += 1;
      await deleteOperatorRefreshToken(user.id);
      await unlinkLocalUserFromAuth(database, user.storeId, user.id);
      if (activeLocalUserId === user.id) {
        activeUserRef.current = { ...user, authUserId: null };
        clearMemorySession();
        setState(client ? 'local_only' : 'unconfigured');
        setMessage(null);
      }
    },
    [activeLocalUserId, clearMemorySession, client, database]
  );

  const getAccessToken = useCallback(async () => {
    const activeUser = activeUserRef.current;
    const session = sessionRef.current;
    if (!client || !canPersistSession || !activeUser?.authUserId) return null;
    const expiresAtMs = (session?.expires_at ?? 0) * 1000;
    if (session && expiresAtMs > Date.now() + 60_000) {
      return session.access_token;
    }
    const refreshToken =
      session?.refresh_token ?? (await readOperatorRefreshToken(activeUser.id));
    if (!refreshToken) return null;
    try {
      const { data, error } = await client.auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error) throw error;
      if (
        !data.session ||
        data.user?.id !== activeUser.authUserId ||
        activeUserRef.current?.id !== activeUser.id
      ) {
        return null;
      }
      await saveOperatorRefreshToken(activeUser.id, data.session.refresh_token);
      sessionRef.current = data.session;
      setAuthUserId(data.user.id);
      setState('authenticated');
      setMessage(null);
      return data.session.access_token;
    } catch (error) {
      clearMemorySession();
      setState('offline');
      setMessage(getSupabaseAuthErrorMessage(error));
      return null;
    }
  }, [canPersistSession, clearMemorySession, client]);

  const value = useMemo<SupabaseAuthContextValue>(
    () => ({
      state,
      message,
      authUserId,
      activeLocalUserId,
      isConfigured: Boolean(client && canPersistSession),
      activateOperator,
      linkOperator,
      provisionFirstOperator,
      unlinkOperator,
      getAccessToken,
    }),
    [
      activateOperator,
      activeLocalUserId,
      authUserId,
      canPersistSession,
      client,
      getAccessToken,
      linkOperator,
      message,
      provisionFirstOperator,
      state,
      unlinkOperator,
    ]
  );

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export function useSupabaseAuth() {
  const value = useContext(SupabaseAuthContext);
  if (!value) {
    throw new Error('useSupabaseAuth debe usarse dentro de SupabaseAuthProvider.');
  }
  return value;
}
