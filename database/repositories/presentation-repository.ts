import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import { roundIntegerRatio } from '../integer-calculations';
import type {
  PresentationType,
  ProductPresentationRecord,
  ProductRecord,
} from '../models';
import { recordInventoryMovement } from './inventory-repository';
import { getActiveLocalUser } from './local-user-repository';
import { getProductById } from './product-repository';
import { enqueueOperation } from './sync-outbox-repository';

type ProductPresentationRow = {
  id: string;
  store_id: string;
  product_id: string;
  sku: string;
  name: string;
  presentation_type: PresentationType;
  quantity_in_base_units: number;
  fixed_price_cents: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  version: number;
};

export type CreateProductPresentationInput = {
  storeId: string;
  productId: string;
  sku: string;
  name: string;
  type: PresentationType;
  quantityInBaseUnits: number;
  fixedPriceCents?: number | null;
  actorUserId: string;
  deviceId: string;
};

export type UpdateProductPresentationInput = CreateProductPresentationInput & {
  presentationId: string;
  expectedVersion: number;
  isActive: boolean;
};

export type RecordPresentationMovementInput = {
  storeId: string;
  presentationId: string;
  presentationCountDelta: number;
  reason: string;
  referenceId?: string | null;
  actorUserId: string;
  deviceId: string;
};

function mapPresentationRow(row: ProductPresentationRow): ProductPresentationRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    type: row.presentation_type,
    quantityInBaseUnits: row.quantity_in_base_units,
    fixedPriceCents: row.fixed_price_cents,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export async function listProductPresentations(
  database: DatabaseAdapter,
  storeId: string,
  productId: string
): Promise<ProductPresentationRecord[]> {
  const rows = await database.getAll<ProductPresentationRow>(
    `SELECT *
     FROM product_presentations
     WHERE store_id = ? AND product_id = ? AND is_active = 1
     ORDER BY name COLLATE NOCASE`,
    [storeId, productId]
  );

  return rows.map(mapPresentationRow);
}

export async function listAllProductPresentations(
  database: DatabaseAdapter,
  storeId: string,
  productId: string
): Promise<ProductPresentationRecord[]> {
  const rows = await database.getAll<ProductPresentationRow>(
    `SELECT * FROM product_presentations
     WHERE store_id = ? AND product_id = ?
     ORDER BY is_active DESC,name COLLATE NOCASE`,
    [storeId, productId]
  );
  return rows.map(mapPresentationRow);
}

export async function listActivePresentations(
  database: DatabaseAdapter,
  storeId: string
): Promise<ProductPresentationRecord[]> {
  const rows = await database.getAll<ProductPresentationRow>(
    `SELECT *
     FROM product_presentations
     WHERE store_id = ? AND is_active = 1
     ORDER BY product_id, name COLLATE NOCASE`,
    [storeId]
  );

  return rows.map(mapPresentationRow);
}

export async function getProductPresentationById(
  database: DatabaseAdapter,
  storeId: string,
  presentationId: string
): Promise<ProductPresentationRecord | null> {
  const row = await database.getFirst<ProductPresentationRow>(
    'SELECT * FROM product_presentations WHERE id = ? AND store_id = ?',
    [presentationId, storeId]
  );

  return row ? mapPresentationRow(row) : null;
}

export function calculatePresentationPriceCents(
  product: ProductRecord,
  presentation: ProductPresentationRecord
) {
  if (presentation.productId !== product.id || presentation.storeId !== product.storeId) {
    throw new Error('La presentación no pertenece al producto indicado.');
  }

  return (
    presentation.fixedPriceCents ??
    roundIntegerRatio(
      product.priceCents,
      presentation.quantityInBaseUnits,
      product.pricingQuantity
    )
  );
}

export async function createProductPresentation(
  database: DatabaseAdapter,
  input: CreateProductPresentationInput
): Promise<ProductPresentationRecord> {
  if (!input.sku.trim() || !input.name.trim()) {
    throw new Error('La presentación requiere código y nombre.');
  }

  if (!Number.isInteger(input.quantityInBaseUnits) || input.quantityInBaseUnits <= 0) {
    throw new Error('La conversión debe ser una cantidad base entera mayor que cero.');
  }

  if (
    input.fixedPriceCents !== undefined &&
    input.fixedPriceCents !== null &&
    (!Number.isInteger(input.fixedPriceCents) || input.fixedPriceCents < 0)
  ) {
    throw new Error('El precio fijo debe expresarse en céntimos enteros no negativos.');
  }

  if (!input.actorUserId || !input.deviceId) {
    throw new Error('La presentación requiere usuario y dispositivo para auditoría.');
  }

  const presentationId = createId();
  const outboxId = createId();
  const timestamp = new Date().toISOString();
  const fixedPriceCents = input.fixedPriceCents ?? null;

  return database.transaction(async (transaction) => {
    const actor = await getActiveLocalUser(
      transaction,
      input.storeId,
      input.actorUserId
    );
    if (!actor || actor.role !== 'administrator') {
      throw new Error('Solo un administrador puede crear presentaciones.');
    }
    const product = await getProductById(transaction, input.storeId, input.productId);
    if (!product) {
      throw new Error('No se encontró el producto para crear la presentación.');
    }

    await transaction.run(
      `INSERT INTO product_presentations (
        id, store_id, product_id, sku, name, presentation_type,
        quantity_in_base_units, fixed_price_cents, is_active,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
      [
        presentationId,
        input.storeId,
        input.productId,
        input.sku.trim(),
        input.name.trim(),
        input.type,
        input.quantityInBaseUnits,
        fixedPriceCents,
        timestamp,
        timestamp,
      ]
    );

    await enqueueOperation(transaction, {
      id: outboxId,
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: presentationId,
      entityType: 'product_presentation',
      entityId: presentationId,
      operationType: 'product_presentation.created',
      payload: {
        id: presentationId,
        storeId: input.storeId,
        productId: input.productId,
        sku: input.sku.trim(),
        name: input.name.trim(),
        type: input.type,
        quantityInBaseUnits: input.quantityInBaseUnits,
        fixedPriceCents,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        createdAt: timestamp,
      },
      timestamp,
    });

    const presentation = await getProductPresentationById(
      transaction,
      input.storeId,
      presentationId
    );
    if (!presentation) {
      throw new Error('No se pudo recuperar la presentación creada.');
    }

    return presentation;
  });
}

export async function updateProductPresentation(
  database: DatabaseAdapter,
  input: UpdateProductPresentationInput
): Promise<ProductPresentationRecord> {
  if (!input.sku.trim() || !input.name.trim()) {
    throw new Error('La presentación requiere código y nombre.');
  }
  if (!Number.isSafeInteger(input.quantityInBaseUnits) || input.quantityInBaseUnits <= 0) {
    throw new Error('La conversión debe ser un entero positivo.');
  }
  if (
    input.fixedPriceCents !== undefined &&
    input.fixedPriceCents !== null &&
    (!Number.isSafeInteger(input.fixedPriceCents) || input.fixedPriceCents < 0)
  ) {
    throw new Error('El precio fijo debe usar céntimos enteros.');
  }
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    const actor = await getActiveLocalUser(
      transaction,
      input.storeId,
      input.actorUserId
    );
    if (!actor || actor.role !== 'administrator') {
      throw new Error('Solo un administrador puede editar presentaciones.');
    }
    const current = await getProductPresentationById(
      transaction,
      input.storeId,
      input.presentationId
    );
    if (!current || current.productId !== input.productId) {
      throw new Error('No se encontró la presentación.');
    }
    const updated = await transaction.run(
      `UPDATE product_presentations SET
        sku = ?,name = ?,presentation_type = ?,quantity_in_base_units = ?,
        fixed_price_cents = ?,is_active = ?,updated_at = ?,version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        input.sku.trim(),
        input.name.trim(),
        input.type,
        input.quantityInBaseUnits,
        input.fixedPriceCents ?? null,
        input.isActive ? 1 : 0,
        timestamp,
        input.presentationId,
        input.storeId,
        input.expectedVersion,
      ]
    );
    if (updated.changes !== 1) {
      throw new Error('La presentación cambió; vuelve a cargarla.');
    }
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: createId(),
      entityType: 'product_presentation',
      entityId: input.presentationId,
      operationType: 'product_presentation.updated',
      payload: {
        id: input.presentationId,
        storeId: input.storeId,
        productId: input.productId,
        sku: input.sku.trim(),
        name: input.name.trim(),
        type: input.type,
        quantityInBaseUnits: input.quantityInBaseUnits,
        fixedPriceCents: input.fixedPriceCents ?? null,
        isActive: input.isActive,
        expectedVersion: input.expectedVersion,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        updatedAt: timestamp,
      },
      timestamp,
    });
    const result = await getProductPresentationById(
      transaction,
      input.storeId,
      input.presentationId
    );
    if (!result) throw new Error('No se pudo recuperar la presentación.');
    return result;
  });
}

export async function recordPresentationInventoryMovement(
  database: DatabaseAdapter,
  input: RecordPresentationMovementInput
) {
  if (!Number.isInteger(input.presentationCountDelta) || input.presentationCountDelta === 0) {
    throw new Error('El movimiento debe usar un número entero de presentaciones.');
  }

  const presentation = await getProductPresentationById(
    database,
    input.storeId,
    input.presentationId
  );
  if (!presentation || !presentation.isActive) {
    throw new Error('No se encontró una presentación activa para el movimiento.');
  }

  return recordInventoryMovement(database, {
    storeId: input.storeId,
    productId: presentation.productId,
    type: input.presentationCountDelta < 0 ? 'sale' : 'purchase',
    quantityDelta:
      presentation.quantityInBaseUnits * input.presentationCountDelta,
    reason: input.reason,
    referenceId: input.referenceId,
    actorUserId: input.actorUserId,
    deviceId: input.deviceId,
  });
}
