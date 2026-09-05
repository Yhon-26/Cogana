import type { DatabaseAdapter, DatabaseRunResult } from '../contracts';
import type {
  LocalUserPinCredentials,
  LocalUserRecord,
  LocalUserRole,
} from '../models';
import type { PinCredentials } from '../pin';

type LocalUserRow = {
  id: string;
  store_id: string;
  auth_user_id: string | null;
  display_name: string;
  role: LocalUserRole;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_algorithm: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  version: number;
};

type PinCredentialsRow = {
  id: string;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_algorithm: string | null;
  failed_pin_attempts: number;
  pin_locked_until: string | null;
  last_failed_pin_at: string | null;
};

export type PinFailureState = {
  failedAttempts: number;
  lockedUntil: string | null;
};

const PIN_FAILURE_RESET_MS = 15 * 60_000;
const PIN_LOCK_BASE_MS = 30_000;
const PIN_LOCK_MAX_MS = 15 * 60_000;
const PIN_LOCK_THRESHOLD = 5;

function mapLocalUserRow(row: LocalUserRow): LocalUserRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    role: row.role,
    hasPin: row.pin_hash !== null,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export async function listActiveLocalUsers(
  database: DatabaseAdapter,
  storeId: string
): Promise<LocalUserRecord[]> {
  const rows = await database.getAll<LocalUserRow>(
    `SELECT *
     FROM local_users
     WHERE store_id = ? AND is_active = 1
     ORDER BY CASE role WHEN 'administrator' THEN 0 ELSE 1 END, display_name`,
    [storeId]
  );

  return rows.map(mapLocalUserRow);
}

export async function listLocalUsers(
  database: DatabaseAdapter,
  storeId: string
): Promise<LocalUserRecord[]> {
  const rows = await database.getAll<LocalUserRow>(
    `SELECT * FROM local_users WHERE store_id = ?
     ORDER BY is_active DESC,
       CASE role WHEN 'administrator' THEN 0 ELSE 1 END,display_name`,
    [storeId]
  );
  return rows.map(mapLocalUserRow);
}

export async function createLocalUser(
  database: DatabaseAdapter,
  input: {
    id: string;
    storeId: string;
    displayName: string;
    role: LocalUserRole;
    credentials: PinCredentials;
    actorUserId: string;
  }
) {
  const actor = await getActiveLocalUser(
    database,
    input.storeId,
    input.actorUserId
  );
  if (actor?.role !== 'administrator') {
    throw new Error('Solo un administrador crea empleados.');
  }
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('El nombre del empleado es obligatorio.');
  const timestamp = new Date().toISOString();
  await database.run(
    `INSERT INTO local_users(
      id,store_id,display_name,role,pin_hash,pin_salt,pin_algorithm,
      is_active,created_at,updated_at,version,auth_user_id
    ) VALUES(?,?,?,?,?,?,?,1,?,?,1,NULL)`,
    [
      input.id,
      input.storeId,
      displayName,
      input.role,
      input.credentials.pinHash,
      input.credentials.pinSalt,
      input.credentials.pinAlgorithm,
      timestamp,
      timestamp,
    ]
  );
  return getActiveLocalUser(database, input.storeId, input.id);
}

export async function provisionFirstLocalOperator(
  database: DatabaseAdapter,
  input: {
    id: string;
    storeId: string;
    authUserId: string;
    displayName: string;
    credentials: PinCredentials | null;
  }
): Promise<LocalUserRecord> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('El nombre del operador es obligatorio.');
  if (!input.authUserId.trim()) {
    throw new Error('La identidad Supabase del operador es obligatoria.');
  }
  const timestamp = new Date().toISOString();
  await database.transaction(async (transaction) => {
    const existing = await transaction.getFirst<{ total: number }>(
      'SELECT COUNT(*) AS total FROM local_users'
    );
    if ((existing?.total ?? 0) !== 0) {
      throw new Error('El dispositivo ya fue aprovisionado.');
    }
    await transaction.run(
      `INSERT INTO local_users(
        id,store_id,auth_user_id,display_name,role,
        pin_hash,pin_salt,pin_algorithm,is_active,
        created_at,updated_at,version
      ) VALUES(?,?,?,?, 'administrator', ?,?,?,1,?,?,1)`,
      [
        input.id,
        input.storeId,
        input.authUserId,
        displayName,
        input.credentials?.pinHash ?? null,
        input.credentials?.pinSalt ?? null,
        input.credentials?.pinAlgorithm ?? null,
        timestamp,
        timestamp,
      ]
    );
  });
  const created = await getActiveLocalUser(database, input.storeId, input.id);
  if (!created) throw new Error('No se pudo aprovisionar el operador local.');
  return created;
}

export async function updateLocalUser(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    userId: string;
    displayName: string;
    role: LocalUserRole;
    isActive: boolean;
    actorUserId: string;
  }
) {
  const actor = await getActiveLocalUser(
    database,
    input.storeId,
    input.actorUserId
  );
  if (actor?.role !== 'administrator') {
    throw new Error('Solo un administrador modifica empleados.');
  }
  if (input.userId === input.actorUserId && !input.isActive) {
    throw new Error('No puedes desactivar tu propio usuario.');
  }
  const timestamp = new Date().toISOString();
  const result = await database.run(
    `UPDATE local_users SET display_name = ?,role = ?,is_active = ?,
      updated_at = ?,version = version + 1
     WHERE id = ? AND store_id = ?`,
    [
      input.displayName.trim(),
      input.role,
      input.isActive ? 1 : 0,
      timestamp,
      input.userId,
      input.storeId,
    ]
  );
  if (result.changes !== 1) throw new Error('El empleado no existe.');
}

export async function getActiveLocalUser(
  database: DatabaseAdapter,
  storeId: string,
  userId: string
): Promise<LocalUserRecord | null> {
  const row = await database.getFirst<LocalUserRow>(
    `SELECT *
     FROM local_users
     WHERE id = ? AND store_id = ? AND is_active = 1`,
    [userId, storeId]
  );

  return row ? mapLocalUserRow(row) : null;
}

export async function getLocalUserPinCredentials(
  database: DatabaseAdapter,
  storeId: string,
  userId: string
): Promise<LocalUserPinCredentials | null> {
  const row = await database.getFirst<PinCredentialsRow>(
    `SELECT id, pin_hash, pin_salt, pin_algorithm,
       failed_pin_attempts, pin_locked_until, last_failed_pin_at
     FROM local_users
     WHERE id = ? AND store_id = ?`,
    [userId, storeId]
  );
  if (!row) return null;
  return {
    id: row.id,
    pinHash: row.pin_hash,
    pinSalt: row.pin_salt,
    pinAlgorithm: row.pin_algorithm,
    failedAttempts: row.failed_pin_attempts,
    lockedUntil: row.pin_locked_until,
    lastFailedAt: row.last_failed_pin_at,
  };
}

export async function recordLocalUserPinFailure(
  database: DatabaseAdapter,
  storeId: string,
  userId: string,
  failedAt: string
): Promise<PinFailureState> {
  const failedAtMs = Date.parse(failedAt);
  if (!Number.isFinite(failedAtMs)) throw new Error('Fecha de intento PIN invalida.');

  return database.transaction(async (transaction) => {
    const current = await transaction.getFirst<{
      failed_pin_attempts: number;
      last_failed_pin_at: string | null;
    }>(
      `SELECT failed_pin_attempts,last_failed_pin_at
       FROM local_users
       WHERE id = ? AND store_id = ? AND is_active = 1`,
      [userId, storeId]
    );
    if (!current) throw new Error('El operador no existe o esta inactivo.');

    const previousFailedAtMs = current.last_failed_pin_at
      ? Date.parse(current.last_failed_pin_at)
      : Number.NaN;
    const previousAttempts =
      Number.isFinite(previousFailedAtMs) &&
      failedAtMs - previousFailedAtMs <= PIN_FAILURE_RESET_MS
        ? current.failed_pin_attempts
        : 0;
    const failedAttempts = previousAttempts + 1;
    const lockExponent = Math.max(failedAttempts - PIN_LOCK_THRESHOLD, 0);
    const lockDurationMs =
      failedAttempts >= PIN_LOCK_THRESHOLD
        ? Math.min(PIN_LOCK_BASE_MS * 2 ** lockExponent, PIN_LOCK_MAX_MS)
        : 0;
    const lockedUntil =
      lockDurationMs > 0
        ? new Date(failedAtMs + lockDurationMs).toISOString()
        : null;
    const result = await transaction.run(
      `UPDATE local_users
       SET failed_pin_attempts = ?,
           pin_locked_until = ?,
           last_failed_pin_at = ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ? AND store_id = ? AND is_active = 1`,
      [failedAttempts, lockedUntil, failedAt, failedAt, userId, storeId]
    );
    if (result.changes !== 1) {
      throw new Error('No se pudo registrar el intento de PIN.');
    }
    return { failedAttempts, lockedUntil };
  });
}

export async function clearLocalUserPinFailures(
  database: DatabaseAdapter,
  storeId: string,
  userId: string,
  timestamp: string
) {
  const result = await database.run(
    `UPDATE local_users
     SET failed_pin_attempts = 0,
         pin_locked_until = NULL,
         last_failed_pin_at = NULL,
         updated_at = ?,
         version = CASE
           WHEN failed_pin_attempts = 0
             AND pin_locked_until IS NULL
             AND last_failed_pin_at IS NULL
           THEN version
           ELSE version + 1
         END
     WHERE id = ? AND store_id = ? AND is_active = 1`,
    [timestamp, userId, storeId]
  );
  if (result.changes !== 1) {
    throw new Error('No se pudo restablecer el bloqueo del PIN.');
  }
}

export async function setLocalUserPin(
  database: DatabaseAdapter,
  storeId: string,
  userId: string,
  credentials: PinCredentials
): Promise<void> {
  const timestamp = new Date().toISOString();
  const result: DatabaseRunResult = await database.run(
     `UPDATE local_users
     SET pin_hash = ?,
         pin_salt = ?,
         pin_algorithm = ?,
         failed_pin_attempts = 0,
         pin_locked_until = NULL,
         updated_at = ?,
         version = version + 1
     WHERE id = ? AND store_id = ? AND is_active = 1`,
    [
      credentials.pinHash,
      credentials.pinSalt,
      credentials.pinAlgorithm,
      timestamp,
      userId,
      storeId,
    ]
  );
  if (result.changes !== 1) {
    throw new Error('No se pudo actualizar el PIN del usuario.');
  }
}

export async function linkLocalUserToAuth(
  database: DatabaseAdapter,
  storeId: string,
  userId: string,
  authUserId: string
): Promise<void> {
  if (!authUserId.trim()) {
    throw new Error('El identificador Supabase del operador es obligatorio.');
  }
  const existing = await database.getFirst<{ id: string }>(
    `SELECT id
     FROM local_users
     WHERE store_id = ? AND auth_user_id = ? AND id <> ?`,
    [storeId, authUserId, userId]
  );
  if (existing) {
    throw new Error('La cuenta Supabase ya está vinculada a otro operador local.');
  }
  const timestamp = new Date().toISOString();
  const result = await database.run(
    `UPDATE local_users
     SET auth_user_id = ?,
         updated_at = ?,
         version = version + 1
     WHERE id = ? AND store_id = ? AND is_active = 1
       AND (auth_user_id IS NULL OR auth_user_id = ?)`,
    [authUserId, timestamp, userId, storeId, authUserId]
  );
  if (result.changes !== 1) {
    throw new Error('El operador ya está vinculado a otra cuenta Supabase.');
  }
}

export async function unlinkLocalUserFromAuth(
  database: DatabaseAdapter,
  storeId: string,
  userId: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  const result = await database.run(
    `UPDATE local_users
     SET auth_user_id = NULL,
         updated_at = ?,
         version = version + 1
     WHERE id = ? AND store_id = ? AND is_active = 1`,
    [timestamp, userId, storeId]
  );
  if (result.changes !== 1) {
    throw new Error('No se pudo desvincular la cuenta Supabase.');
  }
}
