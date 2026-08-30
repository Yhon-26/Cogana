import type { DatabaseAdapter } from '../database/contracts';
import type { PullChange } from './contracts';

function requireString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`El cambio pull requiere ${key}.`);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`El campo ${key} del cambio pull no es texto.`);
  }
  return value;
}

function requireInteger(payload: Record<string, unknown>, key: string, minimum = 0) {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`El cambio pull requiere ${key} como entero valido.`);
  }
  return value as number;
}

function requireSignedInteger(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (!Number.isSafeInteger(value)) {
    throw new Error(`El cambio pull requiere ${key} como entero valido.`);
  }
  return value as number;
}

function requireBoolean(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new Error(`El cambio pull requiere ${key} como booleano.`);
  }
  return value;
}

function optionalInteger(payload: Record<string, unknown>, key: string, minimum = 0) {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`El campo ${key} del cambio pull no es un entero valido.`);
  }
  return value as number;
}

function requireRecord(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`El cambio pull requiere ${key} como objeto.`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`El campo ${key} del cambio pull no es un objeto.`);
  }
  return value as Record<string, unknown>;
}

function requireRecordArray(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new Error(`El cambio pull requiere ${key} como lista de objetos.`);
  }
  return value as Record<string, unknown>[];
}

function optionalRecordArray(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === null || value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new Error(`El campo ${key} del cambio pull no es una lista de objetos.`);
  }
  return value as Record<string, unknown>[];
}

function assertChangeEnvelope(change: PullChange, storeId: string) {
  if (!Number.isSafeInteger(change.sequence) || change.sequence < 1) {
    throw new Error('La secuencia pull no es valida.');
  }
  if (!Number.isSafeInteger(change.version) || change.version < 1) {
    throw new Error('La version del cambio pull no es valida.');
  }
  const payloadStoreId = change.payload.store_id;
  if (typeof payloadStoreId === 'string' && payloadStoreId !== storeId) {
    throw new Error('El cambio pull pertenece a otra tienda.');
  }
}

async function assertEntityStore(
  database: DatabaseAdapter,
  table:
    | 'products'
    | 'product_presentations'
    | 'suppliers'
    | 'delivery_zones'
    | 'order_incidents'
    | 'order_substitutions'
    | 'delivery_assignments'
    | 'purchase_orders'
    | 'inventory_lots'
    | 'physical_counts'
    | 'orders',
  id: string,
  storeId: string
) {
  const existing = await database.getFirst<{ store_id: string }>(
    `SELECT store_id FROM ${table} WHERE id = ?`,
    [id]
  );
  if (existing && existing.store_id !== storeId) {
    throw new Error('El identificador pull ya pertenece a otra tienda local.');
  }
}

async function applyOrder(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  const orderStatus = requireString(payload, 'status');
  if (id !== change.entityId) {
    throw new Error('El id del pedido no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'orders', id, storeId);
  const current = await database.getFirst<{ version: number }>(
    'SELECT version FROM orders WHERE id = ? AND store_id = ?',
    [id, storeId]
  );
  if (current && current.version > change.version) return;

  const customer = requireRecord(payload, 'customer');
  const serverCustomerId = requireString(customer, 'id');
  const customerPhone = requireString(customer, 'phone');
  const localCustomer = await database.getFirst<{ id: string }>(
    `SELECT id FROM customers
     WHERE store_id = ? AND (id = ? OR phone = ?)
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [storeId, serverCustomerId, customerPhone, serverCustomerId]
  );
  const customerId = localCustomer?.id ?? serverCustomerId;
  const customerUpserted = await database.run(
    `INSERT INTO customers (
      id, store_id, auth_user_id, customer_type, name, phone, email,
      status, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      auth_user_id = excluded.auth_user_id,
      customer_type = excluded.customer_type,
      name = excluded.name,
      phone = excluded.phone,
      email = excluded.email,
      status = excluded.status,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE customers.store_id = excluded.store_id
      AND customers.version <= excluded.version`,
    [
      customerId,
      storeId,
      optionalString(customer, 'auth_user_id'),
      requireString(customer, 'customer_type'),
      requireString(customer, 'name'),
      customerPhone,
      optionalString(customer, 'email'),
      requireString(customer, 'status'),
      requireString(customer, 'created_at'),
      requireString(customer, 'updated_at'),
      requireInteger(customer, 'version', 1),
    ]
  );
  if (customerUpserted.changes === 0) {
    throw new Error(
      `El cliente ${customerId} ya existe en otra tienda y no se pudo actualizar.`
    );
  }

  const address = optionalRecord(payload, 'address');
  let addressId: string | null = null;
  if (address) {
    addressId = requireString(address, 'id');
    const isDefault = requireBoolean(address, 'is_default');
    if (isDefault) {
      await database.run(
        `UPDATE customer_addresses
         SET is_default = 0
         WHERE store_id = ? AND customer_id = ? AND id <> ? AND is_default = 1`,
        [storeId, customerId, addressId]
      );
    }
    await database.run(
      `INSERT INTO customer_addresses (
        id, store_id, customer_id, label, address, district, instructions,
        delivery_zone_id, is_default, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id,
        label = excluded.label,
        address = excluded.address,
        district = excluded.district,
        instructions = excluded.instructions,
        delivery_zone_id = excluded.delivery_zone_id,
        is_default = excluded.is_default,
        updated_at = excluded.updated_at,
        version = excluded.version
      WHERE customer_addresses.store_id = excluded.store_id
        AND customer_addresses.version <= excluded.version`,
      [
        addressId,
        storeId,
        customerId,
        requireString(address, 'label'),
        requireString(address, 'address'),
        requireString(address, 'district'),
        optionalString(address, 'instructions'),
        optionalString(address, 'delivery_zone_id'),
        isDefault ? 1 : 0,
        requireString(address, 'created_at'),
        requireString(address, 'updated_at'),
        requireInteger(address, 'version', 1),
      ]
    );
  }

  await database.run(
    `INSERT INTO orders (
      id, store_id, operation_id, order_number, customer_id, source,
      fulfillment_type, address_id, delivery_zone_id, status, payment_status,
      payment_method, payment_reference, payment_verified_at,
      payment_verified_by_user_id,
      estimated_subtotal_cents, delivery_fee_cents, estimated_total_cents,
      final_subtotal_cents, final_total_cents, notes, scheduled_for,
      assigned_user_id, actor_user_id, device_id, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation_id = excluded.operation_id,
      order_number = excluded.order_number,
      customer_id = excluded.customer_id,
      source = excluded.source,
      fulfillment_type = excluded.fulfillment_type,
      address_id = excluded.address_id,
      delivery_zone_id = excluded.delivery_zone_id,
      status = excluded.status,
      payment_status = excluded.payment_status,
      payment_method = excluded.payment_method,
      payment_reference = excluded.payment_reference,
      payment_verified_at = excluded.payment_verified_at,
      payment_verified_by_user_id = excluded.payment_verified_by_user_id,
      estimated_subtotal_cents = excluded.estimated_subtotal_cents,
      delivery_fee_cents = excluded.delivery_fee_cents,
      estimated_total_cents = excluded.estimated_total_cents,
      final_subtotal_cents = excluded.final_subtotal_cents,
      final_total_cents = excluded.final_total_cents,
      notes = excluded.notes,
      scheduled_for = excluded.scheduled_for,
      assigned_user_id = excluded.assigned_user_id,
      actor_user_id = excluded.actor_user_id,
      device_id = excluded.device_id,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE orders.store_id = excluded.store_id
      AND orders.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'operation_id'),
      requireString(payload, 'order_number'),
      customerId,
      requireString(payload, 'source'),
      requireString(payload, 'fulfillment_type'),
      addressId,
      optionalString(payload, 'delivery_zone_id'),
      orderStatus,
      requireString(payload, 'payment_status'),
      optionalString(payload, 'payment_method') ?? 'cash',
      optionalString(payload, 'payment_reference'),
      optionalString(payload, 'payment_verified_at'),
      optionalString(payload, 'payment_verified_by_user_id'),
      requireInteger(payload, 'estimated_subtotal_cents'),
      requireInteger(payload, 'delivery_fee_cents'),
      requireInteger(payload, 'estimated_total_cents'),
      optionalInteger(payload, 'final_subtotal_cents'),
      optionalInteger(payload, 'final_total_cents'),
      optionalString(payload, 'notes'),
      optionalString(payload, 'scheduled_for'),
      optionalString(payload, 'assigned_user_id'),
      requireString(payload, 'actor_user_id'),
      requireString(payload, 'device_id'),
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );

  for (const item of requireRecordArray(payload, 'items')) {
    const itemId = requireString(item, 'id');
    const productId = requireString(item, 'product_id');
    const requestedQuantity = requireInteger(item, 'requested_quantity', 1);
    const preparedQuantity = optionalInteger(item, 'prepared_quantity');
    await database.run(
      `INSERT INTO order_items (
        id, store_id, order_id, product_id, product_name_snapshot,
        base_unit_snapshot, requested_quantity, prepared_quantity,
        price_cents_snapshot, pricing_quantity_snapshot, estimated_cents,
        final_cents, substitution_policy, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        prepared_quantity = excluded.prepared_quantity,
        final_cents = excluded.final_cents,
        updated_at = excluded.updated_at,
        version = excluded.version
      WHERE order_items.store_id = excluded.store_id
        AND order_items.order_id = excluded.order_id
        AND order_items.version <= excluded.version`,
      [
        itemId,
        storeId,
        id,
        productId,
        requireString(item, 'product_name_snapshot'),
        requireString(item, 'base_unit_snapshot'),
        requestedQuantity,
        preparedQuantity,
        requireInteger(item, 'price_cents_snapshot'),
        requireInteger(item, 'pricing_quantity_snapshot', 1),
        requireInteger(item, 'estimated_cents'),
        optionalInteger(item, 'final_cents'),
        requireString(item, 'substitution_policy'),
        requireString(item, 'created_at'),
        requireString(item, 'updated_at'),
        requireInteger(item, 'version', 1),
      ]
    );
    const reservationStatus =
      orderStatus === 'cancelled'
        ? 'released'
        : preparedQuantity === null &&
            ['received', 'confirmed', 'preparing'].includes(orderStatus)
          ? 'reserved'
          : 'consumed';
    const eventAt = requireString(item, 'updated_at');
    await database.run(
      `INSERT INTO order_inventory_reservations (
        id, store_id, order_id, order_item_id, product_id,
        reserved_quantity, consumed_quantity, status,
        consumed_at, released_at, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(store_id, order_item_id) DO UPDATE SET
        reserved_quantity = excluded.reserved_quantity,
        consumed_quantity = excluded.consumed_quantity,
        status = excluded.status,
        consumed_at = excluded.consumed_at,
        released_at = excluded.released_at,
        updated_at = excluded.updated_at,
        version = order_inventory_reservations.version + 1
      WHERE order_inventory_reservations.store_id = excluded.store_id`,
      [
        itemId,
        storeId,
        id,
        itemId,
        productId,
        requestedQuantity,
        preparedQuantity ?? 0,
        reservationStatus,
        reservationStatus === 'consumed' ? eventAt : null,
        reservationStatus === 'released' ? eventAt : null,
        requireString(item, 'created_at'),
        eventAt,
      ]
    );
  }

  const payloadItemIds = new Set(
    requireRecordArray(payload, 'items').map((item) => requireString(item, 'id'))
  );
  const localItems = await database.getAll<{ id: string }>(
    'SELECT id FROM order_items WHERE store_id = ? AND order_id = ?',
    [storeId, id]
  );
  for (const local of localItems) {
    if (!payloadItemIds.has(local.id)) {
      await database.run(
        'DELETE FROM order_inventory_reservations WHERE store_id = ? AND order_item_id = ?',
        [storeId, local.id]
      );
      await database.run(
        'DELETE FROM order_items WHERE store_id = ? AND id = ?',
        [storeId, local.id]
      );
    }
  }

  for (const history of requireRecordArray(payload, 'history')) {
    await database.run(
      `INSERT OR IGNORE INTO order_status_history (
        id, store_id, order_id, operation_id, from_status, to_status,
        reason, actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requireString(history, 'id'),
        storeId,
        id,
        requireString(history, 'operation_id'),
        optionalString(history, 'from_status'),
        requireString(history, 'to_status'),
        requireString(history, 'reason'),
        requireString(history, 'actor_user_id'),
        requireString(history, 'device_id'),
        requireString(history, 'created_at'),
        requireString(history, 'updated_at'),
        requireInteger(history, 'version', 1),
      ]
    );
  }

  for (const history of optionalRecordArray(payload, 'payment_history')) {
    await database.run(
      `INSERT OR IGNORE INTO order_payment_history (
        id, store_id, order_id, operation_id, from_status, to_status,
        payment_method, payment_reference, reason, actor_user_id, device_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requireString(history, 'id'),
        storeId,
        id,
        requireString(history, 'operation_id'),
        requireString(history, 'from_status'),
        requireString(history, 'to_status'),
        requireString(history, 'payment_method'),
        optionalString(history, 'payment_reference'),
        requireString(history, 'reason'),
        requireString(history, 'actor_user_id'),
        requireString(history, 'device_id'),
        requireString(history, 'created_at'),
        requireString(history, 'updated_at'),
        requireInteger(history, 'version', 1),
      ]
    );
  }
}

async function applyOrderPlanning(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const orderId = requireString(payload, 'order_id');
  if (orderId !== change.entityId) {
    throw new Error('El pedido planificado no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'orders', orderId, storeId);
  const orderVersion = requireInteger(payload, 'order_version', 1);
  await database.run(
    `UPDATE orders
     SET scheduled_for = ?, assigned_user_id = ?, updated_at = ?, version = ?
     WHERE id = ? AND store_id = ? AND version <= ?`,
    [
      optionalString(payload, 'scheduled_for'),
      optionalString(payload, 'assigned_user_id'),
      change.changedAt,
      orderVersion,
      orderId,
      storeId,
      orderVersion,
    ]
  );
}

async function applyOrderIncident(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('La incidencia no coincide con el sobre pull.');
  }
  const orderId = requireString(payload, 'order_id');
  await assertEntityStore(database, 'orders', orderId, storeId);
  await assertEntityStore(database, 'order_incidents', id, storeId);
  const deviceId =
    optionalString(payload, 'device_id') ?? change.sourceDeviceId ?? 'server';
  await database.run(
    `INSERT INTO order_incidents (
      id, store_id, order_id, incident_type, description, status, resolution,
      actor_user_id, device_id, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      incident_type = excluded.incident_type,
      description = excluded.description,
      status = excluded.status,
      resolution = excluded.resolution,
      actor_user_id = excluded.actor_user_id,
      device_id = excluded.device_id,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE order_incidents.store_id = excluded.store_id
      AND order_incidents.order_id = excluded.order_id
      AND order_incidents.version <= excluded.version`,
    [
      id,
      storeId,
      orderId,
      requireString(payload, 'incident_type'),
      requireString(payload, 'description'),
      requireString(payload, 'status'),
      optionalString(payload, 'resolution'),
      requireString(payload, 'actor_user_id'),
      deviceId,
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function applyOrderSubstitution(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('La sustitucion no coincide con el sobre pull.');
  }
  const orderId = requireString(payload, 'order_id');
  await assertEntityStore(database, 'orders', orderId, storeId);
  await assertEntityStore(database, 'order_substitutions', id, storeId);
  const deviceId =
    optionalString(payload, 'device_id') ?? change.sourceDeviceId ?? 'server';
  await database.run(
    `INSERT INTO order_substitutions (
      id, store_id, order_id, order_item_id, replacement_product_id,
      replacement_product_name, status, notes, actor_user_id, device_id,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      replacement_product_id = excluded.replacement_product_id,
      replacement_product_name = excluded.replacement_product_name,
      status = excluded.status,
      notes = excluded.notes,
      actor_user_id = excluded.actor_user_id,
      device_id = excluded.device_id,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE order_substitutions.store_id = excluded.store_id
      AND order_substitutions.order_id = excluded.order_id
      AND order_substitutions.order_item_id = excluded.order_item_id
      AND order_substitutions.version <= excluded.version`,
    [
      id,
      storeId,
      orderId,
      requireString(payload, 'order_item_id'),
      requireString(payload, 'replacement_product_id'),
      requireString(payload, 'replacement_product_name'),
      requireString(payload, 'status'),
      optionalString(payload, 'notes'),
      requireString(payload, 'actor_user_id'),
      deviceId,
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function localUserForRemoteAuth(
  database: DatabaseAdapter,
  storeId: string,
  authUserId: string | null,
  fallbackId?: string
) {
  if (authUserId) {
    const linked = await database.getFirst<{ id: string }>(
      `SELECT id FROM local_users
       WHERE store_id = ? AND auth_user_id = ? AND is_active = 1`,
      [storeId, authUserId]
    );
    if (linked) return linked.id;
    const sameId = await database.getFirst<{ id: string }>(
      'SELECT id FROM local_users WHERE store_id = ? AND id = ? AND is_active = 1',
      [storeId, authUserId]
    );
    if (sameId) return sameId.id;
  }
  if (fallbackId) return fallbackId;
  const administrator = await database.getFirst<{ id: string }>(
    `SELECT id FROM local_users
     WHERE store_id = ? AND role = 'administrator' AND is_active = 1
     ORDER BY created_at LIMIT 1`,
    [storeId]
  );
  if (administrator) return administrator.id;
  throw new Error('El usuario remoto de delivery no está vinculado localmente.');
}

async function applyDeliveryAssignment(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('El despacho no coincide con el sobre pull.');
  }
  const orderId = requireString(payload, 'order_id');
  await assertEntityStore(database, 'orders', orderId, storeId);
  await assertEntityStore(database, 'delivery_assignments', id, storeId);
  const existing = await database.getFirst<{
    driver_user_id: string;
    assigned_by_user_id: string;
    version: number;
  }>(
    `SELECT driver_user_id,assigned_by_user_id,version
     FROM delivery_assignments WHERE id = ? AND store_id = ?`,
    [id, storeId]
  );
  if (existing && existing.version > change.version) return;
  const driverUserId = await localUserForRemoteAuth(
    database,
    storeId,
    optionalString(payload, 'driver_user_id'),
    existing?.driver_user_id
  );
  const assignedByUserId = await localUserForRemoteAuth(
    database,
    storeId,
    optionalString(payload, 'assigned_by_user_id'),
    existing?.assigned_by_user_id ?? driverUserId
  );
  const deviceId =
    optionalString(payload, 'device_id') ?? change.sourceDeviceId ?? 'server';
  await database.run(
    `INSERT INTO delivery_assignments(
      id,store_id,order_id,driver_user_id,status,recipient_name,
      confirmation_code,evidence_uri,notes,assigned_by_user_id,device_id,
      started_at,delivered_at,created_at,updated_at,version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      driver_user_id = excluded.driver_user_id,status = excluded.status,
      recipient_name = excluded.recipient_name,
      confirmation_code = excluded.confirmation_code,
      evidence_uri = excluded.evidence_uri,notes = excluded.notes,
      assigned_by_user_id = excluded.assigned_by_user_id,
      device_id = excluded.device_id,started_at = excluded.started_at,
      delivered_at = excluded.delivered_at,updated_at = excluded.updated_at,
      version = excluded.version
    WHERE delivery_assignments.store_id = excluded.store_id
      AND delivery_assignments.order_id = excluded.order_id
      AND delivery_assignments.version <= excluded.version`,
    [
      id,
      storeId,
      orderId,
      driverUserId,
      requireString(payload, 'status'),
      optionalString(payload, 'recipient_name'),
      optionalString(payload, 'confirmation_code'),
      optionalString(payload, 'evidence_uri'),
      optionalString(payload, 'notes'),
      assignedByUserId,
      deviceId,
      optionalString(payload, 'started_at'),
      optionalString(payload, 'delivered_at'),
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function applyPurchaseOrder(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('La orden de compra no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'purchase_orders', id, storeId);
  const existing = await database.getFirst<{
    actor_user_id: string;
    version: number;
  }>(
    'SELECT actor_user_id,version FROM purchase_orders WHERE id = ? AND store_id = ?',
    [id, storeId]
  );
  if (existing && existing.version > change.version) return;
  const actorUserId = await localUserForRemoteAuth(
    database,
    storeId,
    optionalString(payload, 'actor_user_id'),
    existing?.actor_user_id
  );
  const deviceId =
    optionalString(payload, 'device_id') ?? change.sourceDeviceId ?? 'server';
  await database.run(
    `INSERT INTO purchase_orders(
      id,store_id,supplier_id,order_number,status,expected_at,notes,total_cents,
      actor_user_id,device_id,received_at,created_at,updated_at,version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      supplier_id = excluded.supplier_id,order_number = excluded.order_number,
      status = excluded.status,expected_at = excluded.expected_at,
      notes = excluded.notes,total_cents = excluded.total_cents,
      actor_user_id = excluded.actor_user_id,device_id = excluded.device_id,
      received_at = excluded.received_at,updated_at = excluded.updated_at,
      version = excluded.version
    WHERE purchase_orders.store_id = excluded.store_id
      AND purchase_orders.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'supplier_id'),
      requireString(payload, 'order_number'),
      requireString(payload, 'status'),
      optionalString(payload, 'expected_at'),
      optionalString(payload, 'notes'),
      requireInteger(payload, 'total_cents'),
      actorUserId,
      deviceId,
      optionalString(payload, 'received_at'),
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
  for (const item of requireRecordArray(payload, 'items')) {
    await database.run(
      `INSERT INTO purchase_order_items(
        id,store_id,purchase_order_id,product_id,product_name_snapshot,
        ordered_quantity,received_quantity,unit_cost_cents,pricing_quantity,
        line_total_cents,created_at,updated_at,version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        received_quantity = excluded.received_quantity,
        unit_cost_cents = excluded.unit_cost_cents,
        line_total_cents = excluded.line_total_cents,
        updated_at = excluded.updated_at,version = excluded.version
      WHERE purchase_order_items.store_id = excluded.store_id
        AND purchase_order_items.purchase_order_id = excluded.purchase_order_id
        AND purchase_order_items.version <= excluded.version`,
      [
        requireString(item, 'id'),
        storeId,
        id,
        requireString(item, 'product_id'),
        requireString(item, 'product_name_snapshot'),
        requireInteger(item, 'ordered_quantity', 1),
        requireInteger(item, 'received_quantity'),
        requireInteger(item, 'unit_cost_cents'),
        requireInteger(item, 'pricing_quantity', 1),
        requireInteger(item, 'line_total_cents'),
        requireString(item, 'created_at'),
        requireString(item, 'updated_at'),
        requireInteger(item, 'version', 1),
      ]
    );
  }
}

async function applyInventoryLot(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('El lote no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'inventory_lots', id, storeId);
  const existing = await database.getFirst<{
    actor_user_id: string;
    version: number;
  }>(
    'SELECT actor_user_id,version FROM inventory_lots WHERE id = ? AND store_id = ?',
    [id, storeId]
  );
  if (existing && existing.version > change.version) return;
  const actorUserId = await localUserForRemoteAuth(
    database,
    storeId,
    optionalString(payload, 'actor_user_id'),
    existing?.actor_user_id
  );
  await database.run(
    `INSERT INTO inventory_lots(
      id,store_id,product_id,supplier_id,purchase_order_id,
      purchase_order_item_id,lot_code,expires_at,received_quantity,
      remaining_quantity,actor_user_id,device_id,created_at,updated_at,version
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      expires_at = excluded.expires_at,
      remaining_quantity = excluded.remaining_quantity,
      updated_at = excluded.updated_at,version = excluded.version
    WHERE inventory_lots.store_id = excluded.store_id
      AND inventory_lots.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'product_id'),
      requireString(payload, 'supplier_id'),
      requireString(payload, 'purchase_order_id'),
      requireString(payload, 'purchase_order_item_id'),
      requireString(payload, 'lot_code'),
      optionalString(payload, 'expires_at'),
      requireInteger(payload, 'received_quantity', 1),
      requireInteger(payload, 'remaining_quantity'),
      actorUserId,
      optionalString(payload, 'device_id') ?? change.sourceDeviceId ?? 'server',
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function applyPhysicalCount(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('El conteo no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'physical_counts', id, storeId);
  const existing = await database.getFirst<{
    actor_user_id: string;
    version: number;
  }>(
    'SELECT actor_user_id,version FROM physical_counts WHERE id = ? AND store_id = ?',
    [id, storeId]
  );
  if (existing && existing.version > change.version) return;
  const actorUserId = await localUserForRemoteAuth(
    database,
    storeId,
    optionalString(payload, 'actor_user_id'),
    existing?.actor_user_id
  );
  const deviceId =
    optionalString(payload, 'device_id') ?? change.sourceDeviceId ?? 'server';
  await database.run(
    `INSERT INTO physical_counts(
      id,store_id,count_number,status,notes,actor_user_id,device_id,
      created_at,updated_at,version
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      notes = excluded.notes,actor_user_id = excluded.actor_user_id,
      device_id = excluded.device_id,updated_at = excluded.updated_at,
      version = excluded.version
    WHERE physical_counts.store_id = excluded.store_id
      AND physical_counts.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'count_number'),
      requireString(payload, 'status'),
      optionalString(payload, 'notes'),
      actorUserId,
      deviceId,
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
  for (const item of requireRecordArray(payload, 'items')) {
    await database.run(
      `INSERT INTO physical_count_items(
        id,store_id,physical_count_id,product_id,product_name_snapshot,
        expected_quantity,counted_quantity,difference_quantity,
        created_at,updated_at,version
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        expected_quantity = excluded.expected_quantity,
        counted_quantity = excluded.counted_quantity,
        difference_quantity = excluded.difference_quantity,
        updated_at = excluded.updated_at,version = excluded.version
      WHERE physical_count_items.store_id = excluded.store_id
        AND physical_count_items.physical_count_id = excluded.physical_count_id
        AND physical_count_items.version <= excluded.version`,
      [
        requireString(item, 'id'),
        storeId,
        id,
        requireString(item, 'product_id'),
        requireString(item, 'product_name_snapshot'),
        requireInteger(item, 'expected_quantity'),
        requireInteger(item, 'counted_quantity'),
        requireSignedInteger(item, 'difference_quantity'),
        requireString(item, 'created_at'),
        requireString(item, 'updated_at'),
        requireInteger(item, 'version', 1),
      ]
    );
  }
}

async function applyDeliveryZone(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('El id de la zona no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'delivery_zones', id, storeId);

  const etaMinMinutes = requireInteger(payload, 'eta_min_minutes', 1);
  const etaMaxMinutes = requireInteger(payload, 'eta_max_minutes', etaMinMinutes);
  await database.run(
    `INSERT INTO delivery_zones (
      id, store_id, name, district, fee_cents, minimum_order_cents,
      eta_min_minutes, eta_max_minutes, schedule_text, restrictions,
      is_active, created_by_user_id, updated_by_user_id,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      district = excluded.district,
      fee_cents = excluded.fee_cents,
      minimum_order_cents = excluded.minimum_order_cents,
      eta_min_minutes = excluded.eta_min_minutes,
      eta_max_minutes = excluded.eta_max_minutes,
      schedule_text = excluded.schedule_text,
      restrictions = excluded.restrictions,
      is_active = excluded.is_active,
      created_by_user_id = excluded.created_by_user_id,
      updated_by_user_id = excluded.updated_by_user_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE delivery_zones.store_id = excluded.store_id
      AND delivery_zones.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'name'),
      requireString(payload, 'district'),
      requireInteger(payload, 'fee_cents'),
      requireInteger(payload, 'minimum_order_cents'),
      etaMinMinutes,
      etaMaxMinutes,
      requireString(payload, 'schedule_text'),
      optionalString(payload, 'restrictions'),
      requireBoolean(payload, 'is_active') ? 1 : 0,
      requireString(payload, 'created_by'),
      requireString(payload, 'updated_by'),
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function applySupplier(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('El id del proveedor no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'suppliers', id, storeId);

  await database.run(
    `INSERT INTO suppliers (
      id, store_id, name, tax_id, contact_name, phone, email,
      address, notes, is_active, created_by_user_id, updated_by_user_id,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      tax_id = excluded.tax_id,
      contact_name = excluded.contact_name,
      phone = excluded.phone,
      email = excluded.email,
      address = excluded.address,
      notes = excluded.notes,
      is_active = excluded.is_active,
      created_by_user_id = excluded.created_by_user_id,
      updated_by_user_id = excluded.updated_by_user_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE suppliers.store_id = excluded.store_id
      AND suppliers.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'name'),
      optionalString(payload, 'tax_id'),
      optionalString(payload, 'contact_name'),
      optionalString(payload, 'phone'),
      optionalString(payload, 'email'),
      optionalString(payload, 'address'),
      optionalString(payload, 'notes'),
      requireBoolean(payload, 'is_active') ? 1 : 0,
      requireString(payload, 'created_by'),
      requireString(payload, 'updated_by'),
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function applyProduct(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('El id del producto no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'products', id, storeId);

  const baseUnit = requireString(payload, 'base_unit');
  if (baseUnit !== 'gram' && baseUnit !== 'unit') {
    throw new Error('La unidad base del producto pull no es valida.');
  }

  await database.run(
    `INSERT INTO products (
      id, store_id, sku, name, category, base_unit, pricing_quantity,
      price_cents, cost_cents, stock_quantity, minimum_stock_quantity,
      is_active, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sku = excluded.sku,
      name = excluded.name,
      category = excluded.category,
      base_unit = excluded.base_unit,
      pricing_quantity = excluded.pricing_quantity,
      price_cents = excluded.price_cents,
      cost_cents = excluded.cost_cents,
      stock_quantity = excluded.stock_quantity,
      minimum_stock_quantity = excluded.minimum_stock_quantity,
      is_active = excluded.is_active,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE products.store_id = excluded.store_id
      AND products.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'sku'),
      requireString(payload, 'name'),
      requireString(payload, 'category_name'),
      baseUnit,
      requireInteger(payload, 'pricing_quantity', 1),
      requireInteger(payload, 'price_cents'),
      requireInteger(payload, 'cost_cents'),
      requireInteger(payload, 'stock_quantity'),
      requireInteger(payload, 'minimum_stock_quantity'),
      requireBoolean(payload, 'is_active') ? 1 : 0,
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function applyPresentation(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const id = requireString(payload, 'id');
  if (id !== change.entityId) {
    throw new Error('El id de la presentacion no coincide con el sobre pull.');
  }
  await assertEntityStore(database, 'product_presentations', id, storeId);

  const kind = requireString(payload, 'kind');
  if (!['unit', 'package', 'box', 'sack'].includes(kind)) {
    throw new Error('El tipo de presentacion pull no es valido.');
  }
  const fixedPrice = payload.fixed_price_cents;
  if (
    fixedPrice !== null &&
    fixedPrice !== undefined &&
    (!Number.isSafeInteger(fixedPrice) || (fixedPrice as number) < 0)
  ) {
    throw new Error('El precio fijo de la presentacion pull no es valido.');
  }

  await database.run(
    `INSERT INTO product_presentations (
      id, store_id, product_id, sku, name, presentation_type,
      quantity_in_base_units, fixed_price_cents, is_active,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      product_id = excluded.product_id,
      sku = excluded.sku,
      name = excluded.name,
      presentation_type = excluded.presentation_type,
      quantity_in_base_units = excluded.quantity_in_base_units,
      fixed_price_cents = excluded.fixed_price_cents,
      is_active = excluded.is_active,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      version = excluded.version
    WHERE product_presentations.store_id = excluded.store_id
      AND product_presentations.version <= excluded.version`,
    [
      id,
      storeId,
      requireString(payload, 'product_id'),
      requireString(payload, 'sku'),
      requireString(payload, 'name'),
      kind,
      requireInteger(payload, 'conversion_factor', 1),
      fixedPrice === undefined ? null : (fixedPrice as number | null),
      requireBoolean(payload, 'is_active') ? 1 : 0,
      requireString(payload, 'created_at'),
      requireString(payload, 'updated_at'),
      change.version,
    ]
  );
}

async function applyProductProjection(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange
) {
  const payload = change.payload;
  const productId = requireString(payload, 'product_id');
  const productVersion = requireInteger(payload, 'product_version', 1);

  if (change.operation === 'product.price_updated') {
    await database.run(
      `UPDATE products
       SET price_cents = ?,
           updated_at = ?,
           version = ?
       WHERE id = ?
         AND store_id = ?
         AND version <= ?`,
      [
        requireInteger(payload, 'new_price_cents'),
        change.changedAt,
        productVersion,
        productId,
        storeId,
        productVersion,
      ]
    );
  } else if (change.operation === 'inventory_movement.created') {
    await database.run(
      `UPDATE products
       SET stock_quantity = ?,
           updated_at = ?,
           version = ?
       WHERE id = ?
         AND store_id = ?
         AND version <= ?`,
      [
        requireInteger(payload, 'resulting_quantity'),
        change.changedAt,
        productVersion,
        productId,
        storeId,
        productVersion,
      ]
    );
  }
}

export async function applyPullChange(
  database: DatabaseAdapter,
  storeId: string,
  change: PullChange,
  receivedAt: string
) {
  assertChangeEnvelope(change, storeId);

  const inserted = await database.run(
    `INSERT OR IGNORE INTO sync_inbox (
      sequence, store_id, entity_type, entity_id, operation_type,
      entity_version, payload_json, changed_at, source_device_id,
      operation_id, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      change.sequence,
      storeId,
      change.entityType,
      change.entityId,
      change.operation,
      change.version,
      JSON.stringify(change.payload),
      change.changedAt,
      change.sourceDeviceId,
      change.operationId,
      receivedAt,
    ]
  );
  if (inserted.changes === 0) return false;

  if (change.entityType === 'product') {
    await applyProduct(database, storeId, change);
  } else if (change.entityType === 'product_presentation') {
    await applyPresentation(database, storeId, change);
  } else if (change.entityType === 'supplier') {
    await applySupplier(database, storeId, change);
  } else if (change.entityType === 'delivery_zone') {
    await applyDeliveryZone(database, storeId, change);
  } else if (change.entityType === 'order') {
    await applyOrder(database, storeId, change);
  } else if (change.entityType === 'order_planning') {
    await applyOrderPlanning(database, storeId, change);
  } else if (change.entityType === 'order_incident') {
    await applyOrderIncident(database, storeId, change);
  } else if (change.entityType === 'order_substitution') {
    await applyOrderSubstitution(database, storeId, change);
  } else if (change.entityType === 'delivery_assignment') {
    await applyDeliveryAssignment(database, storeId, change);
  } else if (change.entityType === 'purchase_order') {
    await applyPurchaseOrder(database, storeId, change);
  } else if (change.entityType === 'inventory_lot') {
    await applyInventoryLot(database, storeId, change);
  } else if (change.entityType === 'physical_count') {
    await applyPhysicalCount(database, storeId, change);
  } else if (
    change.operation === 'product.price_updated' ||
    change.operation === 'inventory_movement.created'
  ) {
    await applyProductProjection(database, storeId, change);
  } else {
    throw new Error(
      `Tipo de entidad no soportado: ${change.entityType} (${change.operation}). Actualiza la app.`
    );
  }

  return true;
}
