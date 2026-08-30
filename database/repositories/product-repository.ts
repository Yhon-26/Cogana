import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type { ProductBaseUnit, ProductRecord } from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { enqueueOperation } from './sync-outbox-repository';

type ProductFieldsInput = {
  sku: string;
  name: string;
  category: string;
  baseUnit: ProductBaseUnit;
  pricingQuantity: number;
  priceCents: number;
  costCents: number;
  minimumStockQuantity: number;
};

export type CreateProductInput = ProductFieldsInput & {
  storeId: string;
  initialStockQuantity: number;
  actorUserId: string;
  deviceId: string;
};

export type UpdateProductInput = ProductFieldsInput & {
  storeId: string;
  productId: string;
  expectedVersion: number;
  isActive: boolean;
  actorUserId: string;
  deviceId: string;
};

export type ProductRow = {
  id: string;
  store_id: string;
  sku: string;
  name: string;
  category: string;
  base_unit: ProductBaseUnit;
  pricing_quantity: number;
  price_cents: number;
  cost_cents: number;
  stock_quantity: number;
  minimum_stock_quantity: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  version: number;
};

export function mapProductRow(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    baseUnit: row.base_unit,
    pricingQuantity: row.pricing_quantity,
    priceCents: row.price_cents,
    costCents: row.cost_cents,
    stockQuantity: row.stock_quantity,
    minimumStockQuantity: row.minimum_stock_quantity,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function normalizeProductFields(input: ProductFieldsInput) {
  const sku = input.sku.trim().toLocaleUpperCase('es-PE');
  const name = input.name.trim().replace(/\s+/g, ' ');
  const category = input.category.trim().replace(/\s+/g, ' ');
  if (!sku || !name || !category) {
    throw new Error('Código, nombre y categoría son obligatorios.');
  }
  if (sku.length > 50 || name.length > 160 || category.length > 100) {
    throw new Error('Los datos del producto superan la longitud permitida.');
  }
  const integers = [
    input.pricingQuantity,
    input.priceCents,
    input.costCents,
    input.minimumStockQuantity,
  ];
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Cantidades y montos deben ser enteros no negativos.');
  }
  if (input.pricingQuantity < 1) {
    throw new Error('La cantidad de precio debe ser mayor que cero.');
  }
  if (!['gram', 'unit'].includes(input.baseUnit)) {
    throw new Error('La unidad base del producto no es válida.');
  }
  return { ...input, sku, name, category };
}

async function requireAdministrator(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  deviceId: string
) {
  if (!deviceId) throw new Error('La operación requiere un dispositivo identificado.');
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!actor || actor.role !== 'administrator') {
    throw new Error('Solo un administrador puede modificar productos.');
  }
}

async function assertSkuAvailable(
  database: DatabaseAdapter,
  storeId: string,
  sku: string,
  exceptProductId = ''
) {
  const duplicate = await database.getFirst<{ id: string }>(
    `SELECT id FROM products
     WHERE store_id = ? AND sku = ? COLLATE NOCASE AND id <> ?
     LIMIT 1`,
    [storeId, sku, exceptProductId]
  );
  if (duplicate) throw new Error('Ya existe un producto con ese código.');
}

function productPayload(
  product: ProductRecord,
  actorUserId: string,
  deviceId: string,
  expectedVersion: number | null,
  openingMovementId: string | null
) {
  return {
    id: product.id,
    storeId: product.storeId,
    sku: product.sku,
    name: product.name,
    category: product.category,
    baseUnit: product.baseUnit,
    pricingQuantity: product.pricingQuantity,
    priceCents: product.priceCents,
    costCents: product.costCents,
    initialStockQuantity: openingMovementId ? product.stockQuantity : 0,
    minimumStockQuantity: product.minimumStockQuantity,
    isActive: product.isActive,
    expectedVersion,
    openingMovementId,
    actorUserId,
    deviceId,
    updatedAt: product.updatedAt,
  };
}

export async function listProducts(
  database: DatabaseAdapter,
  storeId: string
): Promise<ProductRecord[]> {
  const rows = await database.getAll<ProductRow>(
    `SELECT *
     FROM products
     WHERE store_id = ? AND is_active = 1
     ORDER BY name COLLATE NOCASE`,
    [storeId]
  );

  return rows.map(mapProductRow);
}

export async function getProductById(
  database: DatabaseAdapter,
  storeId: string,
  productId: string
): Promise<ProductRecord | null> {
  const row = await database.getFirst<ProductRow>(
    'SELECT * FROM products WHERE id = ? AND store_id = ?',
    [productId, storeId]
  );

  return row ? mapProductRow(row) : null;
}

export async function createProduct(
  database: DatabaseAdapter,
  input: CreateProductInput
): Promise<ProductRecord> {
  const fields = normalizeProductFields(input);
  if (
    !Number.isSafeInteger(input.initialStockQuantity) ||
    input.initialStockQuantity < 0
  ) {
    throw new Error('El stock inicial debe ser un entero no negativo.');
  }
  const productId = createId();
  const openingMovementId = input.initialStockQuantity > 0 ? createId() : null;
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    await requireAdministrator(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    await assertSkuAvailable(transaction, input.storeId, fields.sku);
    await transaction.run(
      `INSERT INTO products (
        id, store_id, sku, name, category, base_unit, pricing_quantity,
        price_cents, cost_cents, stock_quantity, minimum_stock_quantity,
        is_active, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        productId,
        input.storeId,
        fields.sku,
        fields.name,
        fields.category,
        fields.baseUnit,
        fields.pricingQuantity,
        fields.priceCents,
        fields.costCents,
        input.initialStockQuantity,
        fields.minimumStockQuantity,
        timestamp,
        timestamp,
        openingMovementId ? 2 : 1,
      ]
    );
    if (openingMovementId) {
      await transaction.run(
        `INSERT INTO inventory_movements (
          id, store_id, product_id, movement_type, quantity_delta, reason,
          reference_id, actor_user_id, device_id, created_at, updated_at, version
        ) VALUES (?, ?, ?, 'opening', ?, 'Stock inicial', NULL, ?, ?, ?, ?, 1)`,
        [
          openingMovementId,
          input.storeId,
          productId,
          input.initialStockQuantity,
          input.actorUserId,
          input.deviceId,
          timestamp,
          timestamp,
        ]
      );
    }
    const product = await getProductById(transaction, input.storeId, productId);
    if (!product) throw new Error('No se pudo recuperar el producto creado.');
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: productId,
      entityType: 'product',
      entityId: productId,
      operationType: 'product.created',
      payload: productPayload(
        product,
        input.actorUserId,
        input.deviceId,
        null,
        openingMovementId
      ),
      timestamp,
    });
    return product;
  });
}

export async function updateProduct(
  database: DatabaseAdapter,
  input: UpdateProductInput
): Promise<ProductRecord> {
  const fields = normalizeProductFields(input);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error('La versión esperada del producto no es válida.');
  }
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireAdministrator(
      transaction,
      input.storeId,
      input.actorUserId,
      input.deviceId
    );
    await assertSkuAvailable(
      transaction,
      input.storeId,
      fields.sku,
      input.productId
    );
    const current = await getProductById(
      transaction,
      input.storeId,
      input.productId
    );
    if (!current) throw new Error('No se encontró el producto.');
    if (current.version !== input.expectedVersion) {
      throw new Error('El producto cambió. Recarga antes de volver a editar.');
    }
    if (
      current.baseUnit !== fields.baseUnit &&
      (current.stockQuantity !== 0 || current.minimumStockQuantity !== 0)
    ) {
      throw new Error('Solo puedes cambiar la unidad base cuando el stock es cero.');
    }
    const result = await transaction.run(
      `UPDATE products SET
        sku = ?, name = ?, category = ?, base_unit = ?, pricing_quantity = ?,
        price_cents = ?, cost_cents = ?, minimum_stock_quantity = ?,
        is_active = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND version = ?`,
      [
        fields.sku,
        fields.name,
        fields.category,
        fields.baseUnit,
        fields.pricingQuantity,
        fields.priceCents,
        fields.costCents,
        fields.minimumStockQuantity,
        input.isActive ? 1 : 0,
        timestamp,
        input.productId,
        input.storeId,
        input.expectedVersion,
      ]
    );
    if (result.changes !== 1) {
      throw new Error('El producto cambió. Recarga antes de volver a editar.');
    }
    const product = await getProductById(
      transaction,
      input.storeId,
      input.productId
    );
    if (!product) throw new Error('No se pudo recuperar el producto actualizado.');
    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'product',
      entityId: product.id,
      operationType: 'product.updated',
      payload: productPayload(
        product,
        input.actorUserId,
        input.deviceId,
        input.expectedVersion,
        null
      ),
      timestamp,
    });
    return product;
  });
}
