import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type { LocalUserRole } from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { enqueueOperation } from './sync-outbox-repository';

export type RolePermission = {
  id: string;
  role: LocalUserRole;
  module: string;
  canView: boolean;
  canManage: boolean;
  version: number;
};

export type WorkShift = {
  id: string;
  userId: string;
  userName: string;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes: string | null;
  createdByUserId: string;
  deviceId: string;
  createdAt: string;
  version: number;
};

export type AttendanceEntry = {
  id: string;
  userId: string;
  userName: string;
  workShiftId: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
  notes: string | null;
  deviceId: string;
  version: number;
};

async function requireAdministrator(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string
) {
  const actor = await getActiveLocalUser(database, storeId, actorUserId);
  if (!actor || actor.role !== 'administrator') {
    throw new Error('Solo un administrador puede realizar esta operación.');
  }
  return actor;
}

export async function listRolePermissions(
  database: DatabaseAdapter,
  storeId: string
): Promise<RolePermission[]> {
  const rows = await database.getAll<{
    id: string;
    role: LocalUserRole;
    module: string;
    can_view: number;
    can_manage: number;
    version: number;
  }>(
    `SELECT id,role,module,can_view,can_manage,version
     FROM role_permissions WHERE store_id = ? ORDER BY role,module`,
    [storeId]
  );
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    module: row.module,
    canView: row.can_view === 1,
    canManage: row.can_manage === 1,
    version: row.version,
  }));
}

export async function setRolePermission(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    role: LocalUserRole;
    module: string;
    canView: boolean;
    canManage: boolean;
    actorUserId: string;
    deviceId: string;
  }
) {
  if (!input.module.trim()) throw new Error('Selecciona un módulo.');
  if (input.canManage && !input.canView) {
    throw new Error('Administrar requiere permiso de consulta.');
  }
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireAdministrator(transaction, input.storeId, input.actorUserId);
    const current = await transaction.getFirst<{ id: string; version: number }>(
      `SELECT id,version FROM role_permissions
       WHERE store_id = ? AND role = ? AND module = ?`,
      [input.storeId, input.role, input.module]
    );
    const id = current?.id ?? createId();
    if (current) {
      await transaction.run(
        `UPDATE role_permissions SET can_view = ?,can_manage = ?,
          updated_by_user_id = ?,updated_at = ?,version = version + 1
         WHERE id = ? AND store_id = ? AND version = ?`,
        [
          input.canView ? 1 : 0,
          input.canManage ? 1 : 0,
          input.actorUserId,
          timestamp,
          id,
          input.storeId,
          current.version,
        ]
      );
    } else {
      await transaction.run(
        `INSERT INTO role_permissions(
          id,store_id,role,module,can_view,can_manage,updated_by_user_id,
          updated_at,version
        ) VALUES(?,?,?,?,?,?,?,?,1)`,
        [
          id,
          input.storeId,
          input.role,
          input.module,
          input.canView ? 1 : 0,
          input.canManage ? 1 : 0,
          input.actorUserId,
          timestamp,
        ]
      );
    }
    const version = (current?.version ?? 0) + 1;
    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'role_permission',
      entityId: id,
      operationType: 'role_permission.updated',
      payload: {
        id,
        role: input.role,
        module: input.module,
        canView: input.canView,
        canManage: input.canManage,
        expectedVersion: current?.version ?? null,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        updatedAt: timestamp,
      },
      timestamp,
    });
    return version;
  });
}

export async function listWorkShifts(
  database: DatabaseAdapter,
  storeId: string
): Promise<WorkShift[]> {
  const rows = await database.getAll<{
    id: string;
    user_id: string;
    user_name: string;
    starts_at: string;
    ends_at: string;
    status: WorkShift['status'];
    notes: string | null;
    created_by_user_id: string;
    device_id: string;
    created_at: string;
    version: number;
  }>(
    `SELECT ws.*,u.display_name AS user_name FROM work_shifts ws
     JOIN local_users u ON u.id = ws.user_id AND u.store_id = ws.store_id
     WHERE ws.store_id = ? ORDER BY ws.starts_at DESC`,
    [storeId]
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    version: row.version,
  }));
}

export async function scheduleWorkShift(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    userId: string;
    startsAt: string;
    endsAt: string;
    notes?: string;
    actorUserId: string;
    deviceId: string;
  }
) {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt <= startsAt
  ) {
    throw new Error('El horario del turno no es válido.');
  }
  const id = createId();
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    await requireAdministrator(transaction, input.storeId, input.actorUserId);
    const target = await getActiveLocalUser(transaction, input.storeId, input.userId);
    if (!target) throw new Error('Selecciona un empleado activo.');
    await transaction.run(
      `INSERT INTO work_shifts(
        id,store_id,user_id,starts_at,ends_at,status,notes,
        created_by_user_id,device_id,created_at,updated_at,version
      ) VALUES(?,?,?,?,?,'scheduled',?,?,?,?,?,1)`,
      [
        id,
        input.storeId,
        input.userId,
        startsAt.toISOString(),
        endsAt.toISOString(),
        input.notes?.trim() || null,
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );
    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'work_shift',
      entityId: id,
      operationType: 'work_shift.scheduled',
      payload: {
        id,
        userAuthUserId: target.authUserId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        notes: input.notes?.trim() || null,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        createdAt: timestamp,
      },
      timestamp,
    });
    return id;
  });
}

export async function listAttendance(
  database: DatabaseAdapter,
  storeId: string
): Promise<AttendanceEntry[]> {
  const rows = await database.getAll<{
    id: string;
    user_id: string;
    user_name: string;
    work_shift_id: string | null;
    checked_in_at: string;
    checked_out_at: string | null;
    notes: string | null;
    device_id: string;
    version: number;
  }>(
    `SELECT ae.*,u.display_name AS user_name FROM attendance_entries ae
     JOIN local_users u ON u.id = ae.user_id AND u.store_id = ae.store_id
     WHERE ae.store_id = ? ORDER BY ae.checked_in_at DESC`,
    [storeId]
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    workShiftId: row.work_shift_id,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    notes: row.notes,
    deviceId: row.device_id,
    version: row.version,
  }));
}

export async function checkAttendance(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    userId: string;
    action: 'in' | 'out';
    notes?: string;
    actorUserId: string;
    deviceId: string;
  }
) {
  const timestamp = new Date().toISOString();
  return database.transaction(async (transaction) => {
    const actor = await getActiveLocalUser(
      transaction,
      input.storeId,
      input.actorUserId
    );
    if (!actor || (actor.id !== input.userId && actor.role !== 'administrator')) {
      throw new Error('Solo el empleado o un administrador registra asistencia.');
    }
    const target = await getActiveLocalUser(transaction, input.storeId, input.userId);
    if (!target) throw new Error('El empleado no está activo.');
    const open = await transaction.getFirst<{ id: string; version: number }>(
      `SELECT id,version FROM attendance_entries
       WHERE store_id = ? AND user_id = ? AND checked_out_at IS NULL`,
      [input.storeId, input.userId]
    );
    let id: string;
    let operationId = createId();
    if (input.action === 'in') {
      if (open) throw new Error('El empleado ya registró entrada.');
      id = createId();
      const shift = await transaction.getFirst<{ id: string }>(
        `SELECT id FROM work_shifts WHERE store_id = ? AND user_id = ?
         AND status = 'scheduled' AND starts_at <= ? AND ends_at >= ?
         ORDER BY starts_at LIMIT 1`,
        [input.storeId, input.userId, timestamp, timestamp]
      );
      await transaction.run(
        `INSERT INTO attendance_entries(
          id,store_id,user_id,work_shift_id,checked_in_at,checked_out_at,
          notes,device_id,created_at,updated_at,version
        ) VALUES(?,?,?,?,?,NULL,?,?,?,?,1)`,
        [
          id,
          input.storeId,
          input.userId,
          shift?.id ?? null,
          timestamp,
          input.notes?.trim() || null,
          input.deviceId,
          timestamp,
          timestamp,
        ]
      );
    } else {
      if (!open) throw new Error('No existe una entrada abierta.');
      id = open.id;
      const updated = await transaction.run(
        `UPDATE attendance_entries SET checked_out_at = ?,notes = coalesce(?,notes),
          updated_at = ?,version = version + 1
         WHERE id = ? AND store_id = ? AND version = ?`,
        [
          timestamp,
          input.notes?.trim() || null,
          timestamp,
          id,
          input.storeId,
          open.version,
        ]
      );
      if (updated.changes !== 1) throw new Error('La asistencia cambió.');
    }
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'attendance_entry',
      entityId: id,
      operationType:
        input.action === 'in' ? 'attendance.checked_in' : 'attendance.checked_out',
      payload: {
        id,
        userAuthUserId: target.authUserId,
        notes: input.notes?.trim() || null,
        checkedAt: timestamp,
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
      },
      timestamp,
    });
    return id;
  });
}
