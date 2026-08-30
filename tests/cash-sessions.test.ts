import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  closeCashSession,
  getCashSessionSummary,
  getOpenCashSession,
  openCashSession,
  recordCashMovement,
} from '../database/repositories/cash-repository';
import { listActiveLocalUsers } from '../database/repositories/local-user-repository';
import { listProducts } from '../database/repositories/product-repository';
import { confirmSale } from '../database/repositories/sales-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('precarga tres usuarios locales sin PIN en texto plano', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const users = await listActiveLocalUsers(database, DEFAULT_STORE_ID);
  assert.deepEqual(
    users.map((user) => user.displayName),
    ['Administrador', 'Vendedor esposo', 'Vendedora esposa']
  );
  assert.ok(users.every((user) => !user.hasPin));

  const pinRows = await database.getAll<{
    pin_hash: string | null;
    pin_salt: string | null;
    pin_algorithm: string | null;
  }>('SELECT pin_hash, pin_salt, pin_algorithm FROM local_users');
  assert.ok(
    pinRows.every(
      (row) =>
        row.pin_hash === null &&
        row.pin_salt === null &&
        row.pin_algorithm === null
    )
  );
});

test('abre una caja con responsable, fondo inicial y fecha UTC', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const session = await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 10000,
  });

  assert.equal(session.status, 'open');
  assert.equal(session.openingCashCents, 10000);
  assert.equal(session.responsibleUserId, DEMO_ADMIN_USER_ID);
  assert.equal(new Date(session.openedAt).toISOString(), session.openedAt);
  assert.equal(
    (await getOpenCashSession(database, DEFAULT_STORE_ID, DEMO_DEVICE_ID))?.id,
    session.id
  );
});

test('rechaza una segunda caja abierta en el mismo dispositivo', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 0,
  });

  await assert.rejects(
    openCashSession(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      responsibleUserId: DEMO_HUSBAND_USER_ID,
      openingCashCents: 5000,
    }),
    /ya tiene una caja abierta/
  );
});

test('cierra caja con ventas, ingresos, salidas, esperado, contado y diferencia', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const session = await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 10000,
  });
  await recordCashMovement(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    cashSessionId: session.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    type: 'income',
    amountCents: 2000,
    reason: 'Cambio adicional',
  });
  await recordCashMovement(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    cashSessionId: session.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    type: 'outflow',
    amountCents: 500,
    reason: 'Compra de bolsas',
  });

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'gram'
  );
  assert.ok(product);
  await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{ productId: product.id, quantity: 1000 }],
    payment: { method: 'cash', amountReceivedCents: product.priceCents },
  });

  const beforeClose = await getCashSessionSummary(
    database,
    DEFAULT_STORE_ID,
    session.id
  );
  assert.equal(beforeClose.cashSalesCents, product.priceCents);
  assert.equal(
    beforeClose.expectedCashCents,
    10000 + product.priceCents + 2000 - 500
  );

  const countedCashCents = beforeClose.expectedCashCents + 50;
  const closed = await closeCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    cashSessionId: session.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    countedCashCents,
  });

  assert.equal(closed.status, 'closed');
  assert.equal(closed.cashSalesCents, product.priceCents);
  assert.equal(closed.cashIncomeCents, 2000);
  assert.equal(closed.cashOutflowCents, 500);
  assert.equal(closed.expectedCashCents, beforeClose.expectedCashCents);
  assert.equal(closed.countedCashCents, countedCashCents);
  assert.equal(closed.differenceCents, 50);
  assert.equal(
    await getOpenCashSession(database, DEFAULT_STORE_ID, DEMO_DEVICE_ID),
    null
  );
});
