import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type {
  PaymentMethod,
  PaymentRecord,
  SaleItemRecord,
  SaleRecord,
  SaleStatusHistoryRecord,
} from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { getConfirmedSaleResult } from './sales-repository';
import { enqueueOperation } from './sync-outbox-repository';

type SaleRow = {
  id: string;
  store_id: string;
  device_id: string;
  cash_session_id: string;
  receipt_number: string;
  actor_user_id: string;
  status: 'confirmed';
  total_cents: number;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type SaleItemRow = {
  id: string;
  store_id: string;
  sale_id: string;
  product_id: string;
  product_name_snapshot: string;
  base_unit_snapshot: 'gram' | 'unit';
  quantity: number;
  price_cents_snapshot: number;
  pricing_quantity_snapshot: number;
  cost_cents_snapshot: number;
  cost_pricing_quantity_snapshot: number;
  line_total_cents: number;
  presentation_id: string | null;
  presentation_name_snapshot: string | null;
  presentation_type_snapshot: string | null;
  presentation_quantity_snapshot: number | null;
  presentation_count: number | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type PaymentRow = {
  id: string;
  store_id: string;
  sale_id: string;
  payment_method: PaymentMethod;
  amount_cents: number;
  amount_received_cents: number | null;
  change_cents: number;
  reference: string | null;
  actor_user_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type ProductVersionRow = {
  stock_quantity: number;
  version: number;
};

type ExistingVoidRow = {
  entity_id: string;
  operation_id: string;
};

export type VoidSaleInput = {
  storeId: string;
  saleId: string;
  actorUserId: string;
  deviceId: string;
  reason: string;
};

export type VoidSaleResult = {
  sale: SaleRecord;
  items: SaleItemRecord[];
  payment: PaymentRecord;
  statusHistory: SaleStatusHistoryRecord;
  cashMovementId: string | null;
};

function mapPaymentRow(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    saleId: row.sale_id,
    method: row.payment_method,
    amountCents: row.amount_cents,
    amountReceivedCents: row.amount_received_cents,
    changeCents: row.change_cents,
    reference: row.reference,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export async function voidSale(
  database: DatabaseAdapter,
  input: VoidSaleInput
): Promise<VoidSaleResult> {
  if (!input.reason.trim()) {
    throw new Error('La anulación requiere un motivo.');
  }
  if (!input.deviceId || !input.actorUserId) {
    throw new Error('La anulación requiere usuario y dispositivo.');
  }

  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    const existing = await transaction.getFirst<ExistingVoidRow>(
      `SELECT entity_id, operation_id
       FROM sync_outbox
       WHERE store_id = ?
         AND entity_id = ?
         AND operation_type = 'sale.voided'
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.storeId, input.saleId]
    );
    if (existing) {
      const sale = await getConfirmedSaleResult(transaction, input.storeId, input.saleId);
      if (!sale) {
        throw new Error('La anulación previa no tiene una venta asociada.');
      }
      const saleRow = await transaction.getFirst<SaleRow>(
        'SELECT * FROM sales WHERE id = ? AND store_id = ?',
        [input.saleId, input.storeId]
      );
      if (!saleRow) {
        throw new Error('No se pudo recuperar la venta anulada.');
      }
      return {
        ...sale,
        sale: {
          ...sale.sale,
          status: saleRow.voided_at ? 'voided' : 'confirmed',
          voidedAt: saleRow.voided_at,
          voidedByUserId: saleRow.voided_by_user_id,
          voidReason: saleRow.void_reason,
        },
        statusHistory: {} as SaleStatusHistoryRecord,
        cashMovementId: null,
      } as VoidSaleResult;
    }

    const operationId = createId();

    const actor = await getActiveLocalUser(
      transaction,
      input.storeId,
      input.actorUserId
    );
    if (!actor) {
      throw new Error('Selecciona un usuario local activo para anular la venta.');
    }
    if (actor.role !== 'administrator') {
      throw new Error('Solo un administrador puede anular ventas.');
    }

    const saleRow = await transaction.getFirst<SaleRow>(
      'SELECT * FROM sales WHERE id = ? AND store_id = ?',
      [input.saleId, input.storeId]
    );
    if (!saleRow) {
      throw new Error('No se encontró la venta a anular.');
    }
    if (saleRow.voided_at !== null) {
      throw new Error('La venta ya está anulada.');
    }
    const previousReturn = await transaction.getFirst<{ id: string }>(
      'SELECT id FROM sale_returns WHERE store_id = ? AND sale_id = ? LIMIT 1',
      [input.storeId, input.saleId]
    );
    if (previousReturn) {
      throw new Error(
        'La venta tiene devoluciones parciales y ya no puede anularse completa.'
      );
    }
    if (saleRow.device_id !== input.deviceId) {
      throw new Error('La anulación debe realizarse desde el dispositivo original.');
    }

    const openSession = await transaction.getFirst<{ id: string }>(
      `SELECT id FROM cash_sessions
       WHERE store_id = ? AND device_id = ? AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
      [input.storeId, input.deviceId]
    );
    if (!openSession) {
      throw new Error('Abre una caja en este dispositivo antes de anular una venta.');
    }
    if (openSession.id !== saleRow.cash_session_id) {
      throw new Error(
        'La anulación debe realizarse en la misma caja abierta de la venta original.'
      );
    }

    const itemRows = await transaction.getAll<SaleItemRow>(
      `SELECT * FROM sale_items
       WHERE store_id = ? AND sale_id = ?
       ORDER BY created_at, id`,
      [input.storeId, input.saleId]
    );
    if (itemRows.length === 0) {
      throw new Error('La venta no tiene ítems asociados.');
    }

    const paymentRow = await transaction.getFirst<PaymentRow>(
      `SELECT * FROM payments
       WHERE store_id = ? AND sale_id = ?
       ORDER BY created_at, id LIMIT 1`,
      [input.storeId, input.saleId]
    );
    if (!paymentRow) {
      throw new Error('La venta no tiene un pago asociado.');
    }

    const update = await transaction.run(
      `UPDATE sales
       SET voided_at = ?,
           voided_by_user_id = ?,
           void_reason = ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ? AND store_id = ? AND voided_at IS NULL AND version = ?`,
      [
        timestamp,
        input.actorUserId,
        input.reason.trim(),
        timestamp,
        input.saleId,
        input.storeId,
        saleRow.version,
      ]
    );
    if (update.changes !== 1) {
      throw new Error('La venta cambió antes de anularse. Intenta nuevamente.');
    }

    const historyId = createId();
    await transaction.run(
      `INSERT INTO sale_status_history (
        id, store_id, sale_id, from_status, to_status, reason,
        actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, 'confirmed', 'voided', ?, ?, ?, ?, ?, 1)`,
      [
        historyId,
        input.storeId,
        input.saleId,
        input.reason.trim(),
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );

    for (const item of itemRows) {
      const productVersion = await transaction.getFirst<ProductVersionRow>(
        'SELECT stock_quantity, version FROM products WHERE id = ? AND store_id = ?',
        [item.product_id, input.storeId]
      );
      if (!productVersion) {
        throw new Error(`No se encontró el producto ${item.product_name_snapshot}.`);
      }
      const nextStock = productVersion.stock_quantity + item.quantity;
      if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
        throw new Error(
          `El retorno de ${item.product_name_snapshot} deja un stock inválido.`
        );
      }
      const stockUpdate = await transaction.run(
        `UPDATE products
         SET stock_quantity = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND store_id = ? AND version = ?`,
        [
          nextStock,
          timestamp,
          item.product_id,
          input.storeId,
          productVersion.version,
        ]
      );
      if (stockUpdate.changes !== 1) {
        throw new Error(
          `El stock de ${item.product_name_snapshot} cambió. Intenta nuevamente.`
        );
      }

      const movementId = createId();
      await transaction.run(
        `INSERT INTO inventory_movements (
          id, store_id, product_id, movement_type, quantity_delta,
          reason, reference_id, actor_user_id, device_id,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, 'return', ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          movementId,
          input.storeId,
          item.product_id,
          item.quantity,
          `Anulación ${saleRow.receipt_number}`,
          input.saleId,
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
          productId: item.product_id,
          type: 'return',
          quantityDelta: item.quantity,
          reason: `Anulación ${saleRow.receipt_number}`,
          referenceId: input.saleId,
          actorUserId: input.actorUserId,
          deviceId: input.deviceId,
          createdAt: timestamp,
        },
        timestamp,
      });
    }

    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'sale',
      entityId: input.saleId,
      operationType: 'sale.voided',
      payload: {
        id: input.saleId,
        storeId: input.storeId,
        receiptNumber: saleRow.receipt_number,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        reason: input.reason.trim(),
        createdAt: timestamp,
      },
      timestamp,
    });

    const result = await getConfirmedSaleResult(transaction, input.storeId, input.saleId);
    if (!result) {
      throw new Error('No se pudo recuperar la venta anulada.');
    }
    const statusHistory = {
      id: historyId,
      storeId: input.storeId,
      saleId: input.saleId,
      fromStatus: 'confirmed',
      toStatus: 'voided',
      reason: input.reason.trim(),
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    } as SaleStatusHistoryRecord;

    return {
      sale: result.sale,
      items: result.items,
      payment: mapPaymentRow(paymentRow),
      statusHistory,
      cashMovementId: null,
    };
  });
}
