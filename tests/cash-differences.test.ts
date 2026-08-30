import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reviewCashDifference } from '../database/repositories/cash-difference-repository';
import {
  closeCashSession,
  openCashSession,
} from '../database/repositories/cash-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('un administrador aprueba y actualiza una diferencia de caja con outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const session = await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 1000,
  });
  await closeCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    cashSessionId: session.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    countedCashCents: 1050,
  });

  const first = await reviewCashDifference(database, {
    storeId: DEFAULT_STORE_ID,
    cashSessionId: session.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    decision: 'requires_action',
    justification: 'Validar sobrante con el cajero.',
  });
  const updated = await reviewCashDifference(database, {
    storeId: DEFAULT_STORE_ID,
    cashSessionId: session.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    decision: 'approved',
    justification: 'Sobrante explicado por fondo no registrado.',
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.version, 2);
  assert.equal(updated.decision, 'approved');
  assert.equal(
    (
      await database.getFirst<{ total: number }>(
        `SELECT COUNT(*) AS total FROM sync_outbox
         WHERE operation_type = 'cash_difference.reviewed'`
      )
    )?.total,
    2
  );
});

test('un vendedor no puede revisar diferencias de caja', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const session = await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_HUSBAND_USER_ID,
    openingCashCents: 1000,
  });
  await closeCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    cashSessionId: session.id,
    actorUserId: DEMO_HUSBAND_USER_ID,
    countedCashCents: 900,
  });
  await assert.rejects(
    reviewCashDifference(database, {
      storeId: DEFAULT_STORE_ID,
      cashSessionId: session.id,
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      decision: 'approved',
      justification: 'Intento sin permiso.',
    }),
    /Solo un administrador/
  );
});
