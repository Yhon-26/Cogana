import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculatePresentationPriceCents,
  createProductPresentation,
  listAllProductPresentations,
  listProductPresentations,
  recordPresentationInventoryMovement,
  updateProductPresentation,
} from '../database/repositories/presentation-repository';
import { listProducts } from '../database/repositories/product-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
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
  assert.equal(presentations.length, 3);
  assert.ok(presentations.some((presentation) => presentation.id === packagePresentation.id));
  assert.ok(presentations.some((presentation) => presentation.id === fixedPresentation.id));
});

test('edita y desactiva una presentación con versión optimista y rol administrador', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  assert.ok(product);

  await assert.rejects(
    createProductPresentation(database, {
      storeId: DEFAULT_STORE_ID,
      productId: product.id,
      sku: 'NO-AUT',
      name: 'Sin autorización',
      type: 'package',
      quantityInBaseUnits: 2,
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /administrador/
  );
  const created = await createProductPresentation(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    sku: 'PRES-EDIT',
    name: 'Presentación editable',
    type: 'package',
    quantityInBaseUnits: 5,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  const updated = await updateProductPresentation(database, {
    storeId: DEFAULT_STORE_ID,
    productId: product.id,
    presentationId: created.id,
    expectedVersion: created.version,
    sku: 'PRES-EDIT',
    name: 'Presentación inactiva',
    type: 'box',
    quantityInBaseUnits: 10,
    fixedPriceCents: 999,
    isActive: false,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.isActive, false);
  assert.equal(
    (await listProductPresentations(database, DEFAULT_STORE_ID, product.id)).some(
      (item) => item.id === created.id
    ),
    false
  );
  assert.equal(
    (await listAllProductPresentations(database, DEFAULT_STORE_ID, product.id)).find(
      (item) => item.id === created.id
    )?.name,
    'Presentación inactiva'
  );
});
