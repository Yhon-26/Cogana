import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getProductById } from '../database/repositories/product-repository';
import { openCashSession } from '../database/repositories/cash-repository';
import { confirmSale } from '../database/repositories/sales-repository';
import {
  enqueueOperation,
  listOutboxByStatus,
} from '../database/repositories/sync-outbox-repository';
import { getLocalSyncState } from '../database/repositories/sync-state-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_HUSBAND_USER_ID,
  DEMO_DEVICE_ID,
} from '../database/seed';
import type {
  PullChange,
  PullChangesResponse,
  PushBatchResponse,
  SyncTransport,
} from '../sync/contracts';
import { runSyncCycle } from '../sync/sync-engine';
import { SupabaseSyncTransport } from '../sync/supabase-sync-transport';
import { createTestDatabase } from './helpers/test-database';

const PRODUCT_ID = '81000000-0000-4000-8000-000000000001';
const PRESENTATION_ID = '81000000-0000-4000-8000-000000000002';
const OPERATION_ID = '81000000-0000-4000-8000-000000000003';
const OUTBOX_ID = '81000000-0000-4000-8000-000000000004';
const SUPPLIER_ID = '81000000-0000-4000-8000-000000000005';
const DELIVERY_ZONE_ID = '81000000-0000-4000-8000-000000000006';
const ORDER_ID = '81000000-0000-4000-8000-000000000007';
const CUSTOMER_ID = '81000000-0000-4000-8000-000000000008';
const ADDRESS_ID = '81000000-0000-4000-8000-000000000009';
const ORDER_ITEM_ID = '81000000-0000-4000-8000-000000000010';
const ORDER_HISTORY_ID = '81000000-0000-4000-8000-000000000011';
const DEMO_LENTIL_ID = '10000000-0000-4000-8000-000000000001';
const DEMO_TUNA_ID = '10000000-0000-4000-8000-000000000008';
const NOW = new Date('2026-07-26T15:00:00.000Z');

function emptyPull(cursor: number): PullChangesResponse {
  return {
    schemaVersion: 1,
    changes: [],
    nextCursor: cursor,
    hasMore: false,
    serverTime: NOW.toISOString(),
  };
}

class FakeTransport implements SyncTransport {
  readonly pushes: Parameters<SyncTransport['push']>[0][] = [];
  readonly pulls: Parameters<SyncTransport['pull']>[0][] = [];

  constructor(
    private readonly pushHandler: (
      input: Parameters<SyncTransport['push']>[0]
    ) => Promise<PushBatchResponse> = async (input) => ({
      schemaVersion: 1,
      results: input.operations.map((operation) => ({
        operationId: operation.operation_id,
        status: 'applied',
        result: { accepted: true },
        errorCode: null,
        errorMessage: null,
      })),
      serverTime: NOW.toISOString(),
    }),
    private readonly pullHandler: (
      input: Parameters<SyncTransport['pull']>[0]
    ) => Promise<PullChangesResponse> = async (input) => emptyPull(input.cursor)
  ) {}

  push(input: Parameters<SyncTransport['push']>[0]) {
    this.pushes.push(input);
    return this.pushHandler(input);
  }

  pull(input: Parameters<SyncTransport['pull']>[0]) {
    this.pulls.push(input);
    return this.pullHandler(input);
  }
}

async function enqueuePriceChange(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  await enqueueOperation(database, {
    id: OUTBOX_ID,
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    operationId: OPERATION_ID,
    entityType: 'price_history',
    entityId: OPERATION_ID,
    operationType: 'product.price_updated',
    payload: {
      id: OPERATION_ID,
      storeId: DEFAULT_STORE_ID,
      productId: PRODUCT_ID,
      newPriceCents: 990,
      reason: 'Prueba de sincronizacion',
      deviceId: DEMO_DEVICE_ID,
    },
    timestamp: NOW.toISOString(),
  });
}

function productChange(sequence: number, overrides: Partial<PullChange> = {}): PullChange {
  return {
    sequence,
    entityType: 'product',
    entityId: PRODUCT_ID,
    operation: 'upsert',
    version: 3,
    payload: {
      id: PRODUCT_ID,
      store_id: DEFAULT_STORE_ID,
      sku: 'SYNC-001',
      name: 'Producto sincronizado',
      category_name: 'Sincronizacion',
      base_unit: 'unit',
      pricing_quantity: 1,
      price_cents: 750,
      cost_cents: 500,
      stock_quantity: 20,
      minimum_stock_quantity: 4,
      is_active: true,
      created_at: '2026-07-26T14:00:00.000Z',
      updated_at: '2026-07-26T14:30:00.000Z',
      version: 3,
    },
    changedAt: '2026-07-26T14:30:00.000Z',
    sourceDeviceId: null,
    operationId: null,
    ...overrides,
  };
}

function presentationChange(sequence: number): PullChange {
  return {
    sequence,
    entityType: 'product_presentation',
    entityId: PRESENTATION_ID,
    operation: 'upsert',
    version: 2,
    payload: {
      id: PRESENTATION_ID,
      store_id: DEFAULT_STORE_ID,
      product_id: PRODUCT_ID,
      sku: 'SYNC-001-BOX',
      name: 'Caja sincronizada',
      kind: 'box',
      conversion_factor: 12,
      price_mode: 'fixed',
      fixed_price_cents: 8000,
      is_active: true,
      created_at: '2026-07-26T14:10:00.000Z',
      updated_at: '2026-07-26T14:40:00.000Z',
      version: 2,
    },
    changedAt: '2026-07-26T14:40:00.000Z',
    sourceDeviceId: null,
    operationId: null,
  };
}

function supplierChange(sequence: number): PullChange {
  return {
    sequence,
    entityType: 'supplier',
    entityId: SUPPLIER_ID,
    operation: 'upsert',
    version: 2,
    payload: {
      id: SUPPLIER_ID,
      store_id: DEFAULT_STORE_ID,
      name: 'Proveedor sincronizado',
      tax_id: '20123456789',
      contact_name: 'Contacto central',
      phone: '999 888 777',
      email: 'central@proveedor.pe',
      address: null,
      notes: null,
      is_active: true,
      created_by: DEMO_HUSBAND_USER_ID,
      updated_by: DEMO_HUSBAND_USER_ID,
      created_at: '2026-07-26T14:00:00.000Z',
      updated_at: '2026-07-26T14:45:00.000Z',
      version: 2,
    },
    changedAt: '2026-07-26T14:45:00.000Z',
    sourceDeviceId: null,
    operationId: null,
  };
}

function deliveryZoneChange(sequence: number): PullChange {
  return {
    sequence,
    entityType: 'delivery_zone',
    entityId: DELIVERY_ZONE_ID,
    operation: 'upsert',
    version: 4,
    payload: {
      id: DELIVERY_ZONE_ID,
      store_id: DEFAULT_STORE_ID,
      name: 'Zona sincronizada',
      district: 'Santa Anita',
      fee_cents: 650,
      minimum_order_cents: 3000,
      eta_min_minutes: 25,
      eta_max_minutes: 45,
      schedule_text: 'Lun–Sáb 09:00–18:00',
      restrictions: null,
      is_active: true,
      created_by: DEMO_HUSBAND_USER_ID,
      updated_by: DEMO_HUSBAND_USER_ID,
      created_at: '2026-07-26T14:00:00.000Z',
      updated_at: '2026-07-26T14:50:00.000Z',
      version: 4,
    },
    changedAt: '2026-07-26T14:50:00.000Z',
    sourceDeviceId: null,
    operationId: null,
  };
}

function orderChange(sequence: number): PullChange {
  return {
    sequence,
    entityType: 'order',
    entityId: ORDER_ID,
    operation: 'order.status_changed',
    version: 3,
    payload: {
      id: ORDER_ID,
      store_id: DEFAULT_STORE_ID,
      operation_id: ORDER_ID,
      order_number: 'P-SYNC-00001',
      customer_id: CUSTOMER_ID,
      source: 'online',
      fulfillment_type: 'delivery',
      address_id: ADDRESS_ID,
      delivery_zone_id: DELIVERY_ZONE_ID,
      status: 'weight_review',
      payment_status: 'pending',
      estimated_subtotal_cents: 850,
      delivery_fee_cents: 650,
      estimated_total_cents: 1500,
      final_subtotal_cents: 935,
      final_total_cents: 1585,
      notes: 'Tocar timbre',
      actor_user_id: DEMO_HUSBAND_USER_ID,
      device_id: DEMO_DEVICE_ID,
      created_at: '2026-07-26T14:00:00.000Z',
      updated_at: '2026-07-26T14:55:00.000Z',
      version: 3,
      customer: {
        id: CUSTOMER_ID,
        auth_user_id: null,
        customer_type: 'retail',
        name: 'Cliente sincronizado',
        phone: '999555666',
        email: null,
        status: 'active',
        created_at: '2026-07-26T14:00:00.000Z',
        updated_at: '2026-07-26T14:00:00.000Z',
        version: 1,
      },
      address: {
        id: ADDRESS_ID,
        label: 'Principal',
        address: 'Av. Principal 123',
        district: 'Santa Anita',
        instructions: 'Puerta verde',
        delivery_zone_id: DELIVERY_ZONE_ID,
        is_default: true,
        created_at: '2026-07-26T14:00:00.000Z',
        updated_at: '2026-07-26T14:00:00.000Z',
        version: 1,
      },
      items: [
        {
          id: ORDER_ITEM_ID,
          product_id: DEMO_LENTIL_ID,
          product_name_snapshot: 'Lenteja canadiense',
          base_unit_snapshot: 'gram',
          requested_quantity: 1000,
          prepared_quantity: 1100,
          price_cents_snapshot: 850,
          pricing_quantity_snapshot: 1000,
          estimated_cents: 850,
          final_cents: 935,
          substitution_policy: 'contact',
          created_at: '2026-07-26T14:00:00.000Z',
          updated_at: '2026-07-26T14:55:00.000Z',
          version: 2,
        },
      ],
      history: [
        {
          id: ORDER_HISTORY_ID,
          operation_id: '81000000-0000-4000-8000-000000000012',
          from_status: 'preparing',
          to_status: 'weight_review',
          reason: 'Cantidad real distinta; requiere aprobación',
          actor_user_id: DEMO_HUSBAND_USER_ID,
          device_id: DEMO_DEVICE_ID,
          created_at: '2026-07-26T14:55:00.000Z',
          updated_at: '2026-07-26T14:55:00.000Z',
          version: 1,
        },
      ],
    },
    changedAt: '2026-07-26T14:55:00.000Z',
    sourceDeviceId: DEMO_DEVICE_ID,
    operationId: '81000000-0000-4000-8000-000000000012',
  };
}

test('push envia la outbox pendiente y conserva el resultado idempotente', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await enqueuePriceChange(database);
  const transport = new FakeTransport();

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.pushed, 1);
  assert.equal(transport.pushes.length, 1);
  assert.equal(transport.pushes[0].operations[0].operation_id, OPERATION_ID);
  assert.equal((await listOutboxByStatus(database, 'synced')).length, 1);
  const synced = (await listOutboxByStatus(database, 'synced'))[0];
  assert.equal(synced.attempts, 1);
  assert.deepEqual(JSON.parse(synced.serverResultJson ?? 'null'), { accepted: true });
});

test('push drena varios lotes y renueva el lease durante el ciclo', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  for (let index = 1; index <= 3; index += 1) {
    const suffix = String(index).padStart(12, '0');
    await enqueueOperation(database, {
      id: `82000000-0000-4000-8000-${suffix}`,
      storeId: DEFAULT_STORE_ID,
      actorUserId: DEMO_HUSBAND_USER_ID,
      operationId: `83000000-0000-4000-8000-${suffix}`,
      entityType: 'test',
      entityId: `84000000-0000-4000-8000-${suffix}`,
      operationType: 'test.created',
      payload: { index },
      timestamp: NOW.toISOString(),
    });
  }
  const transport = new FakeTransport();
  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    pushBatchSize: 1,
    maxPushBatches: 5,
    leaseDurationMs: 1_000,
    now: () => NOW,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.pushed, 3);
  assert.equal(transport.pushes.length, 3);
  const state = await getLocalSyncState(
    database,
    DEFAULT_STORE_ID,
    DEMO_DEVICE_ID
  );
  assert.equal(state?.leaseOwner, null);
  assert.equal(state?.leaseExpiresAt, null);
});

test('duplicate del servidor tambien confirma la operacion local', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await enqueuePriceChange(database);
  const transport = new FakeTransport(async (input) => ({
    schemaVersion: 1,
    results: input.operations.map((operation) => ({
      operationId: operation.operation_id,
      status: 'duplicate',
      result: { acceptedPreviously: true },
      errorCode: null,
      errorMessage: null,
    })),
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.pushed, 1);
  assert.equal((await listOutboxByStatus(database, 'synced')).length, 1);
});

test('push ordena apertura y venta antes de movimientos de inventario derivados', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await openCashSession(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    responsibleUserId: DEMO_HUSBAND_USER_ID,
    openingCashCents: 1000,
  });
  const product = await database.getFirst<{ id: string }>(
    'SELECT id FROM products WHERE store_id = ? ORDER BY id LIMIT 1',
    [DEFAULT_STORE_ID]
  );
  assert.ok(product);
  await confirmSale(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    items: [{ productId: product.id, quantity: 100 }],
    payment: { method: 'cash', amountReceivedCents: 1000 },
  });
  const transport = new FakeTransport();

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  const operationTypes = transport.pushes[0].operations.map(
    (operation) => operation.operation_type
  );
  assert.equal(operationTypes[0], 'cash_session.opened');
  assert.ok(
    operationTypes.indexOf('sale.confirmed') <
      operationTypes.indexOf('inventory_movement.created')
  );
});

test('rechazo de dominio queda visible y no entra en reintento automatico', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await enqueuePriceChange(database);
  const transport = new FakeTransport(async (input) => ({
    schemaVersion: 1,
    results: input.operations.map((operation) => ({
      operationId: operation.operation_id,
      status: 'rejected',
      result: null,
      errorCode: 'conflict',
      errorMessage: 'El producto cambio en el servidor.',
    })),
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.rejected, 1);
  const errored = (await listOutboxByStatus(database, 'error'))[0];
  assert.equal(errored.isTerminal, true);
  assert.equal(errored.errorCode, 'conflict');
  assert.equal(errored.nextAttemptAt, null);
});

test('fallo de transporte conserva la outbox y programa backoff', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await enqueuePriceChange(database);
  const transport = new FakeTransport(async () => {
    throw new Error('Sin internet');
  });

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    retryBaseMs: 1000,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'offline');
  assert.equal(result.error, 'Sin internet');
  const errored = (await listOutboxByStatus(database, 'error'))[0];
  assert.equal(errored.isTerminal, false);
  assert.equal(errored.attempts, 1);
  assert.equal(errored.nextAttemptAt, '2026-07-26T15:00:02.000Z');
  const state = await getLocalSyncState(database, DEFAULT_STORE_ID, DEMO_DEVICE_ID);
  assert.equal(state?.consecutiveFailures, 1);
});

test('pull aplica producto y presentacion en una transaccion y avanza cursor', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const transport = new FakeTransport(undefined, async () => ({
    schemaVersion: 1,
    changes: [productChange(1), presentationChange(2)],
    nextCursor: 2,
    hasMore: false,
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.pulled, 2);
  assert.equal(result.cursor, 2);
  const product = await getProductById(database, DEFAULT_STORE_ID, PRODUCT_ID);
  assert.equal(product?.name, 'Producto sincronizado');
  assert.equal(product?.priceCents, 750);
  const presentation = await database.getFirst<{ name: string; fixed_price_cents: number }>(
    'SELECT name, fixed_price_cents FROM product_presentations WHERE id = ?',
    [PRESENTATION_ID]
  );
  assert.equal(presentation?.name, 'Caja sincronizada');
  assert.equal(presentation?.fixed_price_cents, 8000);
  assert.equal(
    (
      await database.getFirst<{ total: number }>(
        'SELECT COUNT(*) AS total FROM sync_inbox WHERE store_id = ?',
        [DEFAULT_STORE_ID]
      )
    )?.total,
    2
  );
});

test('pull aplica el directorio de proveedores sin crear otra outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const transport = new FakeTransport(undefined, async () => ({
    schemaVersion: 1,
    changes: [supplierChange(1)],
    nextCursor: 1,
    hasMore: false,
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  const supplier = await database.getFirst<{
    name: string;
    tax_id: string;
    version: number;
  }>('SELECT name, tax_id, version FROM suppliers WHERE id = ?', [SUPPLIER_ID]);
  assert.equal(supplier?.name, 'Proveedor sincronizado');
  assert.equal(supplier?.tax_id, '20123456789');
  assert.equal(supplier?.version, 2);
  assert.equal((await listOutboxByStatus(database, 'pending')).length, 0);
});

test('pull aplica zonas de delivery sin crear otra outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const transport = new FakeTransport(undefined, async () => ({
    schemaVersion: 1,
    changes: [deliveryZoneChange(1)],
    nextCursor: 1,
    hasMore: false,
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  const zone = await database.getFirst<{
    name: string;
    fee_cents: number;
    version: number;
  }>('SELECT name, fee_cents, version FROM delivery_zones WHERE id = ?', [
    DELIVERY_ZONE_ID,
  ]);
  assert.equal(zone?.name, 'Zona sincronizada');
  assert.equal(zone?.fee_cents, 650);
  assert.equal(zone?.version, 4);
  assert.equal((await listOutboxByStatus(database, 'pending')).length, 0);
});

test('pull aplica pedido, cliente, dirección, items e historial sin otra outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const transport = new FakeTransport(undefined, async () => ({
    schemaVersion: 1,
    changes: [deliveryZoneChange(1), orderChange(2)],
    nextCursor: 2,
    hasMore: false,
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.pulled, 2);
  const order = await database.getFirst<{
    status: string;
    final_total_cents: number;
    version: number;
  }>('SELECT status, final_total_cents, version FROM orders WHERE id = ?', [ORDER_ID]);
  assert.equal(order?.status, 'weight_review');
  assert.equal(order?.final_total_cents, 1585);
  assert.equal(order?.version, 3);
  assert.equal(
    (
      await database.getFirst<{ total: number }>(
        'SELECT count(*) AS total FROM order_status_history WHERE order_id = ?',
        [ORDER_ID]
      )
    )?.total,
    1
  );
  assert.equal((await listOutboxByStatus(database, 'pending')).length, 0);
});

test('pull invalido revierte todo el lote y no adelanta el cursor', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const invalid = presentationChange(2);
  invalid.payload.conversion_factor = 0;
  const transport = new FakeTransport(undefined, async () => ({
    schemaVersion: 1,
    changes: [productChange(1), invalid],
    nextCursor: 2,
    hasMore: false,
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'offline');
  assert.equal(result.cursor, 0);
  assert.equal(await getProductById(database, DEFAULT_STORE_ID, PRODUCT_ID), null);
  assert.equal(
    (
      await database.getFirst<{ total: number }>(
        'SELECT COUNT(*) AS total FROM sync_inbox WHERE store_id = ?',
        [DEFAULT_STORE_ID]
      )
    )?.total,
    0
  );
});

test('pull pagina hasta converger y usa el cursor anterior en cada solicitud', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const transport = new FakeTransport(undefined, async (input) => {
    if (input.cursor === 0) {
      return {
        schemaVersion: 1,
        changes: [productChange(1)],
        nextCursor: 1,
        hasMore: true,
        serverTime: NOW.toISOString(),
      };
    }
    return {
      schemaVersion: 1,
      changes: [presentationChange(2)],
      nextCursor: 2,
      hasMore: false,
      serverTime: NOW.toISOString(),
    };
  });

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(
    transport.pulls.map((pull) => pull.cursor),
    [0, 1]
  );
  assert.equal(result.cursor, 2);
  assert.equal(result.hasMore, false);
});

test('evento de inventario actualiza la proyeccion local sin insertar otro outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const product = await database.getFirst<{ id: string; version: number }>(
    'SELECT id, version FROM products WHERE store_id = ? ORDER BY id LIMIT 1',
    [DEFAULT_STORE_ID]
  );
  assert.ok(product);
  const change: PullChange = {
    sequence: 1,
    entityType: 'inventory_movement',
    entityId: '81000000-0000-4000-8000-000000000020',
    operation: 'inventory_movement.created',
    version: product.version + 1,
    payload: {
      store_id: DEFAULT_STORE_ID,
      product_id: product.id,
      resulting_quantity: 7,
      product_version: product.version + 1,
    },
    changedAt: NOW.toISOString(),
    sourceDeviceId: '81000000-0000-4000-8000-000000000021',
    operationId: '81000000-0000-4000-8000-000000000022',
  };
  const transport = new FakeTransport(undefined, async () => ({
    schemaVersion: 1,
    changes: [change],
    nextCursor: 1,
    hasMore: false,
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });

  assert.equal(result.status, 'completed');
  assert.equal(
    (await getProductById(database, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    7
  );
  assert.equal((await listOutboxByStatus(database, 'pending')).length, 0);
});

test('pull aplica planificacion, incidencias y sustituciones E4', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const changes: PullChange[] = [
    deliveryZoneChange(1),
    orderChange(2),
    {
      sequence: 3,
      entityType: 'order_planning',
      entityId: ORDER_ID,
      operation: 'order.planning_updated',
      version: 4,
      payload: {
        order_id: ORDER_ID,
        scheduled_for: '2026-07-28T15:00:00.000Z',
        assigned_user_id: DEMO_HUSBAND_USER_ID,
        order_version: 4,
      },
      changedAt: '2026-07-26T15:01:00.000Z',
      sourceDeviceId: DEMO_DEVICE_ID,
      operationId: '81000000-0000-4000-8000-000000000020',
    },
    {
      sequence: 4,
      entityType: 'order_incident',
      entityId: '81000000-0000-4000-8000-000000000021',
      operation: 'order.incident_created',
      version: 1,
      payload: {
        id: '81000000-0000-4000-8000-000000000021',
        order_id: ORDER_ID,
        incident_type: 'quality',
        description: 'Revisar empaque',
        status: 'open',
        resolution: null,
        actor_user_id: DEMO_HUSBAND_USER_ID,
        device_id: DEMO_DEVICE_ID,
        created_at: '2026-07-26T15:02:00.000Z',
        updated_at: '2026-07-26T15:02:00.000Z',
      },
      changedAt: '2026-07-26T15:02:00.000Z',
      sourceDeviceId: DEMO_DEVICE_ID,
      operationId: '81000000-0000-4000-8000-000000000021',
    },
    {
      sequence: 5,
      entityType: 'order_substitution',
      entityId: '81000000-0000-4000-8000-000000000022',
      operation: 'order.substitution_proposed',
      version: 1,
      payload: {
        id: '81000000-0000-4000-8000-000000000022',
        order_id: ORDER_ID,
        order_item_id: ORDER_ITEM_ID,
        replacement_product_id: DEMO_TUNA_ID,
        replacement_product_name: 'Atun en lata',
        status: 'proposed',
        notes: 'Confirmar con cliente',
        actor_user_id: DEMO_HUSBAND_USER_ID,
        device_id: DEMO_DEVICE_ID,
        created_at: '2026-07-26T15:03:00.000Z',
        updated_at: '2026-07-26T15:03:00.000Z',
      },
      changedAt: '2026-07-26T15:03:00.000Z',
      sourceDeviceId: DEMO_DEVICE_ID,
      operationId: '81000000-0000-4000-8000-000000000022',
    },
  ];
  const transport = new FakeTransport(undefined, async () => ({
    schemaVersion: 1,
    changes,
    nextCursor: 5,
    hasMore: false,
    serverTime: NOW.toISOString(),
  }));

  const result = await runSyncCycle(database, transport, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    now: () => new Date(NOW),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.pulled, 5);
  const order = await database.getFirst<{
    scheduled_for: string | null;
    assigned_user_id: string | null;
  }>('SELECT scheduled_for, assigned_user_id FROM orders WHERE id = ?', [ORDER_ID]);
  assert.equal(order?.scheduled_for, '2026-07-28T15:00:00.000Z');
  assert.equal(order?.assigned_user_id, DEMO_HUSBAND_USER_ID);
  assert.equal(
    (
      await database.getFirst<{ total: number }>(
        'SELECT count(*) AS total FROM order_incidents WHERE order_id = ?',
        [ORDER_ID]
      )
    )?.total,
    1
  );
  assert.equal(
    (
      await database.getFirst<{ total: number }>(
        'SELECT count(*) AS total FROM order_substitutions WHERE order_id = ?',
        [ORDER_ID]
      )
    )?.total,
    1
  );
  assert.equal((await listOutboxByStatus(database, 'pending')).length, 0);
});

test('transporte Supabase usa RPC autenticada sin credenciales de service_role', async () => {
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const transport = new SupabaseSyncTransport({
    supabaseUrl: 'https://example.supabase.co/',
    anonKey: 'public-anon-key',
    getAccessToken: () => 'user-access-token',
    fetchImplementation: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          results: [],
          serverTime: NOW.toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });

  await transport.push({
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    schemaVersion: 1,
    operations: [],
  });

  assert.equal(
    requestedUrl,
    'https://example.supabase.co/rest/v1/rpc/process_sync_batch'
  );
  const headers = requestedInit?.headers as Record<string, string>;
  assert.equal(headers.apikey, 'public-anon-key');
  assert.equal(headers.Authorization, 'Bearer user-access-token');
  assert.ok(!JSON.stringify(requestedInit).includes('service_role'));
});
