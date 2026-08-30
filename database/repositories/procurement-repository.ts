import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import { calculateLineTotalCents } from '../integer-calculations';
import { getActiveLocalUser } from './local-user-repository';
import { getProductById } from './product-repository';
import { enqueueOperation } from './sync-outbox-repository';

export type PurchaseOrderSummary = {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  status: 'ordered' | 'partially_received' | 'received' | 'cancelled';
  expectedAt: string | null;
  notes: string | null;
  totalCents: number;
  receivedAt: string | null;
  createdAt: string;
  items: {
    id: string;
    productId: string;
    productName: string;
    orderedQuantity: number;
    receivedQuantity: number;
    unitCostCents: number;
    pricingQuantity: number;
    lineTotalCents: number;
  }[];
};

export type InventoryLotSummary = {
  id: string;
  productName: string;
  supplierName: string;
  lotCode: string;
  expiresAt: string | null;
  receivedQuantity: number;
  remainingQuantity: number;
  createdAt: string;
};

async function requireActor(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  administrator = false
) {
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!actor || (administrator && actor.role !== 'administrator')) {
    throw new Error(
      administrator
        ? 'Solo un administrador realiza esta operación.'
        : 'Selecciona un operador activo.'
    );
  }
  return actor;
}

export async function listPurchaseOrders(
  database: DatabaseAdapter,
  storeId: string
) {
  const orders = await database.getAll<{
    id: string;
    order_number: string;
    supplier_id: string;
    supplier_name: string;
    status: PurchaseOrderSummary['status'];
    expected_at: string | null;
    notes: string | null;
    total_cents: number;
    received_at: string | null;
    created_at: string;
  }>(
    `SELECT po.*,s.name AS supplier_name FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id AND s.store_id = po.store_id
     WHERE po.store_id = ? ORDER BY po.created_at DESC`,
    [storeId]
  );
  const result: PurchaseOrderSummary[] = [];
  for (const order of orders) {
    const items = await database.getAll<{
      id: string;
      product_id: string;
      product_name_snapshot: string;
      ordered_quantity: number;
      received_quantity: number;
      unit_cost_cents: number;
      pricing_quantity: number;
      line_total_cents: number;
    }>(
      `SELECT * FROM purchase_order_items
       WHERE store_id = ? AND purchase_order_id = ? ORDER BY created_at`,
      [storeId, order.id]
    );
    result.push({
      id: order.id,
      orderNumber: order.order_number,
      supplierId: order.supplier_id,
      supplierName: order.supplier_name,
      status: order.status,
      expectedAt: order.expected_at,
      notes: order.notes,
      totalCents: order.total_cents,
      receivedAt: order.received_at,
      createdAt: order.created_at,
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name_snapshot,
        orderedQuantity: item.ordered_quantity,
        receivedQuantity: item.received_quantity,
        unitCostCents: item.unit_cost_cents,
        pricingQuantity: item.pricing_quantity,
        lineTotalCents: item.line_total_cents,
      })),
    });
  }
  return result;
}

export async function listInventoryLots(
  database: DatabaseAdapter,
  storeId: string
) {
  const rows = await database.getAll<{
    id: string;
    product_name: string;
    supplier_name: string;
    lot_code: string;
    expires_at: string | null;
    received_quantity: number;
    remaining_quantity: number;
    created_at: string;
  }>(
    `SELECT l.id,p.name AS product_name,s.name AS supplier_name,l.lot_code,
      l.expires_at,l.received_quantity,l.remaining_quantity,l.created_at
     FROM inventory_lots l
     JOIN products p ON p.id = l.product_id AND p.store_id = l.store_id
     JOIN suppliers s ON s.id = l.supplier_id AND s.store_id = l.store_id
     WHERE l.store_id = ? ORDER BY
       CASE WHEN l.expires_at IS NULL THEN 1 ELSE 0 END,l.expires_at,l.created_at`,
    [storeId]
  );
  return rows.map((row): InventoryLotSummary => ({
    id: row.id,
    productName: row.product_name,
    supplierName: row.supplier_name,
    lotCode: row.lot_code,
    expiresAt: row.expires_at,
    receivedQuantity: row.received_quantity,
    remainingQuantity: row.remaining_quantity,
    createdAt: row.created_at,
  }));
}

export async function createPurchaseOrder(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    supplierId: string;
    expectedAt?: string | null;
    notes?: string;
    items: { productId: string; quantity: number; unitCostCents: number }[];
    actorUserId: string;
    deviceId: string;
  }
) {
  if (!input.deviceId) throw new Error('La operación requiere dispositivo.');
  if (!input.items.length) throw new Error('Agrega productos a la orden.');
  const id = createId();
  const timestamp = new Date().toISOString();
  const orderNumber = `OC-${timestamp.slice(0, 10).replaceAll('-', '')}-${id
    .replaceAll('-', '')
    .slice(0, 6)
    .toUpperCase()}`;
  return database.transaction(async (transaction) => {
    await requireActor(transaction, input.storeId, input.actorUserId, true);
    const supplier = await transaction.getFirst<{ id: string }>(
      'SELECT id FROM suppliers WHERE id = ? AND store_id = ? AND is_active = 1',
      [input.supplierId, input.storeId]
    );
    if (!supplier) throw new Error('Selecciona un proveedor activo.');
    let totalCents = 0;
    const resolved = [];
    const productIds = new Set<string>();
    for (const requested of input.items) {
      if (productIds.has(requested.productId)) {
        throw new Error('Cada producto se agrega una sola vez.');
      }
      productIds.add(requested.productId);
      const product = await getProductById(
        transaction,
        input.storeId,
        requested.productId
      );
      if (
        !product ||
        !Number.isSafeInteger(requested.quantity) ||
        requested.quantity <= 0 ||
        !Number.isSafeInteger(requested.unitCostCents) ||
        requested.unitCostCents < 0
      ) {
        throw new Error('Revisa productos, cantidades y costos.');
      }
      const lineTotalCents = calculateLineTotalCents(
        requested.quantity,
        requested.unitCostCents,
        product.pricingQuantity
      );
      totalCents += lineTotalCents;
      resolved.push({ product, requested, lineTotalCents, id: createId() });
    }
    await transaction.run(
      `INSERT INTO purchase_orders(
        id,store_id,supplier_id,order_number,status,expected_at,notes,
        total_cents,actor_user_id,device_id,created_at,updated_at,version
      ) VALUES(?,?,?,?,'ordered',?,?,?,?,?,?,?,1)`,
      [
        id,
        input.storeId,
        input.supplierId,
        orderNumber,
        input.expectedAt ?? null,
        input.notes?.trim() || null,
        totalCents,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    for (const item of resolved) {
      await transaction.run(
        `INSERT INTO purchase_order_items(
          id,store_id,purchase_order_id,product_id,product_name_snapshot,
          ordered_quantity,received_quantity,unit_cost_cents,pricing_quantity,
          line_total_cents,created_at,updated_at,version
        ) VALUES(?,?,?,?,?,?,0,?,?,?,?,?,1)`,
        [
          item.id,
          input.storeId,
          id,
          item.product.id,
          item.product.name,
          item.requested.quantity,
          item.requested.unitCostCents,
          item.product.pricingQuantity,
          item.lineTotalCents,
          timestamp,
          timestamp,
        ]
      );
    }
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: id,
      entityType: 'purchase_order',
      entityId: id,
      operationType: 'purchase_order.created',
      payload: {
        id,
        storeId: input.storeId,
        supplierId: input.supplierId,
        orderNumber,
        expectedAt: input.expectedAt ?? null,
        notes: input.notes?.trim() || null,
        totalCents,
        items: resolved.map((item) => ({
          id: item.id,
          productId: item.product.id,
          productName: item.product.name,
          orderedQuantity: item.requested.quantity,
          unitCostCents: item.requested.unitCostCents,
          pricingQuantity: item.product.pricingQuantity,
          lineTotalCents: item.lineTotalCents,
        })),
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        createdAt: timestamp,
      },
      timestamp,
    });
    return id;
  });
}

async function applyStockIncrease(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    productId: string;
    quantity: number;
    reason: string;
    referenceId: string;
    actorUserId: string;
    deviceId: string;
    timestamp: string;
  }
) {
  const product = await getProductById(database, input.storeId, input.productId);
  if (!product) throw new Error('Producto no encontrado.');
  const movementId = createId();
  const nextQuantity = product.stockQuantity + input.quantity;
  const updated = await database.run(
    `UPDATE products SET stock_quantity = ?,updated_at = ?,version = version + 1
     WHERE id = ? AND store_id = ? AND version = ?`,
    [
      nextQuantity,
      input.timestamp,
      product.id,
      input.storeId,
      product.version,
    ]
  );
  if (updated.changes !== 1) throw new Error('El inventario cambió durante la recepción.');
  await database.run(
    `INSERT INTO inventory_movements(
      id,store_id,product_id,movement_type,quantity_delta,reason,reference_id,
      actor_user_id,device_id,created_at,updated_at,version
    ) VALUES(?,?,?,'purchase',?,?,?,?,?,?,?,1)`,
    [
      movementId,
      input.storeId,
      product.id,
      input.quantity,
      input.reason,
      input.referenceId,
      input.actorUserId,
      input.deviceId,
      input.timestamp,
      input.timestamp,
    ]
  );
  await enqueueOperation(database, {
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
      type: 'purchase',
      quantityDelta: input.quantity,
      baseUnit: product.baseUnit,
      reason: input.reason,
      referenceId: input.referenceId,
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      productVersion: product.version + 1,
      createdAt: input.timestamp,
    },
    timestamp: input.timestamp,
  });
}

export async function receivePurchaseOrder(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    purchaseOrderId: string;
    /**
     * Claves = id del ítem de la orden. Solo los ítems presentes en este mapa
     * se reciben en esta llamada, lo que permite recepciones parciales en
     * varias visitas del proveedor. Si `quantity` se omite, se recibe todo lo
     * pendiente de ese ítem (compatibilidad con "recibir todo").
     */
    items: Record<
      string,
      { quantity?: number; lotCode?: string; expiresAt?: string | null }
    >;
    actorUserId: string;
    deviceId: string;
  }
) {
  if (!input.deviceId) throw new Error('La operación requiere dispositivo.');
  const requestedItemIds = Object.keys(input.items);
  if (!requestedItemIds.length) {
    throw new Error('Selecciona al menos un producto para recibir.');
  }
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireActor(transaction, input.storeId, input.actorUserId);
    const order = (
      await listPurchaseOrders(transaction, input.storeId)
    ).find((candidate) => candidate.id === input.purchaseOrderId);
    if (
      !order ||
      (order.status !== 'ordered' && order.status !== 'partially_received')
    ) {
      throw new Error('La orden no está pendiente de recepción.');
    }
    const payloadLots: {
      id: string | null;
      itemId: string;
      productId: string;
      receivedQuantity: number;
      lotCode: string | null;
      expiresAt: string | null;
    }[] = [];
    let anyReceived = false;
    for (const itemId of requestedItemIds) {
      const item = order.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error('El ítem de la orden no existe.');
      const pending = item.orderedQuantity - item.receivedQuantity;
      if (pending <= 0) continue;

      const requested = input.items[itemId];
      const quantityToReceive = requested.quantity ?? pending;
      if (!Number.isSafeInteger(quantityToReceive) || quantityToReceive <= 0) {
        throw new Error('La cantidad a recibir debe ser un entero mayor que cero.');
      }
      if (quantityToReceive > pending) {
        throw new Error(
          `No puedes recibir más de lo pendiente para ${item.productName}.`
        );
      }
      anyReceived = true;

      await applyStockIncrease(transaction, {
        storeId: input.storeId,
        productId: item.productId,
        quantity: quantityToReceive,
        reason: `Recepción ${order.orderNumber}`,
        referenceId: order.id,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        timestamp,
      });
      await transaction.run(
        `UPDATE purchase_order_items SET received_quantity = received_quantity + ?,
          updated_at = ?,version = version + 1
         WHERE id = ? AND store_id = ?`,
        [quantityToReceive, timestamp, item.id, input.storeId]
      );
      const lot = requested;
      let lotId: string | null = null;
      if (lot?.lotCode?.trim()) {
        lotId = createId();
        await transaction.run(
          `INSERT INTO inventory_lots(
            id,store_id,product_id,supplier_id,purchase_order_id,
            purchase_order_item_id,lot_code,expires_at,received_quantity,
            remaining_quantity,actor_user_id,device_id,created_at,updated_at,version
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          [
            lotId,
            input.storeId,
            item.productId,
            order.supplierId,
            order.id,
            item.id,
            lot.lotCode.trim(),
            lot.expiresAt ?? null,
            quantityToReceive,
            quantityToReceive,
            input.actorUserId,
            input.deviceId,
            timestamp,
            timestamp,
          ]
        );
      }
      payloadLots.push({
        id: lotId,
        itemId: item.id,
        productId: item.productId,
        receivedQuantity: quantityToReceive,
        lotCode: lot?.lotCode?.trim() || null,
        expiresAt: lot?.expiresAt ?? null,
      });
    }

    if (!anyReceived) {
      throw new Error('No hay cantidades pendientes para los productos seleccionados.');
    }

    const refreshedItems = await transaction.getAll<{
      ordered_quantity: number;
      received_quantity: number;
    }>(
      `SELECT ordered_quantity, received_quantity FROM purchase_order_items
       WHERE store_id = ? AND purchase_order_id = ?`,
      [input.storeId, order.id]
    );
    const fullyReceived = refreshedItems.every(
      (row) => row.received_quantity >= row.ordered_quantity
    );
    const nextStatus = fullyReceived ? 'received' : 'partially_received';

    const updateResult = await transaction.run(
      `UPDATE purchase_orders SET status = ?,received_at = ?,
        updated_at = ?,version = version + 1
       WHERE id = ? AND store_id = ? AND status IN ('ordered','partially_received')`,
      [
        nextStatus,
        fullyReceived ? timestamp : order.receivedAt,
        timestamp,
        order.id,
        input.storeId,
      ]
    );
    if (updateResult.changes !== 1) {
      throw new Error('La orden cambió durante la recepción. Intenta nuevamente.');
    }

    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'purchase_order',
      entityId: order.id,
      operationType: 'purchase_order.received',
      payload: {
        operationId,
        id: order.id,
        lots: payloadLots,
        status: nextStatus,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        receivedAt: fullyReceived ? timestamp : order.receivedAt ?? null,
      },
      timestamp,
    });

    return { status: nextStatus, fullyReceived };
  });
}

export async function performPhysicalCount(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    counted: { productId: string; quantity: number }[];
    notes?: string;
    actorUserId: string;
    deviceId: string;
  }
) {
  if (!input.deviceId) throw new Error('La operación requiere dispositivo.');
  if (!input.counted.length) throw new Error('Agrega productos al conteo.');
  const id = createId();
  const timestamp = new Date().toISOString();
  const countNumber = `CF-${timestamp.slice(0, 10).replaceAll('-', '')}-${id
    .replaceAll('-', '')
    .slice(0, 6)
    .toUpperCase()}`;
  return database.transaction(async (transaction) => {
    await requireActor(transaction, input.storeId, input.actorUserId, true);
    await transaction.run(
      `INSERT INTO physical_counts(
        id,store_id,count_number,status,notes,actor_user_id,device_id,
        created_at,updated_at,version
      ) VALUES(?,?,?,'completed',?,?,?,?,?,1)`,
      [
        id,
        input.storeId,
        countNumber,
        input.notes?.trim() || null,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    const payloadItems = [];
    const productIds = new Set<string>();
    for (const requested of input.counted) {
      if (productIds.has(requested.productId)) {
        throw new Error('Cada producto se cuenta una sola vez.');
      }
      productIds.add(requested.productId);
      const product = await getProductById(
        transaction,
        input.storeId,
        requested.productId
      );
      if (!product || !Number.isSafeInteger(requested.quantity) || requested.quantity < 0) {
        throw new Error('Revisa las cantidades contadas.');
      }
      const difference = requested.quantity - product.stockQuantity;
      await transaction.run(
        `INSERT INTO physical_count_items(
          id,store_id,physical_count_id,product_id,product_name_snapshot,
          expected_quantity,counted_quantity,difference_quantity,
          created_at,updated_at,version
        ) VALUES(?,?,?,?,?,?,?,?,?,?,1)`,
        [
          createId(),
          input.storeId,
          id,
          product.id,
          product.name,
          product.stockQuantity,
          requested.quantity,
          difference,
          timestamp,
          timestamp,
        ]
      );
      if (difference !== 0) {
        const movementId = createId();
        const updated = await transaction.run(
          `UPDATE products SET stock_quantity = ?,updated_at = ?,version = version + 1
           WHERE id = ? AND store_id = ? AND version = ?`,
          [
            requested.quantity,
            timestamp,
            product.id,
            input.storeId,
            product.version,
          ]
        );
        if (updated.changes !== 1) {
          throw new Error('El inventario cambió durante el conteo.');
        }
        await transaction.run(
          `INSERT INTO inventory_movements(
            id,store_id,product_id,movement_type,quantity_delta,reason,
            reference_id,actor_user_id,device_id,created_at,updated_at,version
          ) VALUES(?,?,?,'adjustment',?,?,?,?,?,?,?,1)`,
          [
            movementId,
            input.storeId,
            product.id,
            difference,
            `Conteo físico ${countNumber}`,
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
            productId: product.id,
            type: 'adjustment',
            quantityDelta: difference,
            baseUnit: product.baseUnit,
            reason: `Conteo físico ${countNumber}`,
            referenceId: id,
            actorUserId: input.actorUserId,
            deviceId: input.deviceId,
            productVersion: product.version + 1,
            createdAt: timestamp,
          },
          timestamp,
        });
      }
      payloadItems.push({
        productId: product.id,
        productName: product.name,
        expectedQuantity: product.stockQuantity,
        countedQuantity: requested.quantity,
        differenceQuantity: difference,
      });
    }
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: id,
      entityType: 'physical_count',
      entityId: id,
      operationType: 'physical_count.completed',
      payload: {
        id,
        countNumber,
        notes: input.notes?.trim() || null,
        items: payloadItems,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        createdAt: timestamp,
      },
      timestamp,
    });
    return id;
  });
}
