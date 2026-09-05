import assert from 'node:assert/strict';
import { test } from 'node:test';

import { migrateDatabase } from '../database/migrations';
import {
  clearLocalUserPinFailures,
  getActiveLocalUser,
  linkLocalUserToAuth,
  provisionFirstLocalOperator,
  recordLocalUserPinFailure,
  unlinkLocalUserFromAuth,
} from '../database/repositories/local-user-repository';
import {
  enqueueOperation,
  listDueOutbox,
} from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { NodeSQLiteAdapter } from './helpers/node-sqlite-adapter';
import { createTestDatabase } from './helpers/test-database';

const AUTH_USER_ID = 'c1000000-0000-4000-8000-000000000001';
const OTHER_AUTH_USER_ID = 'c1000000-0000-4000-8000-000000000002';
const NOW = '2026-07-26T18:00:00.000Z';

test('vincula un operador local con una sola identidad Supabase', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  await linkLocalUserToAuth(
    database,
    DEFAULT_STORE_ID,
    DEMO_HUSBAND_USER_ID,
    AUTH_USER_ID
  );
  const linked = await getActiveLocalUser(
    database,
    DEFAULT_STORE_ID,
    DEMO_HUSBAND_USER_ID
  );
  assert.equal(linked?.authUserId, AUTH_USER_ID);

  await assert.rejects(
    linkLocalUserToAuth(
      database,
      DEFAULT_STORE_ID,
      DEMO_HUSBAND_USER_ID,
      OTHER_AUTH_USER_ID
    ),
    /otra cuenta Supabase/
  );
  await assert.rejects(
    linkLocalUserToAuth(
      database,
      DEFAULT_STORE_ID,
      DEMO_ADMIN_USER_ID,
      AUTH_USER_ID
    ),
    /otro operador local/
  );

  await unlinkLocalUserFromAuth(
    database,
    DEFAULT_STORE_ID,
    DEMO_HUSBAND_USER_ID
  );
  assert.equal(
    (
      await getActiveLocalUser(
        database,
        DEFAULT_STORE_ID,
        DEMO_HUSBAND_USER_ID
      )
    )?.authUserId,
    null
  );
});

test('la outbox entrega solo operaciones del operador autenticado', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  for (const [index, actorUserId] of [
    DEMO_ADMIN_USER_ID,
    DEMO_HUSBAND_USER_ID,
  ].entries()) {
    await enqueueOperation(database, {
      id: `c2000000-0000-4000-8000-00000000000${index + 1}`,
      storeId: DEFAULT_STORE_ID,
      actorUserId,
      operationId: `c3000000-0000-4000-8000-00000000000${index + 1}`,
      entityType: 'price_history',
      entityId: `c4000000-0000-4000-8000-00000000000${index + 1}`,
      operationType: 'product.price_updated',
      payload: { actorUserId, deviceId: DEMO_DEVICE_ID },
      timestamp: NOW,
    });
  }

  const sellerDue = await listDueOutbox(
    database,
    DEFAULT_STORE_ID,
    DEMO_HUSBAND_USER_ID,
    NOW,
    50
  );
  assert.equal(sellerDue.length, 1);
  assert.equal(sellerDue[0].actorUserId, DEMO_HUSBAND_USER_ID);
});

test('la migración v8 recupera el actor de operaciones ya pendientes', async (context) => {
  const database = new NodeSQLiteAdapter();
  context.after(() => database.close());
  await migrateDatabase(database, 7);
  await database.run(
    `INSERT INTO sync_outbox (
      id, store_id, operation_id, entity_type, entity_id, operation_type,
      payload_json, status, attempts, last_error, next_attempt_at,
      error_code, is_terminal, server_result_json,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, 'cash_session', ?, 'cash_session.opened', ?,
      'pending', 0, NULL, NULL, NULL, 0, NULL, ?, ?, 1)`,
    [
      'c5000000-0000-4000-8000-000000000001',
      DEFAULT_STORE_ID,
      'c6000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000001',
      JSON.stringify({ responsibleUserId: DEMO_ADMIN_USER_ID }),
      NOW,
      NOW,
    ]
  );

  await migrateDatabase(database);
  const migrated = await database.getFirst<{ actor_user_id: string | null }>(
    'SELECT actor_user_id FROM sync_outbox WHERE id = ?',
    ['c5000000-0000-4000-8000-000000000001']
  );
  assert.equal(migrated?.actor_user_id, DEMO_ADMIN_USER_ID);
});

test('bloquea temporalmente el PIN despues de cinco fallos y lo restablece', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  let state = { failedAttempts: 0, lockedUntil: null as string | null };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    state = await recordLocalUserPinFailure(
      database,
      DEFAULT_STORE_ID,
      DEMO_ADMIN_USER_ID,
      new Date(Date.parse(NOW) + attempt * 1000).toISOString()
    );
  }
  assert.equal(state.failedAttempts, 5);
  assert.ok(state.lockedUntil);

  await clearLocalUserPinFailures(
    database,
    DEFAULT_STORE_ID,
    DEMO_ADMIN_USER_ID,
    new Date(Date.parse(NOW) + 60_000).toISOString()
  );
  const row = await database.getFirst<{
    failed_pin_attempts: number;
    pin_locked_until: string | null;
  }>(
    `SELECT failed_pin_attempts,pin_locked_until
     FROM local_users WHERE id = ?`,
    [DEMO_ADMIN_USER_ID]
  );
  assert.equal(row?.failed_pin_attempts, 0);
  assert.equal(row?.pin_locked_until, null);
});

test('el aprovisionamiento inicial solo funciona con una base sin operadores', async (context) => {
  const database = new NodeSQLiteAdapter();
  context.after(() => database.close());
  await migrateDatabase(database);
  const provisioned = await provisionFirstLocalOperator(database, {
    id: AUTH_USER_ID,
    storeId: DEFAULT_STORE_ID,
    authUserId: AUTH_USER_ID,
    displayName: 'Owner Cogana',
    credentials: {
      pinHash: 'hash-seguro',
      pinSalt: '00112233445566778899aabbccddeeff',
      pinAlgorithm: 'test-algorithm',
    },
  });
  assert.equal(provisioned.role, 'administrator');
  assert.equal(provisioned.authUserId, AUTH_USER_ID);
  await assert.rejects(
    provisionFirstLocalOperator(database, {
      id: OTHER_AUTH_USER_ID,
      storeId: DEFAULT_STORE_ID,
      authUserId: OTHER_AUTH_USER_ID,
      displayName: 'Otro owner',
      credentials: {
        pinHash: 'otro-hash',
        pinSalt: 'ffeeddccbbaa99887766554433221100',
        pinAlgorithm: 'test-algorithm',
      },
    }),
    /ya fue aprovisionado/
  );
});

test('el aprovisionamiento inicial admite operador sin PIN para crearlo después', async (context) => {
  const database = new NodeSQLiteAdapter();
  context.after(() => database.close());
  await migrateDatabase(database);
  const provisioned = await provisionFirstLocalOperator(database, {
    id: AUTH_USER_ID,
    storeId: DEFAULT_STORE_ID,
    authUserId: AUTH_USER_ID,
    displayName: 'Owner sin PIN',
    credentials: null,
  });
  assert.equal(provisioned.role, 'administrator');
  assert.equal(provisioned.authUserId, AUTH_USER_ID);
  assert.equal(provisioned.hasPin, false);
  const row = await database.getFirst<{
    pin_hash: string | null;
    pin_salt: string | null;
    pin_algorithm: string | null;
  }>(
    `SELECT pin_hash,pin_salt,pin_algorithm
     FROM local_users WHERE id = ?`,
    [AUTH_USER_ID]
  );
  assert.equal(row?.pin_hash, null);
  assert.equal(row?.pin_salt, null);
  assert.equal(row?.pin_algorithm, null);
});
