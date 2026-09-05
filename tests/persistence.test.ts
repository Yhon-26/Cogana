import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { migrateDatabase } from '../database/migrations';
import { getOpenCashSession, openCashSession } from '../database/repositories/cash-repository';
import { getOrCreateLocalDeviceId } from '../database/repositories/device-repository';
import { getProductById, listProducts } from '../database/repositories/product-repository';
import { confirmSale } from '../database/repositories/sales-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  seedDemoPresentationsIfEmpty,
  seedDemoProductsIfEmpty,
  seedLocalUsersIfEmpty,
} from '../database/seed';
import { NodeSQLiteAdapter } from './helpers/node-sqlite-adapter';

async function initialize(database: NodeSQLiteAdapter) {
  await migrateDatabase(database);
  await seedDemoProductsIfEmpty(database);
  await seedLocalUsersIfEmpty(database);
  await seedDemoPresentationsIfEmpty(database);
}

test('conserva caja, venta y stock después de reiniciar la conexión SQLite', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'cogana-sqlite-'));
  const filename = join(directory, 'persistence.sqlite');
  let firstDatabase: NodeSQLiteAdapter | null = null;
  let reopenedDatabase: NodeSQLiteAdapter | null = null;
  context.after(() => {
    firstDatabase?.close();
    reopenedDatabase?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  firstDatabase = new NodeSQLiteAdapter(filename);
  await initialize(firstDatabase);
  const generatedDeviceId = await getOrCreateLocalDeviceId(firstDatabase);
  const session = await openCashSession(firstDatabase, {
    storeId: DEFAULT_STORE_ID,
    deviceId: generatedDeviceId,
    responsibleUserId: DEMO_ADMIN_USER_ID,
    openingCashCents: 3000,
  });
  const product = (await listProducts(firstDatabase, DEFAULT_STORE_ID))[0];
  const sale = await confirmSale(firstDatabase, {
    storeId: DEFAULT_STORE_ID,
    deviceId: generatedDeviceId,
    actorUserId: DEMO_ADMIN_USER_ID,
    items: [{ productId: product.id, quantity: 250 }],
    payment: { method: 'cash', amountReceivedCents: 1000 },
  });
  firstDatabase.close();
  firstDatabase = null;

  reopenedDatabase = new NodeSQLiteAdapter(filename);
  await initialize(reopenedDatabase);

  assert.equal(await getOrCreateLocalDeviceId(reopenedDatabase), generatedDeviceId);
  assert.equal(
    (await getOpenCashSession(reopenedDatabase, DEFAULT_STORE_ID, generatedDeviceId))?.id,
    session.id
  );
  assert.equal(
    (await reopenedDatabase.getFirst<{ id: string }>(
      'SELECT id FROM sales WHERE id = ?',
      [sale.sale.id]
    ))?.id,
    sale.sale.id
  );
  assert.equal(
    (await getProductById(reopenedDatabase, DEFAULT_STORE_ID, product.id))?.stockQuantity,
    product.stockQuantity - 250
  );
});
