import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listInventoryMovements } from '../database/repositories/inventory-repository';
import {
  createProduct,
  getProductById,
  updateProduct,
} from '../database/repositories/product-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('crea producto con stock inicial, movimiento y outbox atómicos', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const product = await createProduct(database, {
    storeId: DEFAULT_STORE_ID,
    sku: '  arr-001 ',
    name: ' Arroz   Superior ',
    category: ' Arroz ',
    baseUnit: 'gram',
    pricingQuantity: 1000,
    priceCents: 520,
    costCents: 410,
    initialStockQuantity: 25_000,
    minimumStockQuantity: 5_000,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(product.sku, 'ARR-001');
  assert.equal(product.name, 'Arroz Superior');
  assert.equal(product.stockQuantity, 25_000);
  const movements = await listInventoryMovements(
    database,
    DEFAULT_STORE_ID,
    product.id
  );
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type, 'opening');
  assert.equal(movements[0].quantityDelta, 25_000);
  const outbox = await listOutboxByStatus(database, 'pending');
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].operationType, 'product.created');
  assert.equal(JSON.parse(outbox[0].payloadJson).initialStockQuantity, 25_000);
});

test('edita metadatos con versión optimista sin alterar el stock', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const product = await createProduct(database, {
    storeId: DEFAULT_STORE_ID,
    sku: 'FRE-001',
    name: 'Frejol',
    category: 'Menestras',
    baseUnit: 'gram',
    pricingQuantity: 1000,
    priceCents: 800,
    costCents: 600,
    initialStockQuantity: 10_000,
    minimumStockQuantity: 2_000,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  const updated = await updateProduct(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    expectedVersion: product.version,
    sku: product.sku,
    name: 'Frejol Canario',
    category: product.category,
    baseUnit: product.baseUnit,
    pricingQuantity: product.pricingQuantity,
    priceCents: product.priceCents,
    costCents: 650,
    minimumStockQuantity: 3_000,
    isActive: true,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(updated.name, 'Frejol Canario');
  assert.equal(updated.stockQuantity, 10_000);
  assert.equal(updated.version, product.version + 1);
  assert.equal(
    (await listOutboxByStatus(database, 'pending')).at(-1)?.operationType,
    'product.updated'
  );
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.costCents,
    650
  );
});

test('solo administrador crea productos y el SKU no se duplica', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const input = {
    storeId: DEFAULT_STORE_ID,
    sku: 'NUEVO-1',
    name: 'Producto nuevo',
    category: 'General',
    baseUnit: 'unit' as const,
    pricingQuantity: 1,
    priceCents: 100,
    costCents: 50,
    initialStockQuantity: 2,
    minimumStockQuantity: 1,
    deviceId: DEMO_DEVICE_ID,
  };
  await assert.rejects(
    createProduct(database, { ...input, actorUserId: DEMO_HUSBAND_USER_ID }),
    /Solo un administrador/
  );
  await createProduct(database, { ...input, actorUserId: DEMO_ADMIN_USER_ID });
  await assert.rejects(
    createProduct(database, {
      ...input,
      sku: 'nuevo-1',
      actorUserId: DEMO_ADMIN_USER_ID,
    }),
    /ese código/
  );
});
