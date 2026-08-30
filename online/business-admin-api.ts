import { getSupabaseClient } from '@/auth/supabase-client';
import { createId } from '@/database/ids';
import { DEFAULT_STORE_ID } from '@/database/seed';
import type {
  BusinessAccount,
  BusinessQuote,
  BusinessQuoteItem,
} from '@/online/business-contracts';

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error('Supabase no está configurado.');
  return value;
}

type AccountRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string;
  business_type: BusinessAccount['businessType'];
  status: BusinessAccount['status'];
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  credit_limit_cents: number;
  credit_used_cents: number;
  payment_terms_days: number;
};

type QuoteItemRow = {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  base_unit: 'gram' | 'unit';
  catalog_price_cents: number;
  quoted_price_cents: number | null;
  quoted_line_cents: number | null;
};

type QuoteRow = {
  id: string;
  business_account_id: string;
  order_id: string | null;
  status: BusinessQuote['status'];
  requested_delivery_at: string | null;
  recurrence: BusinessQuote['recurrence'];
  notes: string | null;
  quoted_total_cents: number | null;
  valid_until: string | null;
  admin_notes: string | null;
  created_at: string;
  business_quote_items: QuoteItemRow[];
};

function mapAccount(row: AccountRow): BusinessAccount {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    taxId: row.tax_id,
    businessType: row.business_type,
    status: row.status,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    creditLimitCents: row.credit_limit_cents,
    creditUsedCents: row.credit_used_cents,
    paymentTermsDays: row.payment_terms_days,
  };
}

function mapItem(row: QuoteItemRow): BusinessQuoteItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    quantity: row.quantity,
    baseUnit: row.base_unit,
    catalogPriceCents: row.catalog_price_cents,
    quotedPriceCents: row.quoted_price_cents,
    quotedLineCents: row.quoted_line_cents,
  };
}

function mapQuote(row: QuoteRow): BusinessQuote {
  return {
    id: row.id,
    businessAccountId: row.business_account_id,
    orderId: row.order_id,
    status: row.status,
    requestedDeliveryAt: row.requested_delivery_at,
    recurrence: row.recurrence,
    notes: row.notes,
    quotedTotalCents: row.quoted_total_cents,
    validUntil: row.valid_until,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    items: row.business_quote_items.map(mapItem),
  };
}

export async function listBusinessOperations() {
  const [accountsResult, quotesResult] = await Promise.all([
    client()
      .from('business_accounts')
      .select(
        'id,legal_name,trade_name,tax_id,business_type,status,contact_name,contact_phone,contact_email,credit_limit_cents,credit_used_cents,payment_terms_days'
      )
      .eq('store_id', DEFAULT_STORE_ID)
      .order('created_at', { ascending: false }),
    client()
      .from('business_quotes')
      .select(
        'id,business_account_id,order_id,status,requested_delivery_at,recurrence,notes,quoted_total_cents,valid_until,admin_notes,created_at,business_quote_items(id,product_id,product_name_snapshot,quantity,base_unit,catalog_price_cents,quoted_price_cents,quoted_line_cents)'
      )
      .eq('store_id', DEFAULT_STORE_ID)
      .order('created_at', { ascending: false }),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (quotesResult.error) throw quotesResult.error;
  return {
    accounts: (accountsResult.data as AccountRow[]).map(mapAccount),
    quotes: (quotesResult.data as unknown as QuoteRow[]).map(mapQuote),
  };
}

export async function reviewBusinessAccount(input: {
  businessAccountId: string;
  status: 'approved' | 'rejected' | 'suspended';
  creditLimitCents: number;
  paymentTermsDays: number;
}) {
  const { data, error } = await client().rpc('review_business_account', {
    p_store_id: DEFAULT_STORE_ID,
    p_business_account_id: input.businessAccountId,
    p_status: input.status,
    p_credit_limit_cents: input.creditLimitCents,
    p_payment_terms_days: input.paymentTermsDays,
  });
  if (error) throw error;
  return data;
}

export async function respondBusinessQuote(input: {
  quoteId: string;
  validUntil: string;
  adminNotes: string;
  items: { id: string; priceCents: number; lineCents: number }[];
}) {
  const { data, error } = await client().rpc('respond_business_quote', {
    p_store_id: DEFAULT_STORE_ID,
    p_quote_id: input.quoteId,
    p_valid_until: input.validUntil,
    p_admin_notes: input.adminNotes || null,
    p_items: input.items,
  });
  if (error) throw error;
  return data;
}

export async function setBusinessPrice(input: {
  businessAccountId: string;
  productId: string;
  minimumQuantity: number;
  priceCents: number;
  validUntil: string | null;
}) {
  const { data, error } = await client().rpc('set_business_price', {
    p_store_id: DEFAULT_STORE_ID,
    p_price_id: createId(),
    p_business_account_id: input.businessAccountId,
    p_product_id: input.productId,
    p_minimum_quantity: input.minimumQuantity,
    p_price_cents: input.priceCents,
    p_valid_until: input.validUntil,
    p_is_active: true,
  });
  if (error) throw error;
  return data;
}
