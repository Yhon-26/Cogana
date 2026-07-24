import type { SQLiteDatabase } from 'expo-sqlite';

import { ExpoSQLiteAdapter } from './expo-sqlite-adapter';
import { migrateDatabase } from './migrations';
import { seedDemoProductsIfEmpty } from './seed';

export const DATABASE_NAME = 'coguana.db';

export async function initializeDatabase(database: SQLiteDatabase) {
  const adapter = new ExpoSQLiteAdapter(database);
  await migrateDatabase(adapter);
  await seedDemoProductsIfEmpty(adapter);
}
