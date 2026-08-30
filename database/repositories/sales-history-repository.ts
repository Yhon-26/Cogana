import type { DatabaseAdapter } from '../contracts';
import type { SaleStatus } from '../models';
import {
  getConfirmedSaleResult,
  type ConfirmedSaleResult,
} from './sales-repository';

export type SaleHistorySummary = {
  id: string;
  receiptNumber: string;
  actorDisplayName: string;
  status: SaleStatus;
  totalCents: number;
  paymentMethods: string;
  itemNames: string;
  createdAt: string;
  voidReason: string | null;
};

export async function listSalesHistory(
  database: DatabaseAdapter,
  storeId: string
) {
  const rows = await database.getAll<{
    id: string;
    receipt_number: string;
    actor_display_name: string;
    status: SaleStatus;
    total_cents: number;
    payment_methods: string;
    item_names: string;
    created_at: string;
    void_reason: string | null;
  }>(
    `SELECT s.id,s.receipt_number,u.display_name AS actor_display_name,
      s.status,s.total_cents,s.created_at,s.void_reason,
      (SELECT group_concat(p.payment_method, ' + ') FROM payments p
       WHERE p.sale_id = s.id AND p.store_id = s.store_id) AS payment_methods,
      (SELECT group_concat(si.product_name_snapshot, ', ') FROM sale_items si
       WHERE si.sale_id = s.id AND si.store_id = s.store_id) AS item_names
     FROM sales s
     JOIN local_users u ON u.id = s.actor_user_id AND u.store_id = s.store_id
     WHERE s.store_id = ? ORDER BY s.created_at DESC`,
    [storeId]
  );
  return rows.map((row) => ({
    id: row.id,
    receiptNumber: row.receipt_number,
    actorDisplayName: row.actor_display_name,
    status: row.status,
    totalCents: row.total_cents,
    paymentMethods: row.payment_methods,
    itemNames: row.item_names,
    createdAt: row.created_at,
    voidReason: row.void_reason,
  }));
}

export async function getSaleHistoryDetail(
  database: DatabaseAdapter,
  storeId: string,
  saleId: string
): Promise<ConfirmedSaleResult | null> {
  return getConfirmedSaleResult(database, storeId, saleId);
}
