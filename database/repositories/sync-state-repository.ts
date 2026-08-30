import type { DatabaseAdapter } from '../contracts';
import type { LocalSyncStateRecord } from '../models';

type LocalSyncStateRow = {
  store_id: string;
  device_id: string;
  last_pull_cursor: number;
  last_push_at: string | null;
  last_pull_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

function mapState(row: LocalSyncStateRow): LocalSyncStateRecord {
  return {
    storeId: row.store_id,
    deviceId: row.device_id,
    lastPullCursor: row.last_pull_cursor,
    lastPushAt: row.last_push_at,
    lastPullAt: row.last_pull_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export async function ensureLocalSyncState(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  timestamp: string
) {
  await database.run(
    `INSERT OR IGNORE INTO local_sync_state (
      store_id, device_id, last_pull_cursor, consecutive_failures,
      created_at, updated_at, version
    ) VALUES (?, ?, 0, 0, ?, ?, 1)`,
    [storeId, deviceId, timestamp, timestamp]
  );
}

export async function getLocalSyncState(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string
): Promise<LocalSyncStateRecord | null> {
  const row = await database.getFirst<LocalSyncStateRow>(
    `SELECT *
     FROM local_sync_state
     WHERE store_id = ? AND device_id = ?`,
    [storeId, deviceId]
  );
  return row ? mapState(row) : null;
}

export async function acquireSyncLease(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  owner: string,
  now: string,
  expiresAt: string
) {
  await ensureLocalSyncState(database, storeId, deviceId, now);
  const result = await database.run(
    `UPDATE local_sync_state
     SET lease_owner = ?,
         lease_expires_at = ?,
         updated_at = ?,
         version = version + 1
     WHERE store_id = ?
       AND device_id = ?
       AND (
         lease_owner IS NULL
         OR lease_expires_at IS NULL
         OR lease_expires_at <= ?
         OR lease_owner = ?
       )`,
    [owner, expiresAt, now, storeId, deviceId, now, owner]
  );
  return result.changes === 1;
}

export async function releaseSyncLease(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  owner: string,
  timestamp: string
) {
  await database.run(
    `UPDATE local_sync_state
     SET lease_owner = NULL,
         lease_expires_at = NULL,
         updated_at = ?,
         version = version + 1
     WHERE store_id = ? AND device_id = ? AND lease_owner = ?`,
    [timestamp, storeId, deviceId, owner]
  );
}

export async function renewSyncLease(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  owner: string,
  timestamp: string,
  expiresAt: string
) {
  const result = await database.run(
    `UPDATE local_sync_state
     SET lease_expires_at = ?,
         updated_at = ?,
         version = version + 1
     WHERE store_id = ? AND device_id = ? AND lease_owner = ?`,
    [expiresAt, timestamp, storeId, deviceId, owner]
  );
  return result.changes === 1;
}

export async function recordSyncPush(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  timestamp: string
) {
  await database.run(
    `UPDATE local_sync_state
     SET last_push_at = ?,
         updated_at = ?,
         version = version + 1
     WHERE store_id = ? AND device_id = ?`,
    [timestamp, timestamp, storeId, deviceId]
  );
}

export async function recordSyncPull(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  cursor: number,
  timestamp: string
) {
  await database.run(
    `UPDATE local_sync_state
     SET last_pull_cursor = ?,
         last_pull_at = ?,
         last_success_at = ?,
         last_error = NULL,
         consecutive_failures = 0,
         updated_at = ?,
         version = version + 1
     WHERE store_id = ? AND device_id = ?`,
    [cursor, timestamp, timestamp, timestamp, storeId, deviceId]
  );
}

export async function recordSyncFailure(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string,
  error: string,
  timestamp: string
) {
  await database.run(
    `UPDATE local_sync_state
     SET last_error = ?,
         consecutive_failures = consecutive_failures + 1,
         updated_at = ?,
         version = version + 1
     WHERE store_id = ? AND device_id = ?`,
    [error, timestamp, storeId, deviceId]
  );
}

export async function compactSyncInbox(
  database: DatabaseAdapter,
  storeId: string,
  retentionDays: number,
  now: string
) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  await database.run(
    `DELETE FROM sync_inbox
     WHERE store_id = ? AND received_at < ?`,
    [storeId, cutoff.toISOString()]
  );
}
