import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPurchaseOrder,
  listInventoryLots,
  listPurchaseOrders,
  performPhysicalCount,
  receivePurchaseOrder,
} from '../database/repositories/procurement-repository';
import { createSupplier } from '../database/repositories/supplier-repository';
import { getProductById, listProducts } from '../database/repositories/product-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('crea y recibe una orden de compra con lote, stock y outbox atómicos', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const supplier = await createSupplier(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: 'Mayorista de prueba',
  });
  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  assert.ok(product);
  const initialStock = product.stockQuantity;

  const orderId = await createPurchaseOrder(database, {
    storeId: DEFAULT_STORE_ID,
    supplierId: supplier.id,
    expectedAt: '2026-08-01',
    items: [{ productId: product.id, quantity: product.pricingQuantity * 2, unitCostCents: 350 }],
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  const order = (await listPurchaseOrders(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.id === orderId
  );
  assert.ok(order);
  assert.equal(order.status, 'ordered');
  assert.equal(order.totalCents, 700);

  await receivePurchaseOrder(database, {
    storeId: DEFAULT_STORE_ID,
    purchaseOrderId: orderId,
    items: {
      [order.items[0].id]: { lotCode: 'L-2026-08', expiresAt: '2027-08-01' },
    },
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    initialStock + product.pricingQuantity * 2
  );
  assert.equal((await listPurchaseOrders(database, DEFAULT_STORE_ID))[0].status, 'received');
  const lots = await listInventoryLots(database, DEFAULT_STORE_ID);
  assert.equal(lots.length, 1);
  assert.equal(lots[0].lotCode, 'L-2026-08');
  assert.equal(lots[0].remainingQuantity, product.pricingQuantity * 2);
  const operations = (await listOutboxByStatus(database, 'pending')).map(
    (operation) => operation.operationType
  );
  assert.ok(operations.includes('purchase_order.created'));
  assert.ok(operations.includes('purchase_order.received'));
  assert.ok(operations.includes('inventory_movement.created'));
});

test('recibe una orden de compra en dos visitas parciales del proveedor', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const supplier = await createSupplier(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: 'Mayorista parcial',
  });
  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  assert.ok(product);
  const initialStock = product.stockQuantity;
  const orderedQuantity = product.pricingQuantity * 4;

  const orderId = await createPurchaseOrder(database, {
    storeId: DEFAULT_STORE_ID,
    supplierId: supplier.id,
    items: [{ productId: product.id, quantity: orderedQuantity, unitCostCents: 350 }],
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  const order = (await listPurchaseOrders(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.id === orderId
  );
  assert.ok(order);
  const itemId = order.items[0].id;
  const firstBatch = product.pricingQuantity;

  const firstResult = await receivePurchaseOrder(database, {
    storeId: DEFAULT_STORE_ID,
    purchaseOrderId: orderId,
    items: { [itemId]: { quantity: firstBatch, lotCode: 'L-PARCIAL-1' } },
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(firstResult.status, 'partially_received');
  assert.equal(firstResult.fullyReceived, false);

  const afterFirst = (await listPurchaseOrders(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.id === orderId
  );
  assert.equal(afterFirst?.status, 'partially_received');
  assert.equal(afterFirst?.items[0].receivedQuantity, firstBatch);
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    initialStock + firstBatch
  );

  await assert.rejects(
    receivePurchaseOrder(database, {
      storeId: DEFAULT_STORE_ID,
      purchaseOrderId: orderId,
      items: { [itemId]: { quantity: orderedQuantity } },
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /pendiente/
  );

  const secondResult = await receivePurchaseOrder(database, {
    storeId: DEFAULT_STORE_ID,
    purchaseOrderId: orderId,
    items: { [itemId]: { lotCode: 'L-PARCIAL-2' } },
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(secondResult.status, 'received');
  assert.equal(secondResult.fullyReceived, true);

  const afterSecond = (await listPurchaseOrders(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.id === orderId
  );
  assert.equal(afterSecond?.status, 'received');
  assert.equal(afterSecond?.items[0].receivedQuantity, orderedQuantity);
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    initialStock + orderedQuantity
  );
  const lots = await listInventoryLots(database, DEFAULT_STORE_ID);
  assert.equal(lots.filter((lot) => lot.lotCode.startsWith('L-PARCIAL')).length, 2);
});

test('conteo físico corrige diferencias y requiere administrador', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  assert.ok(product);
  const countedQuantity = product.stockQuantity + 7;

  await assert.rejects(
    performPhysicalCount(database, {
      storeId: DEFAULT_STORE_ID,
      counted: [{ productId: product.id, quantity: countedQuantity }],
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /administrador/
  );
  await performPhysicalCount(database, {
    storeId: DEFAULT_STORE_ID,
    counted: [{ productId: product.id, quantity: countedQuantity }],
    notes: 'Conteo de cierre',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    countedQuantity
  );
  const operation = (await listOutboxByStatus(database, 'pending')).find(
    (candidate) => candidate.operationType === 'physical_count.completed'
  );
  assert.ok(operation);
  const payload = JSON.parse(operation.payloadJson) as {
    items: { differenceQuantity: number }[];
  };
  assert.equal(payload.items[0].differenceQuantity, 7);
});
