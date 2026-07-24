import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  listInventoryMovements,
  recordInventoryMovement,
} from '../database/repositories/inventory-repository';
import { listProducts } from '../database/repositories/product-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('registra una salida de 250 gramos y conserva auditoría y outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const product = products.find((candidate) => candidate.baseUnit === 'gram');
  assert.ok(product);
  const initialStock = product.stockQuantity;

  const result = await recordInventoryMovement(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    type: 'sale',
    quantityDelta: -250,
    reason: 'Venta de prueba por peso',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(result.product.stockQuantity, initialStock - 250);
  assert.equal(result.product.version, product.version + 1);
  assert.equal(result.movement.quantityDelta, -250);
  assert.equal(result.movement.actorUserId, DEMO_ADMIN_USER_ID);
  assert.equal(result.movement.deviceId, DEMO_DEVICE_ID);

  const movements = await listInventoryMovements(database, DEFAULT_STORE_ID, product.id);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].id, result.movement.id);

  const pendingOperations = await listOutboxByStatus(database, 'pending');
  assert.equal(pendingOperations.length, 1);
  assert.equal(pendingOperations[0].operationId, result.movement.id);
  assert.equal(pendingOperations[0].operationType, 'inventory_movement.created');

  const payload = JSON.parse(pendingOperations[0].payloadJson) as {
    quantityDelta: number;
    baseUnit: string;
  };
  assert.equal(payload.quantityDelta, -250);
  assert.equal(payload.baseUnit, 'gram');
});

test('registra una salida entera de un producto contable', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const product = products.find((candidate) => candidate.baseUnit === 'unit');
  assert.ok(product);

  const result = await recordInventoryMovement(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    type: 'sale',
    quantityDelta: -3,
    reason: 'Venta de tres unidades',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(result.product.stockQuantity, product.stockQuantity - 3);
  assert.equal(result.movement.quantityDelta, -3);
});

test('rechaza stock negativo y revierte movimiento y outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const product = products.find((candidate) => candidate.baseUnit === 'gram');
  assert.ok(product);

  await assert.rejects(
    recordInventoryMovement(database, {
      storeId: DEFAULT_STORE_ID,
      productId: product.id,
      type: 'adjustment',
      quantityDelta: -(product.stockQuantity + 1),
      reason: 'Ajuste inválido',
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /stock negativo/
  );

  const unchangedProduct = (
    await listProducts(database, DEFAULT_STORE_ID)
  ).find((candidate) => candidate.id === product.id);
  assert.equal(unchangedProduct?.stockQuantity, product.stockQuantity);
  assert.equal(
    (await listInventoryMovements(database, DEFAULT_STORE_ID, product.id)).length,
    0
  );
  assert.equal((await listOutboxByStatus(database, 'pending')).length, 0);
});
