import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import { calculateLineTotalCents } from '../integer-calculations';
import type {
  CustomerAddressRecord,
  CustomerRecord,
  FulfillmentType,
  OrderDetailRecord,
  OrderItemRecord,
  OrderIncidentRecord,
  OrderIncidentType,
  OrderPaymentHistoryRecord,
  OrderPaymentStatus,
  OrderSource,
  OrderStatus,
  OrderStatusHistoryRecord,
  OrderSubstitutionRecord,
  OrderSummaryRecord,
  PaymentMethod,
  ProductRecord,
  SubstitutionPolicy,
} from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { getProductById } from './product-repository';
import { enqueueOperation } from './sync-outbox-repository';

type CustomerRow = {
  id: string;
  store_id: string;
  auth_user_id: string | null;
  customer_type: 'retail' | 'restaurant';
  name: string;
  phone: string;
  email: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  version: number;
};

type AddressRow = {
  id: string;
  store_id: string;
  customer_id: string;
  label: string;
  address: string;
  district: string;
  instructions: string | null;
  delivery_zone_id: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
  version: number;
};

type OrderRow = {
  id: string;
  store_id: string;
  operation_id: string;
  order_number: string;
  customer_id: string;
  source: OrderSource;
  fulfillment_type: FulfillmentType;
  address_id: string | null;
  delivery_zone_id: string | null;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  payment_verified_at: string | null;
  payment_verified_by_user_id: string | null;
  estimated_subtotal_cents: number;
  delivery_fee_cents: number;
  estimated_total_cents: number;
  final_subtotal_cents: number | null;
  final_total_cents: number | null;
  notes: string | null;
  scheduled_for: string | null;
  assigned_user_id: string | null;
  actor_user_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type OrderSummaryRow = OrderRow & {
  customer_name: string;
  customer_phone: string;
  delivery_zone_name: string | null;
  item_count: number;
};

type OrderItemRow = {
  id: string;
  store_id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  base_unit_snapshot: 'gram' | 'unit';
  requested_quantity: number;
  prepared_quantity: number | null;
  price_cents_snapshot: number;
  pricing_quantity_snapshot: number;
  estimated_cents: number;
  final_cents: number | null;
  substitution_policy: SubstitutionPolicy;
  created_at: string;
  updated_at: string;
  version: number;
};

type HistoryRow = {
  id: string;
  store_id: string;
  order_id: string;
  operation_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  reason: string;
  actor_user_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type PaymentHistoryRow = {
  id: string;
  store_id: string;
  order_id: string;
  operation_id: string;
  from_status: OrderPaymentStatus;
  to_status: OrderPaymentStatus;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  reason: string;
  actor_user_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type IncidentRow = {
  id: string;
  store_id: string;
  order_id: string;
  incident_type: OrderIncidentType;
  description: string;
  status: 'open' | 'resolved';
  resolution: string | null;
  actor_user_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type SubstitutionRow = {
  id: string;
  store_id: string;
  order_id: string;
  order_item_id: string;
  replacement_product_id: string;
  replacement_product_name: string;
  status: 'proposed' | 'accepted' | 'rejected';
  notes: string | null;
  actor_user_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type CreateItemInput = {
  productId: string;
  quantity: number;
  substitutionPolicy?: SubstitutionPolicy;
};

export type CreateOrderInput = {
  storeId: string;
  deviceId: string;
  actorUserId: string;
  operationId?: string;
  source: OrderSource;
  fulfillmentType: FulfillmentType;
  customer: {
    name: string;
    phone: string;
    email?: string | null;
  };
  delivery?: {
    zoneId: string;
    address: string;
    district: string;
    instructions?: string | null;
  };
  notes?: string | null;
  paymentMethod?: PaymentMethod;
  paymentReference?: string | null;
  items: CreateItemInput[];
};

export type PrepareOrderInput = {
  storeId: string;
  orderId: string;
  expectedVersion: number;
  actorUserId: string;
  deviceId: string;
  items: { itemId: string; preparedQuantity: number }[];
};

export type TransitionOrderInput = {
  storeId: string;
  orderId: string;
  expectedVersion: number;
  toStatus: OrderStatus;
  reason: string;
  actorUserId: string;
  deviceId: string;
  operationId?: string;
};

export type UpdateOrderPaymentInput = {
  storeId: string;
  orderId: string;
  expectedVersion: number;
  toStatus: OrderPaymentStatus;
  paymentReference?: string | null;
  reason: string;
  actorUserId: string;
  deviceId: string;
  operationId?: string;
};

const nextStatuses: Record<OrderStatus, readonly OrderStatus[]> = {
  received: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'weight_review', 'cancelled'],
  weight_review: ['ready'],
  ready: ['out_for_delivery', 'ready_for_pickup'],
  out_for_delivery: ['delivered'],
  ready_for_pickup: ['delivered'],
  delivered: [],
  cancelled: [],
};

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    authUserId: row.auth_user_id,
    type: row.customer_type,
    name: row.name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapAddress(row: AddressRow): CustomerAddressRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    customerId: row.customer_id,
    label: row.label,
    address: row.address,
    district: row.district,
    instructions: row.instructions,
    deliveryZoneId: row.delivery_zone_id,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapOrder(row: OrderRow) {
  return {
    id: row.id,
    storeId: row.store_id,
    operationId: row.operation_id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    source: row.source,
    fulfillmentType: row.fulfillment_type,
    addressId: row.address_id,
    deliveryZoneId: row.delivery_zone_id,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    paymentVerifiedAt: row.payment_verified_at,
    paymentVerifiedByUserId: row.payment_verified_by_user_id,
    estimatedSubtotalCents: row.estimated_subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    estimatedTotalCents: row.estimated_total_cents,
    finalSubtotalCents: row.final_subtotal_cents,
    finalTotalCents: row.final_total_cents,
    notes: row.notes,
    scheduledFor: row.scheduled_for,
    assignedUserId: row.assigned_user_id,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapIncident(row: IncidentRow): OrderIncidentRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    type: row.incident_type,
    description: row.description,
    status: row.status,
    resolution: row.resolution,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapSubstitution(row: SubstitutionRow): OrderSubstitutionRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    replacementProductId: row.replacement_product_id,
    replacementProductName: row.replacement_product_name,
    status: row.status,
    notes: row.notes,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapSummary(row: OrderSummaryRow): OrderSummaryRecord {
  return {
    ...mapOrder(row),
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    deliveryZoneName: row.delivery_zone_name,
    itemCount: row.item_count,
  };
}

function mapItem(row: OrderItemRow): OrderItemRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    productId: row.product_id,
    productNameSnapshot: row.product_name_snapshot,
    baseUnitSnapshot: row.base_unit_snapshot,
    requestedQuantity: row.requested_quantity,
    preparedQuantity: row.prepared_quantity,
    priceCentsSnapshot: row.price_cents_snapshot,
    pricingQuantitySnapshot: row.pricing_quantity_snapshot,
    estimatedCents: row.estimated_cents,
    finalCents: row.final_cents,
    substitutionPolicy: row.substitution_policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapHistory(row: HistoryRow): OrderStatusHistoryRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    operationId: row.operation_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapPaymentHistory(row: PaymentHistoryRow): OrderPaymentHistoryRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    orderId: row.order_id,
    operationId: row.operation_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function normalizePhone(value: string) {
  const normalized = value.trim().replace(/[^\d+]/g, '');
  if (normalized.length < 7 || normalized.length > 16) {
    throw new Error('El teléfono del cliente debe tener entre 7 y 16 caracteres.');
  }
  return normalized;
}

async function requireActor(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  deviceId: string
) {
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!actor || !deviceId.trim()) {
    throw new Error('El pedido requiere un operador activo y un dispositivo.');
  }
  return actor;
}

async function nextOrderNumber(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  timestamp: string
) {
  const current = await database.getFirst<{ next_number: number; version: number }>(
    `SELECT next_number, version
     FROM local_order_sequences
     WHERE store_id = ? AND device_id = ?`,
    [storeId, deviceId]
  );
  let sequence: number;
  if (!current) {
    sequence = 1;
    await database.run(
      `INSERT INTO local_order_sequences (
        store_id, device_id, next_number, created_at, updated_at, version
      ) VALUES (?, ?, 2, ?, ?, 1)`,
      [storeId, deviceId, timestamp, timestamp]
    );
  } else {
    sequence = current.next_number;
    const updated = await database.run(
      `UPDATE local_order_sequences
       SET next_number = next_number + 1,
           updated_at = ?,
           version = version + 1
       WHERE store_id = ? AND device_id = ? AND version = ?`,
      [timestamp, storeId, deviceId, current.version]
    );
    if (updated.changes !== 1) {
      throw new Error('No se pudo reservar el número del pedido.');
    }
  }
  const suffix = deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return `P-${suffix}-${String(sequence).padStart(5, '0')}`;
}

async function upsertCustomer(
  database: DatabaseAdapter,
  input: CreateOrderInput,
  timestamp: string
) {
  const name = input.customer.name.trim();
  if (!name) throw new Error('Ingresa el nombre del cliente.');
  const phone = normalizePhone(input.customer.phone);
  const email = input.customer.email?.trim() || null;
  const existing = await database.getFirst<CustomerRow>(
    'SELECT * FROM customers WHERE store_id = ? AND phone = ?',
    [input.storeId, phone]
  );
  if (existing) {
    await database.run(
      `UPDATE customers
       SET name = ?, email = ?, status = 'active',
           updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ?`,
      [name, email, timestamp, existing.id, input.storeId]
    );
    return (await database.getFirst<CustomerRow>(
      'SELECT * FROM customers WHERE id = ? AND store_id = ?',
      [existing.id, input.storeId]
    )) as CustomerRow;
  }

  const id = createId();
  await database.run(
    `INSERT INTO customers (
      id, store_id, auth_user_id, customer_type, name, phone, email,
      status, created_at, updated_at, version
    ) VALUES (?, ?, NULL, 'retail', ?, ?, ?, 'active', ?, ?, 1)`,
    [id, input.storeId, name, phone, email, timestamp, timestamp]
  );
  return (await database.getFirst<CustomerRow>(
    'SELECT * FROM customers WHERE id = ? AND store_id = ?',
    [id, input.storeId]
  )) as CustomerRow;
}

async function createDeliveryAddress(
  database: DatabaseAdapter,
  input: CreateOrderInput,
  customerId: string,
  timestamp: string
) {
  if (!input.delivery) {
    throw new Error('El delivery requiere zona y dirección.');
  }
  const address = input.delivery.address.trim();
  const district = input.delivery.district.trim();
  if (!address || !district) {
    throw new Error('El delivery requiere dirección y distrito.');
  }
  const zone = await database.getFirst<{
    id: string;
    fee_cents: number;
    minimum_order_cents: number;
    is_active: number;
  }>(
    `SELECT id, fee_cents, minimum_order_cents, is_active
     FROM delivery_zones
     WHERE id = ? AND store_id = ?`,
    [input.delivery.zoneId, input.storeId]
  );
  if (!zone || zone.is_active !== 1) {
    throw new Error('La zona de delivery seleccionada no está disponible.');
  }

  const existing = await database.getFirst<AddressRow>(
    `SELECT *
     FROM customer_addresses
     WHERE store_id = ? AND customer_id = ?
       AND address = ? AND district = ? AND delivery_zone_id = ?`,
    [input.storeId, customerId, address, district, zone.id]
  );
  if (existing) return { row: existing, zone };

  const hasDefault = await database.getFirst<{ id: string }>(
    `SELECT id FROM customer_addresses
     WHERE store_id = ? AND customer_id = ? AND is_default = 1`,
    [input.storeId, customerId]
  );
  const id = createId();
  await database.run(
    `INSERT INTO customer_addresses (
      id, store_id, customer_id, label, address, district, instructions,
      delivery_zone_id, is_default, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'Principal', ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      input.storeId,
      customerId,
      address,
      district,
      input.delivery.instructions?.trim() || null,
      zone.id,
      hasDefault ? 0 : 1,
      timestamp,
      timestamp,
    ]
  );
  return {
    row: (await database.getFirst<AddressRow>(
      'SELECT * FROM customer_addresses WHERE id = ? AND store_id = ?',
      [id, input.storeId]
    )) as AddressRow,
    zone,
  };
}

async function resolveItems(database: DatabaseAdapter, input: CreateOrderInput) {
  if (input.items.length === 0) {
    throw new Error('Agrega al menos un producto al pedido.');
  }
  const seen = new Set<string>();
  const result: {
    product: ProductRecord;
    quantity: number;
    substitutionPolicy: SubstitutionPolicy;
    estimatedCents: number;
  }[] = [];
  for (const requested of input.items) {
    if (seen.has(requested.productId)) {
      throw new Error('Cada producto solo puede aparecer una vez en el pedido.');
    }
    seen.add(requested.productId);
    if (!Number.isSafeInteger(requested.quantity) || requested.quantity <= 0) {
      throw new Error('Cada cantidad debe ser un entero positivo en la unidad base.');
    }
    const product = await getProductById(
      database,
      input.storeId,
      requested.productId
    );
    if (!product?.isActive) {
      throw new Error('Uno de los productos ya no está disponible.');
    }
    if (product.baseUnit === 'unit' && !Number.isInteger(requested.quantity)) {
      throw new Error(`${product.name} debe pedirse en unidades enteras.`);
    }
    const reservation = await database.getFirst<{ reserved_quantity: number }>(
      `SELECT COALESCE(SUM(reserved_quantity), 0) AS reserved_quantity
       FROM order_inventory_reservations
       WHERE store_id = ? AND product_id = ? AND status = 'reserved'`,
      [input.storeId, requested.productId]
    );
    const availableQuantity =
      product.stockQuantity - (reservation?.reserved_quantity ?? 0);
    if (requested.quantity > availableQuantity) {
      throw new Error(`Stock insuficiente para ${product.name}.`);
    }
    result.push({
      product,
      quantity: requested.quantity,
      substitutionPolicy: requested.substitutionPolicy ?? 'contact',
      estimatedCents: calculateLineTotalCents(
        requested.quantity,
        product.priceCents,
        product.pricingQuantity
      ),
    });
  }
  return result;
}

function orderPayload(detail: OrderDetailRecord) {
  const { order, customer, address, items } = detail;
  return {
    id: order.id,
    storeId: order.storeId,
    operationId: order.operationId,
    orderNumber: order.orderNumber,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      type: customer.type,
    },
    address: address
      ? {
          id: address.id,
          label: address.label,
          address: address.address,
          district: address.district,
          instructions: address.instructions,
          deliveryZoneId: address.deliveryZoneId,
        }
      : null,
    source: order.source,
    fulfillmentType: order.fulfillmentType,
    deliveryZoneId: order.deliveryZoneId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paymentReference: order.paymentReference,
    paymentVerifiedAt: order.paymentVerifiedAt,
    paymentVerifiedByUserId: order.paymentVerifiedByUserId,
    estimatedSubtotalCents: order.estimatedSubtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    estimatedTotalCents: order.estimatedTotalCents,
    finalSubtotalCents: order.finalSubtotalCents,
    finalTotalCents: order.finalTotalCents,
    notes: order.notes,
    actorUserId: order.actorUserId,
    deviceId: order.deviceId,
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productNameSnapshot,
      baseUnit: item.baseUnitSnapshot,
      requestedQuantity: item.requestedQuantity,
      preparedQuantity: item.preparedQuantity,
      priceCents: item.priceCentsSnapshot,
      pricingQuantity: item.pricingQuantitySnapshot,
      estimatedCents: item.estimatedCents,
      finalCents: item.finalCents,
      substitutionPolicy: item.substitutionPolicy,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    version: order.version,
  };
}

export async function listOrders(
  database: DatabaseAdapter,
  storeId: string
): Promise<OrderSummaryRecord[]> {
  const rows = await database.getAll<OrderSummaryRow>(
    `SELECT
       orders.*,
       customers.name AS customer_name,
       customers.phone AS customer_phone,
       delivery_zones.name AS delivery_zone_name,
       (SELECT count(*) FROM order_items
        WHERE order_items.store_id = orders.store_id
          AND order_items.order_id = orders.id) AS item_count
     FROM orders
     JOIN customers
       ON customers.id = orders.customer_id
      AND customers.store_id = orders.store_id
     LEFT JOIN delivery_zones
       ON delivery_zones.id = orders.delivery_zone_id
      AND delivery_zones.store_id = orders.store_id
     WHERE orders.store_id = ?
     ORDER BY
       CASE orders.status
         WHEN 'received' THEN 10
         WHEN 'confirmed' THEN 20
         WHEN 'preparing' THEN 30
         WHEN 'weight_review' THEN 40
         WHEN 'ready' THEN 50
         WHEN 'out_for_delivery' THEN 60
         WHEN 'ready_for_pickup' THEN 60
         ELSE 90
       END,
       orders.created_at DESC`,
    [storeId]
  );
  return rows.map(mapSummary);
}

export async function getOrderDetail(
  database: DatabaseAdapter,
  storeId: string,
  orderId: string
): Promise<OrderDetailRecord | null> {
  const order = await database.getFirst<OrderSummaryRow>(
    `SELECT
       orders.*,
       customers.name AS customer_name,
       customers.phone AS customer_phone,
       delivery_zones.name AS delivery_zone_name,
       (SELECT count(*) FROM order_items
        WHERE order_items.store_id = orders.store_id
          AND order_items.order_id = orders.id) AS item_count
     FROM orders
     JOIN customers
       ON customers.id = orders.customer_id
      AND customers.store_id = orders.store_id
     LEFT JOIN delivery_zones
       ON delivery_zones.id = orders.delivery_zone_id
      AND delivery_zones.store_id = orders.store_id
     WHERE orders.store_id = ? AND orders.id = ?`,
    [storeId, orderId]
  );
  if (!order) return null;
  const customer = await database.getFirst<CustomerRow>(
    'SELECT * FROM customers WHERE store_id = ? AND id = ?',
    [storeId, order.customer_id]
  );
  const address = order.address_id
    ? await database.getFirst<AddressRow>(
        'SELECT * FROM customer_addresses WHERE store_id = ? AND id = ?',
        [storeId, order.address_id]
      )
    : null;
  const items = await database.getAll<OrderItemRow>(
    `SELECT * FROM order_items
     WHERE store_id = ? AND order_id = ?
     ORDER BY created_at, id`,
    [storeId, orderId]
  );
  const history = await database.getAll<HistoryRow>(
    `SELECT * FROM order_status_history
     WHERE store_id = ? AND order_id = ?
     ORDER BY created_at, id`,
    [storeId, orderId]
  );
  const paymentHistory = await database.getAll<PaymentHistoryRow>(
    `SELECT * FROM order_payment_history
     WHERE store_id = ? AND order_id = ?
     ORDER BY created_at, id`,
    [storeId, orderId]
  );
  const incidents = await database.getAll<IncidentRow>(
    `SELECT * FROM order_incidents
     WHERE store_id = ? AND order_id = ?
     ORDER BY status, created_at DESC`,
    [storeId, orderId]
  );
  const substitutions = await database.getAll<SubstitutionRow>(
    `SELECT * FROM order_substitutions
     WHERE store_id = ? AND order_id = ?
     ORDER BY created_at DESC`,
    [storeId, orderId]
  );
  if (!customer) throw new Error('El pedido no tiene un cliente válido.');
  return {
    order: mapSummary(order),
    customer: mapCustomer(customer),
    address: address ? mapAddress(address) : null,
    items: items.map(mapItem),
    history: history.map(mapHistory),
    paymentHistory: paymentHistory.map(mapPaymentHistory),
    incidents: incidents.map(mapIncident),
    substitutions: substitutions.map(mapSubstitution),
  };
}

export async function createOrder(
  database: DatabaseAdapter,
  input: CreateOrderInput
): Promise<OrderDetailRecord> {
  const operationId = input.operationId ?? createId();
  const timestamp = new Date().toISOString();
  const paymentMethod = input.paymentMethod ?? 'cash';
  const paymentReference = input.paymentReference?.trim() || null;
  if (
    (paymentMethod === 'yape' || paymentMethod === 'plin') &&
    !paymentReference
  ) {
    throw new Error('La referencia de Yape o Plin es obligatoria.');
  }
  return database.transaction(async (transaction) => {
    const existing = await transaction.getFirst<{ id: string }>(
      'SELECT id FROM orders WHERE store_id = ? AND operation_id = ?',
      [input.storeId, operationId]
    );
    if (existing) {
      const detail = await getOrderDetail(transaction, input.storeId, existing.id);
      if (!detail) throw new Error('El pedido idempotente no se pudo recuperar.');
      return detail;
    }
    await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    const resolvedItems = await resolveItems(transaction, input);
    const customerRow = await upsertCustomer(transaction, input, timestamp);
    const delivery =
      input.fulfillmentType === 'delivery'
        ? await createDeliveryAddress(
            transaction,
            input,
            customerRow.id,
            timestamp
          )
        : null;
    if (input.fulfillmentType === 'pickup' && input.delivery) {
      throw new Error('Un pedido para recojo no debe incluir dirección de delivery.');
    }

    const estimatedSubtotalCents = resolvedItems.reduce(
      (sum, item) => sum + item.estimatedCents,
      0
    );
    if (
      !Number.isSafeInteger(estimatedSubtotalCents) ||
      estimatedSubtotalCents <= 0
    ) {
      throw new Error('El subtotal estimado del pedido no es válido.');
    }
    if (
      delivery &&
      estimatedSubtotalCents < delivery.zone.minimum_order_cents
    ) {
      throw new Error('El pedido no alcanza el mínimo de la zona seleccionada.');
    }
    const deliveryFeeCents = delivery?.zone.fee_cents ?? 0;
    const estimatedTotalCents = estimatedSubtotalCents + deliveryFeeCents;
    if (!Number.isSafeInteger(estimatedTotalCents)) {
      throw new Error('El total estimado excede el rango permitido.');
    }

    const orderId = operationId;
    const orderNumber = await nextOrderNumber(
      transaction,
      input.storeId,
      input.deviceId,
      timestamp
    );
    await transaction.run(
      `INSERT INTO orders (
        id, store_id, operation_id, order_number, customer_id, source,
        fulfillment_type, address_id, delivery_zone_id, status, payment_status,
        payment_method, payment_reference,
        estimated_subtotal_cents, delivery_fee_cents, estimated_total_cents,
        final_subtotal_cents, final_total_cents, notes, actor_user_id, device_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', 'pending', ?, ?,
        ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 1)`,
      [
        orderId,
        input.storeId,
        operationId,
        orderNumber,
        customerRow.id,
        input.source,
        input.fulfillmentType,
        delivery?.row.id ?? null,
        delivery?.zone.id ?? null,
        paymentMethod,
        paymentReference,
        estimatedSubtotalCents,
        deliveryFeeCents,
        estimatedTotalCents,
        input.notes?.trim() || null,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    for (const item of resolvedItems) {
      const itemId = createId();
      await transaction.run(
        `INSERT INTO order_items (
          id, store_id, order_id, product_id, product_name_snapshot,
          base_unit_snapshot, requested_quantity, prepared_quantity,
          price_cents_snapshot, pricing_quantity_snapshot, estimated_cents,
          final_cents, substitution_policy, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, 1)`,
        [
          itemId,
          input.storeId,
          orderId,
          item.product.id,
          item.product.name,
          item.product.baseUnit,
          item.quantity,
          item.product.priceCents,
          item.product.pricingQuantity,
          item.estimatedCents,
          item.substitutionPolicy,
          timestamp,
          timestamp,
        ]
      );
      await transaction.run(
        `INSERT INTO order_inventory_reservations (
          id, store_id, order_id, order_item_id, product_id,
          reserved_quantity, consumed_quantity, status,
          consumed_at, released_at, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 'reserved', NULL, NULL, ?, ?, 1)`,
        [
          itemId,
          input.storeId,
          orderId,
          itemId,
          item.product.id,
          item.quantity,
          timestamp,
          timestamp,
        ]
      );
    }
    await transaction.run(
      `INSERT INTO order_status_history (
        id, store_id, order_id, operation_id, from_status, to_status,
        reason, actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, NULL, 'received', ?, ?, ?, ?, ?, 1)`,
      [
        createId(),
        input.storeId,
        orderId,
        operationId,
        'Pedido registrado',
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    const detail = await getOrderDetail(transaction, input.storeId, orderId);
    if (!detail) throw new Error('No se pudo recuperar el pedido creado.');
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'order',
      entityId: orderId,
      operationType: 'order.created',
      payload: orderPayload(detail),
      timestamp,
    });
    return detail;
  });
}

export async function transitionOrderInTransaction(
  database: DatabaseAdapter,
  input: TransitionOrderInput,
  options: { enqueueSyncOperation?: boolean } = {}
): Promise<OrderDetailRecord> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Indica el motivo del cambio de estado.');
  const timestamp = new Date().toISOString();
  const operationId = input.operationId ?? createId();
  const transaction = database;
    const actor = await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    const previous = await getOrderDetail(
      transaction,
      input.storeId,
      input.orderId
    );
    if (!previous) throw new Error('No se encontró el pedido.');
    if (!nextStatuses[previous.order.status].includes(input.toStatus)) {
      throw new Error(
        `No se permite pasar de ${previous.order.status} a ${input.toStatus}.`
      );
    }
    if (
      (input.toStatus === 'cancelled' ||
        previous.order.status === 'weight_review') &&
      actor.role !== 'administrator'
    ) {
      throw new Error('Este cambio de estado requiere un administrador.');
    }
    if (
      previous.order.status === 'ready' &&
      ((previous.order.fulfillmentType === 'pickup' &&
        input.toStatus !== 'ready_for_pickup') ||
        (previous.order.fulfillmentType === 'delivery' &&
          input.toStatus !== 'out_for_delivery'))
    ) {
      throw new Error('El siguiente estado no coincide con la modalidad del pedido.');
    }
    if (
      previous.order.status === 'preparing' &&
      (input.toStatus === 'ready' || input.toStatus === 'weight_review') &&
      previous.items.some((item) => item.preparedQuantity === null)
    ) {
      throw new Error('Registra las cantidades preparadas antes de finalizar.');
    }

    const updated = await transaction.run(
      `UPDATE orders
       SET status = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        input.toStatus,
        timestamp,
        input.orderId,
        input.storeId,
        input.expectedVersion,
      ]
    );
    if (updated.changes !== 1) {
      throw new Error('El pedido cambió. Actualiza la bandeja e intenta nuevamente.');
    }
    if (input.toStatus === 'cancelled') {
      await transaction.run(
        `UPDATE order_inventory_reservations
         SET status = 'released', released_at = ?, updated_at = ?,
             version = version + 1
         WHERE store_id = ? AND order_id = ? AND status = 'reserved'`,
        [timestamp, timestamp, input.storeId, input.orderId]
      );
    }
    await transaction.run(
      `INSERT INTO order_status_history (
        id, store_id, order_id, operation_id, from_status, to_status,
        reason, actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        createId(),
        input.storeId,
        input.orderId,
        operationId,
        previous.order.status,
        input.toStatus,
        reason,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    const detail = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (!detail) throw new Error('No se pudo recuperar el pedido actualizado.');
    if (options.enqueueSyncOperation !== false) {
      await enqueueOperation(transaction, {
        id: createId(),
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        operationId,
        entityType: 'order',
        entityId: input.orderId,
        operationType: 'order.status_changed',
        payload: {
          id: input.orderId,
          storeId: input.storeId,
          fromStatus: previous.order.status,
          toStatus: input.toStatus,
          reason,
          actorUserId: input.actorUserId,
          deviceId: input.deviceId,
          expectedVersion: input.expectedVersion,
          items: detail.items.map((item) => ({
            id: item.id,
            preparedQuantity: item.preparedQuantity,
            finalCents: item.finalCents,
          })),
          finalSubtotalCents: detail.order.finalSubtotalCents,
          finalTotalCents: detail.order.finalTotalCents,
          updatedAt: timestamp,
        },
        timestamp,
      });
    }
  return detail;
}

export async function transitionOrder(
  database: DatabaseAdapter,
  input: TransitionOrderInput
): Promise<OrderDetailRecord> {
  return database.transaction((transaction) =>
    transitionOrderInTransaction(transaction, input)
  );
}

const nextPaymentStatuses: Record<
  OrderPaymentStatus,
  readonly OrderPaymentStatus[]
> = {
  pending: ['paid', 'failed'],
  paid: ['refunded'],
  failed: ['pending', 'paid'],
  refunded: [],
};

export async function updateOrderPaymentStatus(
  database: DatabaseAdapter,
  input: UpdateOrderPaymentInput
): Promise<OrderDetailRecord> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('Indica el motivo del cambio de pago.');
  const operationId = input.operationId ?? createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    const existingOperation = await transaction.getFirst<{ order_id: string }>(
      `SELECT order_id FROM order_payment_history
       WHERE store_id = ? AND operation_id = ?`,
      [input.storeId, operationId]
    );
    if (existingOperation) {
      const existing = await getOrderDetail(
        transaction,
        input.storeId,
        existingOperation.order_id
      );
      if (!existing) {
        throw new Error('No se pudo recuperar el pago idempotente.');
      }
      return existing;
    }

    const actor = await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    if (actor.role !== 'administrator') {
      throw new Error('Solo un administrador puede verificar o reembolsar pagos.');
    }
    const detail = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (!detail) throw new Error('No se encontró el pedido.');
    if (!nextPaymentStatuses[detail.order.paymentStatus].includes(input.toStatus)) {
      throw new Error(
        `No se permite pasar el pago de ${detail.order.paymentStatus} a ${input.toStatus}.`
      );
    }
    if (
      detail.order.status === 'cancelled' &&
      input.toStatus !== 'refunded'
    ) {
      throw new Error('Un pedido cancelado solo admite el reembolso de un pago previo.');
    }

    const paymentReference =
      input.paymentReference?.trim() || detail.order.paymentReference;
    if (
      input.toStatus === 'paid' &&
      detail.order.paymentMethod !== 'cash' &&
      !paymentReference
    ) {
      throw new Error('Registra la referencia del pago antes de marcarlo como pagado.');
    }

    const updated = await transaction.run(
      `UPDATE orders
       SET payment_status = ?, payment_reference = ?,
           payment_verified_at = ?, payment_verified_by_user_id = ?,
           updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        input.toStatus,
        paymentReference,
        input.toStatus === 'paid' || input.toStatus === 'refunded'
          ? timestamp
          : null,
        input.toStatus === 'paid' || input.toStatus === 'refunded'
          ? input.actorUserId
          : null,
        timestamp,
        input.orderId,
        input.storeId,
        input.expectedVersion,
      ]
    );
    if (updated.changes !== 1) {
      throw new Error('El pedido cambió. Actualiza la bandeja e intenta nuevamente.');
    }

    await transaction.run(
      `INSERT INTO order_payment_history (
        id, store_id, order_id, operation_id, from_status, to_status,
        payment_method, payment_reference, reason, actor_user_id, device_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        createId(),
        input.storeId,
        input.orderId,
        operationId,
        detail.order.paymentStatus,
        input.toStatus,
        detail.order.paymentMethod,
        paymentReference,
        reason,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );

    const result = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (!result) throw new Error('No se pudo recuperar el pago actualizado.');
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'order',
      entityId: input.orderId,
      operationType: 'order.payment_status_changed',
      payload: {
        id: input.orderId,
        storeId: input.storeId,
        fromStatus: detail.order.paymentStatus,
        toStatus: input.toStatus,
        paymentMethod: detail.order.paymentMethod,
        paymentReference,
        reason,
        expectedVersion: input.expectedVersion,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        updatedAt: timestamp,
      },
      timestamp,
    });
    return result;
  });
}

export async function prepareOrder(
  database: DatabaseAdapter,
  input: PrepareOrderInput
): Promise<OrderDetailRecord> {
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireActor(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    const detail = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (!detail) throw new Error('No se encontró el pedido.');
    if (detail.order.status !== 'preparing') {
      throw new Error('Solo un pedido en preparación admite cantidades reales.');
    }
    if (detail.order.version !== input.expectedVersion) {
      throw new Error('El pedido cambió. Actualiza la bandeja e intenta nuevamente.');
    }
    if (input.items.length !== detail.items.length) {
      throw new Error('Registra la cantidad preparada de todos los productos.');
    }
    const preparedById = new Map(
      input.items.map((item) => [item.itemId, item.preparedQuantity])
    );
    let hasDifference = false;
    let finalSubtotalCents = 0;
    for (const item of detail.items) {
      const preparedQuantity = preparedById.get(item.id);
      if (
        preparedQuantity === undefined ||
        !Number.isSafeInteger(preparedQuantity) ||
        preparedQuantity < 0
      ) {
        throw new Error('Cada cantidad preparada debe ser un entero no negativo.');
      }
      if (item.baseUnitSnapshot === 'unit' && preparedQuantity !== item.requestedQuantity) {
        throw new Error(
          `${item.productNameSnapshot} debe prepararse en la cantidad solicitada o gestionarse como sustitución.`
        );
      }
      const finalCents =
        preparedQuantity === 0
          ? 0
          : calculateLineTotalCents(
              preparedQuantity,
              item.priceCentsSnapshot,
              item.pricingQuantitySnapshot
            );
      hasDifference ||= preparedQuantity !== item.requestedQuantity;
      finalSubtotalCents += finalCents;
      if (!Number.isSafeInteger(finalSubtotalCents)) {
        throw new Error('El total final excede el rango permitido.');
      }
      const product = await getProductById(
        transaction,
        input.storeId,
        item.productId
      );
      if (!product) {
        throw new Error(`Ya no existe el producto ${item.productNameSnapshot}.`);
      }
      const otherReservations = await transaction.getFirst<{
        reserved_quantity: number;
      }>(
        `SELECT COALESCE(SUM(reserved_quantity), 0) AS reserved_quantity
         FROM order_inventory_reservations
         WHERE store_id = ? AND product_id = ? AND status = 'reserved'
           AND order_item_id <> ?`,
        [input.storeId, item.productId, item.id]
      );
      const availableForThisOrder =
        product.stockQuantity - (otherReservations?.reserved_quantity ?? 0);
      if (preparedQuantity > availableForThisOrder) {
        throw new Error(
          `Stock insuficiente para preparar ${item.productNameSnapshot}.`
        );
      }
      if (preparedQuantity > 0) {
        const productUpdate = await transaction.run(
          `UPDATE products
           SET stock_quantity = stock_quantity - ?,
               updated_at = ?, version = version + 1
           WHERE id = ? AND store_id = ? AND version = ?
             AND stock_quantity >= ?`,
          [
            preparedQuantity,
            timestamp,
            item.productId,
            input.storeId,
            product.version,
            preparedQuantity,
          ]
        );
        if (productUpdate.changes !== 1) {
          throw new Error(
            `El stock de ${item.productNameSnapshot} cambió; vuelve a revisar el pedido.`
          );
        }
        await transaction.run(
          `INSERT INTO inventory_movements (
            id, store_id, product_id, movement_type, quantity_delta,
            reason, reference_id, actor_user_id, device_id,
            created_at, updated_at, version
          ) VALUES (?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            item.id,
            input.storeId,
            item.productId,
            -preparedQuantity,
            `Consumo por preparación del pedido ${detail.order.orderNumber}`,
            input.orderId,
            input.actorUserId,
            input.deviceId,
            timestamp,
            timestamp,
          ]
        );
      }
      const reservationUpdate = await transaction.run(
        `UPDATE order_inventory_reservations
         SET status = 'consumed', consumed_quantity = ?, consumed_at = ?,
             updated_at = ?, version = version + 1
         WHERE store_id = ? AND order_item_id = ? AND status = 'reserved'`,
        [
          preparedQuantity,
          timestamp,
          timestamp,
          input.storeId,
          item.id,
        ]
      );
      if (reservationUpdate.changes !== 1) {
        await transaction.run(
          `INSERT INTO order_inventory_reservations (
            id, store_id, order_id, order_item_id, product_id,
            reserved_quantity, consumed_quantity, status,
            consumed_at, released_at, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'consumed', ?, NULL, ?, ?, 1)`,
          [
            item.id,
            input.storeId,
            input.orderId,
            item.id,
            item.productId,
            item.requestedQuantity,
            preparedQuantity,
            timestamp,
            item.createdAt,
            timestamp,
          ]
        );
      }
      await transaction.run(
        `UPDATE order_items
         SET prepared_quantity = ?, final_cents = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND store_id = ? AND order_id = ?`,
        [
          preparedQuantity,
          finalCents,
          timestamp,
          item.id,
          input.storeId,
          input.orderId,
        ]
      );
    }
    const finalTotalCents = finalSubtotalCents + detail.order.deliveryFeeCents;
    await transaction.run(
      `UPDATE orders
       SET final_subtotal_cents = ?, final_total_cents = ?,
           updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        finalSubtotalCents,
        finalTotalCents,
        timestamp,
        input.orderId,
        input.storeId,
        input.expectedVersion,
      ]
    );
    const prepared = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (!prepared) throw new Error('No se pudo recuperar la preparación.');
    const toStatus: OrderStatus = hasDifference ? 'weight_review' : 'ready';
    const reason = hasDifference
      ? 'Cantidad real distinta; requiere aprobación'
      : 'Preparación completada';
    const operationId = createId();
    const transitioned = await transaction.run(
      `UPDATE orders
       SET status = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        toStatus,
        timestamp,
        input.orderId,
        input.storeId,
        prepared.order.version,
      ]
    );
    if (transitioned.changes !== 1) {
      throw new Error('El pedido cambió durante la preparación.');
    }
    await transaction.run(
      `INSERT INTO order_status_history (
        id, store_id, order_id, operation_id, from_status, to_status,
        reason, actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 'preparing', ?, ?, ?, ?, ?, ?, 1)`,
      [
        createId(),
        input.storeId,
        input.orderId,
        operationId,
        toStatus,
        reason,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    const result = await getOrderDetail(transaction, input.storeId, input.orderId);
    if (!result) throw new Error('No se pudo recuperar el pedido preparado.');
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'order',
      entityId: input.orderId,
      operationType: 'order.status_changed',
      payload: {
        id: input.orderId,
        storeId: input.storeId,
        fromStatus: 'preparing',
        toStatus,
        reason,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        expectedVersion: input.expectedVersion,
        items: result.items.map((item) => ({
          id: item.id,
          preparedQuantity: item.preparedQuantity,
          finalCents: item.finalCents,
        })),
        finalSubtotalCents: result.order.finalSubtotalCents,
        finalTotalCents: result.order.finalTotalCents,
        updatedAt: timestamp,
      },
      timestamp,
    });
    return result;
  });
}

export function nextOperationalStatus(order: OrderSummaryRecord): OrderStatus | null {
  switch (order.status) {
    case 'received':
      return 'confirmed';
    case 'confirmed':
      return 'preparing';
    case 'weight_review':
      return 'ready';
    case 'ready':
      return order.fulfillmentType === 'delivery'
        ? 'out_for_delivery'
        : 'ready_for_pickup';
    case 'out_for_delivery':
    case 'ready_for_pickup':
      return 'delivered';
    default:
      return null;
  }
}
