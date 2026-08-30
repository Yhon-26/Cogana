import type { DatabaseAdapter } from '../contracts';
import type { SyncOutboxRecord, SyncStatus } from '../models';

type SyncOutboxRow = {
  id: string;
  store_id: string;
  actor_user_id: string | null;
  operation_id: string;
  entity_type: string;
  entity_id: string;
  operation_type: string;
  payload_json: string;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  error_code: string | null;
  is_terminal: number;
  server_result_json: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type EnqueueOperationInput = {
  id: string;
  storeId: string;
  actorUserId: string;
  operationId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  payload: object;
  timestamp: string;
};

function mapSyncOutboxRow(row: SyncOutboxRow): SyncOutboxRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    actorUserId: row.actor_user_id,
    operationId: row.operation_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operationType: row.operation_type,
    payloadJson: row.payload_json,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    errorCode: row.error_code,
    isTerminal: row.is_terminal === 1,
    serverResultJson: row.server_result_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export async function enqueueOperation(
  database: DatabaseAdapter,
  input: EnqueueOperationInput
) {
  await database.run(
    `INSERT INTO sync_outbox (
      id, store_id, actor_user_id, operation_id, entity_type, entity_id, operation_type,
      payload_json, status, attempts, last_error, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, 1)`,
    [
      input.id,
      input.storeId,
      input.actorUserId,
      input.operationId,
      input.entityType,
      input.entityId,
      input.operationType,
      JSON.stringify(input.payload),
      input.timestamp,
      input.timestamp,
    ]
  );
}

export async function listOutboxByStatus(
  database: DatabaseAdapter,
  status: SyncStatus
): Promise<SyncOutboxRecord[]> {
  const rows = await database.getAll<SyncOutboxRow>(
    'SELECT * FROM sync_outbox WHERE status = ? ORDER BY created_at, rowid',
    [status]
  );

  return rows.map(mapSyncOutboxRow);
}

export async function listOutboxForActor(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  limit = 100
): Promise<SyncOutboxRecord[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('El diagnóstico admite entre 1 y 500 operaciones.');
  }
  const rows = await database.getAll<SyncOutboxRow>(
    `SELECT * FROM sync_outbox
     WHERE store_id = ? AND actor_user_id = ?
       AND status <> 'synced'
     ORDER BY
       CASE status WHEN 'error' THEN 0 WHEN 'syncing' THEN 1 ELSE 2 END,
       created_at, rowid
     LIMIT ?`,
    [storeId, actorUserId, limit]
  );
  return rows.map(mapSyncOutboxRow);
}

export async function listDueOutbox(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  now: string,
  limit: number
): Promise<SyncOutboxRecord[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('El lote push debe contener entre 1 y 100 operaciones.');
  }

  const rows = await database.getAll<SyncOutboxRow>(
    `SELECT *
     FROM sync_outbox
     WHERE store_id = ?
       AND actor_user_id = ?
       AND status IN ('pending', 'error')
       AND is_terminal = 0
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND NOT (
          operation_type = 'delivery.confirmed'
          AND nullif(json_extract(payload_json, '$.confirmationCode'), '') IS NULL
          AND EXISTS (
            SELECT 1
            FROM delivery_evidence_uploads evidence
            WHERE evidence.store_id = sync_outbox.store_id
              AND evidence.assignment_id = sync_outbox.entity_id
              AND evidence.status <> 'uploaded'
              AND evidence.attempts < 5
          )
        )
     ORDER BY
       CASE operation_type
         WHEN 'cash_session.opened' THEN 10
         WHEN 'product.created' THEN 15
         WHEN 'product.updated' THEN 20
         WHEN 'product.price_updated' THEN 20
         WHEN 'product_presentation.created' THEN 20
         WHEN 'product_presentation.updated' THEN 20
         WHEN 'supplier.created' THEN 20
         WHEN 'supplier.updated' THEN 20
         WHEN 'supplier.activated' THEN 20
         WHEN 'supplier.deactivated' THEN 20
         WHEN 'delivery_zone.created' THEN 20
         WHEN 'delivery_zone.updated' THEN 20
         WHEN 'delivery_zone.activated' THEN 20
         WHEN 'delivery_zone.deactivated' THEN 20
         WHEN 'order.created' THEN 25
         WHEN 'sale.confirmed' THEN 30
         WHEN 'order.planning_updated' THEN 32
         WHEN 'order.incident_created' THEN 33
         WHEN 'order.substitution_proposed' THEN 34
         WHEN 'order.status_changed' THEN 35
         WHEN 'delivery.assigned' THEN 36
         WHEN 'delivery.started' THEN 37
         WHEN 'delivery.confirmed' THEN 38
         WHEN 'purchase_order.created' THEN 42
         WHEN 'purchase_order.received' THEN 43
         WHEN 'physical_count.completed' THEN 45
         WHEN 'role_permission.updated' THEN 22
         WHEN 'work_shift.scheduled' THEN 23
         WHEN 'attendance.checked_in' THEN 24
         WHEN 'attendance.checked_out' THEN 24
         WHEN 'cash_movement.income' THEN 40
         WHEN 'cash_movement.outflow' THEN 40
         WHEN 'sale.voided' THEN 50
         WHEN 'sale.returned' THEN 50
         WHEN 'inventory_movement.created' THEN 60
         WHEN 'cash_session.closed' THEN 70
         ELSE 50
       END,
       created_at,
       rowid
     LIMIT ?`,
    [storeId, actorUserId, now, limit]
  );

  return rows.map(mapSyncOutboxRow);
}

async function setOutboxStatus(
  database: DatabaseAdapter,
  id: string,
  status: SyncStatus,
  lastError: string | null,
  incrementAttempts: boolean
) {
  const timestamp = new Date().toISOString();
  const result = await database.run(
    `UPDATE sync_outbox
     SET status = ?,
         attempts = attempts + ?,
         last_error = ?,
         next_attempt_at = NULL,
         error_code = NULL,
         is_terminal = 0,
         server_result_json = CASE WHEN ? = 'synced' THEN server_result_json ELSE NULL END,
         updated_at = ?,
         version = version + 1
     WHERE id = ?`,
    [status, incrementAttempts ? 1 : 0, lastError, status, timestamp, id]
  );

  if (result.changes !== 1) {
    throw new Error(`No se encontró la operación pendiente ${id}.`);
  }
}

export function markOutboxSyncing(database: DatabaseAdapter, id: string) {
  return setOutboxStatus(database, id, 'syncing', null, true);
}

export function markOutboxSynced(database: DatabaseAdapter, id: string) {
  return setOutboxStatus(database, id, 'synced', null, false);
}

export function retryOutboxOperation(database: DatabaseAdapter, id: string) {
  return setOutboxStatus(database, id, 'pending', null, false);
}

export async function markOutboxPushSucceeded(
  database: DatabaseAdapter,
  id: string,
  serverResult: unknown,
  timestamp: string
) {
  const result = await database.run(
    `UPDATE sync_outbox
     SET status = 'synced',
         last_error = NULL,
         next_attempt_at = NULL,
         error_code = NULL,
         is_terminal = 0,
         server_result_json = ?,
         updated_at = ?,
         version = version + 1
     WHERE id = ? AND status = 'syncing'`,
    [serverResult === undefined ? null : JSON.stringify(serverResult), timestamp, id]
  );
  if (result.changes !== 1) {
    throw new Error(`La operacion ${id} ya no esta reservada para sincronizar.`);
  }
}

export async function markOutboxPushRejected(
  database: DatabaseAdapter,
  id: string,
  errorCode: string,
  errorMessage: string,
  timestamp: string
) {
  const result = await database.run(
    `UPDATE sync_outbox
     SET status = 'error',
         last_error = ?,
         next_attempt_at = NULL,
         error_code = ?,
         is_terminal = 1,
         server_result_json = NULL,
         updated_at = ?,
         version = version + 1
     WHERE id = ? AND status = 'syncing'`,
    [errorMessage, errorCode, timestamp, id]
  );
  if (result.changes !== 1) {
    throw new Error(`La operacion ${id} ya no esta reservada para sincronizar.`);
  }
}

export async function markOutboxPushRetry(
  database: DatabaseAdapter,
  id: string,
  errorCode: string,
  errorMessage: string,
  nextAttemptAt: string,
  timestamp: string
) {
  const result = await database.run(
    `UPDATE sync_outbox
     SET status = 'error',
         last_error = ?,
         next_attempt_at = ?,
         error_code = ?,
         is_terminal = 0,
         server_result_json = NULL,
         updated_at = ?,
         version = version + 1
     WHERE id = ? AND status = 'syncing'`,
    [errorMessage, nextAttemptAt, errorCode, timestamp, id]
  );
  if (result.changes !== 1) {
    throw new Error(`La operacion ${id} ya no esta reservada para sincronizar.`);
  }
}

export async function recoverInterruptedOutbox(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  timestamp: string
) {
  return database.run(
    `UPDATE sync_outbox
     SET status = 'pending',
         last_error = 'Sincronizacion interrumpida; se reintentara.',
         next_attempt_at = NULL,
         error_code = 'interrupted',
         is_terminal = 0,
         updated_at = ?,
         version = version + 1
     WHERE store_id = ?
       AND json_extract(payload_json, '$.deviceId') = ?
       AND status = 'syncing'`,
    [timestamp, storeId, deviceId]
  );
}
