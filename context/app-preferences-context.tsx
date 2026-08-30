import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useLocalOperator } from '@/context/local-operator-context';
import {
  DEFAULT_APP_PREFERENCES,
  getAppPreferences,
  saveAppPreferences,
  type AppPreferences,
} from '@/database/repositories/app-preferences-repository';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';

type AppPreferencesContextValue = {
  preferences: AppPreferences;
  isLoading: boolean;
  updatePreferences: (next: AppPreferences) => Promise<void>;
};

const AppPreferencesContext =
  createContext<AppPreferencesContextValue | null>(null);

export function AppPreferencesProvider({ children }: PropsWithChildren) {
  const database = useLocalDatabase();
  const { selectedUser } = useLocalOperator();
  const [preferences, setPreferences] = useState(DEFAULT_APP_PREFERENCES);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!selectedUser) return;
    let isActive = true;
    setIsLoading(true);
    void getAppPreferences(database, DEFAULT_STORE_ID, selectedUser.id)
      .then((loaded) => {
        if (isActive) setPreferences(loaded);
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [database, selectedUser]);

  const updatePreferences = async (next: AppPreferences) => {
    if (!selectedUser) {
      throw new Error('Selecciona un operador para guardar sus preferencias.');
    }
    await saveAppPreferences(
      database,
      DEFAULT_STORE_ID,
      selectedUser.id,
      next
    );
    setPreferences(next);
  };

  const value = useMemo(
    () => ({ preferences, isLoading, updatePreferences }),
    [preferences, isLoading]
  );
  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences() {
  const value = useContext(AppPreferencesContext);
  if (!value) {
    throw new Error(
      'useAppPreferences debe usarse dentro de AppPreferencesProvider.'
    );
  }
  return value;
}
