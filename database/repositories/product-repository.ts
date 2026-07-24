import type { DatabaseAdapter } from '../contracts';
import type { ProductBaseUnit, ProductRecord } from '../models';

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
