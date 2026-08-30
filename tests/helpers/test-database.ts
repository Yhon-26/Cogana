import { migrateDatabase } from '../../database/migrations';
import {
  seedDemoPresentationsIfEmpty,
  seedDemoProductsIfEmpty,
  seedLocalUsersIfEmpty,
} from '../../database/seed';
import { NodeSQLiteAdapter } from './node-sqlite-adapter';

export async function createTestDatabase() {
  const database = new NodeSQLiteAdapter();
  await migrateDatabase(database);
  await seedDemoProductsIfEmpty(database);
  await seedLocalUsersIfEmpty(database);
  await seedDemoPresentationsIfEmpty(database);
  return database;
}
