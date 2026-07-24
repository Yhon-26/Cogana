import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculatePresentationPriceCents,
  createProductPresentation,
  listProductPresentations,
  recordPresentationInventoryMovement,
} from '../database/repositories/presentation-repository';
import { listProducts } from '../database/repositories/product-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('convierte una presentación a unidades base y calcula o fija su precio', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const products = await listProducts(database, DEFAULT_STORE_ID);
  const product = products.find((candidate) => candidate.baseUnit === 'unit');
  assert.ok(product);

  const packagePresentation = await createProductPresentation(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    sku: `${product.sku}-P06`,
    name: 'Paquete de 6',
    type: 'package',
    quantityInBaseUnits: 6,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  assert.equal(
    calculatePresentationPriceCents(product, packagePresentation),
    product.priceCents * 6
  );

  const result = await recordPresentationInventoryMovement(database, {
    storeId: DEFAULT_STORE_ID,
    presentationId: packagePresentation.id,
    presentationCountDelta: -2,
    reason: 'Salida de dos paquetes',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(result.movement.quantityDelta, -12);
  assert.equal(result.product.stockQuantity, product.stockQuantity - 12);

  const fixedPresentation = await createProductPresentation(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    sku: `${product.sku}-C12`,
    name: 'Caja de 12',
    type: 'box',
    quantityInBaseUnits: 12,
    fixedPriceCents: 7000,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(calculatePresentationPriceCents(product, fixedPresentation), 7000);

  const presentations = await listProductPresentations(
    database,
    DEFAULT_STORE_ID,
    product.id
  );
  assert.equal(presentations.length, 2);
});
