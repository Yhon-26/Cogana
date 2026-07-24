import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DATABASE_VERSION, migrateDatabase } from '../database/migrations';
import { getProductById } from '../database/repositories/product-repository';
import { DEFAULT_STORE_ID } from '../database/seed';
import { NodeSQLiteAdapter } from './helpers/node-sqlite-adapter';

const PRODUCT_ID = '90000000-0000-4000-8000-000000000001';
const MOVEMENT_ID = '90000000-0000-4000-8000-000000000002';
const HISTORY_ID = '90000000-0000-4000-8000-000000000003';
const TIMESTAMP = '2026-07-22T12:00:00.000Z';

test('migra v1 a v2 sin borrar la base y conserva cantidades de productos por kg', async (context) => {
  const database = new NodeSQLiteAdapter();
  context.after(() => database.close());

  await migrateDatabase(database, 1);
  await database.run(
    `INSERT INTO products (
      id, store_id, sku, name, category, unit, price_cents,
      stock_grams, minimum_stock_grams, is_active, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 3)`,
    [
      PRODUCT_ID,
      DEFAULT_STORE_ID,
      'V1-001',
      'Producto legado por kg',
      'Prueba',
      'kg',
      850,
      34600,
      8000,
      TIMESTAMP,
      TIMESTAMP,
    ]
  );
  await database.run(
    `INSERT INTO inventory_movements (
      id, store_id, product_id, movement_type, quantity_delta_grams,
      reason, reference_id, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'purchase', 1200, 'Carga v1', NULL, ?, ?, 1)`,
    [MOVEMENT_ID, DEFAULT_STORE_ID, PRODUCT_ID, TIMESTAMP, TIMESTAMP]
  );
  await database.run(
    `INSERT INTO price_history (
      id, store_id, product_id, previous_price_cents, new_price_cents,
      reason, created_at, updated_at, version
    ) VALUES (?, ?, ?, 800, 850, 'Cambio v1', ?, ?, 1)`,
    [HISTORY_ID, DEFAULT_STORE_ID, PRODUCT_ID, TIMESTAMP, TIMESTAMP]
  );

  await migrateDatabase(database);

  const version = await database.getFirst<{ user_version: number }>('PRAGMA user_version');
  assert.equal(version?.user_version, DATABASE_VERSION);

  const product = await getProductById(database, DEFAULT_STORE_ID, PRODUCT_ID);
  assert.ok(product);
  assert.equal(product.baseUnit, 'gram');
  assert.equal(product.pricingQuantity, 1000);
  assert.equal(product.costCents, 0);
  assert.equal(product.stockQuantity, 34600);
  assert.equal(product.minimumStockQuantity, 8000);
  assert.equal(product.version, 3);

  const movement = await database.getFirst<{
    quantity_delta: number;
    actor_user_id: string | null;
    device_id: string | null;
  }>('SELECT quantity_delta, actor_user_id, device_id FROM inventory_movements WHERE id = ?', [
    MOVEMENT_ID,
  ]);
  assert.equal(movement?.quantity_delta, 1200);
  assert.equal(movement?.actor_user_id, null);
  assert.equal(movement?.device_id, null);

  const history = await database.getFirst<{
    actor_user_id: string | null;
    device_id: string | null;
  }>('SELECT actor_user_id, device_id FROM price_history WHERE id = ?', [HISTORY_ID]);
  assert.equal(history?.actor_user_id, null);
  assert.equal(history?.device_id, null);

  const productColumns = await database.getAll<{ name: string }>('PRAGMA table_info(products)');
  assert.ok(productColumns.some((column) => column.name === 'stock_quantity'));
  assert.ok(!productColumns.some((column) => column.name === 'stock_grams'));
});
