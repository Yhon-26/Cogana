import { migrateDatabase } from '../../database/migrations';
import { seedDemoProductsIfEmpty } from '../../database/seed';
import { NodeSQLiteAdapter } from './node-sqlite-adapter';

export async function createTestDatabase() {
  const database = new NodeSQLiteAdapter();
  await migrateDatabase(database);
  await seedDemoProductsIfEmpty(database);
  return database;
}
