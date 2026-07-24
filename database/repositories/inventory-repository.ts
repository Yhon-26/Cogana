import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type { InventoryMovementRecord, InventoryMovementType, ProductRecord } from '../models';
import { enqueueOperation } from './sync-outbox-repository';
import { getProductById } from './product-repository';

type InventoryMovementRow = {
  id: string;
  store_id: string;
  product_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  reason: string;
  reference_id: string | null;
  actor_user_id: string | null;
  device_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type RecordInventoryMovementInput = {
  storeId: string;
  productId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  reason: string;
  referenceId?: string | null;
  actorUserId: string;
  deviceId: string;
};

type RecordInventoryMovementResult = {
  movement: InventoryMovementRecord;
  product: ProductRecord;
};

function mapMovementRow(row: InventoryMovementRow): InventoryMovementRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    type: row.movement_type,
    quantityDelta: row.quantity_delta,
    reason: row.reason,
    referenceId: row.reference_id,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export async function listInventoryMovements(
  database: DatabaseAdapter,
  storeId: string,
  productId: string
): Promise<InventoryMovementRecord[]> {
  const rows = await database.getAll<InventoryMovementRow>(
    `SELECT *
     FROM inventory_movements
     WHERE store_id = ? AND product_id = ?
     ORDER BY created_at DESC, id DESC`,
    [storeId, productId]
  );

  return rows.map(mapMovementRow);
}

export async function recordInventoryMovement(
  database: DatabaseAdapter,
  input: RecordInventoryMovementInput
): Promise<RecordInventoryMovementResult> {
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
    throw new Error('El movimiento debe usar una cantidad base entera distinta de cero.');
  }

  if (!input.reason.trim()) {
    throw new Error('El movimiento de inventario requiere un motivo.');
  }

  if (!input.actorUserId || !input.deviceId) {
    throw new Error('El movimiento requiere usuario y dispositivo para auditoría.');
  }

  const movementId = createId();
  const outboxId = createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    const currentProduct = await getProductById(transaction, input.storeId, input.productId);
    if (!currentProduct) {
      throw new Error('No se encontró el producto para registrar el movimiento.');
    }

    const nextStockQuantity = currentProduct.stockQuantity + input.quantityDelta;
    if (nextStockQuantity < 0) {
      throw new Error('El movimiento dejaría el inventario con stock negativo.');
    }

    const updateResult = await transaction.run(
      `UPDATE products
       SET stock_quantity = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        nextStockQuantity,
        timestamp,
        input.productId,
        input.storeId,
        currentProduct.version,
      ]
    );

    if (updateResult.changes !== 1) {
      throw new Error('El producto cambió durante el movimiento. Intenta nuevamente.');
    }

    await transaction.run(
      `INSERT INTO inventory_movements (
        id, store_id, product_id, movement_type, quantity_delta,
        reason, reference_id, actor_user_id, device_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        movementId,
        input.storeId,
        input.productId,
        input.type,
        input.quantityDelta,
        input.reason.trim(),
        input.referenceId ?? null,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );

    await enqueueOperation(transaction, {
      id: outboxId,
      storeId: input.storeId,
      operationId: movementId,
      entityType: 'inventory_movement',
      entityId: movementId,
      operationType: 'inventory_movement.created',
      payload: {
        id: movementId,
        storeId: input.storeId,
        productId: input.productId,
        type: input.type,
        quantityDelta: input.quantityDelta,
        baseUnit: currentProduct.baseUnit,
        reason: input.reason.trim(),
        referenceId: input.referenceId ?? null,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        productVersion: currentProduct.version + 1,
        createdAt: timestamp,
      },
      timestamp,
    });

    const movement: InventoryMovementRecord = {
      id: movementId,
      storeId: input.storeId,
      productId: input.productId,
      type: input.type,
      quantityDelta: input.quantityDelta,
      reason: input.reason.trim(),
      referenceId: input.referenceId ?? null,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const updatedProduct = await getProductById(transaction, input.storeId, input.productId);

    if (!updatedProduct) {
      throw new Error('No se pudo recuperar el producto actualizado.');
    }

    return { movement, product: updatedProduct };
  });
}
