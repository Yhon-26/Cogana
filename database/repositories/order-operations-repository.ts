import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type {
  OrderIncidentRecord,
  OrderIncidentType,
  OrderSubstitutionRecord,
} from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { getOrderDetail } from './order-repository';
import { getProductById } from './product-repository';
import { enqueueOperation } from './sync-outbox-repository';

async function requireActor(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  deviceId: string,
  administrator = false
) {
  if (!deviceId) throw new Error('La operación requiere dispositivo.');
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!actor || (administrator && actor.role !== 'administrator')) {
    throw new Error(
      administrator
        ? 'Solo un administrador puede realizar esta acción.'
        : 'Selecciona un operador activo.'
    );
  }
  return actor;
}

export async function updateOrderPlanning(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    orderId: string;
    expectedVersion: number;
    scheduledFor: string | null;
    assignedUserId: string | null;
    actorUserId: string;
    deviceId: string;
  }
) {
  const timestamp = new Date().toISOString();
  if (input.scheduledFor && Number.isNaN(Date.parse(input.scheduledFor))) {
    throw new Error('La fecha programada no es válida.');
  }
  return database.transaction(async (transaction) => {
    await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId,
      true
    );
    const assignedActor = input.assignedUserId
      ? await requireActor(
        transaction,
        input.storeId,
        input.assignedUserId,
        input.deviceId
      )
      : null;
    const result = await transaction.run(
      `UPDATE orders
       SET scheduled_for = ?, assigned_user_id = ?,
           updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?
         AND status NOT IN ('delivered', 'cancelled')`,
      [
        input.scheduledFor,
        input.assignedUserId,
        timestamp,
        input.orderId,
        input.storeId,
        input.expectedVersion,
      ]
    );
    if (result.changes !== 1) {
      throw new Error('El pedido cambió o ya está cerrado.');
    }
    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'order',
      entityId: input.orderId,
      operationType: 'order.planning_updated',
      payload: {
        operationId,
        storeId: input.storeId,
        orderId: input.orderId,
        scheduledFor: input.scheduledFor,
        assignedUserId: input.assignedUserId,
        assignedAuthUserId: assignedActor?.authUserId ?? null,
        expectedVersion: input.expectedVersion,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        updatedAt: timestamp,
      },
      timestamp,
    });
    return getOrderDetail(transaction, input.storeId, input.orderId);
  });
}

export async function createOrderIncident(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    orderId: string;
    type: OrderIncidentType;
    description: string;
    actorUserId: string;
    deviceId: string;
  }
): Promise<OrderIncidentRecord> {
  const description = input.description.trim();
  if (!description) throw new Error('Describe la incidencia.');
  const id = createId();
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    if (!(await getOrderDetail(transaction, input.storeId, input.orderId))) {
      throw new Error('El pedido no existe.');
    }
    await transaction.run(
      `INSERT INTO order_incidents (
        id, store_id, order_id, incident_type, description, status,
        resolution, actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?, ?, 1)`,
      [
        id,
        input.storeId,
        input.orderId,
        input.type,
        description,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: id,
      entityType: 'order_incident',
      entityId: id,
      operationType: 'order.incident_created',
      payload: { id, ...input, description, createdAt: timestamp },
      timestamp,
    });
    return {
      id,
      storeId: input.storeId,
      orderId: input.orderId,
      type: input.type,
      description,
      status: 'open',
      resolution: null,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
  });
}

export async function proposeOrderSubstitution(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    orderId: string;
    orderItemId: string;
    replacementProductId: string;
    notes?: string | null;
    actorUserId: string;
    deviceId: string;
  }
): Promise<OrderSubstitutionRecord> {
  const id = createId();
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    const detail = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (!detail || !['confirmed', 'preparing'].includes(detail.order.status)) {
      throw new Error('Solo puedes proponer sustituciones antes de terminar la preparación.');
    }
    const item = detail.items.find((candidate) => candidate.id === input.orderItemId);
    if (!item || item.substitutionPolicy === 'remove') {
      throw new Error('El producto no admite sustitución.');
    }
    const replacement = await getProductById(
      transaction,
      input.storeId,
      input.replacementProductId
    );
    if (!replacement?.isActive || replacement.id === item.productId) {
      throw new Error('Selecciona un producto de reemplazo disponible.');
    }
    await transaction.run(
      `INSERT INTO order_substitutions (
        id, store_id, order_id, order_item_id, replacement_product_id,
        replacement_product_name, status, notes, actor_user_id, device_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, 1)`,
      [
        id,
        input.storeId,
        input.orderId,
        input.orderItemId,
        replacement.id,
        replacement.name,
        input.notes?.trim() || null,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: id,
      entityType: 'order_substitution',
      entityId: id,
      operationType: 'order.substitution_proposed',
      payload: {
        id,
        storeId: input.storeId,
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        replacementProductId: replacement.id,
        replacementProductName: replacement.name,
        notes: input.notes?.trim() || null,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        createdAt: timestamp,
      },
      timestamp,
    });
    return {
      id,
      storeId: input.storeId,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      replacementProductId: replacement.id,
      replacementProductName: replacement.name,
      status: 'proposed',
      notes: input.notes?.trim() || null,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
  });
}
