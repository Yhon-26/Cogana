import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import { enqueueOperation } from './sync-outbox-repository';

export type PendingDeliveryEvidence = {
  id: string;
  storeId: string;
  assignmentId: string;
  localUri: string;
  storagePath: string;
  contentType: string;
  attempts: number;
  actorUserId: string;
  deviceId: string;
};

type EvidenceRow = {
  id: string;
  store_id: string;
  assignment_id: string;
  local_uri: string;
  storage_path: string;
  content_type: string;
  attempts: number;
  actor_user_id: string;
  device_id: string;
};

function mapEvidence(row: EvidenceRow): PendingDeliveryEvidence {
  return {
    id: row.id,
    storeId: row.store_id,
    assignmentId: row.assignment_id,
    localUri: row.local_uri,
    storagePath: row.storage_path,
    contentType: row.content_type,
    attempts: row.attempts,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
  };
}

export async function listPendingDeliveryEvidence(
  database: DatabaseAdapter,
  storeId: string,
  actorUserId: string,
  limit = 5
) {
  const rows = await database.getAll<EvidenceRow>(
    `SELECT id, store_id, assignment_id, local_uri, storage_path,
       content_type, attempts, actor_user_id, device_id
     FROM delivery_evidence_uploads
     WHERE store_id = ? AND actor_user_id = ?
       AND status IN ('pending', 'error') AND attempts < 5
     ORDER BY created_at
     LIMIT ?`,
    [storeId, actorUserId, limit]
  );
  return rows.map(mapEvidence);
}

export async function markDeliveryEvidenceUploading(
  database: DatabaseAdapter,
  evidenceId: string,
  timestamp: string
) {
  const result = await database.run(
    `UPDATE delivery_evidence_uploads
     SET status = 'uploading', attempts = attempts + 1,
         last_error = NULL, updated_at = ?, version = version + 1
     WHERE id = ? AND status IN ('pending', 'error')`,
    [timestamp, evidenceId]
  );
  return result.changes === 1;
}

export async function markDeliveryEvidenceError(
  database: DatabaseAdapter,
  evidenceId: string,
  error: string,
  timestamp: string
) {
  await database.run(
    `UPDATE delivery_evidence_uploads
     SET status = 'error', last_error = ?, updated_at = ?,
         version = version + 1
     WHERE id = ? AND status = 'uploading'`,
    [error.slice(0, 500), timestamp, evidenceId]
  );
}

export async function recoverStuckEvidenceUploads(
  database: DatabaseAdapter,
  storeId: string,
  timestamp: string
) {
  return database.run(
    `UPDATE delivery_evidence_uploads
     SET status = 'pending', last_error = 'Subida interrumpida; se reintentara.',
         updated_at = ?, version = version + 1
     WHERE store_id = ? AND status = 'uploading'`,
    [timestamp, storeId]
  );
}

export async function completeDeliveryEvidenceUpload(
  database: DatabaseAdapter,
  evidence: PendingDeliveryEvidence,
  timestamp: string
) {
  return database.transaction(async (transaction) => {
    const updated = await transaction.run(
      `UPDATE delivery_evidence_uploads
       SET status = 'uploaded', last_error = NULL, uploaded_at = ?,
           updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ? AND status = 'uploading'`,
      [timestamp, timestamp, evidence.id, evidence.storeId]
    );
    if (updated.changes !== 1) return false;

    await transaction.run(
      `UPDATE delivery_assignments
       SET evidence_uri = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND store_id = ?`,
      [
        evidence.storagePath,
        timestamp,
        evidence.assignmentId,
        evidence.storeId,
      ]
    );
    await transaction.run(
      `UPDATE sync_outbox
       SET payload_json = json_set(payload_json, '$.evidenceUri', ?),
           updated_at = ?, version = version + 1
       WHERE store_id = ? AND entity_id = ?
         AND operation_type = 'delivery.confirmed'
         AND status IN ('pending', 'error') AND is_terminal = 0`,
      [
        evidence.storagePath,
        timestamp,
        evidence.storeId,
        evidence.assignmentId,
      ]
    );
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: evidence.storeId,
      actorUserId: evidence.actorUserId,
      operationId: evidence.id,
      entityType: 'delivery_assignment',
      entityId: evidence.assignmentId,
      operationType: 'delivery.evidence_attached',
      payload: {
        operationId: evidence.id,
        id: evidence.assignmentId,
        evidenceUri: evidence.storagePath,
        actorUserId: evidence.actorUserId,
        deviceId: evidence.deviceId,
        uploadedAt: timestamp,
      },
      timestamp,
    });
    return true;
  });
}
