import type { DatabaseAdapter } from '../contracts';

export type SalesReportSummary = {
  saleCount: number;
  totalCents: number;
  averageTicketCents: number;
  estimatedCostCents: number;
  estimatedMarginCents: number;
};

export type ProductSalesReport = {
  productId: string;
  productName: string;
  quantity: number;
  baseUnit: 'gram' | 'unit';
  salesCents: number;
  costCents: number;
  marginCents: number;
};

export type PaymentReport = {
  method: string;
  totalCents: number;
  paymentCount: number;
};

export type InventoryReport = {
  productCount: number;
  lowStockCount: number;
  stockValueCents: number;
  retailValueCents: number;
};

export type CustomerReport = {
  customerId: string;
  customerName: string;
  phone: string;
  orderCount: number;
  totalCents: number;
};

export type CashDifferenceReport = {
  sessionId: string;
  responsibleName: string;
  closedAt: string;
  expectedCashCents: number;
  countedCashCents: number;
  differenceCents: number;
  reviewDecision: 'approved' | 'requires_action' | null;
  reviewJustification: string | null;
  reviewedAt: string | null;
};

export type AuditReport = {
  id: string;
  eventType: string;
  description: string;
  actorName: string;
  createdAt: string;
};

export type ReportDashboard = {
  sales: SalesReportSummary;
  products: ProductSalesReport[];
  payments: PaymentReport[];
  inventory: InventoryReport;
  customers: CustomerReport[];
  cashDifferences: CashDifferenceReport[];
  audit: AuditReport[];
};

export async function getReportDashboard(
  database: DatabaseAdapter,
  storeId: string
): Promise<ReportDashboard> {
  const sales = await database.getFirst<{
    sale_count: number;
    total_cents: number;
    average_ticket_cents: number;
    estimated_cost_cents: number;
  }>(
    `WITH returned AS (
       SELECT sale_item_id,SUM(quantity) AS returned_quantity,
         SUM(refund_cents) AS refund_cents
       FROM sale_return_items WHERE store_id = ?
       GROUP BY sale_item_id
     )
     SELECT COUNT(DISTINCT s.id) AS sale_count,
      COALESCE(SUM(si.line_total_cents - COALESCE(r.refund_cents,0)),0)
        AS total_cents,
      CASE WHEN COUNT(DISTINCT s.id) = 0 THEN 0
        ELSE (COALESCE(SUM(
          si.line_total_cents - COALESCE(r.refund_cents,0)
        ),0) + COUNT(DISTINCT s.id) / 2) / COUNT(DISTINCT s.id) END
        AS average_ticket_cents,
      COALESCE(SUM(
        ((si.quantity - COALESCE(r.returned_quantity,0))
          * si.cost_cents_snapshot
          + si.cost_pricing_quantity_snapshot / 2)
        / si.cost_pricing_quantity_snapshot
      ),0) AS estimated_cost_cents
     FROM sales s
     LEFT JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
     LEFT JOIN returned r ON r.sale_item_id = si.id
     WHERE s.store_id = ? AND s.status = 'confirmed'
       AND s.voided_at IS NULL`,
    [storeId, storeId]
  );
  const products = await database.getAll<{
    product_id: string;
    product_name: string;
    quantity: number;
    base_unit: 'gram' | 'unit';
    sales_cents: number;
    cost_cents: number;
  }>(
    `WITH returned AS (
       SELECT sale_item_id,SUM(quantity) AS returned_quantity,
         SUM(refund_cents) AS refund_cents
       FROM sale_return_items WHERE store_id = ?
       GROUP BY sale_item_id
     )
     SELECT si.product_id,si.product_name_snapshot AS product_name,
      SUM(si.quantity - COALESCE(r.returned_quantity,0)) AS quantity,
      si.base_unit_snapshot AS base_unit,
      SUM(si.line_total_cents - COALESCE(r.refund_cents,0)) AS sales_cents,
      SUM(((si.quantity - COALESCE(r.returned_quantity,0))
        * si.cost_cents_snapshot
        + si.cost_pricing_quantity_snapshot / 2)
        / si.cost_pricing_quantity_snapshot) AS cost_cents
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id AND s.store_id = si.store_id
     LEFT JOIN returned r ON r.sale_item_id = si.id
     WHERE si.store_id = ? AND s.status = 'confirmed'
       AND s.voided_at IS NULL
     GROUP BY si.product_id,si.product_name_snapshot,si.base_unit_snapshot
     ORDER BY sales_cents DESC`,
    [storeId, storeId]
  );
  const payments = await database.getAll<{
    method: string;
    total_cents: number;
    payment_count: number;
  }>(
    `WITH methods AS (
       SELECT p.payment_method AS method
       FROM payments p
       JOIN sales s ON s.id = p.sale_id AND s.store_id = p.store_id
       WHERE p.store_id = ? AND s.voided_at IS NULL
       UNION
       SELECT refund_method FROM sale_returns WHERE store_id = ?
     )
     SELECT methods.method,
       COALESCE((
         SELECT SUM(p.amount_cents)
         FROM payments p
         JOIN sales s ON s.id = p.sale_id AND s.store_id = p.store_id
         WHERE p.store_id = ? AND p.payment_method = methods.method
           AND s.voided_at IS NULL
       ),0) - COALESCE((
         SELECT SUM(sr.total_cents) FROM sale_returns sr
         WHERE sr.store_id = ? AND sr.refund_method = methods.method
       ),0) AS total_cents,
       COALESCE((
         SELECT COUNT(*) FROM payments p
         JOIN sales s ON s.id = p.sale_id AND s.store_id = p.store_id
         WHERE p.store_id = ? AND p.payment_method = methods.method
           AND s.voided_at IS NULL
       ),0) AS payment_count
     FROM methods ORDER BY total_cents DESC`,
    [storeId, storeId, storeId, storeId, storeId]
  );
  const inventory = await database.getFirst<{
    product_count: number;
    low_stock_count: number;
    stock_value_cents: number;
    retail_value_cents: number;
  }>(
    `SELECT COUNT(*) AS product_count,
      SUM(CASE WHEN stock_quantity <= minimum_stock_quantity THEN 1 ELSE 0 END)
        AS low_stock_count,
      COALESCE(SUM(
        (stock_quantity * cost_cents + pricing_quantity / 2) / pricing_quantity
      ),0) AS stock_value_cents,
      COALESCE(SUM(
        (stock_quantity * price_cents + pricing_quantity / 2) / pricing_quantity
      ),0) AS retail_value_cents
     FROM products WHERE store_id = ? AND is_active = 1`,
    [storeId]
  );
  const customers = await database.getAll<{
    customer_id: string;
    customer_name: string;
    phone: string;
    order_count: number;
    total_cents: number;
  }>(
    `SELECT c.id AS customer_id,c.name AS customer_name,c.phone,
      COUNT(o.id) AS order_count,
      COALESCE(SUM(COALESCE(o.final_total_cents,o.estimated_total_cents)),0)
        AS total_cents
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id AND o.store_id = c.store_id
       AND o.status <> 'cancelled'
     WHERE c.store_id = ?
     GROUP BY c.id,c.name,c.phone
     ORDER BY total_cents DESC,order_count DESC LIMIT 20`,
    [storeId]
  );
  const cashDifferences = await database.getAll<{
    session_id: string;
    responsible_name: string;
    closed_at: string;
    expected_cash_cents: number;
    counted_cash_cents: number;
    difference_cents: number;
    review_decision: 'approved' | 'requires_action' | null;
    review_justification: string | null;
    reviewed_at: string | null;
  }>(
    `SELECT cs.id AS session_id,u.display_name AS responsible_name,cs.closed_at,
      cs.expected_cash_cents,cs.counted_cash_cents,cs.difference_cents,
      cdr.decision AS review_decision,
      cdr.justification AS review_justification,cdr.reviewed_at
     FROM cash_sessions cs
     JOIN local_users u
       ON u.id = cs.responsible_user_id AND u.store_id = cs.store_id
     LEFT JOIN cash_difference_reviews cdr
       ON cdr.cash_session_id = cs.id AND cdr.store_id = cs.store_id
     WHERE cs.store_id = ? AND cs.status = 'closed'
     ORDER BY cs.closed_at DESC LIMIT 20`,
    [storeId]
  );
  const audit = await database.getAll<AuditReport>(
    `SELECT ph.id,'price' AS eventType,
      'Precio ' || p.name || ': ' || ph.previous_price_cents || ' → ' ||
        ph.new_price_cents AS description,
      COALESCE(u.display_name,'Sistema') AS actorName,ph.created_at AS createdAt
     FROM price_history ph
     JOIN products p ON p.id = ph.product_id AND p.store_id = ph.store_id
     LEFT JOIN local_users u
       ON u.id = ph.actor_user_id AND u.store_id = ph.store_id
     WHERE ph.store_id = ?
     UNION ALL
     SELECT ssh.id,'sale_status',
       'Venta ' || s.receipt_number || ': ' || ssh.to_status || ' · ' || ssh.reason,
       u.display_name,ssh.created_at
     FROM sale_status_history ssh
     JOIN sales s ON s.id = ssh.sale_id AND s.store_id = ssh.store_id
     JOIN local_users u
       ON u.id = ssh.actor_user_id AND u.store_id = ssh.store_id
     WHERE ssh.store_id = ?
     UNION ALL
     SELECT oh.id,'order_status',
       'Pedido ' || o.order_number || ': ' || oh.to_status || ' · ' || oh.reason,
       u.display_name,oh.created_at
     FROM order_status_history oh
     JOIN orders o ON o.id = oh.order_id AND o.store_id = oh.store_id
     JOIN local_users u
       ON u.id = oh.actor_user_id AND u.store_id = oh.store_id
     WHERE oh.store_id = ?
     ORDER BY createdAt DESC LIMIT 50`,
    [storeId, storeId, storeId]
  );

  const totalCents = sales?.total_cents ?? 0;
  const costCents = sales?.estimated_cost_cents ?? 0;
  return {
    sales: {
      saleCount: sales?.sale_count ?? 0,
      totalCents,
      averageTicketCents: sales?.average_ticket_cents ?? 0,
      estimatedCostCents: costCents,
      estimatedMarginCents: totalCents - costCents,
    },
    products: products.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      quantity: row.quantity,
      baseUnit: row.base_unit,
      salesCents: row.sales_cents,
      costCents: row.cost_cents,
      marginCents: row.sales_cents - row.cost_cents,
    })),
    payments: payments.map((row) => ({
      method: row.method,
      totalCents: row.total_cents,
      paymentCount: row.payment_count,
    })),
    inventory: {
      productCount: inventory?.product_count ?? 0,
      lowStockCount: inventory?.low_stock_count ?? 0,
      stockValueCents: inventory?.stock_value_cents ?? 0,
      retailValueCents: inventory?.retail_value_cents ?? 0,
    },
    customers: customers.map((row) => ({
      customerId: row.customer_id,
      customerName: row.customer_name,
      phone: row.phone,
      orderCount: row.order_count,
      totalCents: row.total_cents,
    })),
    cashDifferences: cashDifferences.map((row) => ({
      sessionId: row.session_id,
      responsibleName: row.responsible_name,
      closedAt: row.closed_at,
      expectedCashCents: row.expected_cash_cents,
      countedCashCents: row.counted_cash_cents,
      differenceCents: row.difference_cents,
      reviewDecision: row.review_decision,
      reviewJustification: row.review_justification,
      reviewedAt: row.reviewed_at,
    })),
    audit,
  };
}
