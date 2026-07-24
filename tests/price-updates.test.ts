import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listProducts } from '../database/repositories/product-repository';
import {
  listPriceHistory,
  updateProductPrice,
} from '../database/repositories/price-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('actualiza el precio en céntimos y conserva historial, auditoría y outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const [product] = await listProducts(database, DEFAULT_STORE_ID);
  const newPriceCents = product.priceCents + 75;

  const updatedProduct = await updateProductPrice(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    newPriceCents,
    reason: 'Cambio de prueba',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(updatedProduct.priceCents, newPriceCents);
  assert.equal(updatedProduct.version, product.version + 1);

  const history = await listPriceHistory(database, DEFAULT_STORE_ID, product.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].previousPriceCents, product.priceCents);
  assert.equal(history[0].newPriceCents, newPriceCents);
  assert.equal(history[0].actorUserId, DEMO_ADMIN_USER_ID);
  assert.equal(history[0].deviceId, DEMO_DEVICE_ID);

  const pendingOperations = await listOutboxByStatus(database, 'pending');
  assert.equal(pendingOperations.length, 1);
  assert.equal(pendingOperations[0].operationId, history[0].id);
  assert.equal(pendingOperations[0].operationType, 'product.price_updated');
});

test('no duplica historial ni outbox cuando el precio no cambia', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const [product] = await listProducts(database, DEFAULT_STORE_ID);

  const unchangedProduct = await updateProductPrice(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    newPriceCents: product.priceCents,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(unchangedProduct.version, product.version);
  assert.equal((await listPriceHistory(database, DEFAULT_STORE_ID, product.id)).length, 0);
  assert.equal((await listOutboxByStatus(database, 'pending')).length, 0);
});
