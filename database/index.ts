import type { SQLiteDatabase } from 'expo-sqlite';

import { ExpoSQLiteAdapter } from './expo-sqlite-adapter';
import { migrateDatabase } from './migrations';
import {
  seedDemoPresentationsIfEmpty,
  seedDemoProductsIfEmpty,
  seedLocalUsersIfEmpty,
} from './seed';

export const DATABASE_NAME = 'coguana.db';

function shouldSeedDemoData() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.EXPO_PUBLIC_ENABLE_DEMO_DATA === 'true'
  );
}

export async function initializeDatabase(database: SQLiteDatabase) {
  const adapter = new ExpoSQLiteAdapter(database);
  await migrateDatabase(adapter);
  if (!shouldSeedDemoData()) return;
  await seedDemoProductsIfEmpty(adapter);
  await seedLocalUsersIfEmpty(adapter);
  await seedDemoPresentationsIfEmpty(adapter);
}
