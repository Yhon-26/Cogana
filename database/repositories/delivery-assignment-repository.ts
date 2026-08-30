import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type {
  DeliveryAssignmentRecord,
  DeliveryAssignmentStatus,
} from '../models';
import { getActiveLocalUser } from './local-user-repository';
import {
  getOrderDetail,
  transitionOrderInTransaction,
} from './order-repository';
import { enqueueOperation } from './sync-outbox-repository';

type DeliveryRow = {
  id: string;
  store_id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  district: string;
  instructions: string | null;
  driver_user_id: string;
  driver_name: string;
  status: DeliveryAssignmentStatus;
  recipient_name: string | null;
  confirmation_code: string | null;
  evidence_uri: string | null;
  notes: string | null;
  assigned_by_user_id: string;
  device_id: string;
  started_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  order_version: number;
  order_status: DeliveryAssignmentRecord['orderStatus'];
};

const deliverySelect = `
  SELECT da.*, o.order_number, o.version AS order_version,
    o.status AS order_status, c.name AS customer_name, c.phone AS customer_phone,
    ca.address, ca.district, ca.instructions,
    u.display_name AS driver_name
  FROM delivery_assignments da
  JOIN orders o ON o.id = da.order_id AND o.store_id = da.store_id
  JOIN customers c ON c.id = o.customer_id AND c.store_id = o.store_id
  LEFT JOIN customer_addresses ca ON ca.id = o.address_id AND ca.store_id = o.store_id
  JOIN local_users u ON u.id = da.driver_user_id AND u.store_id = da.store_id`;

function mapDelivery(row: DeliveryRow): DeliveryAssignmentRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    address: row.address,
    district: row.district,
    instructions: row.instructions,
    driverUserId: row.driver_user_id,
    driverName: row.driver_name,
    status: row.status,
    recipientName: row.recipient_name,
    confirmationCode: row.confirmation_code,
    evidenceUri: row.evidence_uri,
    notes: row.notes,
    assignedByUserId: row.assigned_by_user_id,
    deviceId: row.device_id,
    startedAt: row.started_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    orderVersion: row.order_version,
    orderStatus: row.order_status,
  };
}

async function requireActor(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  deviceId: string
) {
  if (!deviceId) throw new Error('La operación requiere dispositivo.');
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!actor) throw new Error('Selecciona un operador activo.');
  return actor;
}

async function addEvent(
  database: DatabaseAdapter,
  input: {
    id?: string;
    storeId: string;
    assignmentId: string;
    eventType: 'assigned' | 'started' | 'confirmed' | 'failed' | 'cancelled';
    notes: string | null;
    actorUserId: string;
    deviceId: string;
    timestamp: string;
  }
) {
  await database.run(
    `INSERT INTO delivery_events(
      id,store_id,assignment_id,event_type,notes,actor_user_id,device_id,
      created_at,updated_at,version
    ) VALUES(?,?,?,?,?,?,?,?,?,1)`,
    [
      input.id ?? createId(),
      input.storeId,
      input.assignmentId,
      input.eventType,
      input.notes,
      input.actorUserId,
      input.deviceId,
      input.timestamp,
      input.timestamp,
    ]
  );
}

export async function listDeliveryAssignments(
  database: DatabaseAdapter,
  storeId: string,
  driverUserId?: string
) {
  const rows = await database.getAll<DeliveryRow>(
    `${deliverySelect}
     WHERE da.store_id = ? ${driverUserId ? 'AND da.driver_user_id = ?' : ''}
     ORDER BY CASE da.status
       WHEN 'en_route' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END,
       da.created_at DESC`,
    driverUserId ? [storeId, driverUserId] : [storeId]
  );
  return rows.map(mapDelivery);
}

export async function assignDelivery(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    orderId: string;
    driverUserId: string;
    notes?: string;
    actorUserId: string;
    deviceId: string;
  }
) {
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    const actor = await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    if (actor.role !== 'administrator') {
      throw new Error('Solo un administrador asigna repartos.');
    }
    const driver = await requireActor(
      transaction,
      input.storeId,
      input.driverUserId,
      input.deviceId
    );
    const order = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (
      !order ||
      order.order.fulfillmentType !== 'delivery' ||
      !['ready', 'out_for_delivery'].includes(order.order.status)
    ) {
      throw new Error('El pedido aún no está listo para despacho.');
    }
    const existing = await transaction.getFirst<{ id: string; status: string }>(
      'SELECT id,status FROM delivery_assignments WHERE store_id = ? AND order_id = ?',
      [input.storeId, input.orderId]
    );
    if (existing && !['assigned', 'failed'].includes(existing.status)) {
      throw new Error('El reparto ya está en curso o cerrado.');
    }
    const id = existing?.id ?? createId();
    if (existing) {
      await transaction.run(
        `UPDATE delivery_assignments SET driver_user_id = ?,status = 'assigned',
          notes = ?,assigned_by_user_id = ?,device_id = ?,started_at = NULL,
          delivered_at = NULL,updated_at = ?,version = version + 1
         WHERE id = ? AND store_id = ?`,
        [
          input.driverUserId,
          input.notes?.trim() || null,
          input.actorUserId,
          input.deviceId,
          timestamp,
          id,
          input.storeId,
        ]
      );
    } else {
      await transaction.run(
        `INSERT INTO delivery_assignments(
          id,store_id,order_id,driver_user_id,status,notes,
          assigned_by_user_id,device_id,created_at,updated_at,version
        ) VALUES(?,?,?,?,'assigned',?,?,?,?,?,1)`,
        [
          id,
          input.storeId,
          input.orderId,
          input.driverUserId,
          input.notes?.trim() || null,
          input.actorUserId,
          input.deviceId,
          timestamp,
          timestamp,
        ]
      );
    }
    await addEvent(transaction, {
      storeId: input.storeId,
      assignmentId: id,
      eventType: 'assigned',
      notes: input.notes?.trim() || null,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      timestamp,
    });
    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'delivery_assignment',
      entityId: id,
      operationType: 'delivery.assigned',
      payload: {
        operationId,
        id,
        storeId: input.storeId,
        orderId: input.orderId,
        driverUserId: input.driverUserId,
        driverAuthUserId: driver.authUserId,
        notes: input.notes?.trim() || null,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        createdAt: timestamp,
      },
      timestamp,
    });
    return id;
  });
}

export async function startDelivery(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    assignmentId: string;
    actorUserId: string;
    deviceId: string;
  }
) {
  return database.transaction(async (transaction) => {
    const actor = await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    const assignment = (
      await listDeliveryAssignments(transaction, input.storeId)
    ).find((candidate) => candidate.id === input.assignmentId);
    if (!assignment || assignment.status !== 'assigned') {
      throw new Error('El reparto no está disponible para iniciar.');
    }
    if (
      actor.role !== 'administrator' &&
      assignment.driverUserId !== input.actorUserId
    ) {
      throw new Error('El reparto está asignado a otro operador.');
    }
    if (assignment.orderStatus === 'ready') {
      await transitionOrderInTransaction(
        transaction,
        {
          storeId: input.storeId,
          orderId: assignment.orderId,
          expectedVersion: assignment.orderVersion,
          toStatus: 'out_for_delivery',
          reason: 'Repartidor inicia ruta',
          actorUserId: input.actorUserId,
          deviceId: input.deviceId,
        },
        { enqueueSyncOperation: false }
      );
    } else if (assignment.orderStatus !== 'out_for_delivery') {
      throw new Error('El pedido no puede salir a reparto.');
    }
    const timestamp = new Date().toISOString();
    const result = await transaction.run(
      `UPDATE delivery_assignments SET status = 'en_route',started_at = ?,
        updated_at = ?,version = version + 1
       WHERE id = ? AND store_id = ? AND status = 'assigned'`,
      [timestamp, timestamp, input.assignmentId, input.storeId]
    );
    if (result.changes !== 1) throw new Error('El reparto cambió en otro dispositivo.');
    await addEvent(transaction, {
      storeId: input.storeId,
      assignmentId: input.assignmentId,
      eventType: 'started',
      notes: 'Ruta iniciada',
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      timestamp,
    });
    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'delivery_assignment',
      entityId: input.assignmentId,
      operationType: 'delivery.started',
      payload: {
        operationId,
        id: input.assignmentId,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        startedAt: timestamp,
      },
      timestamp,
    });
  });
}

export async function confirmDelivery(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    assignmentId: string;
    recipientName: string;
    confirmationCode?: string;
    evidenceUri?: string;
    notes?: string;
    actorUserId: string;
    deviceId: string;
  }
) {
  const recipientName = input.recipientName.trim();
  if (!recipientName) throw new Error('Indica quién recibió el pedido.');
  const confirmationCode = input.confirmationCode?.trim() || null;
  const evidenceUri = input.evidenceUri?.trim() || null;
  if (!confirmationCode && !evidenceUri) {
    throw new Error('Registra un código de recepción o una foto de evidencia.');
  }
  const hasLocalEvidence =
    evidenceUri !== null &&
    (evidenceUri.startsWith('file:') || evidenceUri.startsWith('content:'));
  return database.transaction(async (transaction) => {
    const actor = await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    const assignment = (
      await listDeliveryAssignments(transaction, input.storeId)
    ).find((candidate) => candidate.id === input.assignmentId);
    if (!assignment) throw new Error('El reparto no existe.');
    if (assignment.status === 'delivered') return assignment;
    if (
      actor.role !== 'administrator' &&
      assignment.driverUserId !== input.actorUserId
    ) {
      throw new Error('El reparto está asignado a otro operador.');
    }
    if (assignment.status !== 'en_route') {
      throw new Error('Inicia la ruta antes de confirmar entrega.');
    }
    if (assignment.orderStatus !== 'delivered') {
      await transitionOrderInTransaction(
        transaction,
        {
          storeId: input.storeId,
          orderId: assignment.orderId,
          expectedVersion: assignment.orderVersion,
          toStatus: 'delivered',
          reason: `Recibido por ${recipientName}`,
          actorUserId: input.actorUserId,
          deviceId: input.deviceId,
        },
        { enqueueSyncOperation: false }
      );
    }
    const timestamp = new Date().toISOString();
    const updated = await transaction.run(
      `UPDATE delivery_assignments SET status = 'delivered',
        recipient_name = ?,confirmation_code = ?,evidence_uri = ?,notes = ?,
        delivered_at = ?,updated_at = ?,version = version + 1
       WHERE id = ? AND store_id = ? AND status = 'en_route'`,
      [
        recipientName,
        confirmationCode,
        evidenceUri,
        input.notes?.trim() || null,
        timestamp,
        timestamp,
        input.assignmentId,
        input.storeId,
      ]
    );
    if (updated.changes !== 1) {
      throw new Error('El reparto cambió en otro dispositivo.');
    }
    await addEvent(transaction, {
      storeId: input.storeId,
      assignmentId: input.assignmentId,
      eventType: 'confirmed',
      notes: `Recibido por ${recipientName}`,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      timestamp,
    });
    if (hasLocalEvidence && evidenceUri) {
      const evidenceId = createId();
      await transaction.run(
        `INSERT INTO delivery_evidence_uploads (
          id, store_id, assignment_id, local_uri, storage_path, content_type,
          status, attempts, last_error, actor_user_id, device_id,
          created_at, updated_at, uploaded_at, version
        ) VALUES (?, ?, ?, ?, ?, 'image/jpeg', 'pending', 0, NULL, ?, ?, ?, ?, NULL, 1)
        ON CONFLICT(store_id, assignment_id) DO UPDATE SET
          local_uri = excluded.local_uri,
          storage_path = excluded.storage_path,
          content_type = excluded.content_type,
          status = 'pending',
          attempts = 0,
          last_error = NULL,
          actor_user_id = excluded.actor_user_id,
          device_id = excluded.device_id,
          updated_at = excluded.updated_at,
          uploaded_at = NULL,
          version = delivery_evidence_uploads.version + 1`,
        [
          evidenceId,
          input.storeId,
          input.assignmentId,
          evidenceUri,
          `${input.storeId}/${input.assignmentId}/${evidenceId}.jpg`,
          input.actorUserId,
          input.deviceId,
          timestamp,
          timestamp,
        ]
      );
    }
    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'delivery_assignment',
      entityId: input.assignmentId,
      operationType: 'delivery.confirmed',
      payload: {
        operationId,
        id: input.assignmentId,
        recipientName,
        confirmationCode,
        evidenceUri: hasLocalEvidence ? null : evidenceUri,
        notes: input.notes?.trim() || null,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        deliveredAt: timestamp,
      },
      timestamp,
    });
    const confirmed = (
      await listDeliveryAssignments(transaction, input.storeId)
    ).find((candidate) => candidate.id === input.assignmentId);
    return confirmed ?? null;
  });
}
