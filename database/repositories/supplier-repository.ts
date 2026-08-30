import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type { SupplierRecord } from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { enqueueOperation } from './sync-outbox-repository';

type SupplierRow = {
  id: string;
  store_id: string;
  name: string;
  tax_id: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: number;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type SupplierFieldsInput = {
  name: string;
  taxId?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type CreateSupplierInput = SupplierFieldsInput & {
  storeId: string;
  actorUserId: string;
  deviceId: string;
};

export type UpdateSupplierInput = SupplierFieldsInput & {
  storeId: string;
  supplierId: string;
  expectedVersion: number;
  actorUserId: string;
  deviceId: string;
};

export type SetSupplierActiveInput = {
  storeId: string;
  supplierId: string;
  expectedVersion: number;
  isActive: boolean;
  actorUserId: string;
  deviceId: string;
};

type NormalizedSupplierFields = {
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

function optionalText(value: string | null | undefined, maximumLength: number) {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > maximumLength) {
    throw new Error(`El campo supera el máximo de ${maximumLength} caracteres.`);
  }
  return normalized;
}

function normalizeSupplierFields(input: SupplierFieldsInput): NormalizedSupplierFields {
  const name = input.name.trim();
  if (!name) {
    throw new Error('El proveedor requiere una razón social o nombre.');
  }
  if (name.length > 120) {
    throw new Error('El nombre del proveedor no puede superar 120 caracteres.');
  }

  const taxId = optionalText(input.taxId, 11);
  if (taxId && !/^\d{11}$/.test(taxId)) {
    throw new Error('El RUC debe contener exactamente 11 dígitos.');
  }

  const email = optionalText(input.email, 160)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('El correo del proveedor no es válido.');
  }

  return {
    name,
    taxId,
    contactName: optionalText(input.contactName, 120),
    phone: optionalText(input.phone, 30),
    email,
    address: optionalText(input.address, 240),
    notes: optionalText(input.notes, 500),
  };
}

function mapSupplierRow(row: SupplierRow): SupplierRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    taxId: row.tax_id,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    isActive: row.is_active === 1,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

async function requireAdministrator(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  deviceId: string
) {
  if (!deviceId) {
    throw new Error('La operación requiere un dispositivo identificado.');
  }
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!actor || actor.role !== 'administrator') {
    throw new Error('Solo un administrador puede modificar proveedores.');
  }
}

async function assertTaxIdAvailable(
  database: DatabaseAdapter,
  storeId: string,
  taxId: string | null,
  exceptSupplierId?: string
) {
  if (!taxId) return;
  const duplicate = await database.getFirst<{ id: string }>(
    `SELECT id
     FROM suppliers
     WHERE store_id = ? AND tax_id = ? AND id <> ?
     LIMIT 1`,
    [storeId, taxId, exceptSupplierId ?? '']
  );
  if (duplicate) {
    throw new Error('Ya existe un proveedor con ese RUC.');
  }
}

function supplierPayload(
  supplier: SupplierRecord,
  deviceId: string,
  actorUserId: string,
  expectedVersion: number | null
) {
  return {
    id: supplier.id,
    storeId: supplier.storeId,
    name: supplier.name,
    taxId: supplier.taxId,
    contactName: supplier.contactName,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    isActive: supplier.isActive,
    expectedVersion,
    actorUserId,
    deviceId,
    updatedAt: supplier.updatedAt,
  };
}

export async function listSuppliers(
  database: DatabaseAdapter,
  storeId: string,
  includeInactive = true
): Promise<SupplierRecord[]> {
  const rows = await database.getAll<SupplierRow>(
    `SELECT *
     FROM suppliers
     WHERE store_id = ? AND (? = 1 OR is_active = 1)
     ORDER BY is_active DESC, name COLLATE NOCASE, id`,
    [storeId, includeInactive ? 1 : 0]
  );
  return rows.map(mapSupplierRow);
}

export async function getSupplierById(
  database: DatabaseAdapter,
  storeId: string,
  supplierId: string
): Promise<SupplierRecord | null> {
  const row = await database.getFirst<SupplierRow>(
    'SELECT * FROM suppliers WHERE store_id = ? AND id = ?',
    [storeId, supplierId]
  );
  return row ? mapSupplierRow(row) : null;
}

export async function createSupplier(
  database: DatabaseAdapter,
  input: CreateSupplierInput
): Promise<SupplierRecord> {
  const fields = normalizeSupplierFields(input);
  const supplierId = createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    await requireAdministrator(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    await assertTaxIdAvailable(transaction, input.storeId, fields.taxId);

    await transaction.run(
      `INSERT INTO suppliers (
        id, store_id, name, tax_id, contact_name, phone, email,
        address, notes, is_active, created_by_user_id, updated_by_user_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1)`,
      [
        supplierId,
        input.storeId,
        fields.name,
        fields.taxId,
        fields.contactName,
        fields.phone,
        fields.email,
        fields.address,
        fields.notes,
        input.actorUserId,
        input.actorUserId,
        timestamp,
        timestamp,
      ]
    );

    const supplier = await getSupplierById(transaction, input.storeId, supplierId);
    if (!supplier) {
      throw new Error('No se pudo recuperar el proveedor creado.');
    }

    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: supplierId,
      entityType: 'supplier',
      entityId: supplierId,
      operationType: 'supplier.created',
      payload: supplierPayload(supplier, input.deviceId, input.actorUserId, null),
      timestamp,
    });

    return supplier;
  });
}

export async function updateSupplier(
  database: DatabaseAdapter,
  input: UpdateSupplierInput
): Promise<SupplierRecord> {
  const fields = normalizeSupplierFields(input);
  const operationId = createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    await requireAdministrator(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    await assertTaxIdAvailable(
      transaction,
      input.storeId,
      fields.taxId,
      input.supplierId
    );

    const update = await transaction.run(
      `UPDATE suppliers
       SET name = ?,
           tax_id = ?,
           contact_name = ?,
           phone = ?,
           email = ?,
           address = ?,
           notes = ?,
           updated_by_user_id = ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        fields.name,
        fields.taxId,
        fields.contactName,
        fields.phone,
        fields.email,
        fields.address,
        fields.notes,
        input.actorUserId,
        timestamp,
        input.supplierId,
        input.storeId,
        input.expectedVersion,
      ]
    );
    if (update.changes !== 1) {
      throw new Error('El proveedor cambió. Actualiza la lista e intenta nuevamente.');
    }

    const supplier = await getSupplierById(
      transaction,
      input.storeId,
      input.supplierId
    );
    if (!supplier) {
      throw new Error('No se pudo recuperar el proveedor actualizado.');
    }

    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'supplier',
      entityId: supplier.id,
      operationType: 'supplier.updated',
      payload: supplierPayload(
        supplier,
        input.deviceId,
        input.actorUserId,
        input.expectedVersion
      ),
      timestamp,
    });

    return supplier;
  });
}

export async function setSupplierActive(
  database: DatabaseAdapter,
  input: SetSupplierActiveInput
): Promise<SupplierRecord> {
  const operationId = createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    await requireAdministrator(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );

    const update = await transaction.run(
      `UPDATE suppliers
       SET is_active = ?,
           updated_by_user_id = ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ? AND store_id = ? AND version = ? AND is_active <> ?`,
      [
        input.isActive ? 1 : 0,
        input.actorUserId,
        timestamp,
        input.supplierId,
        input.storeId,
        input.expectedVersion,
        input.isActive ? 1 : 0,
      ]
    );
    if (update.changes !== 1) {
      throw new Error('El proveedor cambió o ya tenía ese estado.');
    }

    const supplier = await getSupplierById(
      transaction,
      input.storeId,
      input.supplierId
    );
    if (!supplier) {
      throw new Error('No se pudo recuperar el proveedor actualizado.');
    }

    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'supplier',
      entityId: supplier.id,
      operationType: input.isActive
        ? 'supplier.activated'
        : 'supplier.deactivated',
      payload: supplierPayload(
        supplier,
        input.deviceId,
        input.actorUserId,
        input.expectedVersion
      ),
      timestamp,
    });

    return supplier;
  });
}
