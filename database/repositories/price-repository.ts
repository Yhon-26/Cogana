import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type { PriceHistoryRecord, ProductRecord } from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { getProductById } from './product-repository';
import { enqueueOperation } from './sync-outbox-repository';

type PriceHistoryRow = {
  id: string;
  store_id: string;
  product_id: string;
  previous_price_cents: number;
  new_price_cents: number;
  reason: string;
  actor_user_id: string | null;
  device_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type UpdateProductPriceInput = {
  storeId: string;
  productId: string;
  newPriceCents: number;
  reason?: string;
  actorUserId: string;
  deviceId: string;
};

function mapPriceHistoryRow(row: PriceHistoryRow): PriceHistoryRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    previousPriceCents: row.previous_price_cents,
    newPriceCents: row.new_price_cents,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export async function listPriceHistory(
  database: DatabaseAdapter,
  storeId: string,
  productId: string
): Promise<PriceHistoryRecord[]> {
  const rows = await database.getAll<PriceHistoryRow>(
    `SELECT *
     FROM price_history
     WHERE store_id = ? AND product_id = ?
     ORDER BY created_at DESC, id DESC`,
    [storeId, productId]
  );

  return rows.map(mapPriceHistoryRow);
}

export async function updateProductPrice(
  database: DatabaseAdapter,
  input: UpdateProductPriceInput
): Promise<ProductRecord> {
  if (!Number.isInteger(input.newPriceCents) || input.newPriceCents <= 0) {
    throw new Error('El precio debe ser un número entero de céntimos mayor que cero.');
  }

  if (!input.actorUserId || !input.deviceId) {
    throw new Error('El cambio de precio requiere usuario y dispositivo para auditoría.');
  }

  const historyId = createId();
  const outboxId = createId();
  const timestamp = new Date().toISOString();
  const reason = input.reason?.trim() || 'Actualización manual de precio';

  return database.transaction(async (transaction) => {
    const actor = await getActiveLocalUser(
      transaction,
      input.storeId,
      input.actorUserId
    );
    if (!actor || actor.role !== 'administrator') {
      throw new Error('Solo un administrador puede cambiar precios.');
    }

    const currentProduct = await getProductById(transaction, input.storeId, input.productId);
    if (!currentProduct) {
      throw new Error('No se encontró el producto que se desea actualizar.');
    }

    if (currentProduct.priceCents === input.newPriceCents) {
      return currentProduct;
    }

    const updateResult = await transaction.run(
      `UPDATE products
       SET price_cents = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        input.newPriceCents,
        timestamp,
        input.productId,
        input.storeId,
        currentProduct.version,
      ]
    );

    if (updateResult.changes !== 1) {
      throw new Error('El precio cambió desde otro proceso. Intenta nuevamente.');
    }

    await transaction.run(
      `INSERT INTO price_history (
        id, store_id, product_id, previous_price_cents, new_price_cents,
        reason, actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        historyId,
        input.storeId,
        input.productId,
        currentProduct.priceCents,
        input.newPriceCents,
        reason,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );

    await enqueueOperation(transaction, {
      id: outboxId,
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: historyId,
      entityType: 'price_history',
      entityId: historyId,
      operationType: 'product.price_updated',
      payload: {
        id: historyId,
        storeId: input.storeId,
        productId: input.productId,
        previousPriceCents: currentProduct.priceCents,
        newPriceCents: input.newPriceCents,
        reason,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        productVersion: currentProduct.version + 1,
        createdAt: timestamp,
      },
      timestamp,
    });

    const updatedProduct = await getProductById(transaction, input.storeId, input.productId);
    if (!updatedProduct) {
      throw new Error('No se pudo recuperar el producto con el nuevo precio.');
    }

    return updatedProduct;
  });
}
