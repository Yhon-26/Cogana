import type { DatabaseAdapter } from '../database/contracts';
import { createId } from '../database/ids';
import {
  acquireSyncLease,
  compactSyncInbox,
  ensureLocalSyncState,
  getLocalSyncState,
  recordSyncFailure,
  recordSyncPull,
  recordSyncPush,
  releaseSyncLease,
  renewSyncLease,
} from '../database/repositories/sync-state-repository';
import {
  listDueOutbox,
  markOutboxPushRejected,
  markOutboxPushRetry,
  markOutboxPushSucceeded,
  markOutboxSyncing,
  recoverInterruptedOutbox,
} from '../database/repositories/sync-outbox-repository';
import { applyPullChange } from './apply-pull';
import {
  SYNC_SCHEMA_VERSION,
  type PushOperation,
  type SyncCycleResult,
  type SyncTransport,
} from './contracts';

type SyncEngineOptions = {
  storeId: string;
  deviceId: string;
  actorUserId: string;
  pushBatchSize?: number;
  maxPushBatches?: number;
  pullPageSize?: number;
  maxPullPages?: number;
  leaseDurationMs?: number;
  retryBaseMs?: number;
  now?: () => Date;
};

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 500);
  }
  return 'No se pudo completar la sincronizacion.';
}

function nextRetryAt(now: Date, attempts: number, baseMs: number) {
  const multiplier = 2 ** Math.min(Math.max(attempts, 0), 6);
  return new Date(now.getTime() + Math.min(baseMs * multiplier, 5 * 60_000)).toISOString();
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  const payload = JSON.parse(payloadJson) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('La outbox contiene un payload invalido.');
  }
  return payload as Record<string, unknown>;
}

function asPushOperation(record: {
  operationId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  payloadJson: string;
}): PushOperation {
  return {
    operation_id: record.operationId,
    entity_type: record.entityType,
    entity_id: record.entityId,
    operation_type: record.operationType,
    payload: parsePayload(record.payloadJson),
  };
}

export async function runSyncCycle(
  database: DatabaseAdapter,
  transport: SyncTransport,
  options: SyncEngineOptions
): Promise<SyncCycleResult> {
  const nowProvider = options.now ?? (() => new Date());
  const pushBatchSize = options.pushBatchSize ?? 50;
  const maxPushBatches = options.maxPushBatches ?? 20;
  const pullPageSize = options.pullPageSize ?? 100;
  const maxPullPages = options.maxPullPages ?? 20;
  const leaseDurationMs = options.leaseDurationMs ?? 5 * 60_000;
  const retryBaseMs = options.retryBaseMs ?? 2_000;

  if (!options.storeId || !options.deviceId || !options.actorUserId) {
    throw new Error('La sincronizacion requiere tienda, dispositivo y operador.');
  }
  if (!Number.isSafeInteger(pushBatchSize) || pushBatchSize < 1 || pushBatchSize > 100) {
    throw new Error('pushBatchSize debe estar entre 1 y 100.');
  }
  if (!Number.isSafeInteger(maxPushBatches) || maxPushBatches < 1 || maxPushBatches > 100) {
    throw new Error('maxPushBatches debe estar entre 1 y 100.');
  }
  if (!Number.isSafeInteger(pullPageSize) || pullPageSize < 1 || pullPageSize > 500) {
    throw new Error('pullPageSize debe estar entre 1 y 500.');
  }

  const owner = createId();
  const startedAt = nowProvider();
  const startedAtIso = startedAt.toISOString();
  const acquired = await acquireSyncLease(
    database,
    options.storeId,
    options.deviceId,
    owner,
    startedAtIso,
    new Date(startedAt.getTime() + leaseDurationMs).toISOString()
  );
  if (!acquired) {
    const state = await getLocalSyncState(database, options.storeId, options.deviceId);
    return {
      status: 'skipped',
      pushed: 0,
      rejected: 0,
      pulled: 0,
      cursor: state?.lastPullCursor ?? 0,
      hasMore: false,
      error: null,
    };
  }

  let pushed = 0;
  let rejected = 0;
  let pulled = 0;
  let cursor = 0;
  let hasMore = false;

  const renewLease = async () => {
    const renewedAt = nowProvider();
    const renewed = await renewSyncLease(
      database,
      options.storeId,
      options.deviceId,
      owner,
      renewedAt.toISOString(),
      new Date(renewedAt.getTime() + leaseDurationMs).toISOString()
    );
    if (!renewed) {
      throw new Error('La sincronizacion perdio su lease local.');
    }
  };

  try {
    await ensureLocalSyncState(
      database,
      options.storeId,
      options.deviceId,
      startedAtIso
    );
    await recoverInterruptedOutbox(database, options.storeId, options.deviceId, startedAtIso);

    for (let batch = 0; batch < maxPushBatches; batch += 1) {
      await renewLease();
      const batchStartedAt = nowProvider();
      const batchStartedAtIso = batchStartedAt.toISOString();
      const due = await listDueOutbox(
        database,
        options.storeId,
        options.actorUserId,
        batchStartedAtIso,
        pushBatchSize
      );
      if (due.length === 0) break;

      const claimed = [];
      for (const record of due) {
        try {
          parsePayload(record.payloadJson);
          await markOutboxSyncing(database, record.id);
          claimed.push(record);
        } catch (error) {
          rejected += 1;
          await database.run(
            `UPDATE sync_outbox
             SET status = 'error',
                 last_error = ?,
                 error_code = 'invalid_local_payload',
                 is_terminal = 1,
                 next_attempt_at = NULL,
                 updated_at = ?,
                 version = version + 1
             WHERE id = ?`,
            [safeErrorMessage(error), batchStartedAtIso, record.id]
          );
        }
      }
      if (claimed.length === 0) continue;

      let response;
      try {
        response = await transport.push({
          storeId: options.storeId,
          deviceId: options.deviceId,
          schemaVersion: SYNC_SCHEMA_VERSION,
          operations: claimed.map(asPushOperation),
        });
        await renewLease();
      } catch (error) {
        const message = safeErrorMessage(error);
        for (const record of claimed) {
          await markOutboxPushRetry(
            database,
            record.id,
            'transport_error',
            message,
            nextRetryAt(batchStartedAt, record.attempts + 1, retryBaseMs),
            batchStartedAtIso
          );
        }
        throw error;
      }

      if (response.schemaVersion !== SYNC_SCHEMA_VERSION) {
        throw new Error('El backend respondio con una version de sync incompatible.');
      }
      const results = new Map(response.results.map((result) => [result.operationId, result]));
      for (const record of claimed) {
        const result = results.get(record.operationId);
        if (!result) {
          await markOutboxPushRetry(
            database,
            record.id,
            'missing_result',
            'El backend no devolvio resultado para la operacion.',
            nextRetryAt(batchStartedAt, record.attempts + 1, retryBaseMs),
            batchStartedAtIso
          );
          continue;
        }
        if (result.status === 'applied' || result.status === 'duplicate') {
          await markOutboxPushSucceeded(
            database,
            record.id,
            result.result,
            batchStartedAtIso
          );
          pushed += 1;
        } else {
          await markOutboxPushRejected(
            database,
            record.id,
            result.errorCode ?? 'rejected',
            result.errorMessage ?? 'La operacion fue rechazada por el servidor.',
            batchStartedAtIso
          );
          rejected += 1;
        }
      }
      await recordSyncPush(
        database,
        options.storeId,
        options.deviceId,
        batchStartedAtIso
      );
      if (due.length < pushBatchSize) break;
    }

    const state = await getLocalSyncState(database, options.storeId, options.deviceId);
    cursor = state?.lastPullCursor ?? 0;
    for (let page = 0; page < maxPullPages; page += 1) {
      await renewLease();
      const response = await transport.pull({
        storeId: options.storeId,
        deviceId: options.deviceId,
        cursor,
        limit: pullPageSize,
      });
      await renewLease();
      if (response.schemaVersion !== SYNC_SCHEMA_VERSION) {
        throw new Error('El backend respondio con una version de sync incompatible.');
      }
      if (!Number.isSafeInteger(response.nextCursor) || response.nextCursor < cursor) {
        throw new Error('El backend devolvio un cursor pull invalido.');
      }
      if (response.hasMore && response.nextCursor === cursor) {
        throw new Error('El backend no avanzo el cursor aunque quedan cambios.');
      }

      const receivedAt = nowProvider().toISOString();
      let appliedInPage = 0;
      await database.transaction(async (transaction) => {
        let previousSequence = cursor;
        for (const change of response.changes) {
          if (change.sequence <= previousSequence) {
            throw new Error('El lote pull no esta ordenado por secuencia.');
          }
          if (change.sequence > response.nextCursor) {
            throw new Error('Un cambio pull excede el cursor de la pagina.');
          }
          if (await applyPullChange(transaction, options.storeId, change, receivedAt)) {
            appliedInPage += 1;
          }
          previousSequence = change.sequence;
        }
        await recordSyncPull(
          transaction,
          options.storeId,
          options.deviceId,
          response.nextCursor,
          receivedAt
        );
      });
      pulled += appliedInPage;

      cursor = response.nextCursor;
      hasMore = response.hasMore;
      if (!hasMore) break;
    }

    const completedAt = nowProvider().toISOString();
    await compactSyncInbox(database, options.storeId, 30, completedAt);

    return {
      status: 'completed',
      pushed,
      rejected,
      pulled,
      cursor,
      hasMore,
      error: null,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    const failedAt = nowProvider().toISOString();
    await recordSyncFailure(
      database,
      options.storeId,
      options.deviceId,
      message,
      failedAt
    );
    const state = await getLocalSyncState(database, options.storeId, options.deviceId);
    return {
      status: 'offline',
      pushed,
      rejected,
      pulled,
      cursor: state?.lastPullCursor ?? cursor,
      hasMore,
      error: message,
    };
  } finally {
    await releaseSyncLease(
      database,
      options.storeId,
      options.deviceId,
      owner,
      nowProvider().toISOString()
    );
  }
}
