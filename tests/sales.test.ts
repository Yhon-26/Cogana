import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  calculateLineTotalCents,
  calculateQuantityForAmountCents,
  roundIntegerRatio,
} from '../database/integer-calculations';
import {
  getCashSessionSummary,
  openCashSession,
} from '../database/repositories/cash-repository';
import { listInventoryMovements } from '../database/repositories/inventory-repository';
import { listActivePresentations } from '../database/repositories/presentation-repository';
import {
  getProductById,
  listProducts,
} from '../database/repositories/product-repository';
import { confirmSale } from '../database/repositories/sales-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
  DEMO_WIFE_USER_ID,
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

test('redondea proporciones con la mitad hacia arriba', () => {
  assert.equal(roundIntegerRatio(1, 1, 2), 1);
  assert.equal(roundIntegerRatio(3, 1, 2), 2);
  assert.equal(roundIntegerRatio(1, 1, 3), 0);
  assert.equal(roundIntegerRatio(2, 1, 3), 1);
});

test('confirma venta de 250 gramos, calcula vuelto y relaciona el movimiento', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'gram'
  );
  assert.ok(product);

  const expectedTotal = calculateLineTotalCents(250, product.priceCents, 1000);
  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    items: [{ productId: product.id, quantity: 250 }],
    payment: { method: 'cash', amountReceivedCents: 300 },
  });

  assert.equal(result.items[0].quantity, 250);
  assert.equal(result.sale.totalCents, expectedTotal);
  assert.equal(result.payment.changeCents, 300 - expectedTotal);
  assert.equal(result.sale.actorUserId, DEMO_HUSBAND_USER_ID);
  assert.match(result.sale.receiptNumber, /^V-[A-Z0-9]+-\d{6}$/);

  const updated = await getProductById(database, DEFAULT_STORE_ID, product.id);
  assert.equal(updated?.stockQuantity, product.stockQuantity - 250);

  const movements = await listInventoryMovements(
    database,
    DEFAULT_STORE_ID,
    product.id
  );
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantityDelta, -250);
  assert.equal(movements[0].referenceId, result.sale.id);
  assert.equal(movements[0].actorUserId, DEMO_HUSBAND_USER_ID);
});

test('confirma venta de producto contable por unidades enteras', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'unit'
  );
  assert.ok(product);

  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_WIFE_USER_ID,
    items: [{ productId: product.id, quantity: 2 }],
    payment: { method: 'cash', amountReceivedCents: product.priceCents * 2 },
  });

  assert.equal(result.items[0].baseUnitSnapshot, 'unit');
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.sale.totalCents, product.priceCents * 2);
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    product.stockQuantity - 2
  );
});

test('confirma venta mediante presentación y conserva sus snapshots', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const presentation = (await listActivePresentations(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.type === 'package'
  );
  assert.ok(presentation);
  const product = await getProductById(
    database,
    DEFAULT_STORE_ID,
    presentation.productId
  );
  assert.ok(product);

  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{
      productId: product.id,
      presentationId: presentation.id,
      presentationCount: 1,
    }],
    payment: {
      method: 'cash',
      amountReceivedCents: presentation.fixedPriceCents ?? product.priceCents * 6,
    },
  });

  assert.equal(result.items[0].quantity, presentation.quantityInBaseUnits);
  assert.equal(result.items[0].presentationId, presentation.id);
  assert.equal(result.items[0].presentationNameSnapshot, presentation.name);
  assert.equal(result.items[0].presentationCount, 1);
  assert.equal(result.sale.totalCents, presentation.fixedPriceCents);
});

test('convierte una venta solicitada por monto y cobra el peso entero final', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'gram'
  );
  assert.ok(product);
  const requestedAmountCents = 1000;
  const finalQuantity = calculateQuantityForAmountCents(
    requestedAmountCents,
    product.priceCents,
    product.pricingQuantity
  );
  const actualTotalCents = calculateLineTotalCents(
    finalQuantity,
    product.priceCents,
    product.pricingQuantity
  );

  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{ productId: product.id, quantity: finalQuantity }],
    payment: { method: 'cash', amountReceivedCents: actualTotalCents },
  });

  assert.equal(result.items[0].quantity, finalQuantity);
  assert.equal(result.sale.totalCents, actualTotalCents);
});

test('Yape, Plin y tarjeta no aumentan el efectivo esperado', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const session = await openDemoCash(database, 5000);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'gram'
  );
  assert.ok(product);

  for (const method of ['yape', 'plin', 'card'] as const) {
    const result = await confirmSale(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      items: [{ productId: product.id, quantity: 100 }],
      payment: { method, reference: `REF-${method}` },
    });
    assert.equal(result.payment.method, method);
    assert.equal(result.payment.reference, `REF-${method}`);
    assert.equal(result.payment.amountReceivedCents, null);
    assert.equal(result.payment.changeCents, 0);
  }

  const summary = await getCashSessionSummary(
    database,
    DEFAULT_STORE_ID,
    session.id
  );
  assert.equal(summary.saleCount, 3);
  assert.equal(summary.cashSalesCents, 0);
  assert.equal(summary.expectedCashCents, 5000);
  assert.ok(summary.totalSalesCents > 0);
});

test('Yape y Plin requieren un código validado antes de persistir', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'unit'
  );
  assert.ok(product);

  await assert.rejects(
    confirmSale(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      items: [{ productId: product.id, quantity: 1 }],
      payment: { method: 'yape' },
    }),
    /código de operación validado/
  );
  assert.equal(
    (await database.getFirst<{ total: number }>('SELECT COUNT(*) AS total FROM sales'))
      ?.total,
    0
  );
});

test('combina efectivo y Yape, calcula vuelto por tramo y conserva ambos pagos', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const session = await openDemoCash(database, 1000);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'unit'
  );
  assert.ok(product);

  const totalCents = product.priceCents * 2;
  const cashCents = Math.floor(totalCents / 2);
  const yapeCents = totalCents - cashCents;
  const result = await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{ productId: product.id, quantity: 2 }],
    payments: [
      {
        method: 'cash',
        amountCents: cashCents,
        amountReceivedCents: cashCents + 50,
      },
      {
        method: 'yape',
        amountCents: yapeCents,
        reference: 'YAPE-DO04',
      },
    ],
  });

  assert.equal(result.payments.length, 2);
  const cashPayment = result.payments.find((payment) => payment.method === 'cash');
  const yapePayment = result.payments.find((payment) => payment.method === 'yape');
  assert.equal(cashPayment?.amountCents, cashCents);
  assert.equal(cashPayment?.changeCents, 50);
  assert.equal(yapePayment?.amountCents, yapeCents);
  assert.equal(yapePayment?.reference, 'YAPE-DO04');

  const summary = await getCashSessionSummary(
    database,
    DEFAULT_STORE_ID,
    session.id
  );
  assert.equal(summary.cashSalesCents, cashCents);
  assert.equal(summary.expectedCashCents, 1000 + cashCents);

  const saleOperation = (await listOutboxByStatus(database, 'pending')).find(
    (operation) => operation.operationType === 'sale.confirmed'
  );
  assert.ok(saleOperation);
  const payload = JSON.parse(saleOperation.payloadJson) as {
    payments: { method: string; amountCents: number }[];
    payment?: unknown;
  };
  assert.deepEqual(
    payload.payments.map((payment) => [payment.method, payment.amountCents]),
    [
      ['cash', cashCents],
      ['yape', yapeCents],
    ]
  );
  assert.equal(payload.payment, undefined);
});

test('rechaza pagos combinados cuya suma no coincide y no deja venta parcial', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'unit'
  );
  assert.ok(product);

  const totalCents = product.priceCents;
  await assert.rejects(
    confirmSale(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [
        {
          method: 'cash',
          amountCents: totalCents - 2,
          amountReceivedCents: totalCents,
        },
        { method: 'plin', amountCents: 1, reference: '123456' },
      ],
    }),
    /suma de los pagos/
  );

  assert.equal(
    (await database.getFirst<{ total: number }>('SELECT COUNT(*) AS total FROM sales'))
      ?.total,
    0
  );
  assert.equal(
    (await database.getFirst<{ total: number }>('SELECT COUNT(*) AS total FROM payments'))
      ?.total,
    0
  );
});

test('rechaza repetir un medio dentro de una venta combinada', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.baseUnit === 'unit'
  );
  assert.ok(product);

  const totalCents = product.priceCents;
  const firstPart = Math.floor(totalCents / 2);
  await assert.rejects(
    confirmSale(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [
        { method: 'yape', amountCents: firstPart, reference: '123456' },
        {
          method: 'yape',
          amountCents: totalCents - firstPart,
          reference: '654321',
        },
      ],
    }),
    /solo puede agregarse una vez/
  );
});

test('rechaza stock insuficiente sin guardar una venta parcial', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  await assert.rejects(
    confirmSale(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      items: [{
        productId: product.id,
        quantity: product.stockQuantity + 1,
      }],
      payment: { method: 'cash', amountReceivedCents: 99999999 },
    }),
    /Stock insuficiente/
  );

  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    product.stockQuantity
  );
  assert.equal(
    (await database.getFirst<{ total: number }>('SELECT COUNT(*) AS total FROM sales'))
      ?.total,
    0
  );
});

test('revierte venta, ítems, pago, stock, comprobante y outbox ante un fallo', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  const pendingBefore = (await listOutboxByStatus(database, 'pending')).length;
  await database.exec(`
    CREATE TRIGGER reject_test_payment
    BEFORE INSERT ON payments
    BEGIN
      SELECT RAISE(ABORT, 'fallo de pago simulado');
    END
  `);

  await assert.rejects(
    confirmSale(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      items: [{ productId: product.id, quantity: 250 }],
      payment: { method: 'cash', amountReceivedCents: 1000 },
    }),
    /fallo de pago simulado/
  );

  for (const table of ['sales', 'sale_items', 'payments', 'inventory_movements']) {
    const row = await database.getFirst<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ${table}`
    );
    assert.equal(row?.total, 0, table);
  }
  assert.equal(
    (await database.getFirst<{ total: number }>(
      'SELECT COUNT(*) AS total FROM local_receipt_sequences'
    ))?.total,
    0
  );
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    product.stockQuantity
  );
  assert.equal((await listOutboxByStatus(database, 'pending')).length, pendingBefore);
});

test('reintentar el mismo operation_id no duplica venta ni outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openDemoCash(database);

  const product = (await listProducts(database, DEFAULT_STORE_ID))[0];
  const operationId = '70000000-0000-4000-8000-000000000001';
  const input = {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    operationId,
    items: [{ productId: product.id, quantity: 250 }],
    payment: { method: 'cash' as const, amountReceivedCents: 1000 },
  };

  const first = await confirmSale(database, input);
  const pendingAfterFirst = await listOutboxByStatus(database, 'pending');
  const second = await confirmSale(database, input);
  const pendingAfterSecond = await listOutboxByStatus(database, 'pending');

  assert.equal(second.sale.id, first.sale.id);
  assert.equal(pendingAfterSecond.length, pendingAfterFirst.length);
  assert.equal(
    (await database.getFirst<{ total: number }>('SELECT COUNT(*) AS total FROM sales'))
      ?.total,
    1
  );

  const duplicates = await database.getAll<{ operation_id: string; total: number }>(
    `SELECT operation_id, COUNT(*) AS total
     FROM sync_outbox
     GROUP BY store_id, operation_id
     HAVING COUNT(*) > 1`
  );
  assert.equal(duplicates.length, 0);
});
