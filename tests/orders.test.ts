import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  completeDeliveryEvidenceUpload,
  listPendingDeliveryEvidence,
  markDeliveryEvidenceUploading,
} from '../database/repositories/delivery-evidence-repository';
import { createDeliveryZone } from '../database/repositories/delivery-zone-repository';
import {
  assignDelivery,
  confirmDelivery,
  listDeliveryAssignments,
  startDelivery,
} from '../database/repositories/delivery-assignment-repository';
import {
  createOrderIncident,
  proposeOrderSubstitution,
  updateOrderPlanning,
} from '../database/repositories/order-operations-repository';
import {
  createOrder,
  getOrderDetail,
  listOrders,
  prepareOrder,
  transitionOrder,
  updateOrderPaymentStatus,
} from '../database/repositories/order-repository';
import { getProductById } from '../database/repositories/product-repository';
import {
  listDueOutbox,
  listOutboxByStatus,
} from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

const LENTIL_ID = '10000000-0000-4000-8000-000000000001';
const TUNA_ID = '10000000-0000-4000-8000-000000000008';

test('crea un pedido idempotente con snapshots, cliente e historial', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const operationId = '91000000-0000-4000-8000-000000000001';

  const input = {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    operationId,
    source: 'whatsapp' as const,
    fulfillmentType: 'pickup' as const,
    customer: { name: '  Ana Pérez  ', phone: ' 999 111 222 ' },
    items: [
      { productId: LENTIL_ID, quantity: 1000, substitutionPolicy: 'contact' as const },
      { productId: TUNA_ID, quantity: 2, substitutionPolicy: 'remove' as const },
    ],
  };
  const created = await createOrder(database, input);
  const repeated = await createOrder(database, input);

  assert.equal(repeated.order.id, created.order.id);
  assert.equal(created.customer.name, 'Ana Pérez');
  assert.equal(created.customer.phone, '999111222');
  assert.equal(created.order.status, 'received');
  assert.equal(created.order.estimatedSubtotalCents, 2150);
  assert.equal(created.order.estimatedTotalCents, 2150);
  assert.equal(created.items.length, 2);
  assert.equal(created.history.length, 1);
  assert.equal(created.history[0].fromStatus, null);
  assert.equal((await listOrders(database, DEFAULT_STORE_ID)).length, 1);

  const outbox = (await listOutboxByStatus(database, 'pending')).filter(
    (operation) => operation.operationType === 'order.created'
  );
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].operationId, operationId);
  const payload = JSON.parse(outbox[0].payloadJson) as {
    customer: { phone: string };
    items: unknown[];
  };
  assert.equal(payload.customer.phone, '999111222');
  assert.equal(payload.items.length, 2);
});

test('reserva stock entre pedidos y lo libera al cancelar', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const product = await getProductById(database, DEFAULT_STORE_ID, TUNA_ID);
  assert.ok(product);

  const reserved = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'phone',
    fulfillmentType: 'pickup',
    customer: { name: 'Reserva total', phone: '999701001' },
    items: [{ productId: TUNA_ID, quantity: product.stockQuantity }],
  });

  await assert.rejects(
    createOrder(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_HUSBAND_USER_ID,
      source: 'phone',
      fulfillmentType: 'pickup',
      customer: { name: 'Sin stock', phone: '999701002' },
      items: [{ productId: TUNA_ID, quantity: 1 }],
    }),
    /Stock insuficiente/
  );

  await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: reserved.order.id,
    expectedVersion: reserved.order.version,
    toStatus: 'cancelled',
    reason: 'Cliente desistió',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });

  const afterRelease = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'phone',
    fulfillmentType: 'pickup',
    customer: { name: 'Stock liberado', phone: '999701003' },
    items: [{ productId: TUNA_ID, quantity: 1 }],
  });
  assert.equal(afterRelease.items[0].requestedQuantity, 1);
});

test('preparar consume stock y deja un movimiento auditable', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const before = await getProductById(database, DEFAULT_STORE_ID, TUNA_ID);
  assert.ok(before);
  let detail = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'whatsapp',
    fulfillmentType: 'pickup',
    customer: { name: 'Consumo', phone: '999702001' },
    items: [{ productId: TUNA_ID, quantity: 2 }],
  });
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'confirmed',
    reason: 'Confirmado',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'preparing',
    reason: 'Preparando',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await prepareOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    items: [{ itemId: detail.items[0].id, preparedQuantity: 2 }],
  });

  const after = await getProductById(database, DEFAULT_STORE_ID, TUNA_ID);
  assert.equal(after?.stockQuantity, before.stockQuantity - 2);
  const movement = await database.getFirst<{
    movement_type: string;
    quantity_delta: number;
    reference_id: string;
  }>(
    `SELECT movement_type, quantity_delta, reference_id
     FROM inventory_movements WHERE id = ?`,
    [detail.items[0].id]
  );
  assert.equal(movement?.movement_type, 'sale');
  assert.equal(movement?.quantity_delta, -2);
  assert.equal(movement?.reference_id, detail.order.id);
});

test('pago digital requiere referencia y solo un administrador lo verifica', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const detail = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'whatsapp',
    fulfillmentType: 'pickup',
    paymentMethod: 'card',
    customer: { name: 'Pago digital', phone: '999703001' },
    items: [{ productId: TUNA_ID, quantity: 1 }],
  });

  await assert.rejects(
    updateOrderPaymentStatus(database, {
      storeId: DEFAULT_STORE_ID,
      orderId: detail.order.id,
      expectedVersion: detail.order.version,
      toStatus: 'paid',
      reason: 'Verificación',
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /administrador/
  );
  await assert.rejects(
    updateOrderPaymentStatus(database, {
      storeId: DEFAULT_STORE_ID,
      orderId: detail.order.id,
      expectedVersion: detail.order.version,
      toStatus: 'paid',
      reason: 'Verificación',
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /referencia/
  );

  const operationId = '91000000-0000-4000-8000-000000000099';
  const paid = await updateOrderPaymentStatus(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'paid',
    paymentReference: 'CARD-998877',
    reason: 'Abono confirmado',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    operationId,
  });
  const repeated = await updateOrderPaymentStatus(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'paid',
    paymentReference: 'YAPE-998877',
    reason: 'Abono confirmado',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    operationId,
  });
  assert.equal(paid.order.paymentStatus, 'paid');
  assert.equal(paid.order.paymentReference, 'CARD-998877');
  assert.equal(paid.paymentHistory.length, 1);
  assert.equal(repeated.paymentHistory.length, 1);
});

test('delivery exige zona activa, dirección y pedido mínimo', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const zone = await createDeliveryZone(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: 'Santa Anita',
    district: 'Santa Anita',
    feeCents: 700,
    minimumOrderCents: 2000,
    etaMinMinutes: 30,
    etaMaxMinutes: 50,
    scheduleText: 'Lun-Sáb 09:00-18:00',
  });

  await assert.rejects(
    createOrder(database, {
      storeId: DEFAULT_STORE_ID,
      deviceId: DEMO_DEVICE_ID,
      actorUserId: DEMO_HUSBAND_USER_ID,
      source: 'phone',
      fulfillmentType: 'delivery',
      customer: { name: 'Luis', phone: '999222333' },
      delivery: {
        zoneId: zone.id,
        address: 'Av. Los Frutales 123',
        district: 'Santa Anita',
      },
      items: [{ productId: LENTIL_ID, quantity: 1000 }],
    }),
    /mínimo/
  );

  const delivered = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'phone',
    fulfillmentType: 'delivery',
    customer: { name: 'Luis', phone: '999222333' },
    delivery: {
      zoneId: zone.id,
      address: 'Av. Los Frutales 123',
      district: 'Santa Anita',
      instructions: 'Puerta verde',
    },
    items: [{ productId: LENTIL_ID, quantity: 3000 }],
  });
  assert.equal(delivered.order.deliveryFeeCents, 700);
  assert.equal(delivered.order.estimatedTotalCents, 3250);
  assert.equal(delivered.address?.deliveryZoneId, zone.id);
});

test('preparación conserva enteros y envía diferencias de peso a revisión', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  let detail = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'whatsapp',
    fulfillmentType: 'pickup',
    customer: { name: 'Rosa', phone: '999333444' },
    items: [{ productId: LENTIL_ID, quantity: 1000 }],
  });

  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'confirmed',
    reason: 'Pedido confirmado',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'preparing',
    reason: 'Inicia preparación',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await prepareOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    items: [{ itemId: detail.items[0].id, preparedQuantity: 1100 }],
  });

  assert.equal(detail.order.status, 'weight_review');
  assert.equal(detail.items[0].finalCents, 935);
  assert.equal(detail.order.finalSubtotalCents, 935);
  assert.equal(detail.order.finalTotalCents, 935);
  const preparationEvent = (await listOutboxByStatus(database, 'pending'))
    .filter((operation) => operation.operationType === 'order.status_changed')
    .at(-1);
  assert.ok(preparationEvent);
  assert.equal(
    (JSON.parse(preparationEvent.payloadJson) as { expectedVersion: number })
      .expectedVersion,
    3
  );
  await assert.rejects(
    transitionOrder(database, {
      storeId: DEFAULT_STORE_ID,
      orderId: detail.order.id,
      expectedVersion: detail.order.version,
      toStatus: 'ready',
      reason: 'Aprobar',
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /administrador/
  );
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'ready',
    reason: 'Diferencia aprobada',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'ready_for_pickup',
    reason: 'Listo para recojo',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'delivered',
    reason: 'Entregado',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(detail.order.status, 'delivered');
  assert.equal(detail.history.length, 7);
  assert.equal(
    (await getOrderDetail(database, DEFAULT_STORE_ID, detail.order.id))?.order.status,
    'delivered'
  );
});

test('solo administrador cancela y no se permiten saltos de estado', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const detail = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'phone',
    fulfillmentType: 'pickup',
    customer: { name: 'Mario', phone: '999444555' },
    items: [{ productId: TUNA_ID, quantity: 1 }],
  });

  await assert.rejects(
    transitionOrder(database, {
      storeId: DEFAULT_STORE_ID,
      orderId: detail.order.id,
      expectedVersion: detail.order.version,
      toStatus: 'preparing',
      reason: 'Saltar',
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /No se permite/
  );
  await assert.rejects(
    transitionOrder(database, {
      storeId: DEFAULT_STORE_ID,
      orderId: detail.order.id,
      expectedVersion: detail.order.version,
      toStatus: 'cancelled',
      reason: 'Cliente desistió',
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /administrador/
  );
  const cancelled = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'cancelled',
    reason: 'Cliente desistió',
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(cancelled.order.status, 'cancelled');
});

test('planifica, registra incidencias y propone sustituciones con outbox', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  let detail = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'online',
    fulfillmentType: 'pickup',
    customer: { name: 'Eva', phone: '999777888' },
    items: [
      {
        productId: LENTIL_ID,
        quantity: 1000,
        substitutionPolicy: 'contact',
      },
    ],
  });

  await assert.rejects(
    updateOrderPlanning(database, {
      storeId: DEFAULT_STORE_ID,
      orderId: detail.order.id,
      expectedVersion: detail.order.version,
      scheduledFor: '2026-07-28T15:00:00.000Z',
      assignedUserId: DEMO_HUSBAND_USER_ID,
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /administrador/
  );

  detail =
    (await updateOrderPlanning(database, {
      storeId: DEFAULT_STORE_ID,
      orderId: detail.order.id,
      expectedVersion: detail.order.version,
      scheduledFor: '2026-07-28T15:00:00.000Z',
      assignedUserId: DEMO_HUSBAND_USER_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    })) ?? detail;
  assert.equal(detail.order.assignedUserId, DEMO_HUSBAND_USER_ID);
  assert.equal(detail.order.scheduledFor, '2026-07-28T15:00:00.000Z');

  const incident = await createOrderIncident(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    type: 'missing_item',
    description: '  Falta revisar el lote disponible.  ',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(incident.description, 'Falta revisar el lote disponible.');

  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'confirmed',
    reason: 'Pedido confirmado',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  const substitution = await proposeOrderSubstitution(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    orderItemId: detail.items[0].id,
    replacementProductId: TUNA_ID,
    notes: 'Esperando respuesta del cliente',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(substitution.status, 'proposed');

  const refreshed = await getOrderDetail(
    database,
    DEFAULT_STORE_ID,
    detail.order.id
  );
  assert.equal(refreshed?.incidents.length, 1);
  assert.equal(refreshed?.substitutions.length, 1);

  const operationTypes = (await listOutboxByStatus(database, 'pending')).map(
    (operation) => operation.operationType
  );
  assert.ok(operationTypes.includes('order.planning_updated'));
  assert.ok(operationTypes.includes('order.incident_created'));
  assert.ok(operationTypes.includes('order.substitution_proposed'));
});

test('reparto mantiene pedido y asignación atómicos al confirmar', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const zone = await createDeliveryZone(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: 'Ruta delivery',
    district: 'Santa Anita',
    feeCents: 500,
    minimumOrderCents: 0,
    etaMinMinutes: 20,
    etaMaxMinutes: 40,
    scheduleText: 'Todos los días',
  });
  let detail = await createOrder(database, {
    storeId: DEFAULT_STORE_ID,
    deviceId: DEMO_DEVICE_ID,
    actorUserId: DEMO_HUSBAND_USER_ID,
    source: 'online',
    fulfillmentType: 'delivery',
    customer: { name: 'Cliente reparto', phone: '999888777' },
    delivery: {
      zoneId: zone.id,
      address: 'Av. Los Eucaliptos 123',
      district: 'Santa Anita',
    },
    items: [{ productId: LENTIL_ID, quantity: 1000 }],
  });
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'confirmed',
    reason: 'Confirmado',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await transitionOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    toStatus: 'preparing',
    reason: 'Preparando',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  detail = await prepareOrder(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    expectedVersion: detail.order.version,
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    items: [
      {
        itemId: detail.items[0].id,
        preparedQuantity: detail.items[0].requestedQuantity,
      },
    ],
  });
  assert.equal(detail.order.status, 'ready');

  const assignmentId = await assignDelivery(database, {
    storeId: DEFAULT_STORE_ID,
    orderId: detail.order.id,
    driverUserId: DEMO_HUSBAND_USER_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  await startDelivery(database, {
    storeId: DEFAULT_STORE_ID,
    assignmentId,
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  await database.exec(`
    CREATE TRIGGER reject_delivery_confirmation
    BEFORE UPDATE OF status ON delivery_assignments
    WHEN NEW.status = 'delivered'
    BEGIN
      SELECT RAISE(ABORT, 'fallo de evidencia simulado');
    END
  `);
  await assert.rejects(
    confirmDelivery(database, {
      storeId: DEFAULT_STORE_ID,
      assignmentId,
      recipientName: 'María',
      confirmationCode: '4582',
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /fallo de evidencia simulado/
  );
  assert.equal(
    (await getOrderDetail(database, DEFAULT_STORE_ID, detail.order.id))?.order
      .status,
    'out_for_delivery'
  );
  assert.equal(
    (await listDeliveryAssignments(database, DEFAULT_STORE_ID))[0]?.status,
    'en_route'
  );
  await database.exec('DROP TRIGGER reject_delivery_confirmation');

  const delivered = await confirmDelivery(database, {
    storeId: DEFAULT_STORE_ID,
    assignmentId,
    recipientName: 'María',
    evidenceUri: 'file:///evidence.jpg',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(delivered?.status, 'delivered');
  assert.equal(delivered?.recipientName, 'María');
  assert.equal(
    (await getOrderDetail(database, DEFAULT_STORE_ID, detail.order.id))?.order
      .status,
    'delivered'
  );
  assert.equal(
    (await listDeliveryAssignments(database, DEFAULT_STORE_ID)).length,
    1
  );
  const beforeEvidenceUpload = await listDueOutbox(
    database,
    DEFAULT_STORE_ID,
    DEMO_HUSBAND_USER_ID,
    new Date().toISOString(),
    100
  );
  assert.equal(
    beforeEvidenceUpload.some(
      (operation) => operation.operationType === 'delivery.confirmed'
    ),
    false
  );
  const [pendingEvidence] = await listPendingDeliveryEvidence(
    database,
    DEFAULT_STORE_ID,
    DEMO_HUSBAND_USER_ID
  );
  assert.ok(pendingEvidence);
  const uploadTimestamp = new Date().toISOString();
  assert.equal(
    await markDeliveryEvidenceUploading(
      database,
      pendingEvidence.id,
      uploadTimestamp
    ),
    true
  );
  assert.equal(
    await completeDeliveryEvidenceUpload(
      database,
      pendingEvidence,
      uploadTimestamp
    ),
    true
  );
  const afterEvidenceUpload = await listDueOutbox(
    database,
    DEFAULT_STORE_ID,
    DEMO_HUSBAND_USER_ID,
    new Date().toISOString(),
    100
  );
  const confirmationOperation = afterEvidenceUpload.find(
    (operation) => operation.operationType === 'delivery.confirmed'
  );
  assert.ok(confirmationOperation);
  assert.equal(
    JSON.parse(confirmationOperation.payloadJson).evidenceUri,
    pendingEvidence.storagePath
  );
  const operationTypes = (await listOutboxByStatus(database, 'pending')).map(
    (operation) => operation.operationType
  );
  assert.ok(operationTypes.includes('delivery.assigned'));
  assert.ok(operationTypes.includes('delivery.started'));
  assert.ok(operationTypes.includes('delivery.confirmed'));
  assert.ok(operationTypes.includes('delivery.evidence_attached'));
  const deliveredOrderOperations = (
    await listOutboxByStatus(database, 'pending')
  ).filter(
    (operation) =>
      operation.operationType === 'order.status_changed' &&
      JSON.parse(operation.payloadJson).toStatus === 'delivered'
  );
  assert.equal(deliveredOrderOperations.length, 0);
});
