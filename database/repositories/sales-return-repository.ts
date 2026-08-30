import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import { roundIntegerRatio } from '../integer-calculations';
import type { PaymentMethod } from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { enqueueOperation } from './sync-outbox-repository';

export type SaleReturnRecord = {
  id: string;
  saleId: string;
  refundMethod: PaymentMethod;
  totalCents: number;
  reason: string;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  items: {
    id: string;
    saleItemId: string;
    productId: string;
    productName: string;
    quantity: number;
    refundCents: number;
  }[];
};

export async function listSaleReturns(
  database: DatabaseAdapter,
  storeId: string,
  saleId: string
): Promise<SaleReturnRecord[]> {
  const rows = await database.getAll<{
    id: string;
    sale_id: string;
    refund_method: PaymentMethod;
    total_cents: number;
    reason: string;
    actor_user_id: string;
    device_id: string;
    created_at: string;
  }>(
    `SELECT * FROM sale_returns
     WHERE store_id = ? AND sale_id = ? ORDER BY created_at DESC`,
    [storeId, saleId]
  );
  const result: SaleReturnRecord[] = [];
  for (const row of rows) {
    const items = await database.getAll<{
      id: string;
      sale_item_id: string;
      product_id: string;
      product_name: string;
      quantity: number;
      refund_cents: number;
    }>(
      `SELECT sri.id,sri.sale_item_id,sri.product_id,
        si.product_name_snapshot AS product_name,sri.quantity,sri.refund_cents
       FROM sale_return_items sri
       JOIN sale_items si ON si.id = sri.sale_item_id AND si.store_id = sri.store_id
       WHERE sri.store_id = ? AND sri.sale_return_id = ?`,
      [storeId, row.id]
    );
    result.push({
      id: row.id,
      saleId: row.sale_id,
      refundMethod: row.refund_method,
      totalCents: row.total_cents,
      reason: row.reason,
      actorUserId: row.actor_user_id,
      deviceId: row.device_id,
      createdAt: row.created_at,
      items: items.map((item) => ({
        id: item.id,
        saleItemId: item.sale_item_id,
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        refundCents: item.refund_cents,
      })),
    });
  }
  return result;
}

export async function createPartialSaleReturn(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    saleId: string;
    items: { saleItemId: string; quantity: number }[];
    refundMethod: PaymentMethod;
    reason: string;
    actorUserId: string;
    deviceId: string;
  }
) {
  if (!input.items.length) throw new Error('Selecciona al menos un producto.');
  if (!input.reason.trim()) throw new Error('La devolución requiere motivo.');
  if (!input.deviceId) throw new Error('La devolución requiere dispositivo.');
  const id = createId();
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    const actor = await getActiveLocalUser(
      transaction,
      input.storeId,
      input.actorUserId
    );
    if (!actor || actor.role !== 'administrator') {
      throw new Error('Solo un administrador puede registrar devoluciones.');
    }
    const sale = await transaction.getFirst<{
      id: string;
      receipt_number: string;
      voided_at: string | null;
    }>(
      'SELECT id,receipt_number,voided_at FROM sales WHERE id = ? AND store_id = ?',
      [input.saleId, input.storeId]
    );
    if (!sale || sale.voided_at) throw new Error('La venta no admite devoluciones.');
    const requestedIds = new Set<string>();
    const resolved: {
      id: string;
      saleItemId: string;
      productId: string;
      productName: string;
      quantity: number;
      refundCents: number;
    }[] = [];
    let totalCents = 0;
    for (const requested of input.items) {
      if (requestedIds.has(requested.saleItemId)) {
        throw new Error('Cada ítem se devuelve una sola vez por operación.');
      }
      requestedIds.add(requested.saleItemId);
      const item = await transaction.getFirst<{
        id: string;
        product_id: string;
        product_name_snapshot: string;
        quantity: number;
        line_total_cents: number;
        returned_quantity: number;
        returned_cents: number;
      }>(
        `SELECT si.id,si.product_id,si.product_name_snapshot,si.quantity,
          si.line_total_cents,
          coalesce((SELECT sum(sri.quantity) FROM sale_return_items sri
            JOIN sale_returns sr ON sr.id = sri.sale_return_id
              AND sr.store_id = sri.store_id
            WHERE sri.store_id = si.store_id AND sri.sale_item_id = si.id),0)
            AS returned_quantity,
          coalesce((SELECT sum(sri.refund_cents) FROM sale_return_items sri
            JOIN sale_returns sr ON sr.id = sri.sale_return_id
              AND sr.store_id = sri.store_id
            WHERE sri.store_id = si.store_id AND sri.sale_item_id = si.id),0)
            AS returned_cents
         FROM sale_items si
         WHERE si.id = ? AND si.store_id = ? AND si.sale_id = ?`,
        [requested.saleItemId, input.storeId, input.saleId]
      );
      if (
        !item ||
        !Number.isSafeInteger(requested.quantity) ||
        requested.quantity <= 0 ||
        requested.quantity > item.quantity - item.returned_quantity
      ) {
        throw new Error('La cantidad excede lo disponible para devolver.');
      }
      const isLastReturn = requested.quantity === item.quantity - item.returned_quantity;
      const refundCents = isLastReturn
        ? item.line_total_cents - item.returned_cents
        : roundIntegerRatio(
            requested.quantity,
            item.line_total_cents,
            item.quantity
          );
      if (refundCents <= 0) throw new Error('La devolución no produce un monto válido.');
      totalCents += refundCents;
      resolved.push({
        id: createId(),
        saleItemId: item.id,
        productId: item.product_id,
        productName: item.product_name_snapshot,
        quantity: requested.quantity,
        refundCents,
      });
    }

    let cashSessionId: string | null = null;
    let cashMovementId: string | null = null;
    if (input.refundMethod === 'cash') {
      const session = await transaction.getFirst<{ id: string }>(
        `SELECT id FROM cash_sessions
         WHERE store_id = ? AND device_id = ? AND status = 'open'`,
        [input.storeId, input.deviceId]
      );
      if (!session) throw new Error('Abre una caja para devolver efectivo.');
      const available = await transaction.getFirst<{ expected_cents: number }>(
        `SELECT cs.opening_cash_cents
          + coalesce((SELECT sum(p.amount_cents) FROM payments p
            JOIN sales s ON s.id = p.sale_id AND s.store_id = p.store_id
            WHERE s.cash_session_id = cs.id AND s.voided_at IS NULL
              AND p.payment_method = 'cash'),0)
          + coalesce((SELECT sum(cm.amount_cents) FROM cash_movements cm
            WHERE cm.cash_session_id = cs.id AND cm.movement_type = 'income'),0)
          - coalesce((SELECT sum(cm.amount_cents) FROM cash_movements cm
            WHERE cm.cash_session_id = cs.id AND cm.movement_type = 'outflow'),0)
          AS expected_cents
         FROM cash_sessions cs WHERE cs.id = ? AND cs.store_id = ?`,
        [session.id, input.storeId]
      );
      if ((available?.expected_cents ?? 0) < totalCents) {
        throw new Error('La caja no tiene efectivo esperado suficiente.');
      }
      cashSessionId = session.id;
      cashMovementId = createId();
      await transaction.run(
        `INSERT INTO cash_movements(
          id,store_id,cash_session_id,movement_type,amount_cents,reason,
          actor_user_id,device_id,created_at,updated_at,version,sale_id
        ) VALUES(?,?,?,'outflow',?,?,?,?,?,?,1,?)`,
        [
          cashMovementId,
          input.storeId,
          session.id,
          totalCents,
          `Devolución ${sale.receipt_number}: ${input.reason.trim()}`,
          input.actorUserId,
          input.deviceId,
          timestamp,
          timestamp,
          input.saleId,
        ]
      );
    }
    await transaction.run(
      `INSERT INTO sale_returns(
        id,store_id,sale_id,cash_session_id,refund_method,total_cents,reason,
        actor_user_id,device_id,created_at,updated_at,version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        id,
        input.storeId,
        input.saleId,
        cashSessionId,
        input.refundMethod,
        totalCents,
        input.reason.trim(),
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    for (const item of resolved) {
      await transaction.run(
        `INSERT INTO sale_return_items(
          id,store_id,sale_return_id,sale_item_id,product_id,quantity,
          refund_cents,created_at,updated_at,version
        ) VALUES(?,?,?,?,?,?,?,?,?,1)`,
        [
          item.id,
          input.storeId,
          id,
          item.saleItemId,
          item.productId,
          item.quantity,
          item.refundCents,
          timestamp,
          timestamp,
        ]
      );
      const product = await transaction.getFirst<{
        stock_quantity: number;
        version: number;
        base_unit: string;
      }>(
        'SELECT stock_quantity,version,base_unit FROM products WHERE id = ? AND store_id = ?',
        [item.productId, input.storeId]
      );
      if (!product) throw new Error(`No se encontró ${item.productName}.`);
      const updated = await transaction.run(
        `UPDATE products SET stock_quantity = ?,updated_at = ?,version = version + 1
         WHERE id = ? AND store_id = ? AND version = ?`,
        [
          product.stock_quantity + item.quantity,
          timestamp,
          item.productId,
          input.storeId,
          product.version,
        ]
      );
      if (updated.changes !== 1) throw new Error('El inventario cambió durante la devolución.');
      const movementId = createId();
      await transaction.run(
        `INSERT INTO inventory_movements(
          id,store_id,product_id,movement_type,quantity_delta,reason,
          reference_id,actor_user_id,device_id,created_at,updated_at,version
        ) VALUES(?,?,?,'return',?,?,?,?,?,?,?,1)`,
        [
          movementId,
          input.storeId,
          item.productId,
          item.quantity,
          `Devolución parcial ${sale.receipt_number}`,
          id,
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
        operationId: movementId,
        entityType: 'inventory_movement',
        entityId: movementId,
        operationType: 'inventory_movement.created',
        payload: {
          id: movementId,
          storeId: input.storeId,
          productId: item.productId,
          type: 'return',
          quantityDelta: item.quantity,
          baseUnit: product.base_unit,
          reason: `Devolución parcial ${sale.receipt_number}`,
          referenceId: id,
          actorUserId: input.actorUserId,
          deviceId: input.deviceId,
          productVersion: product.version + 1,
          createdAt: timestamp,
        },
        timestamp,
      });
    }
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: id,
      entityType: 'sale_return',
      entityId: id,
      operationType: 'sale.returned',
      payload: {
        id,
        storeId: input.storeId,
        saleId: input.saleId,
        cashSessionId,
        cashMovementId,
        refundMethod: input.refundMethod,
        totalCents,
        reason: input.reason.trim(),
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        items: resolved,
        createdAt: timestamp,
      },
      timestamp,
    });
    return id;
  });
}
