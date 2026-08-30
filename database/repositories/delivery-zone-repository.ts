import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type { DeliveryZoneRecord } from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { enqueueOperation } from './sync-outbox-repository';

type DeliveryZoneRow = {
  id: string;
  store_id: string;
  name: string;
  district: string;
  fee_cents: number;
  minimum_order_cents: number;
  eta_min_minutes: number;
  eta_max_minutes: number;
  schedule_text: string;
  restrictions: string | null;
  is_active: number;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type DeliveryZoneFields = {
  name: string;
  district: string;
  feeCents: number;
  minimumOrderCents: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  scheduleText: string;
  restrictions?: string | null;
  isActive?: boolean;
};

export type CreateDeliveryZoneInput = DeliveryZoneFields & {
  storeId: string;
  actorUserId: string;
  deviceId: string;
};

export type UpdateDeliveryZoneInput = DeliveryZoneFields & {
  storeId: string;
  zoneId: string;
  expectedVersion: number;
  actorUserId: string;
  deviceId: string;
};

function mapRow(row: DeliveryZoneRow): DeliveryZoneRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    district: row.district,
    feeCents: row.fee_cents,
    minimumOrderCents: row.minimum_order_cents,
    etaMinMinutes: row.eta_min_minutes,
    etaMaxMinutes: row.eta_max_minutes,
    scheduleText: row.schedule_text,
    restrictions: row.restrictions,
    isActive: row.is_active === 1,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function normalize(input: DeliveryZoneFields) {
  const name = input.name.trim();
  const district = input.district.trim();
  const scheduleText = input.scheduleText.trim();
  if (!name || !district || !scheduleText) {
    throw new Error('La zona requiere nombre, distrito y horario.');
  }
  for (const [value, label] of [
    [input.feeCents, 'La tarifa'],
    [input.minimumOrderCents, 'El pedido mínimo'],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} debe expresarse en céntimos enteros no negativos.`);
    }
  }
  if (
    !Number.isSafeInteger(input.etaMinMinutes) ||
    input.etaMinMinutes <= 0 ||
    !Number.isSafeInteger(input.etaMaxMinutes) ||
    input.etaMaxMinutes < input.etaMinMinutes
  ) {
    throw new Error('El rango de entrega debe usar minutos enteros y coherentes.');
  }
  return {
    name,
    district,
    scheduleText,
    restrictions: input.restrictions?.trim() || null,
    isActive: input.isActive ?? true,
  };
}

async function requireAdmin(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  deviceId: string
) {
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!deviceId || !actor || actor.role !== 'administrator') {
    throw new Error('Solo un administrador puede modificar zonas de delivery.');
  }
}

function payload(
  zone: DeliveryZoneRecord,
  actorUserId: string,
  deviceId: string,
  expectedVersion: number | null
) {
  return {
    id: zone.id,
    storeId: zone.storeId,
    name: zone.name,
    district: zone.district,
    feeCents: zone.feeCents,
    minimumOrderCents: zone.minimumOrderCents,
    etaMinMinutes: zone.etaMinMinutes,
    etaMaxMinutes: zone.etaMaxMinutes,
    scheduleText: zone.scheduleText,
    restrictions: zone.restrictions,
    isActive: zone.isActive,
    actorUserId,
    deviceId,
    expectedVersion,
    updatedAt: zone.updatedAt,
  };
}

export async function listDeliveryZones(
  database: DatabaseAdapter,
  storeId: string
): Promise<DeliveryZoneRecord[]> {
  const rows = await database.getAll<DeliveryZoneRow>(
    `SELECT * FROM delivery_zones
     WHERE store_id = ?
     ORDER BY is_active DESC, name COLLATE NOCASE, id`,
    [storeId]
  );
  return rows.map(mapRow);
}

export async function getDeliveryZoneById(
  database: DatabaseAdapter,
  storeId: string,
  zoneId: string
) {
  const row = await database.getFirst<DeliveryZoneRow>(
    'SELECT * FROM delivery_zones WHERE store_id = ? AND id = ?',
    [storeId, zoneId]
  );
  return row ? mapRow(row) : null;
}

export async function createDeliveryZone(
  database: DatabaseAdapter,
  input: CreateDeliveryZoneInput
) {
  const fields = normalize(input);
  const id = createId();
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireAdmin(transaction, input.storeId, input.actorUserId, input.deviceId);
    await transaction.run(
      `INSERT INTO delivery_zones (
        id, store_id, name, district, fee_cents, minimum_order_cents,
        eta_min_minutes, eta_max_minutes, schedule_text, restrictions,
        is_active, created_by_user_id, updated_by_user_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id, input.storeId, fields.name, fields.district, input.feeCents,
        input.minimumOrderCents, input.etaMinMinutes, input.etaMaxMinutes,
        fields.scheduleText, fields.restrictions, fields.isActive ? 1 : 0,
        input.actorUserId, input.actorUserId, timestamp, timestamp,
      ]
    );
    const zone = await getDeliveryZoneById(transaction, input.storeId, id);
    if (!zone) throw new Error('No se pudo recuperar la zona creada.');
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: id,
      entityType: 'delivery_zone',
      entityId: id,
      operationType: 'delivery_zone.created',
      payload: payload(zone, input.actorUserId, input.deviceId, null),
      timestamp,
    });
    return zone;
  });
}

export async function updateDeliveryZone(
  database: DatabaseAdapter,
  input: UpdateDeliveryZoneInput
) {
  const fields = normalize(input);
  const timestamp = new Date().toISOString();
  const operationId = createId();
  return database.transaction(async (transaction) => {
    await requireAdmin(transaction, input.storeId, input.actorUserId, input.deviceId);
    const previous = await getDeliveryZoneById(transaction, input.storeId, input.zoneId);
    if (!previous) throw new Error('No se encontró la zona de delivery.');
    const result = await transaction.run(
      `UPDATE delivery_zones SET
        name = ?, district = ?, fee_cents = ?, minimum_order_cents = ?,
        eta_min_minutes = ?, eta_max_minutes = ?, schedule_text = ?,
        restrictions = ?, is_active = ?, updated_by_user_id = ?,
        updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        fields.name, fields.district, input.feeCents, input.minimumOrderCents,
        input.etaMinMinutes, input.etaMaxMinutes, fields.scheduleText,
        fields.restrictions, fields.isActive ? 1 : 0, input.actorUserId,
        timestamp, input.zoneId, input.storeId, input.expectedVersion,
      ]
    );
    if (result.changes !== 1) {
      throw new Error('La zona cambió. Actualiza la lista e intenta nuevamente.');
    }
    const zone = await getDeliveryZoneById(transaction, input.storeId, input.zoneId);
    if (!zone) throw new Error('No se pudo recuperar la zona actualizada.');
    const operationType =
      previous.isActive !== zone.isActive
        ? zone.isActive ? 'delivery_zone.activated' : 'delivery_zone.deactivated'
        : 'delivery_zone.updated';
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'delivery_zone',
      entityId: zone.id,
      operationType,
      payload: payload(zone, input.actorUserId, input.deviceId, input.expectedVersion),
      timestamp,
    });
    return zone;
  });
}
