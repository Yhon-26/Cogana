import type { DatabaseAdapter } from './contracts';

type Migration = {
  version: number;
  statements: string[];
};

export const DATABASE_VERSION = 19;

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
  {
    version: 3,
    statements: [
      `CREATE TABLE local_users (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('administrator', 'seller')),
        pin_hash TEXT,
        pin_salt TEXT,
        pin_algorithm TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, display_name),
        CHECK (
          (pin_hash IS NULL AND pin_salt IS NULL AND pin_algorithm IS NULL)
          OR
          (pin_hash IS NOT NULL AND pin_salt IS NOT NULL AND pin_algorithm IS NOT NULL)
        )
      )`,
      `CREATE TABLE cash_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        responsible_user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        opening_cash_cents INTEGER NOT NULL CHECK (opening_cash_cents >= 0),
        cash_sales_cents INTEGER CHECK (cash_sales_cents IS NULL OR cash_sales_cents >= 0),
        cash_income_cents INTEGER CHECK (cash_income_cents IS NULL OR cash_income_cents >= 0),
        cash_outflow_cents INTEGER CHECK (cash_outflow_cents IS NULL OR cash_outflow_cents >= 0),
        expected_cash_cents INTEGER CHECK (expected_cash_cents IS NULL OR expected_cash_cents >= 0),
        counted_cash_cents INTEGER CHECK (counted_cash_cents IS NULL OR counted_cash_cents >= 0),
        difference_cents INTEGER,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        closed_by_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (responsible_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (closed_by_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        CHECK (
          (status = 'open'
            AND closed_at IS NULL
            AND closed_by_user_id IS NULL
            AND counted_cash_cents IS NULL
            AND difference_cents IS NULL)
          OR
          (status = 'closed'
            AND closed_at IS NOT NULL
            AND closed_by_user_id IS NOT NULL
            AND cash_sales_cents IS NOT NULL
            AND cash_income_cents IS NOT NULL
            AND cash_outflow_cents IS NOT NULL
            AND expected_cash_cents IS NOT NULL
            AND counted_cash_cents IS NOT NULL
            AND difference_cents IS NOT NULL)
        )
      )`,
      `CREATE TABLE cash_movements (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        cash_session_id TEXT NOT NULL,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('income', 'outflow')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        reason TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (cash_session_id, store_id)
          REFERENCES cash_sessions (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `CREATE TABLE sales (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        cash_session_id TEXT NOT NULL,
        receipt_number TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed')),
        total_cents INTEGER NOT NULL CHECK (total_cents > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (store_id, receipt_number),
        UNIQUE (id, store_id),
        FOREIGN KEY (cash_session_id, store_id)
          REFERENCES cash_sessions (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `CREATE TABLE sale_items (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name_snapshot TEXT NOT NULL,
        base_unit_snapshot TEXT NOT NULL CHECK (base_unit_snapshot IN ('gram', 'unit')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        price_cents_snapshot INTEGER NOT NULL CHECK (price_cents_snapshot >= 0),
        pricing_quantity_snapshot INTEGER NOT NULL CHECK (pricing_quantity_snapshot > 0),
        cost_cents_snapshot INTEGER NOT NULL CHECK (cost_cents_snapshot >= 0),
        cost_pricing_quantity_snapshot INTEGER NOT NULL CHECK (
          cost_pricing_quantity_snapshot > 0
        ),
        line_total_cents INTEGER NOT NULL CHECK (line_total_cents > 0),
        presentation_id TEXT,
        presentation_name_snapshot TEXT,
        presentation_type_snapshot TEXT CHECK (
          presentation_type_snapshot IS NULL
          OR presentation_type_snapshot IN ('unit', 'package', 'box', 'sack')
        ),
        presentation_quantity_snapshot INTEGER CHECK (
          presentation_quantity_snapshot IS NULL
          OR presentation_quantity_snapshot > 0
        ),
        presentation_count INTEGER CHECK (
          presentation_count IS NULL
          OR presentation_count > 0
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (sale_id, store_id)
          REFERENCES sales (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (presentation_id, store_id)
          REFERENCES product_presentations (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        CHECK (
          (presentation_id IS NULL
            AND presentation_name_snapshot IS NULL
            AND presentation_type_snapshot IS NULL
            AND presentation_quantity_snapshot IS NULL
            AND presentation_count IS NULL)
          OR
          (presentation_id IS NOT NULL
            AND presentation_name_snapshot IS NOT NULL
            AND presentation_type_snapshot IS NOT NULL
            AND presentation_quantity_snapshot IS NOT NULL
            AND presentation_count IS NOT NULL)
        )
      )`,
      `CREATE TABLE payments (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        payment_method TEXT NOT NULL CHECK (
          payment_method IN ('cash', 'yape', 'plin', 'card')
        ),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        amount_received_cents INTEGER CHECK (
          amount_received_cents IS NULL OR amount_received_cents >= 0
        ),
        change_cents INTEGER NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
        reference TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (sale_id, store_id)
          REFERENCES sales (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        CHECK (
          (payment_method = 'cash'
            AND amount_received_cents IS NOT NULL
            AND amount_received_cents >= amount_cents
            AND change_cents = amount_received_cents - amount_cents)
          OR
          (payment_method != 'cash'
            AND amount_received_cents IS NULL
            AND change_cents = 0)
        )
      )`,
      `CREATE TABLE local_device_identity (
        singleton_key INTEGER PRIMARY KEY NOT NULL CHECK (singleton_key = 1),
        device_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
      )`,
      `CREATE TABLE local_receipt_sequences (
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        next_number INTEGER NOT NULL CHECK (next_number > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        PRIMARY KEY (store_id, device_id)
      )`,
      `CREATE UNIQUE INDEX idx_cash_sessions_one_open_device
        ON cash_sessions (store_id, device_id)
        WHERE status = 'open'`,
      `CREATE INDEX idx_local_users_store_active_name
        ON local_users (store_id, is_active, display_name)`,
      `CREATE INDEX idx_cash_sessions_store_device_status
        ON cash_sessions (store_id, device_id, status, opened_at DESC)`,
      `CREATE INDEX idx_cash_movements_session_date
        ON cash_movements (store_id, cash_session_id, created_at)`,
      `CREATE INDEX idx_sales_session_date
        ON sales (store_id, cash_session_id, created_at DESC)`,
      `CREATE INDEX idx_sales_store_receipt
        ON sales (store_id, receipt_number)`,
      `CREATE INDEX idx_sale_items_sale
        ON sale_items (store_id, sale_id)`,
      `CREATE INDEX idx_sale_items_product_date
        ON sale_items (store_id, product_id, created_at DESC)`,
`CREATE INDEX idx_payments_sale_method
        ON payments (store_id, sale_id, payment_method)`,
    ],
  },
  {
    version: 4,
    statements: [
      `ALTER TABLE sales ADD COLUMN voided_at TEXT`,
      `ALTER TABLE sales ADD COLUMN voided_by_user_id TEXT`,
      `ALTER TABLE sales ADD COLUMN void_reason TEXT`,
      `CREATE TABLE sale_status_history (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        from_status TEXT NOT NULL CHECK (from_status IN ('confirmed', 'voided')),
        to_status TEXT NOT NULL CHECK (to_status IN ('confirmed', 'voided')),
        reason TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (sale_id, store_id)
          REFERENCES sales (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `ALTER TABLE cash_movements ADD COLUMN sale_id TEXT`,
      `CREATE INDEX idx_sale_status_history_sale ON sale_status_history (store_id, sale_id, created_at DESC)`,
      `CREATE INDEX idx_cash_movements_sale ON cash_movements (store_id, sale_id)`,
      `CREATE INDEX idx_sales_voided_at ON sales (store_id, voided_at)`,
    ],
  },
  {
    version: 5,
    statements: [
      `ALTER TABLE sync_outbox ADD COLUMN next_attempt_at TEXT`,
      `ALTER TABLE sync_outbox ADD COLUMN error_code TEXT`,
      `ALTER TABLE sync_outbox ADD COLUMN is_terminal INTEGER NOT NULL DEFAULT 0
        CHECK (is_terminal IN (0, 1))`,
      `ALTER TABLE sync_outbox ADD COLUMN server_result_json TEXT`,
      `CREATE TABLE sync_inbox (
        sequence INTEGER NOT NULL,
        store_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        entity_version INTEGER NOT NULL CHECK (entity_version >= 1),
        payload_json TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        source_device_id TEXT,
        operation_id TEXT,
        received_at TEXT NOT NULL,
        PRIMARY KEY (store_id, sequence)
      )`,
      `CREATE TABLE local_sync_state (
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        last_pull_cursor INTEGER NOT NULL DEFAULT 0 CHECK (last_pull_cursor >= 0),
        last_push_at TEXT,
        last_pull_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
          CHECK (consecutive_failures >= 0),
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        PRIMARY KEY (store_id, device_id)
      )`,
      `CREATE INDEX idx_sync_outbox_due
        ON sync_outbox (store_id, status, is_terminal, next_attempt_at, created_at)`,
      `CREATE INDEX idx_sync_inbox_store_entity
        ON sync_inbox (store_id, entity_type, entity_id, sequence DESC)`,
    ],
  },
  {
    version: 6,
    statements: [
      `CREATE TABLE suppliers (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        tax_id TEXT,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_by_user_id TEXT NOT NULL,
        updated_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, tax_id)
      )`,
      `CREATE INDEX idx_suppliers_store_active_name
        ON suppliers (store_id, is_active, name COLLATE NOCASE)`,
    ],
  },
  {
    version: 7,
    statements: [
      `CREATE TABLE delivery_zones (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        district TEXT NOT NULL CHECK (length(trim(district)) > 0),
        fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
        minimum_order_cents INTEGER NOT NULL DEFAULT 0
          CHECK (minimum_order_cents >= 0),
        eta_min_minutes INTEGER NOT NULL CHECK (eta_min_minutes > 0),
        eta_max_minutes INTEGER NOT NULL CHECK (
          eta_max_minutes >= eta_min_minutes
        ),
        schedule_text TEXT NOT NULL CHECK (length(trim(schedule_text)) > 0),
        restrictions TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_by_user_id TEXT NOT NULL,
        updated_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, name)
      )`,
      `CREATE INDEX idx_delivery_zones_store_active_name
        ON delivery_zones (store_id, is_active, name COLLATE NOCASE)`,
    ],
  },
  {
    version: 8,
    statements: [
      'ALTER TABLE local_users ADD COLUMN auth_user_id TEXT',
      `CREATE UNIQUE INDEX idx_local_users_store_auth_user
        ON local_users (store_id, auth_user_id)
        WHERE auth_user_id IS NOT NULL`,
      'ALTER TABLE sync_outbox ADD COLUMN actor_user_id TEXT',
      `UPDATE sync_outbox
       SET actor_user_id = COALESCE(
         json_extract(payload_json, '$.actorUserId'),
         json_extract(payload_json, '$.responsibleUserId')
       )
       WHERE actor_user_id IS NULL`,
      `CREATE INDEX idx_sync_outbox_due_actor
        ON sync_outbox (
          store_id, actor_user_id, status, is_terminal, next_attempt_at, created_at
        )`,
    ],
  },
  {
    version: 9,
    statements: [
      `CREATE TABLE customers (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        auth_user_id TEXT,
        customer_type TEXT NOT NULL DEFAULT 'retail'
          CHECK (customer_type IN ('retail', 'restaurant')),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        phone TEXT NOT NULL CHECK (length(trim(phone)) > 0),
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, phone)
      )`,
      `CREATE TABLE customer_addresses (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        label TEXT NOT NULL CHECK (length(trim(label)) > 0),
        address TEXT NOT NULL CHECK (length(trim(address)) > 0),
        district TEXT NOT NULL CHECK (length(trim(district)) > 0),
        instructions TEXT,
        delivery_zone_id TEXT,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (customer_id, store_id)
          REFERENCES customers (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (delivery_zone_id, store_id)
          REFERENCES delivery_zones (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      )`,
      `CREATE TABLE orders (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        order_number TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('phone', 'whatsapp', 'online')),
        fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('pickup', 'delivery')),
        address_id TEXT,
        delivery_zone_id TEXT,
        status TEXT NOT NULL CHECK (
          status IN (
            'received', 'confirmed', 'preparing', 'weight_review', 'ready',
            'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled'
          )
        ),
        payment_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
        estimated_subtotal_cents INTEGER NOT NULL CHECK (estimated_subtotal_cents >= 0),
        delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
        estimated_total_cents INTEGER NOT NULL CHECK (
          estimated_total_cents = estimated_subtotal_cents + delivery_fee_cents
        ),
        final_subtotal_cents INTEGER CHECK (
          final_subtotal_cents IS NULL OR final_subtotal_cents >= 0
        ),
        final_total_cents INTEGER CHECK (
          final_total_cents IS NULL
          OR final_total_cents = final_subtotal_cents + delivery_fee_cents
        ),
        notes TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, operation_id),
        UNIQUE (store_id, order_number),
        FOREIGN KEY (customer_id, store_id)
          REFERENCES customers (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (address_id, store_id)
          REFERENCES customer_addresses (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (delivery_zone_id, store_id)
          REFERENCES delivery_zones (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        CHECK (
          (fulfillment_type = 'pickup'
            AND address_id IS NULL
            AND delivery_zone_id IS NULL
            AND delivery_fee_cents = 0)
          OR
          (fulfillment_type = 'delivery'
            AND address_id IS NOT NULL
            AND delivery_zone_id IS NOT NULL)
        ),
        CHECK (
          (final_subtotal_cents IS NULL AND final_total_cents IS NULL)
          OR
          (final_subtotal_cents IS NOT NULL AND final_total_cents IS NOT NULL)
        )
      )`,
      `CREATE TABLE order_items (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name_snapshot TEXT NOT NULL,
        base_unit_snapshot TEXT NOT NULL CHECK (base_unit_snapshot IN ('gram', 'unit')),
        requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
        prepared_quantity INTEGER CHECK (
          prepared_quantity IS NULL OR prepared_quantity >= 0
        ),
        price_cents_snapshot INTEGER NOT NULL CHECK (price_cents_snapshot >= 0),
        pricing_quantity_snapshot INTEGER NOT NULL CHECK (pricing_quantity_snapshot > 0),
        estimated_cents INTEGER NOT NULL CHECK (estimated_cents >= 0),
        final_cents INTEGER CHECK (final_cents IS NULL OR final_cents >= 0),
        substitution_policy TEXT NOT NULL DEFAULT 'contact'
          CHECK (substitution_policy IN ('allow', 'contact', 'remove')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (order_id, store_id)
          REFERENCES orders (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        CHECK (
          (prepared_quantity IS NULL AND final_cents IS NULL)
          OR
          (prepared_quantity IS NOT NULL AND final_cents IS NOT NULL)
        )
      )`,
      `CREATE TABLE order_status_history (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL CHECK (
          to_status IN (
            'received', 'confirmed', 'preparing', 'weight_review', 'ready',
            'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled'
          )
        ),
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, operation_id),
        FOREIGN KEY (order_id, store_id)
          REFERENCES orders (id, store_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT,
        CHECK (
          from_status IS NULL
          OR from_status IN (
            'received', 'confirmed', 'preparing', 'weight_review', 'ready',
            'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled'
          )
        )
      )`,
      `CREATE TABLE local_order_sequences (
        store_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        next_number INTEGER NOT NULL CHECK (next_number > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        PRIMARY KEY (store_id, device_id)
      )`,
      `CREATE INDEX idx_customers_store_name
        ON customers (store_id, status, name COLLATE NOCASE)`,
      `CREATE INDEX idx_customer_addresses_customer
        ON customer_addresses (store_id, customer_id, is_default DESC)`,
      `CREATE UNIQUE INDEX idx_customer_addresses_one_default
        ON customer_addresses (store_id, customer_id)
        WHERE is_default = 1`,
      `CREATE INDEX idx_orders_store_status_date
        ON orders (store_id, status, created_at DESC)`,
      `CREATE INDEX idx_orders_customer_date
        ON orders (store_id, customer_id, created_at DESC)`,
      `CREATE INDEX idx_order_items_order
        ON order_items (store_id, order_id)`,
      `CREATE INDEX idx_order_status_history_order
        ON order_status_history (store_id, order_id, created_at, id)`,
    ],
  },
  {
    version: 10,
    statements: [
      'ALTER TABLE orders ADD COLUMN scheduled_for TEXT',
      'ALTER TABLE orders ADD COLUMN assigned_user_id TEXT',
      `CREATE TABLE order_incidents (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        incident_type TEXT NOT NULL CHECK (
          incident_type IN ('missing_item', 'address', 'payment', 'quality', 'delivery', 'other')
        ),
        description TEXT NOT NULL CHECK (length(trim(description)) > 0),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        resolution TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE TABLE order_substitutions (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        order_item_id TEXT NOT NULL,
        replacement_product_id TEXT NOT NULL,
        replacement_product_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed'
          CHECK (status IN ('proposed', 'accepted', 'rejected')),
        notes TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (order_item_id, store_id) REFERENCES order_items(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (replacement_product_id, store_id) REFERENCES products(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_order_incidents_order ON order_incidents(store_id, order_id, status, created_at)',
      'CREATE INDEX idx_order_substitutions_order ON order_substitutions(store_id, order_id, status, created_at)',
      'CREATE INDEX idx_orders_schedule ON orders(store_id, scheduled_for, status)',
      'CREATE INDEX idx_orders_assignee ON orders(store_id, assigned_user_id, status)',
    ],
  },
  {
    version: 11,
    statements: [
      `CREATE TABLE delivery_assignments (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        driver_user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'assigned'
          CHECK (status IN ('assigned', 'en_route', 'delivered', 'failed', 'cancelled')),
        recipient_name TEXT,
        confirmation_code TEXT,
        evidence_uri TEXT,
        notes TEXT,
        assigned_by_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        started_at TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, order_id),
        FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (driver_user_id, store_id) REFERENCES local_users(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (assigned_by_user_id, store_id) REFERENCES local_users(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE TABLE delivery_events (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('assigned', 'started', 'confirmed', 'failed', 'cancelled')
        ),
        notes TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (assignment_id, store_id)
          REFERENCES delivery_assignments(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_delivery_assignments_driver ON delivery_assignments(store_id, driver_user_id, status, created_at)',
      'CREATE INDEX idx_delivery_assignments_status ON delivery_assignments(store_id, status, created_at)',
      'CREATE INDEX idx_delivery_events_assignment ON delivery_events(store_id, assignment_id, created_at)',
    ],
  },
  {
    version: 12,
    statements: [
      `CREATE TABLE purchase_orders (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        order_number TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('ordered','partially_received','received','cancelled')
        ),
        expected_at TEXT,
        notes TEXT,
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        received_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, order_number),
        FOREIGN KEY (supplier_id, store_id) REFERENCES suppliers(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id, store_id) REFERENCES local_users(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE TABLE purchase_order_items (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        purchase_order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name_snapshot TEXT NOT NULL,
        ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
        received_quantity INTEGER NOT NULL DEFAULT 0
          CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
        unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
        pricing_quantity INTEGER NOT NULL CHECK (pricing_quantity > 0),
        line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (purchase_order_id, store_id)
          REFERENCES purchase_orders(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE TABLE inventory_lots (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        purchase_order_id TEXT NOT NULL,
        purchase_order_item_id TEXT NOT NULL,
        lot_code TEXT NOT NULL,
        expires_at TEXT,
        received_quantity INTEGER NOT NULL CHECK (received_quantity > 0),
        remaining_quantity INTEGER NOT NULL CHECK (
          remaining_quantity >= 0 AND remaining_quantity <= received_quantity
        ),
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, product_id, lot_code),
        FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (supplier_id, store_id) REFERENCES suppliers(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (purchase_order_id, store_id)
          REFERENCES purchase_orders(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (purchase_order_item_id, store_id)
          REFERENCES purchase_order_items(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE TABLE physical_counts (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        count_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
        notes TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, count_number),
        FOREIGN KEY (actor_user_id, store_id) REFERENCES local_users(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE TABLE physical_count_items (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        physical_count_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name_snapshot TEXT NOT NULL,
        expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
        counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
        difference_quantity INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        FOREIGN KEY (physical_count_id, store_id)
          REFERENCES physical_counts(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (product_id, store_id) REFERENCES products(id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_purchase_orders_status ON purchase_orders(store_id,status,created_at DESC)',
      'CREATE INDEX idx_purchase_order_items_order ON purchase_order_items(store_id,purchase_order_id)',
      'CREATE INDEX idx_inventory_lots_expiry ON inventory_lots(store_id,expires_at,remaining_quantity)',
      'CREATE INDEX idx_physical_counts_date ON physical_counts(store_id,created_at DESC)',
    ],
  },
  {
    version: 13,
    statements: [
      `CREATE TABLE sale_returns (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        sale_id TEXT NOT NULL,
        cash_session_id TEXT,
        refund_method TEXT NOT NULL
          CHECK (refund_method IN ('cash','yape','plin','card')),
        total_cents INTEGER NOT NULL CHECK (total_cents > 0),
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id,store_id),
        FOREIGN KEY (sale_id,store_id) REFERENCES sales(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (cash_session_id,store_id) REFERENCES cash_sessions(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id,store_id) REFERENCES local_users(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        CHECK (
          (refund_method = 'cash' AND cash_session_id IS NOT NULL)
          OR (refund_method <> 'cash' AND cash_session_id IS NULL)
        )
      )`,
      `CREATE TABLE sale_return_items (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        sale_return_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        refund_cents INTEGER NOT NULL CHECK (refund_cents > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id,store_id),
        FOREIGN KEY (sale_return_id,store_id) REFERENCES sale_returns(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (sale_item_id,store_id) REFERENCES sale_items(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (product_id,store_id) REFERENCES products(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_sale_returns_sale ON sale_returns(store_id,sale_id,created_at DESC)',
      'CREATE INDEX idx_sale_return_items_item ON sale_return_items(store_id,sale_item_id)',
    ],
  },
  {
    version: 14,
    statements: [
      `CREATE TABLE role_permissions (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('administrator','seller')),
        module TEXT NOT NULL CHECK (length(trim(module)) > 0),
        can_view INTEGER NOT NULL DEFAULT 1 CHECK (can_view IN (0,1)),
        can_manage INTEGER NOT NULL DEFAULT 0 CHECK (can_manage IN (0,1)),
        updated_by_user_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id,store_id),
        UNIQUE (store_id,role,module),
        FOREIGN KEY (updated_by_user_id,store_id) REFERENCES local_users(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        CHECK (can_manage = 0 OR can_view = 1)
      )`,
      `CREATE TABLE work_shifts (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled','completed','cancelled')),
        notes TEXT,
        created_by_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id,store_id),
        FOREIGN KEY (user_id,store_id) REFERENCES local_users(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (created_by_user_id,store_id) REFERENCES local_users(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        CHECK (ends_at > starts_at)
      )`,
      `CREATE TABLE attendance_entries (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        work_shift_id TEXT,
        checked_in_at TEXT NOT NULL,
        checked_out_at TEXT,
        notes TEXT,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id,store_id),
        FOREIGN KEY (user_id,store_id) REFERENCES local_users(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (work_shift_id,store_id) REFERENCES work_shifts(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at)
      )`,
      'CREATE UNIQUE INDEX idx_attendance_open_user ON attendance_entries(store_id,user_id) WHERE checked_out_at IS NULL',
      'CREATE INDEX idx_work_shifts_user_date ON work_shifts(store_id,user_id,starts_at)',
      'CREATE INDEX idx_attendance_user_date ON attendance_entries(store_id,user_id,checked_in_at DESC)',
    ],
  },
  {
    version: 15,
    statements: [
      `CREATE TABLE cash_difference_reviews (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        cash_session_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approved','requires_action')),
        justification TEXT NOT NULL CHECK (length(trim(justification)) > 0),
        reviewed_by_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id,store_id),
        UNIQUE (store_id,cash_session_id),
        FOREIGN KEY (cash_session_id,store_id) REFERENCES cash_sessions(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (reviewed_by_user_id,store_id) REFERENCES local_users(id,store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_cash_difference_reviews_date ON cash_difference_reviews(store_id,reviewed_at DESC)',
    ],
  },
  {
    version: 16,
    statements: [
      `CREATE TABLE app_preferences (
        store_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        density TEXT NOT NULL DEFAULT 'comfortable'
          CHECK (density IN ('comfortable','compact')),
        reduce_motion INTEGER NOT NULL DEFAULT 0 CHECK (reduce_motion IN (0,1)),
        haptics_enabled INTEGER NOT NULL DEFAULT 1 CHECK (haptics_enabled IN (0,1)),
        locale TEXT NOT NULL DEFAULT 'es-PE' CHECK (locale IN ('es-PE')),
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        PRIMARY KEY (store_id,user_id),
        FOREIGN KEY (user_id,store_id) REFERENCES local_users(id,store_id)
          ON UPDATE CASCADE ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 17,
    statements: [
      `ALTER TABLE local_users ADD COLUMN failed_pin_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (failed_pin_attempts >= 0)`,
      'ALTER TABLE local_users ADD COLUMN pin_locked_until TEXT',
      'ALTER TABLE local_users ADD COLUMN last_failed_pin_at TEXT',
      `CREATE INDEX idx_local_users_pin_lock
        ON local_users (store_id, pin_locked_until)
        WHERE pin_locked_until IS NOT NULL`,
    ],
  },
  {
    version: 18,
    statements: [
      `CREATE TABLE order_inventory_reservations (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        order_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        reserved_quantity INTEGER NOT NULL CHECK (reserved_quantity > 0),
        consumed_quantity INTEGER NOT NULL DEFAULT 0
          CHECK (consumed_quantity >= 0),
        status TEXT NOT NULL DEFAULT 'reserved'
          CHECK (status IN ('reserved', 'consumed', 'released')),
        consumed_at TEXT,
        released_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, order_item_id),
        FOREIGN KEY (order_id, store_id)
          REFERENCES orders (id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (order_item_id, store_id)
          REFERENCES order_items (id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (product_id, store_id)
          REFERENCES products (id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        CHECK (
          (status = 'reserved' AND consumed_at IS NULL AND released_at IS NULL)
          OR (status = 'consumed' AND consumed_at IS NOT NULL AND released_at IS NULL)
          OR (status = 'released' AND consumed_at IS NULL AND released_at IS NOT NULL)
        )
      )`,
      `CREATE INDEX idx_order_inventory_reservations_product
        ON order_inventory_reservations (store_id, product_id, status)`,
      `CREATE INDEX idx_order_inventory_reservations_order
        ON order_inventory_reservations (store_id, order_id, status)`,
      `INSERT INTO order_inventory_reservations (
        id, store_id, order_id, order_item_id, product_id,
        reserved_quantity, consumed_quantity, status,
        consumed_at, released_at, created_at, updated_at, version
      )
      SELECT
        order_items.id, order_items.store_id, order_items.order_id,
        order_items.id, order_items.product_id, order_items.requested_quantity,
        0, 'reserved', NULL, NULL, order_items.created_at, order_items.updated_at, 1
      FROM order_items
      JOIN orders
        ON orders.id = order_items.order_id
       AND orders.store_id = order_items.store_id
      WHERE orders.status IN ('received', 'confirmed', 'preparing')
        AND order_items.prepared_quantity IS NULL`,
      `ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'yape', 'plin', 'card'))`,
      'ALTER TABLE orders ADD COLUMN payment_reference TEXT',
      'ALTER TABLE orders ADD COLUMN payment_verified_at TEXT',
      'ALTER TABLE orders ADD COLUMN payment_verified_by_user_id TEXT',
      `CREATE TABLE order_payment_history (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        from_status TEXT NOT NULL
          CHECK (from_status IN ('pending', 'paid', 'failed', 'refunded')),
        to_status TEXT NOT NULL
          CHECK (to_status IN ('pending', 'paid', 'failed', 'refunded')),
        payment_method TEXT NOT NULL
          CHECK (payment_method IN ('cash', 'yape', 'plin', 'card')),
        payment_reference TEXT,
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, operation_id),
        FOREIGN KEY (order_id, store_id)
          REFERENCES orders (id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE INDEX idx_order_payment_history_order
        ON order_payment_history (store_id, order_id, created_at DESC)`,
    ],
  },
  {
    version: 19,
    statements: [
      `CREATE TABLE delivery_evidence_uploads (
        id TEXT PRIMARY KEY NOT NULL,
        store_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        local_uri TEXT NOT NULL CHECK (length(trim(local_uri)) > 0),
        storage_path TEXT NOT NULL CHECK (length(trim(storage_path)) > 0),
        content_type TEXT NOT NULL DEFAULT 'image/jpeg',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'uploading', 'uploaded', 'error')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error TEXT,
        actor_user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        uploaded_at TEXT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        UNIQUE (id, store_id),
        UNIQUE (store_id, assignment_id),
        UNIQUE (store_id, storage_path),
        FOREIGN KEY (assignment_id, store_id)
          REFERENCES delivery_assignments (id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id, store_id)
          REFERENCES local_users (id, store_id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE INDEX idx_delivery_evidence_uploads_due
        ON delivery_evidence_uploads (store_id, actor_user_id, status, created_at)`,
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
