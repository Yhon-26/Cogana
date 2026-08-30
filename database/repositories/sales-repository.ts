import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import { calculateLineTotalCents } from '../integer-calculations';
import type {
  InventoryMovementType,
  PaymentMethod,
  PaymentRecord,
  PresentationType,
  ProductBaseUnit,
  ProductPresentationRecord,
  ProductRecord,
  RecentSaleRecord,
  SaleItemRecord,
  SaleRecord,
} from '../models';
import { getOpenCashSession } from './cash-repository';
import { getActiveLocalUser } from './local-user-repository';
import { getProductPresentationById } from './presentation-repository';
import { getProductById } from './product-repository';
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
  base_unit_snapshot: ProductBaseUnit;
  quantity: number;
  price_cents_snapshot: number;
  pricing_quantity_snapshot: number;
  cost_cents_snapshot: number;
  cost_pricing_quantity_snapshot: number;
  line_total_cents: number;
  presentation_id: string | null;
  presentation_name_snapshot: string | null;
  presentation_type_snapshot: PresentationType | null;
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

type RecentSaleRow = SaleRow & {
  actor_display_name: string;
  payment_method: PaymentMethod;
};

type ReceiptSequenceRow = {
  next_number: number;
  version: number;
};

type ExistingOperationRow = {
  entity_type: string;
  entity_id: string;
};

export type ConfirmSaleItemInput = {
  productId: string;
  quantity?: number;
  presentationId?: string;
  presentationCount?: number;
};

export type ConfirmSalePaymentInput = {
  method: PaymentMethod;
  amountCents: number;
  amountReceivedCents?: number;
  reference?: string;
};

export type ConfirmSaleInput = {
  storeId: string;
  deviceId: string;
  actorUserId: string;
  operationId?: string;
  items: ConfirmSaleItemInput[];
  payment?: {
    method: PaymentMethod;
    amountReceivedCents?: number;
    reference?: string;
  };
  payments?: ConfirmSalePaymentInput[];
};

export type ConfirmedSaleResult = {
  sale: SaleRecord;
  items: SaleItemRecord[];
  payments: PaymentRecord[];
  /** @deprecated Usa `payments`. Se conserva para compatibilidad con ventas de un pago. */
  payment: PaymentRecord;
};

type ResolvedSaleItem = {
  product: ProductRecord;
  presentation: ProductPresentationRecord | null;
  presentationCount: number | null;
  quantity: number;
  priceCentsSnapshot: number;
  pricingQuantitySnapshot: number;
  lineTotalCents: number;
};

type ResolvedPayment = {
  method: PaymentMethod;
  amountCents: number;
  amountReceivedCents: number | null;
  changeCents: number;
  reference: string | null;
};

function mapSaleRow(row: SaleRow): SaleRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    deviceId: row.device_id,
    cashSessionId: row.cash_session_id,
    receiptNumber: row.receipt_number,
    actorUserId: row.actor_user_id,
    status: row.voided_at ? 'voided' : 'confirmed',
    totalCents: row.total_cents,
    voidedAt: row.voided_at,
    voidedByUserId: row.voided_by_user_id,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapSaleItemRow(row: SaleItemRow): SaleItemRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    saleId: row.sale_id,
    productId: row.product_id,
    productNameSnapshot: row.product_name_snapshot,
    baseUnitSnapshot: row.base_unit_snapshot,
    quantity: row.quantity,
    priceCentsSnapshot: row.price_cents_snapshot,
    pricingQuantitySnapshot: row.pricing_quantity_snapshot,
    costCentsSnapshot: row.cost_cents_snapshot,
    costPricingQuantitySnapshot: row.cost_pricing_quantity_snapshot,
    lineTotalCents: row.line_total_cents,
    presentationId: row.presentation_id,
    presentationNameSnapshot: row.presentation_name_snapshot,
    presentationTypeSnapshot: row.presentation_type_snapshot,
    presentationQuantitySnapshot: row.presentation_quantity_snapshot,
    presentationCount: row.presentation_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

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

export async function getConfirmedSaleResult(
  database: DatabaseAdapter,
  storeId: string,
  saleId: string
): Promise<ConfirmedSaleResult | null> {
  const saleRow = await database.getFirst<SaleRow>(
    'SELECT * FROM sales WHERE id = ? AND store_id = ?',
    [saleId, storeId]
  );
  if (!saleRow) return null;

  const itemRows = await database.getAll<SaleItemRow>(
    `SELECT *
     FROM sale_items
     WHERE store_id = ? AND sale_id = ?
     ORDER BY created_at, id`,
    [storeId, saleId]
  );
  const paymentRows = await database.getAll<PaymentRow>(
    `SELECT *
     FROM payments
     WHERE store_id = ? AND sale_id = ?
     ORDER BY created_at, id`,
    [storeId, saleId]
  );
  if (paymentRows.length === 0) {
    throw new Error('La venta persistida no tiene un pago asociado.');
  }

  const payments = paymentRows.map(mapPaymentRow);
  return {
    sale: mapSaleRow(saleRow),
    items: itemRows.map(mapSaleItemRow),
    payments,
    payment: payments[0],
  };
}

function resolvePayments(
  input: ConfirmSaleInput,
  totalCents: number
): ResolvedPayment[] {
  if (input.payment && input.payments) {
    throw new Error('Envía payment o payments, pero no ambos.');
  }

  const requestedPayments: ConfirmSalePaymentInput[] = input.payments
    ? input.payments
    : input.payment
      ? [{ ...input.payment, amountCents: totalCents }]
      : [];

  if (requestedPayments.length === 0) {
    throw new Error('Agrega al menos un medio de pago.');
  }

  const methods = new Set<PaymentMethod>();
  let allocatedCents = 0;
  const resolved = requestedPayments.map((payment) => {
    if (methods.has(payment.method)) {
      throw new Error('Cada medio de pago solo puede agregarse una vez.');
    }
    methods.add(payment.method);

    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
      throw new Error('Cada pago debe tener un monto válido mayor que cero.');
    }
    allocatedCents += payment.amountCents;
    if (!Number.isSafeInteger(allocatedCents)) {
      throw new Error('La suma de pagos excede el rango permitido.');
    }

    const reference = payment.reference?.trim() || null;
    if (
      (payment.method === 'yape' || payment.method === 'plin') &&
      reference === null
    ) {
      throw new Error('Yape y Plin requieren un código de operación validado.');
    }

    let amountReceivedCents: number | null = null;
    let changeCents = 0;
    if (payment.method === 'cash') {
      if (
        !Number.isSafeInteger(payment.amountReceivedCents) ||
        (payment.amountReceivedCents ?? 0) < payment.amountCents
      ) {
        throw new Error('El efectivo recibido debe cubrir el monto pagado en efectivo.');
      }
      amountReceivedCents = payment.amountReceivedCents as number;
      changeCents = amountReceivedCents - payment.amountCents;
    } else if (payment.amountReceivedCents !== undefined) {
      throw new Error('Solo los pagos en efectivo registran monto recibido.');
    }

    return {
      method: payment.method,
      amountCents: payment.amountCents,
      amountReceivedCents,
      changeCents,
      reference,
    };
  });

  if (allocatedCents !== totalCents) {
    throw new Error('La suma de los pagos debe coincidir con el total de la venta.');
  }

  return resolved;
}

async function resolveSaleItem(
  database: DatabaseAdapter,
  storeId: string,
  input: ConfirmSaleItemInput
): Promise<ResolvedSaleItem> {
  const product = await getProductById(database, storeId, input.productId);
  if (!product || !product.isActive) {
    throw new Error('Uno de los productos ya no está disponible.');
  }

  if (input.presentationId) {
    if (!Number.isSafeInteger(input.presentationCount) || (input.presentationCount ?? 0) <= 0) {
      throw new Error('La cantidad de presentaciones debe ser un entero mayor que cero.');
    }

    const presentation = await getProductPresentationById(
      database,
      storeId,
      input.presentationId
    );
    if (
      !presentation ||
      !presentation.isActive ||
      presentation.productId !== product.id
    ) {
      throw new Error('La presentación seleccionada no está disponible para el producto.');
    }

    const presentationCount = input.presentationCount as number;
    const quantity = presentation.quantityInBaseUnits * presentationCount;
    if (!Number.isSafeInteger(quantity)) {
      throw new Error('La cantidad de la presentación excede el rango permitido.');
    }

    const priceCentsSnapshot = presentation.fixedPriceCents ?? product.priceCents;
    const pricingQuantitySnapshot =
      presentation.fixedPriceCents === null
        ? product.pricingQuantity
        : presentation.quantityInBaseUnits;
    const lineTotalCents = calculateLineTotalCents(
      quantity,
      priceCentsSnapshot,
      pricingQuantitySnapshot
    );

    return {
      product,
      presentation,
      presentationCount,
      quantity,
      priceCentsSnapshot,
      pricingQuantitySnapshot,
      lineTotalCents,
    };
  }

  if (!Number.isSafeInteger(input.quantity) || (input.quantity ?? 0) <= 0) {
    throw new Error('La cantidad debe ser un entero mayor que cero en la unidad base.');
  }

  const quantity = input.quantity as number;
  return {
    product,
    presentation: null,
    presentationCount: null,
    quantity,
    priceCentsSnapshot: product.priceCents,
    pricingQuantitySnapshot: product.pricingQuantity,
    lineTotalCents: calculateLineTotalCents(
      quantity,
      product.priceCents,
      product.pricingQuantity
    ),
  };
}

async function nextReceiptNumber(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  timestamp: string
) {
  const current = await database.getFirst<ReceiptSequenceRow>(
    `SELECT next_number, version
     FROM local_receipt_sequences
     WHERE store_id = ? AND device_id = ?`,
    [storeId, deviceId]
  );

  let sequence: number;
  if (!current) {
    sequence = 1;
    await database.run(
      `INSERT INTO local_receipt_sequences (
        store_id, device_id, next_number, created_at, updated_at, version
      ) VALUES (?, ?, 2, ?, ?, 1)`,
      [storeId, deviceId, timestamp, timestamp]
    );
  } else {
    sequence = current.next_number;
    const update = await database.run(
      `UPDATE local_receipt_sequences
       SET next_number = next_number + 1,
           updated_at = ?,
           version = version + 1
       WHERE store_id = ? AND device_id = ? AND version = ?`,
      [timestamp, storeId, deviceId, current.version]
    );
    if (update.changes !== 1) {
      throw new Error('No se pudo reservar el número de comprobante.');
    }
  }

  const deviceSuffix = deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `V-${deviceSuffix}-${String(sequence).padStart(6, '0')}`;
}

export async function confirmSale(
  database: DatabaseAdapter,
  input: ConfirmSaleInput
): Promise<ConfirmedSaleResult> {
  if (!input.deviceId || !input.actorUserId) {
    throw new Error('La venta requiere usuario y dispositivo.');
  }
  if (input.items.length === 0) {
    throw new Error('Agrega al menos un producto a la venta.');
  }

  const saleId = input.operationId ?? createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    const existingOperation = await transaction.getFirst<ExistingOperationRow>(
      `SELECT entity_type, entity_id
       FROM sync_outbox
       WHERE store_id = ? AND operation_id = ?`,
      [input.storeId, saleId]
    );
    if (existingOperation) {
      if (existingOperation.entity_type !== 'sale') {
        throw new Error('El identificador de operación ya pertenece a otra entidad.');
      }
      const existingSale = await getConfirmedSaleResult(
        transaction,
        input.storeId,
        existingOperation.entity_id
      );
      if (!existingSale) {
        throw new Error('La operación idempotente no tiene una venta asociada.');
      }
      return existingSale;
    }

    const actor = await getActiveLocalUser(
      transaction,
      input.storeId,
      input.actorUserId
    );
    if (!actor) {
      throw new Error('Selecciona un usuario local activo para confirmar la venta.');
    }

    const cashSession = await getOpenCashSession(
      transaction,
      input.storeId,
      input.deviceId
    );
    if (!cashSession) {
      throw new Error('Abre una caja en este dispositivo antes de vender.');
    }

    const resolvedItems: ResolvedSaleItem[] = [];
    for (const item of input.items) {
      resolvedItems.push(await resolveSaleItem(transaction, input.storeId, item));
    }

    const quantitiesByProduct = new Map<
      string,
      { product: ProductRecord; quantity: number }
    >();
    for (const item of resolvedItems) {
      const current = quantitiesByProduct.get(item.product.id);
      const quantity = (current?.quantity ?? 0) + item.quantity;
      if (!Number.isSafeInteger(quantity)) {
        throw new Error('La cantidad acumulada excede el rango permitido.');
      }
      quantitiesByProduct.set(item.product.id, { product: item.product, quantity });
    }
    for (const { product, quantity } of quantitiesByProduct.values()) {
      if (quantity > product.stockQuantity) {
        throw new Error(`Stock insuficiente para ${product.name}.`);
      }
    }

    const totalCents = resolvedItems.reduce(
      (total, item) => total + item.lineTotalCents,
      0
    );
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
      throw new Error('El total de la venta no es válido.');
    }

    const resolvedPayments = resolvePayments(input, totalCents);

    const receiptNumber = await nextReceiptNumber(
      transaction,
      input.storeId,
      input.deviceId,
      timestamp
    );
    await transaction.run(
      `INSERT INTO sales (
        id, store_id, device_id, cash_session_id, receipt_number,
        actor_user_id, status, total_cents, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, 1)`,
      [
        saleId,
        input.storeId,
        input.deviceId,
        cashSession.id,
        receiptNumber,
        input.actorUserId,
        totalCents,
        timestamp,
        timestamp,
      ]
    );

    const saleItemIds: string[] = [];
    for (const item of resolvedItems) {
      const itemId = createId();
      saleItemIds.push(itemId);
      await transaction.run(
        `INSERT INTO sale_items (
          id, store_id, sale_id, product_id, product_name_snapshot,
          base_unit_snapshot, quantity, price_cents_snapshot,
          pricing_quantity_snapshot, cost_cents_snapshot,
          cost_pricing_quantity_snapshot, line_total_cents,
          presentation_id, presentation_name_snapshot,
          presentation_type_snapshot, presentation_quantity_snapshot,
          presentation_count, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          itemId,
          input.storeId,
          saleId,
          item.product.id,
          item.product.name,
          item.product.baseUnit,
          item.quantity,
          item.priceCentsSnapshot,
          item.pricingQuantitySnapshot,
          item.product.costCents,
          item.product.pricingQuantity,
          item.lineTotalCents,
          item.presentation?.id ?? null,
          item.presentation?.name ?? null,
          item.presentation?.type ?? null,
          item.presentation?.quantityInBaseUnits ?? null,
          item.presentationCount,
          timestamp,
          timestamp,
        ]
      );
    }

    const paymentIds: string[] = [];
    for (const payment of resolvedPayments) {
      const paymentId = createId();
      paymentIds.push(paymentId);
      await transaction.run(
        `INSERT INTO payments (
          id, store_id, sale_id, payment_method, amount_cents,
          amount_received_cents, change_cents, reference,
          actor_user_id, device_id, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          paymentId,
          input.storeId,
          saleId,
          payment.method,
          payment.amountCents,
          payment.amountReceivedCents,
          payment.changeCents,
          payment.reference,
          input.actorUserId,
          input.deviceId,
          timestamp,
          timestamp,
        ]
      );
    }

    const movementType: InventoryMovementType = 'sale';
    for (const { product, quantity } of quantitiesByProduct.values()) {
      const nextStock = product.stockQuantity - quantity;
      const update = await transaction.run(
        `UPDATE products
         SET stock_quantity = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND store_id = ? AND version = ?`,
        [nextStock, timestamp, product.id, input.storeId, product.version]
      );
      if (update.changes !== 1) {
        throw new Error(`El stock de ${product.name} cambió. Intenta nuevamente.`);
      }

      const movementId = createId();
      await transaction.run(
        `INSERT INTO inventory_movements (
          id, store_id, product_id, movement_type, quantity_delta,
          reason, reference_id, actor_user_id, device_id,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          movementId,
          input.storeId,
          product.id,
          movementType,
          -quantity,
          `Venta ${receiptNumber}`,
          saleId,
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
          productId: product.id,
          type: movementType,
          quantityDelta: -quantity,
          baseUnit: product.baseUnit,
          referenceId: saleId,
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
      operationId: saleId,
      entityType: 'sale',
      entityId: saleId,
      operationType: 'sale.confirmed',
      payload: {
        id: saleId,
        storeId: input.storeId,
        deviceId: input.deviceId,
        cashSessionId: cashSession.id,
        receiptNumber,
        actorUserId: input.actorUserId,
        totalCents,
        items: resolvedItems.map((item, index) => ({
          id: saleItemIds[index],
          productId: item.product.id,
          productName: item.product.name,
          baseUnit: item.product.baseUnit,
          quantity: item.quantity,
          priceCents: item.priceCentsSnapshot,
          pricingQuantity: item.pricingQuantitySnapshot,
          costCents: item.product.costCents,
          costPricingQuantity: item.product.pricingQuantity,
          lineTotalCents: item.lineTotalCents,
          presentationId: item.presentation?.id ?? null,
          presentationName: item.presentation?.name ?? null,
          presentationType: item.presentation?.type ?? null,
          presentationQuantity: item.presentation?.quantityInBaseUnits ?? null,
          presentationCount: item.presentationCount,
        })),
        payments: resolvedPayments.map((payment, index) => ({
          id: paymentIds[index],
          method: payment.method,
          amountCents: payment.amountCents,
          amountReceivedCents: payment.amountReceivedCents,
          changeCents: payment.changeCents,
          reference: payment.reference,
        })),
        ...(resolvedPayments.length === 1
          ? {
              payment: {
                id: paymentIds[0],
                method: resolvedPayments[0].method,
                amountCents: resolvedPayments[0].amountCents,
                amountReceivedCents: resolvedPayments[0].amountReceivedCents,
                changeCents: resolvedPayments[0].changeCents,
                reference: resolvedPayments[0].reference,
              },
            }
          : {}),
        createdAt: timestamp,
      },
      timestamp,
    });

    const result = await getConfirmedSaleResult(transaction, input.storeId, saleId);
    if (!result) {
      throw new Error('No se pudo recuperar la venta confirmada.');
    }
    return result;
  });
}

export async function listRecentSalesForSession(
  database: DatabaseAdapter,
  storeId: string,
  cashSessionId: string,
  limit = 10
): Promise<RecentSaleRecord[]> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('El límite de ventas recientes debe ser mayor que cero.');
  }

  const rows = await database.getAll<RecentSaleRow>(
    `SELECT
       sales.*,
       local_users.display_name AS actor_display_name,
       (
         SELECT payments.payment_method
         FROM payments
         WHERE payments.sale_id = sales.id
           AND payments.store_id = sales.store_id
         ORDER BY payments.created_at, payments.id
         LIMIT 1
       ) AS payment_method
     FROM sales
     INNER JOIN local_users
       ON local_users.id = sales.actor_user_id
       AND local_users.store_id = sales.store_id
     WHERE sales.store_id = ? AND sales.cash_session_id = ? AND sales.voided_at IS NULL
      ORDER BY sales.created_at DESC, sales.id DESC
      LIMIT ?`,
    [storeId, cashSessionId, limit]
  );

  return rows.map((row) => ({
    ...mapSaleRow(row),
    actorDisplayName: row.actor_display_name,
    paymentMethod: row.payment_method,
  }));
}
