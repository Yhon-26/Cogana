import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';

import { ExpoSQLiteAdapter } from '@/database/expo-sqlite-adapter';

export function useLocalDatabase() {
  const sqlite = useSQLiteContext();
  return useMemo(() => new ExpoSQLiteAdapter(sqlite), [sqlite]);
}
