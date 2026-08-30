import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';
import type {
  CashMovementRecord,
  CashMovementType,
  CashSessionRecord,
  CashSessionStatus,
} from '../models';
import { getActiveLocalUser } from './local-user-repository';
import { enqueueOperation } from './sync-outbox-repository';

type CashSessionRow = {
  id: string;
  store_id: string;
  device_id: string;
  responsible_user_id: string;
  status: CashSessionStatus;
  opening_cash_cents: number;
  cash_sales_cents: number | null;
  cash_income_cents: number | null;
  cash_outflow_cents: number | null;
  expected_cash_cents: number | null;
  counted_cash_cents: number | null;
  difference_cents: number | null;
  opened_at: string;
  closed_at: string | null;
  closed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type CashMovementRow = {
  id: string;
  store_id: string;
  cash_session_id: string;
  movement_type: CashMovementType;
  amount_cents: number;
  reason: string;
  actor_user_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type CashSalesSummaryRow = {
  cash_sales_cents: number;
};

type SaleTotalsRow = {
  total_sales_cents: number;
  sale_count: number;
};

type ManualCashSummaryRow = {
  income_cents: number;
  outflow_cents: number;
};

export type CashSessionSummary = {
  session: CashSessionRecord;
  totalSalesCents: number;
  cashSalesCents: number;
  manualIncomeCents: number;
  manualOutflowCents: number;
  expectedCashCents: number;
  saleCount: number;
};

export type OpenCashSessionInput = {
  storeId: string;
  deviceId: string;
  responsibleUserId: string;
  openingCashCents: number;
};

export type RecordCashMovementInput = {
  storeId: string;
  deviceId: string;
  cashSessionId: string;
  actorUserId: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
};

export type CloseCashSessionInput = {
  storeId: string;
  deviceId: string;
  cashSessionId: string;
  actorUserId: string;
  countedCashCents: number;
};

function mapCashSessionRow(row: CashSessionRow): CashSessionRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    deviceId: row.device_id,
    responsibleUserId: row.responsible_user_id,
    status: row.status,
    openingCashCents: row.opening_cash_cents,
    cashSalesCents: row.cash_sales_cents,
    cashIncomeCents: row.cash_income_cents,
    cashOutflowCents: row.cash_outflow_cents,
    expectedCashCents: row.expected_cash_cents,
    countedCashCents: row.counted_cash_cents,
    differenceCents: row.difference_cents,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    closedByUserId: row.closed_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function mapCashMovementRow(row: CashMovementRow): CashMovementRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    cashSessionId: row.cash_session_id,
    type: row.movement_type,
    amountCents: row.amount_cents,
    reason: row.reason,
    actorUserId: row.actor_user_id,
    deviceId: row.device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

async function requireActiveUser(
  database: DatabaseAdapter,
  storeId: string,
  userId: string
) {
  const user = await getActiveLocalUser(database, storeId, userId);
  if (!user) {
    throw new Error('Selecciona un usuario local activo para registrar la operación.');
  }
  return user;
}

export async function getCashSessionById(
  database: DatabaseAdapter,
  storeId: string,
  sessionId: string
): Promise<CashSessionRecord | null> {
  const row = await database.getFirst<CashSessionRow>(
    'SELECT * FROM cash_sessions WHERE id = ? AND store_id = ?',
    [sessionId, storeId]
  );
  return row ? mapCashSessionRow(row) : null;
}

export async function getOpenCashSession(
  database: DatabaseAdapter,
  storeId: string,
  deviceId: string
): Promise<CashSessionRecord | null> {
  const row = await database.getFirst<CashSessionRow>(
    `SELECT *
     FROM cash_sessions
     WHERE store_id = ? AND device_id = ? AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [storeId, deviceId]
  );
  return row ? mapCashSessionRow(row) : null;
}

export async function getCashSessionSummary(
  database: DatabaseAdapter,
  storeId: string,
  sessionId: string
): Promise<CashSessionSummary> {
  const session = await getCashSessionById(database, storeId, sessionId);
  if (!session) {
    throw new Error('No se encontró la caja solicitada.');
  }

  const sales = await database.getFirst<SaleTotalsRow>(
    `SELECT
       COALESCE(SUM(total_cents), 0) AS total_sales_cents,
       COUNT(*) AS sale_count
     FROM sales
     WHERE store_id = ? AND cash_session_id = ? AND voided_at IS NULL`,
    [storeId, sessionId]
  );
  const cashPayments = await database.getFirst<CashSalesSummaryRow>(
    `SELECT COALESCE(SUM(payments.amount_cents), 0) AS cash_sales_cents
     FROM payments
     INNER JOIN sales
       ON sales.id = payments.sale_id
       AND sales.store_id = payments.store_id
     WHERE sales.store_id = ?
       AND sales.cash_session_id = ?
       AND sales.voided_at IS NULL
       AND payments.payment_method = 'cash'`,
    [storeId, sessionId]
  );
  const manual = await database.getFirst<ManualCashSummaryRow>(
    `SELECT
       COALESCE(SUM(CASE WHEN movement_type = 'income' THEN amount_cents ELSE 0 END), 0)
         AS income_cents,
       COALESCE(SUM(CASE WHEN movement_type = 'outflow' THEN amount_cents ELSE 0 END), 0)
         AS outflow_cents
     FROM cash_movements
     WHERE store_id = ? AND cash_session_id = ?`,
    [storeId, sessionId]
  );

  const cashSalesCents = cashPayments?.cash_sales_cents ?? 0;
  const manualIncomeCents = manual?.income_cents ?? 0;
  const manualOutflowCents = manual?.outflow_cents ?? 0;

  return {
    session,
    totalSalesCents: sales?.total_sales_cents ?? 0,
    cashSalesCents,
    manualIncomeCents,
    manualOutflowCents,
    expectedCashCents:
      session.openingCashCents + cashSalesCents + manualIncomeCents - manualOutflowCents,
    saleCount: sales?.sale_count ?? 0,
  };
}

export async function openCashSession(
  database: DatabaseAdapter,
  input: OpenCashSessionInput
): Promise<CashSessionRecord> {
  if (!Number.isSafeInteger(input.openingCashCents) || input.openingCashCents < 0) {
    throw new Error('El fondo inicial debe expresarse en céntimos enteros no negativos.');
  }
  if (!input.deviceId) {
    throw new Error('La apertura requiere un identificador de dispositivo.');
  }

  const sessionId = createId();
  const outboxId = createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    await requireActiveUser(transaction, input.storeId, input.responsibleUserId);

    const current = await getOpenCashSession(transaction, input.storeId, input.deviceId);
    if (current) {
      throw new Error('Este dispositivo ya tiene una caja abierta.');
    }

    await transaction.run(
      `INSERT INTO cash_sessions (
        id, store_id, device_id, responsible_user_id, status,
        opening_cash_cents, cash_sales_cents, cash_income_cents,
        cash_outflow_cents, expected_cash_cents, counted_cash_cents,
        difference_cents, opened_at, closed_at, closed_by_user_id,
        created_at, updated_at, version
      ) VALUES (
        ?, ?, ?, ?, 'open',
        ?, NULL, NULL, NULL, NULL, NULL,
        NULL, ?, NULL, NULL, ?, ?, 1
      )`,
      [
        sessionId,
        input.storeId,
        input.deviceId,
        input.responsibleUserId,
        input.openingCashCents,
        timestamp,
        timestamp,
        timestamp,
      ]
    );

    await enqueueOperation(transaction, {
      id: outboxId,
      storeId: input.storeId,
      actorUserId: input.responsibleUserId,
      operationId: sessionId,
      entityType: 'cash_session',
      entityId: sessionId,
      operationType: 'cash_session.opened',
      payload: {
        id: sessionId,
        storeId: input.storeId,
        deviceId: input.deviceId,
        responsibleUserId: input.responsibleUserId,
        openingCashCents: input.openingCashCents,
        openedAt: timestamp,
      },
      timestamp,
    });

    const session = await getCashSessionById(transaction, input.storeId, sessionId);
    if (!session) {
      throw new Error('No se pudo recuperar la caja abierta.');
    }
    return session;
  });
}

export async function recordCashMovement(
  database: DatabaseAdapter,
  input: RecordCashMovementInput
): Promise<CashMovementRecord> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('El movimiento debe tener un monto entero mayor que cero.');
  }
  if (!input.reason.trim()) {
    throw new Error('El movimiento de caja requiere un motivo.');
  }

  const movementId = createId();
  const outboxId = createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    await requireActiveUser(transaction, input.storeId, input.actorUserId);

    const session = await getCashSessionById(
      transaction,
      input.storeId,
      input.cashSessionId
    );
    if (!session || session.status !== 'open' || session.deviceId !== input.deviceId) {
      throw new Error('El movimiento requiere una caja abierta en este dispositivo.');
    }

    if (input.type === 'outflow') {
      const summary = await getCashSessionSummary(
        transaction,
        input.storeId,
        input.cashSessionId
      );
      if (input.amountCents > summary.expectedCashCents) {
        throw new Error('La salida supera el efectivo esperado en caja.');
      }
    }

    await transaction.run(
      `INSERT INTO cash_movements (
        id, store_id, cash_session_id, movement_type, amount_cents,
        reason, actor_user_id, device_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        movementId,
        input.storeId,
        input.cashSessionId,
        input.type,
        input.amountCents,
        input.reason.trim(),
        input.actorUserId,
        input.deviceId,
        timestamp,
        timestamp,
      ]
    );

    await enqueueOperation(transaction, {
      id: outboxId,
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId: movementId,
      entityType: 'cash_movement',
      entityId: movementId,
      operationType: `cash_movement.${input.type}`,
      payload: {
        id: movementId,
        storeId: input.storeId,
        cashSessionId: input.cashSessionId,
        type: input.type,
        amountCents: input.amountCents,
        reason: input.reason.trim(),
        actorUserId: input.actorUserId,
        deviceId: input.deviceId,
        createdAt: timestamp,
      },
      timestamp,
    });

    const row = await transaction.getFirst<CashMovementRow>(
      'SELECT * FROM cash_movements WHERE id = ? AND store_id = ?',
      [movementId, input.storeId]
    );
    if (!row) {
      throw new Error('No se pudo recuperar el movimiento de caja.');
    }
    return mapCashMovementRow(row);
  });
}

export async function listCashMovements(
  database: DatabaseAdapter,
  storeId: string,
  cashSessionId: string
): Promise<CashMovementRecord[]> {
  const rows = await database.getAll<CashMovementRow>(
    `SELECT *
     FROM cash_movements
     WHERE store_id = ? AND cash_session_id = ?
     ORDER BY created_at DESC, id DESC`,
    [storeId, cashSessionId]
  );
  return rows.map(mapCashMovementRow);
}

export async function closeCashSession(
  database: DatabaseAdapter,
  input: CloseCashSessionInput
): Promise<CashSessionRecord> {
  if (!Number.isSafeInteger(input.countedCashCents) || input.countedCashCents < 0) {
    throw new Error('El efectivo contado debe ser un entero no negativo.');
  }

  const operationId = createId();
  const outboxId = createId();
  const timestamp = new Date().toISOString();

  return database.transaction(async (transaction) => {
    await requireActiveUser(transaction, input.storeId, input.actorUserId);

    const summary = await getCashSessionSummary(
      transaction,
      input.storeId,
      input.cashSessionId
    );
    if (summary.session.status !== 'open' || summary.session.deviceId !== input.deviceId) {
      throw new Error('No existe una caja abierta para cerrar en este dispositivo.');
    }
    if (summary.expectedCashCents < 0) {
      throw new Error('El efectivo esperado no puede ser negativo.');
    }

    const differenceCents = input.countedCashCents - summary.expectedCashCents;
    const update = await transaction.run(
      `UPDATE cash_sessions
       SET status = 'closed',
           cash_sales_cents = ?,
           cash_income_cents = ?,
           cash_outflow_cents = ?,
           expected_cash_cents = ?,
           counted_cash_cents = ?,
           difference_cents = ?,
           closed_at = ?,
           closed_by_user_id = ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ? AND store_id = ? AND status = 'open' AND version = ?`,
      [
        summary.cashSalesCents,
        summary.manualIncomeCents,
        summary.manualOutflowCents,
        summary.expectedCashCents,
        input.countedCashCents,
        differenceCents,
        timestamp,
        input.actorUserId,
        timestamp,
        input.cashSessionId,
        input.storeId,
        summary.session.version,
      ]
    );
    if (update.changes !== 1) {
      throw new Error('La caja cambió antes de cerrarse. Intenta nuevamente.');
    }

    await enqueueOperation(transaction, {
      id: outboxId,
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      operationId,
      entityType: 'cash_session',
      entityId: input.cashSessionId,
      operationType: 'cash_session.closed',
      payload: {
        id: input.cashSessionId,
        storeId: input.storeId,
        deviceId: input.deviceId,
        actorUserId: input.actorUserId,
        openingCashCents: summary.session.openingCashCents,
        cashSalesCents: summary.cashSalesCents,
        cashIncomeCents: summary.manualIncomeCents,
        cashOutflowCents: summary.manualOutflowCents,
        expectedCashCents: summary.expectedCashCents,
        countedCashCents: input.countedCashCents,
        differenceCents,
        closedAt: timestamp,
      },
      timestamp,
    });

    const closed = await getCashSessionById(
      transaction,
      input.storeId,
      input.cashSessionId
    );
    if (!closed) {
      throw new Error('No se pudo recuperar el cierre de caja.');
    }
    return closed;
  });
}
