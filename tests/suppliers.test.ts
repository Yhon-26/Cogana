import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSupplier,
  getSupplierById,
  listSuppliers,
  setSupplierActive,
  updateSupplier,
} from '../database/repositories/supplier-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('crea un proveedor normalizado y deja una operación sync pendiente', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const supplier = await createSupplier(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: '  Distribuidora Andina  ',
    taxId: '20123456789',
    contactName: '  Rosa Díaz ',
    phone: '999 111 222',
    email: ' VENTAS@ANDINA.PE ',
    address: 'Mercado Mayorista',
    notes: 'Entrega los martes',
  });

  assert.equal(supplier.name, 'Distribuidora Andina');
  assert.equal(supplier.email, 'ventas@andina.pe');
  assert.equal(supplier.isActive, true);
  assert.equal(supplier.version, 1);
  assert.equal((await listSuppliers(database, DEFAULT_STORE_ID)).length, 1);

  const operation = (await listOutboxByStatus(database, 'pending')).find(
    (candidate) => candidate.operationType === 'supplier.created'
  );
  assert.ok(operation);
  assert.equal(operation.entityId, supplier.id);
  const payload = JSON.parse(operation.payloadJson) as {
    name: string;
    taxId: string;
    expectedVersion: number | null;
  };
  assert.equal(payload.name, 'Distribuidora Andina');
  assert.equal(payload.taxId, '20123456789');
  assert.equal(payload.expectedVersion, null);
});

test('edita y desactiva un proveedor con control optimista de versión', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const created = await createSupplier(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: 'Proveedor inicial',
  });
  const updated = await updateSupplier(database, {
    storeId: DEFAULT_STORE_ID,
    supplierId: created.id,
    expectedVersion: created.version,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: 'Proveedor actualizado',
    taxId: '20987654321',
    phone: '955 000 000',
  });

  assert.equal(updated.name, 'Proveedor actualizado');
  assert.equal(updated.version, 2);
  assert.equal(updated.updatedByUserId, DEMO_ADMIN_USER_ID);

  const deactivated = await setSupplierActive(database, {
    storeId: DEFAULT_STORE_ID,
    supplierId: updated.id,
    expectedVersion: updated.version,
    isActive: false,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal(deactivated.isActive, false);
  assert.equal(deactivated.version, 3);
  assert.equal((await listSuppliers(database, DEFAULT_STORE_ID, false)).length, 0);

  await assert.rejects(
    updateSupplier(database, {
      storeId: DEFAULT_STORE_ID,
      supplierId: created.id,
      expectedVersion: 1,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      name: 'Cambio obsoleto',
    }),
    /cambió/
  );

  const supplierOperations = (await listOutboxByStatus(database, 'pending')).filter(
    (operation) => operation.entityType === 'supplier'
  );
  assert.deepEqual(
    supplierOperations.map((operation) => operation.operationType),
    ['supplier.created', 'supplier.updated', 'supplier.deactivated']
  );
});

test('solo administrador modifica proveedores y el RUC no se duplica', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  await assert.rejects(
    createSupplier(database, {
      storeId: DEFAULT_STORE_ID,
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      name: 'Proveedor del vendedor',
    }),
    /Solo un administrador/
  );

  const first = await createSupplier(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: 'Proveedor uno',
    taxId: '20111111111',
  });
  assert.ok(await getSupplierById(database, DEFAULT_STORE_ID, first.id));

  await assert.rejects(
    createSupplier(database, {
      storeId: DEFAULT_STORE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      name: 'Proveedor duplicado',
      taxId: '20111111111',
    }),
    /Ya existe/
  );
  await assert.rejects(
    createSupplier(database, {
      storeId: DEFAULT_STORE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      name: 'Proveedor RUC inválido',
      taxId: '123',
    }),
    /11 dígitos/
  );

  assert.equal((await listSuppliers(database, DEFAULT_STORE_ID)).length, 1);
});
