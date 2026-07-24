import type { DatabaseAdapter } from '../contracts';
import type { SyncOutboxRecord, SyncStatus } from '../models';

type SyncOutboxRow = {
  id: string;
  store_id: string;
  operation_id: string;
  entity_type: string;
  entity_id: string;
  operation_type: string;
  payload_json: string;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type EnqueueOperationInput = {
  id: string;
  storeId: string;
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
    operationId: row.operation_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operationType: row.operation_type,
    payloadJson: row.payload_json,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
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
      id, store_id, operation_id, entity_type, entity_id, operation_type,
      payload_json, status, attempts, last_error, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, 1)`,
    [
      input.id,
      input.storeId,
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
    'SELECT * FROM sync_outbox WHERE status = ? ORDER BY created_at, id',
    [status]
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
         updated_at = ?,
         version = version + 1
     WHERE id = ?`,
    [status, incrementAttempts ? 1 : 0, lastError, timestamp, id]
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

export function markOutboxError(database: DatabaseAdapter, id: string, error: string) {
  return setOutboxStatus(database, id, 'error', error, false);
}

export function retryOutboxOperation(database: DatabaseAdapter, id: string) {
  return setOutboxStatus(database, id, 'pending', null, false);
}
