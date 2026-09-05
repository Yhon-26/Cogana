import type { DatabaseAdapter } from '../../database/contracts';
import { migrateDatabase } from '../../database/migrations';
import {
  DEFAULT_STORE_ID,
  DEMO_HUSBAND_USER_ID,
  DEMO_WIFE_USER_ID,
  seedDemoPresentationsIfEmpty,
  seedDemoProductsIfEmpty,
  seedLocalUsersIfEmpty,
} from '../../database/seed';
import { NodeSQLiteAdapter } from './node-sqlite-adapter';

const TEST_OPERATORS = [
  { id: DEMO_HUSBAND_USER_ID, displayName: 'Vendedor esposo', role: 'seller' },
  { id: DEMO_WIFE_USER_ID, displayName: 'Vendedora esposa', role: 'seller' },
] as const;

async function seedTestOperatorsIfEmpty(database: DatabaseAdapter) {
  const timestamp = new Date().toISOString();
  await database.transaction(async (transaction) => {
    for (const user of TEST_OPERATORS) {
      const existing = await transaction.getFirst<{ total: number }>(
        'SELECT COUNT(*) AS total FROM local_users WHERE id = ?',
        [user.id]
      );
      if ((existing?.total ?? 0) > 0) continue;
      await transaction.run(
        `INSERT INTO local_users (
          id, store_id, display_name, role,
          pin_hash, pin_salt, pin_algorithm, is_active,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, 1)`,
        [
          user.id,
          DEFAULT_STORE_ID,
          user.displayName,
          user.role,
          timestamp,
          timestamp,
        ]
      );
    }
  });
}

export async function createTestDatabase() {
  const database = new NodeSQLiteAdapter();
  await migrateDatabase(database);
  await seedDemoProductsIfEmpty(database);
  await seedLocalUsersIfEmpty(database);
  await seedTestOperatorsIfEmpty(database);
  await seedDemoPresentationsIfEmpty(database);
  return database;
}
