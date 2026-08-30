import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCashSessionSummary, openCashSession } from '../database/repositories/cash-repository';
import { listInventoryMovements } from '../database/repositories/inventory-repository';
import { getProductById, listProducts } from '../database/repositories/product-repository';
import { confirmSale, listRecentSalesForSession } from '../database/repositories/sales-repository';
import { voidSale } from '../database/repositories/sales-corrections-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

async function openDemoCash(database: Awaited<ReturnType<typeof createTestDatabase>>, opening = 0) {
  return openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: opening,
  });
}

test('anula una venta en efectivo: restaura stock, marca voided y registra historial', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const target = products.find((candidate) => candidate.baseUnit === 'gram');
  assert.ok(target);
  const stockBefore = target.stockQuantity;

  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    items: [{ productId: target.id, quantity: 250 }],
    payment: { method: 'cash', amountReceivedCents: 1000 },
  });

  const stockAfterSale = await getProductById(database, DEFAULT_STORE_ID, target.id);
  assert.equal(stockAfterSale?.stockQuantity, stockBefore - 250);

  const voided = await voidSale(database, {
    storeId: DEFAULT_STORE_ID,
    saleId: result.sale.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    reason: 'Cliente canceló la compra',
  });

  assert.equal(voided.sale.status, 'voided');
  assert.ok(voided.sale.voidedAt);
  assert.equal(voided.sale.voidedByUserId, DEMO_ADMIN_USER_ID);
  assert.equal(voided.sale.voidReason, 'Cliente canceló la compra');
  assert.equal(voided.statusHistory.fromStatus, 'confirmed');
  assert.equal(voided.statusHistory.toStatus, 'voided');

  const stockAfterVoid = await getProductById(database, DEFAULT_STORE_ID, target.id);
  assert.equal(stockAfterVoid?.stockQuantity, stockBefore, 'El stock debe restaurarse tras anular');

  const movements = await listInventoryMovements(database, DEFAULT_STORE_ID, target.id);
  const returnMovement = movements.find((movement) => movement.type === 'return');
  assert.ok(returnMovement);
  assert.equal(returnMovement?.quantityDelta, 250);
  assert.equal(returnMovement?.referenceId, result.sale.id);
});

test('anular una venta reduce el efectivo esperado excluyéndola del sum', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const session = await openDemoCash(database, 5000);

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const target = products.find((candidate) => candidate.baseUnit === 'gram');
  assert.ok(target);

  await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    items: [{ productId: target.id, quantity: 1000 }],
    payment: { method: 'cash', amountReceivedCents: target.priceCents },
  });

  const summaryBefore = await getCashSessionSummary(database, DEFAULT_STORE_ID, session.id);
  assert.equal(summaryBefore.cashSalesCents, target.priceCents);
  assert.equal(summaryBefore.saleCount, 1);

  const recent = await listRecentSalesForSession(database, DEFAULT_STORE_ID, session.id);
  assert.ok(recent.length > 0);

  await voidSale(database, {
    storeId: DEFAULT_STORE_ID,
    saleId: recent[0].id,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    reason: 'Error de cobro',
  });

  const summaryAfter = await getCashSessionSummary(database, DEFAULT_STORE_ID, session.id);
  assert.equal(summaryAfter.cashSalesCents, 0, 'La venta anulada no cuenta como venta en efectivo');
  assert.equal(summaryAfter.saleCount, 0, 'La venta anulada no cuenta en el conteo del turno');
  assert.equal(
    summaryAfter.expectedCashCents,
    5000,
    'El efectivo esperado vuelve al fondo inicial sin la venta'
  );
});

test('reintentar la anulación con el mismo operation_id no duplica efectos', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const target = products.find((candidate) => candidate.baseUnit === 'gram');
  assert.ok(target);

  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    items: [{ productId: target.id, quantity: 500 }],
    payment: { method: 'yape', reference: 'yape-001' },
  });

  await voidSale(database, {
    storeId: DEFAULT_STORE_ID,
    saleId: result.sale.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    reason: 'Pedido incorrecto',
  });
  const stockAfterFirstVoid = (await getProductById(database, DEFAULT_STORE_ID, target.id))?.stockQuantity;
  assert.ok(stockAfterFirstVoid !== undefined);

  const second = await voidSale(database, {
    storeId: DEFAULT_STORE_ID,
    saleId: result.sale.id,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    reason: 'Pedido incorrecto',
  });
  assert.equal(second.sale.status, 'voided');

  const stockAfterSecondVoid = (await getProductById(database, DEFAULT_STORE_ID, target.id))?.stockQuantity;
  assert.equal(stockAfterSecondVoid, stockAfterFirstVoid, 'El stock no se restaura dos veces');

  const voidOperations = (await listOutboxByStatus(database, 'pending')).filter(
    (entry) => entry.operationType === 'sale.voided'
  );
  assert.equal(voidOperations.length, 1);
  assert.match(
    voidOperations[0].operationId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test('rechaza anular una venta desde otro dispositivo', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const target = products.find((candidate) => candidate.baseUnit === 'gram');
  assert.ok(target);

  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    items: [{ productId: target.id, quantity: 100 }],
    payment: { method: 'cash', amountReceivedCents: 500 },
  });

  await assert.rejects(
    voidSale(database, {
      storeId: DEFAULT_STORE_ID,
      saleId: result.sale.id,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: 'otro-dispositivo',
      reason: 'Intento externo',
    }),
    /dispositivo original/
  );
});

test('rechaza anular una venta sin motivo', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const target = products.find((candidate) => candidate.baseUnit === 'gram');
  assert.ok(target);

  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    items: [{ productId: target.id, quantity: 100 }],
    payment: { method: 'cash', amountReceivedCents: 500 },
  });

  await assert.rejects(
    voidSale(database, {
      storeId: DEFAULT_STORE_ID,
      saleId: result.sale.id,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      reason: '   ',
    }),
    /motivo/
  );
});
