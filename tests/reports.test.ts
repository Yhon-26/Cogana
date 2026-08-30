import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openCashSession } from '../database/repositories/cash-repository';
import { listProducts } from '../database/repositories/product-repository';
import { getReportDashboard } from '../database/repositories/report-repository';
import { createPartialSaleReturn } from '../database/repositories/sales-return-repository';
import { confirmSale } from '../database/repositories/sales-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('los reportes descuentan devoluciones parciales de ventas, pagos y margen', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 0,
  });
  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.priceCents === 850 && candidate.costCents === 620
  );
  assert.ok(product);
  const sale = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{ productId: product.id, quantity: 1000 }],
    payment: { method: 'card', reference: 'TEST-REPORT' },
  });
  await createPartialSaleReturn(database, {
    storeId: DEFAULT_STORE_ID,
    saleId: sale.sale.id,
    items: [{ saleItemId: sale.items[0].id, quantity: 500 }],
    refundMethod: 'card',
    reason: 'Prueba de reporte neto',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  const report = await getReportDashboard(database, DEFAULT_STORE_ID);
  assert.equal(report.sales.saleCount, 1);
  assert.equal(report.sales.totalCents, 425);
  assert.equal(report.sales.estimatedCostCents, 310);
  assert.equal(report.sales.estimatedMarginCents, 115);
  assert.equal(report.products[0].quantity, 500);
  assert.equal(report.products[0].salesCents, 425);
  assert.equal(report.payments[0].totalCents, 425);
});
