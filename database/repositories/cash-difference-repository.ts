import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import { getActiveLocalUser } from './local-user-repository';
import { enqueueOperation } from './sync-outbox-repository';

export type CashDifferenceDecision = 'approved' | 'requires_action';

export type CashDifferenceReview = {
  id: string;
  storeId: string;
  cashSessionId: string;
  decision: CashDifferenceDecision;
  justification: string;
  reviewedByUserId: string;
  deviceId: string;
  reviewedAt: string;
  version: number;
};

type ReviewRow = {
  id: string;
  store_id: string;
  cash_session_id: string;
  decision: CashDifferenceDecision;
  justification: string;
  reviewed_by_user_id: string;
  device_id: string;
  reviewed_at: string;
  version: number;
};

function mapReview(row: ReviewRow): CashDifferenceReview {
  return {
    id: row.id,
    storeId: row.store_id,
    cashSessionId: row.cash_session_id,
    decision: row.decision,
    justification: row.justification,
    reviewedByUserId: row.reviewed_by_user_id,
    deviceId: row.device_id,
    reviewedAt: row.reviewed_at,
    version: row.version,
  };
}

export async function reviewCashDifference(
  database: DatabaseAdapter,
  input: {
    storeId: string;
    cashSessionId: string;
    actorUserId: string;
    deviceId: string;
    decision: CashDifferenceDecision;
    justification: string;
  }
): Promise<CashDifferenceReview> {
  const justification = input.justification.trim();
  if (!justification) {
    throw new Error('La revisión requiere una justificación.');
  }
  const actor = await getActiveLocalUser(
    database,
    input.storeId,
    input.actorUserId
  );
  if (!actor || actor.role !== 'administrator') {
    throw new Error('Solo un administrador puede revisar diferencias de caja.');
  }

  return database.transaction(async (transaction) => {
    const session = await transaction.getFirst<{
      status: string;
      difference_cents: number | null;
    }>(
      `SELECT status,difference_cents FROM cash_sessions
       WHERE id = ? AND store_id = ?`,
      [input.cashSessionId, input.storeId]
    );
    if (!session || session.status !== 'closed') {
      throw new Error('Solo se puede revisar una caja cerrada.');
    }
    if (!session.difference_cents) {
      throw new Error('La caja no tiene una diferencia que revisar.');
    }

    const existing = await transaction.getFirst<ReviewRow>(
      `SELECT * FROM cash_difference_reviews
       WHERE store_id = ? AND cash_session_id = ?`,
      [input.storeId, input.cashSessionId]
    );
    const id = existing?.id ?? createId();
    const expectedVersion = existing?.version ?? 0;
    const timestamp = new Date().toISOString();

    if (existing) {
      const updated = await transaction.run(
        `UPDATE cash_difference_reviews
         SET decision = ?,justification = ?,reviewed_by_user_id = ?,
             device_id = ?,reviewed_at = ?,updated_at = ?,version = version + 1
         WHERE id = ? AND store_id = ? AND version = ?`,
        [
          input.decision,
          justification,
          input.actorUserId,
          input.deviceId,
          timestamp,
          timestamp,
          id,
          input.storeId,
          expectedVersion,
        ]
      );
      if (updated.changes !== 1) {
        throw new Error('La revisión cambió en otro proceso. Intenta nuevamente.');
      }
    } else {
      await transaction.run(
        `INSERT INTO cash_difference_reviews(
          id,store_id,cash_session_id,decision,justification,
          reviewed_by_user_id,device_id,reviewed_at,created_at,updated_at,version
        ) VALUES(?,?,?,?,?,?,?,?,?,?,1)`,
        [
          id,
          input.storeId,
          input.cashSessionId,
          input.decision,
          justification,
          input.actorUserId,
          input.deviceId,
          timestamp,
          timestamp,
          timestamp,
        ]
      );
    }

    const row = await transaction.getFirst<ReviewRow>(
      'SELECT * FROM cash_difference_reviews WHERE id = ? AND store_id = ?',
      [id, input.storeId]
    );
    if (!row) throw new Error('No se pudo recuperar la revisión.');

    const operationId = createId();
    await enqueueOperation(transaction, {
      id: createId(),
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'cash_difference_review',
      entityId: id,
      operationType: 'cash_difference.reviewed',
      payload: {
        id,
        storeId: input.storeId,
        cashSessionId: input.cashSessionId,
        decision: input.decision,
        justification,
        reviewedByUserId: input.actorUserId,
        deviceId: input.deviceId,
        reviewedAt: timestamp,
        expectedVersion,
      },
      timestamp,
    });
    return mapReview(row);
  });
}
