import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkAttendance,
  listAttendance,
  listRolePermissions,
  listWorkShifts,
  scheduleWorkShift,
  setRolePermission,
} from '../database/repositories/personnel-operations-repository';
import { listOutboxByStatus } from '../database/repositories/sync-outbox-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
  DEMO_DEVICE_ID,
  DEMO_HUSBAND_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('configura permisos restrictivos del rol vendedor', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  await assert.rejects(
    setRolePermission(database, {
      storeId: DEFAULT_STORE_ID,
      role: 'seller',
      module: 'reportes',
      canView: false,
      canManage: false,
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /administrador/
  );
  await setRolePermission(database, {
    storeId: DEFAULT_STORE_ID,
    role: 'seller',
    module: 'reportes',
    canView: true,
    canManage: false,
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  const permission = (await listRolePermissions(database, DEFAULT_STORE_ID))[0];
  assert.equal(permission.module, 'reportes');
  assert.equal(permission.canView, true);
  assert.equal(permission.canManage, false);
});

test('programa turno y registra entrada y salida sin duplicar jornada abierta', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());
  const now = Date.now();
  const shiftId = await scheduleWorkShift(database, {
    storeId: DEFAULT_STORE_ID,
    userId: DEMO_HUSBAND_USER_ID,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 8 * 60 * 60_000).toISOString(),
    actorUserId: DEMO_ADMIN_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  assert.equal((await listWorkShifts(database, DEFAULT_STORE_ID))[0].id, shiftId);
  const attendanceId = await checkAttendance(database, {
    storeId: DEFAULT_STORE_ID,
    userId: DEMO_HUSBAND_USER_ID,
    action: 'in',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  await assert.rejects(
    checkAttendance(database, {
      storeId: DEFAULT_STORE_ID,
      userId: DEMO_HUSBAND_USER_ID,
      action: 'in',
      actorUserId: DEMO_HUSBAND_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    }),
    /ya registró/
  );
  await checkAttendance(database, {
    storeId: DEFAULT_STORE_ID,
    userId: DEMO_HUSBAND_USER_ID,
    action: 'out',
    actorUserId: DEMO_HUSBAND_USER_ID,
    deviceId: DEMO_DEVICE_ID,
  });
  const entry = (await listAttendance(database, DEFAULT_STORE_ID)).find(
    (candidate) => candidate.id === attendanceId
  );
  assert.ok(entry?.checkedOutAt);
  assert.equal(entry?.workShiftId, shiftId);
  const operations = (await listOutboxByStatus(database, 'pending')).map(
    (operation) => operation.operationType
  );
  assert.ok(operations.includes('work_shift.scheduled'));
  assert.ok(operations.includes('attendance.checked_in'));
  assert.ok(operations.includes('attendance.checked_out'));
});
