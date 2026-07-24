import type { DatabaseAdapter } from './contracts';

type Migration = {
  version: number;
  statements: string[];
};

export const DATABASE_VERSION = 2;

const migrations: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        stock_grams INTEGER NOT NULL CHECK (stock_grams >= 0),
        minimum_stock_grams INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock_grams >= 0),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (store_id, sku),
        UNIQUE (id, store_id)
      )`,
      `CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        movement_type TEXT NOT NULL CHECK (
          movement_type IN ('opening', 'purchase', 'sale', 'adjustment', 'waste', 'return')
        ),
        quantity_delta_grams INTEGER NOT NULL CHECK (quantity_delta_grams != 0),
        reason TEXT NOT NULL,
        reference_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS price_history (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        previous_price_cents INTEGER NOT NULL CHECK (previous_price_cents >= 0),
        new_price_cents INTEGER NOT NULL CHECK (new_price_cents >= 0),
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (
          status IN ('pending', 'syncing', 'synced', 'error')
        ),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (store_id, operation_id)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_products_store_active_name ON products (store_id, is_active, name)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_date ON inventory_movements (product_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_price_history_product_date ON price_history (product_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_date ON sync_outbox (status, created_at)',
    ],
  },
  {
    version: 2,
    statements: [
      'ALTER TABLE inventory_movements RENAME TO inventory_movements_v1',
      'ALTER TABLE price_history RENAME TO price_history_v1',
      'ALTER TABLE products RENAME TO products_v1',
      `CREATE TABLE products (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        base_unit TEXT NOT NULL CHECK (base_unit IN ('gram', 'unit')),
        pricing_quantity INTEGER NOT NULL CHECK (pricing_quantity > 0),
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
        stock_quantity INTEGER NOT NULL CHECK (stock_quantity >= 0),
        minimum_stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock_quantity >= 0),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (store_id, sku),
        UNIQUE (id, store_id)
      )`,
      `CREATE TABLE inventory_movements (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        movement_type TEXT NOT NULL CHECK (
          movement_type IN ('opening', 'purchase', 'sale', 'adjustment', 'waste', 'return')
        ),
        quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
        reason TEXT NOT NULL,
        reference_id TEXT,
        actor_user_id TEXT,
        device_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `CREATE TABLE price_history (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        previous_price_cents INTEGER NOT NULL CHECK (previous_price_cents >= 0),
        new_price_cents INTEGER NOT NULL CHECK (new_price_cents >= 0),
        reason TEXT NOT NULL,
        actor_user_id TEXT,
        device_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `CREATE TABLE product_presentations (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        presentation_type TEXT NOT NULL CHECK (
          presentation_type IN ('unit', 'package', 'box', 'sack')
        ),
        quantity_in_base_units INTEGER NOT NULL CHECK (quantity_in_base_units > 0),
        fixed_price_cents INTEGER CHECK (
          fixed_price_cents IS NULL OR fixed_price_cents >= 0
        ),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (store_id, sku),
        UNIQUE (id, store_id),
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `INSERT INTO products (
        id, store_id, sku, name, category, base_unit, pricing_quantity,
        price_cents, cost_cents, stock_quantity, minimum_stock_quantity,
        is_active, created_at, updated_at, version
      )
      SELECT
        id,
        store_id,
        sku,
        name,
        category,
        CASE WHEN unit IN ('kg', 'gram') THEN 'gram' ELSE 'unit' END,
        CASE WHEN unit IN ('kg', 'gram') THEN 1000 ELSE 1 END,
        price_cents,
        0,
        stock_grams,
        minimum_stock_grams,
        is_active,
        created_at,
        updated_at,
        version
      FROM products_v1`,
      `INSERT INTO inventory_movements (
        id, store_id, product_id, movement_type, quantity_delta,
        reason, reference_id, actor_user_id, device_id,
        created_at, updated_at, version
      )
      SELECT
        id, store_id, product_id, movement_type, quantity_delta_grams,
        reason, reference_id, NULL, NULL, created_at, updated_at, version
      FROM inventory_movements_v1`,
      `INSERT INTO price_history (
        id, store_id, product_id, previous_price_cents, new_price_cents,
        reason, actor_user_id, device_id, created_at, updated_at, version
      )
      SELECT
        id, store_id, product_id, previous_price_cents, new_price_cents,
        reason, NULL, NULL, created_at, updated_at, version
      FROM price_history_v1`,
      'DROP TABLE inventory_movements_v1',
      'DROP TABLE price_history_v1',
      'DROP TABLE products_v1',
      'CREATE INDEX idx_products_store_unit_active_name ON products (store_id, base_unit, is_active, name)',
      'CREATE INDEX idx_inventory_movements_store_product_date ON inventory_movements (store_id, product_id, created_at DESC)',
      'CREATE INDEX idx_inventory_movements_store_date ON inventory_movements (store_id, created_at DESC)',
      'CREATE INDEX idx_price_history_store_product_date ON price_history (store_id, product_id, created_at DESC)',
      'CREATE INDEX idx_product_presentations_product_active ON product_presentations (store_id, product_id, is_active)',
      'CREATE INDEX idx_sync_outbox_store_status_date ON sync_outbox (store_id, status, created_at)',
    ],
  },
];

type UserVersionRow = {
  user_version: number;
};

async function configureDatabase(database: DatabaseAdapter) {
  await database.exec('PRAGMA foreign_keys = ON');

  try {
    await database.exec('PRAGMA journal_mode = WAL');
  } catch {
    // Some runtimes (notably early web support) do not expose WAL.
  }
}

export async function migrateDatabase(
  database: DatabaseAdapter,
  targetVersion = DATABASE_VERSION
) {
  await configureDatabase(database);

  const result = await database.getFirst<UserVersionRow>('PRAGMA user_version');
  let currentVersion = result?.user_version ?? 0;

  if (targetVersion < 0 || targetVersion > DATABASE_VERSION) {
    throw new Error(`La versión de destino ${targetVersion} no es válida.`);
  }

  if (currentVersion > targetVersion) {
    throw new Error(
      `La base local usa la versión ${currentVersion}, pero el destino solicitado es ${targetVersion}.`
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion || migration.version > targetVersion) continue;

    await database.transaction(async (transaction) => {
      for (const statement of migration.statements) {
        await transaction.exec(statement);
      }
      await transaction.exec(`PRAGMA user_version = ${migration.version}`);
    });

    currentVersion = migration.version;
  }
}
