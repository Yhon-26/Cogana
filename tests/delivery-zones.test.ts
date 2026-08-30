import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDeliveryZone,
  getDeliveryZoneById,
  listDeliveryZones,
  updateDeliveryZone,
} from '../database/repositories/delivery-zone-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

const zoneFields = {
  name: '  Zona Este 1 ',
  district: ' Santa Anita ',
  feeCents: 700,
  minimumOrderCents: 3500,
  etaMinMinutes: 30,
  etaMaxMinutes: 55,
  scheduleText: ' Lun–Sáb 09:00–18:00 ',
  restrictions: ' No cubre zonas industriales ',
};

test('crea una zona normalizada y deja el evento sync pendiente', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const zone = await createDeliveryZone(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    ...zoneFields,
  });

  assert.equal(zone.name, 'Zona Este 1');
  assert.equal(zone.district, 'Santa Anita');
  assert.equal(zone.feeCents, 700);
  assert.equal(zone.minimumOrderCents, 3500);
  assert.equal(zone.scheduleText, 'Lun–Sáb 09:00–18:00');
  assert.equal(zone.restrictions, 'No cubre zonas industriales');
  assert.equal(zone.isActive, true);
  assert.equal(zone.version, 1);
  assert.equal((await listDeliveryZones(database, DEFAULT_STORE_ID)).length, 1);

  const operation = (await listOutboxByStatus(database, 'pending')).find(
    (candidate) => candidate.operationType === 'delivery_zone.created'
  );
  assert.ok(operation);
  assert.equal(operation.operationId, zone.id);
  const payload = JSON.parse(operation.payloadJson) as {
    feeCents: number;
    minimumOrderCents: number;
    expectedVersion: number | null;
  };
  assert.equal(payload.feeCents, 700);
  assert.equal(payload.minimumOrderCents, 3500);
  assert.equal(payload.expectedVersion, null);
});

test('actualiza y desactiva una zona con versión optimista', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  const created = await createDeliveryZone(database, {
    storeId: DEFAULT_STORE_ID,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    ...zoneFields,
  });
  const updated = await updateDeliveryZone(database, {
    storeId: DEFAULT_STORE_ID,
    zoneId: created.id,
    expectedVersion: created.version,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    ...zoneFields,
    name: 'Zona Este ampliada',
    feeCents: 850,
  });
  assert.equal(updated.name, 'Zona Este ampliada');
  assert.equal(updated.feeCents, 850);
  assert.equal(updated.version, 2);

  const deactivated = await updateDeliveryZone(database, {
    storeId: DEFAULT_STORE_ID,
    zoneId: updated.id,
    expectedVersion: updated.version,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
    name: updated.name,
    district: updated.district,
    feeCents: updated.feeCents,
    minimumOrderCents: updated.minimumOrderCents,
    etaMinMinutes: updated.etaMinMinutes,
    etaMaxMinutes: updated.etaMaxMinutes,
    scheduleText: updated.scheduleText,
    restrictions: updated.restrictions,
    isActive: false,
  });
  assert.equal(deactivated.isActive, false);
  assert.equal(deactivated.version, 3);

  await assert.rejects(
    updateDeliveryZone(database, {
      storeId: DEFAULT_STORE_ID,
      zoneId: created.id,
      expectedVersion: 1,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      ...zoneFields,
    }),
    /cambió/
  );
  assert.deepEqual(
    (await listOutboxByStatus(database, 'pending'))
      .filter((operation) => operation.entityType === 'delivery_zone')
      .map((operation) => operation.operationType),
    ['delivery_zone.created', 'delivery_zone.updated', 'delivery_zone.deactivated']
  );
});

test('solo administrador modifica zonas y valida tarifa y ETA', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  await assert.rejects(
    createDeliveryZone(database, {
      storeId: DEFAULT_STORE_ID,
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      ...zoneFields,
    }),
    /Solo un administrador/
  );
  await assert.rejects(
    createDeliveryZone(database, {
      storeId: DEFAULT_STORE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      ...zoneFields,
      feeCents: -1,
    }),
    /tarifa/
  );
  await assert.rejects(
    createDeliveryZone(database, {
      storeId: DEFAULT_STORE_ID,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
      ...zoneFields,
      etaMinMinutes: 60,
      etaMaxMinutes: 30,
    }),
    /rango de entrega/
  );

  assert.equal(
    await getDeliveryZoneById(database, DEFAULT_STORE_ID, 'missing-zone'),
    null
  );
});
