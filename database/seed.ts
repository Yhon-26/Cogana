import type { DatabaseAdapter } from './contracts';

export const DEFAULT_STORE_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000101';
export const DEMO_HUSBAND_USER_ID = '00000000-0000-4000-8000-000000000102';
export const DEMO_WIFE_USER_ID = '00000000-0000-4000-8000-000000000103';
export const DEMO_DEVICE_ID = '00000000-0000-4000-8000-000000000201';

type DemoProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: 'gram' | 'unit';
  pricingQuantity: number;
  priceCents: number;
  costCents: number;
  stockQuantity: number;
  minimumStockQuantity: number;
};

const DEMO_PRODUCTS: DemoProduct[] = [
  { id: '10000000-0000-4000-8000-000000000001', sku: 'MEN-001', name: 'Lenteja canadiense', category: 'Menestras', baseUnit: 'gram', pricingQuantity: 1000, priceCents: 850, costCents: 620, stockQuantity: 34600, minimumStockQuantity: 8000 },
  { id: '10000000-0000-4000-8000-000000000002', sku: 'MEN-002', name: 'Frejol canario', category: 'Menestras', baseUnit: 'gram', pricingQuantity: 1000, priceCents: 1290, costCents: 980, stockQuantity: 21300, minimumStockQuantity: 7000 },
  { id: '10000000-0000-4000-8000-000000000003', sku: 'MEN-003', name: 'Garbanzo', category: 'Menestras', baseUnit: 'gram', pricingQuantity: 1000, priceCents: 1040, costCents: 780, stockQuantity: 5800, minimumStockQuantity: 7000 },
  { id: '10000000-0000-4000-8000-000000000004', sku: 'MEN-004', name: 'Pallar bebé', category: 'Menestras', baseUnit: 'gram', pricingQuantity: 1000, priceCents: 1580, costCents: 1210, stockQuantity: 12400, minimumStockQuantity: 5000 },
  { id: '10000000-0000-4000-8000-000000000005', sku: 'ABR-001', name: 'Arroz superior', category: 'Abarrotes', baseUnit: 'gram', pricingQuantity: 1000, priceCents: 460, costCents: 350, stockQuantity: 68500, minimumStockQuantity: 15000 },
  { id: '10000000-0000-4000-8000-000000000006', sku: 'ABR-002', name: 'Azúcar rubia', category: 'Abarrotes', baseUnit: 'gram', pricingQuantity: 1000, priceCents: 420, costCents: 320, stockQuantity: 9200, minimumStockQuantity: 12000 },
  { id: '10000000-0000-4000-8000-000000000007', sku: 'GRA-001', name: 'Quinua blanca', category: 'Granos', baseUnit: 'gram', pricingQuantity: 1000, priceCents: 1350, costCents: 990, stockQuantity: 17700, minimumStockQuantity: 5000 },
  { id: '10000000-0000-4000-8000-000000000008', sku: 'ABR-003', name: 'Atún en lata', category: 'Abarrotes', baseUnit: 'unit', pricingQuantity: 1, priceCents: 650, costCents: 480, stockQuantity: 24, minimumStockQuantity: 6 },
];

const DEMO_USERS = [
  {
    id: DEMO_ADMIN_USER_ID,
    displayName: 'Administrador',
    role: 'administrator',
  },
  {
    id: DEMO_HUSBAND_USER_ID,
    displayName: 'Vendedor esposo',
    role: 'seller',
  },
  {
    id: DEMO_WIFE_USER_ID,
    displayName: 'Vendedora esposa',
    role: 'seller',
  },
] as const;

const DEMO_PRESENTATIONS = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    productId: '10000000-0000-4000-8000-000000000008',
    sku: 'ABR-003-PACK6',
    name: 'Paquete de 6 latas',
    type: 'package',
    quantityInBaseUnits: 6,
    fixedPriceCents: 3600,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    productId: '10000000-0000-4000-8000-000000000005',
    sku: 'ABR-001-S50',
    name: 'Saco de 50 kg',
    type: 'sack',
    quantityInBaseUnits: 50000,
    fixedPriceCents: 22000,
  },
] as const;

type CountRow = {
  total: number;
};

export async function seedDemoProductsIfEmpty(database: DatabaseAdapter) {
  const result = await database.getFirst<CountRow>('SELECT COUNT(*) AS total FROM products');
  if ((result?.total ?? 0) > 0) return;

  const timestamp = new Date().toISOString();

  await database.transaction(async (transaction) => {
    const countInsideTransaction = await transaction.getFirst<CountRow>(
      'SELECT COUNT(*) AS total FROM products'
    );
    if ((countInsideTransaction?.total ?? 0) > 0) return;

    for (const product of DEMO_PRODUCTS) {
      await transaction.run(
        `INSERT INTO products (
          id, store_id, sku, name, category, base_unit, pricing_quantity,
          price_cents, cost_cents, stock_quantity, minimum_stock_quantity,
          is_active, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
        [
          product.id,
          DEFAULT_STORE_ID,
          product.sku,
          product.name,
          product.category,
          product.baseUnit,
          product.pricingQuantity,
          product.priceCents,
          product.costCents,
          product.stockQuantity,
          product.minimumStockQuantity,
          timestamp,
          timestamp,
        ]
      );
    }
  });
}

export async function seedLocalUsersIfEmpty(database: DatabaseAdapter) {
  const result = await database.getFirst<CountRow>('SELECT COUNT(*) AS total FROM local_users');
  if ((result?.total ?? 0) > 0) return;

  const timestamp = new Date().toISOString();

  await database.transaction(async (transaction) => {
    const countInsideTransaction = await transaction.getFirst<CountRow>(
      'SELECT COUNT(*) AS total FROM local_users'
    );
    if ((countInsideTransaction?.total ?? 0) > 0) return;

    for (const user of DEMO_USERS) {
      await transaction.run(
        `INSERT INTO local_users (
          id, store_id, display_name, role,
          pin_hash, pin_salt, pin_algorithm, is_active,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, 1)`,
        [
          user.id,
          DEFAULT_STORE_ID,
          user.displayName,
          user.role,
          timestamp,
          timestamp,
        ]
      );
    }
  });
}

export async function seedDemoPresentationsIfEmpty(database: DatabaseAdapter) {
  const result = await database.getFirst<CountRow>(
    'SELECT COUNT(*) AS total FROM product_presentations'
  );
  if ((result?.total ?? 0) > 0) return;

  const timestamp = new Date().toISOString();

  await database.transaction(async (transaction) => {
    const countInsideTransaction = await transaction.getFirst<CountRow>(
      'SELECT COUNT(*) AS total FROM product_presentations'
    );
    if ((countInsideTransaction?.total ?? 0) > 0) return;

    for (const presentation of DEMO_PRESENTATIONS) {
      await transaction.run(
        `INSERT INTO product_presentations (
          id, store_id, product_id, sku, name, presentation_type,
          quantity_in_base_units, fixed_price_cents, is_active,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
        [
          presentation.id,
          DEFAULT_STORE_ID,
          presentation.productId,
          presentation.sku,
          presentation.name,
          presentation.type,
          presentation.quantityInBaseUnits,
          presentation.fixedPriceCents,
          timestamp,
          timestamp,
        ]
      );
    }
  });
}
