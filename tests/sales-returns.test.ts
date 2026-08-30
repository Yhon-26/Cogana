import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getCashSessionSummary,
  openCashSession,
} from '../database/repositories/cash-repository';
import { getProductById, listProducts } from '../database/repositories/product-repository';
import { voidSale } from '../database/repositories/sales-corrections-repository';
import {
  createPartialSaleReturn,
  listSaleReturns,
} from '../database/repositories/sales-return-repository';
import { confirmSale } from '../database/repositories/sales-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('devuelve parcialmente, restaura stock y reduce el efectivo esperado', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const session = await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 1000,
  });
  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'unit'
  );
  assert.ok(product);
  const sale = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{ productId: product.id, quantity: 2 }],
    payment: { method: 'cash', amountReceivedCents: product.priceCents * 2 },
  });
  const beforeReturn = await getCashSessionSummary(
    database,
    DEFAULT_STORE_ID,
    session.id
  );
  await createPartialSaleReturn(database, {
    storeId: DEFAULT_STORE_ID,
    saleId: sale.sale.id,
    items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
    refundMethod: 'cash',
    reason: 'Producto dañado',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  const returns = await listSaleReturns(database, DEFAULT_STORE_ID, sale.sale.id);
  assert.equal(returns.length, 1);
  assert.equal(returns[0].totalCents, product.priceCents);
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    product.stockQuantity - 1
  );
  assert.equal(
    (await getCashSessionSummary(database, DEFAULT_STORE_ID, session.id))
      .expectedCashCents,
    beforeReturn.expectedCashCents - product.priceCents
  );
  assert.ok(
    (await listOutboxByStatus(database, 'pending')).some(
      (operation) => operation.operationType === 'sale.returned'
    )
  );
  await assert.rejects(
    voidSale(database, {
      storeId: DEFAULT_STORE_ID,
      saleId: sale.sale.id,
      reason: 'Ya no procede',
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /devoluciones parciales/
  );
});

test('impide devolver más cantidad que la vendida acumulada', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 0,
  });
  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  assert.ok(product);
  const sale = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{ productId: product.id, quantity: 1000 }],
    payment: { method: 'yape', reference: 'RET-123456' },
  });
  await assert.rejects(
    createPartialSaleReturn(database, {
      storeId: DEFAULT_STORE_ID,
      saleId: sale.sale.id,
      items: [{ saleItemId: sale.items[0].id, quantity: 1001 }],
      refundMethod: 'yape',
      reason: 'Cantidad inválida',
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /excede/
  );
  assert.equal(
    (await listSaleReturns(database, DEFAULT_STORE_ID, sale.sale.id)).length,
    0
  );
});
