import { getCustomerSupabaseClient } from '@/auth/supabase-client';
import { createId } from '@/database/ids';
import { DEFAULT_STORE_ID } from '@/database/seed';
import type { BusinessContext } from '@/online/business-contracts';

function client() {
  const value = getCustomerSupabaseClient();
  if (!value) throw new Error('Supabase no está configurado.');
  return value;
}

export async function registerBusinessAccount(input: {
  legalName: string;
  tradeName?: string;
  taxId: string;
  businessType: 'restaurant' | 'wholesale';
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
}) {
  const { data, error } = await client().rpc('register_business_account', {
    p_store_id: DEFAULT_STORE_ID,
    p_business_id: createId(),
    p_legal_name: input.legalName,
    p_trade_name: input.tradeName || null,
    p_tax_id: input.taxId,
    p_business_type: input.businessType,
    p_contact_name: input.contactName,
    p_contact_phone: input.contactPhone,
    p_contact_email: input.contactEmail || null,
  });
  if (error) throw error;
  return data as { id: string; status: 'pending' };
}

export async function getMyBusinessContext() {
  const { data, error } = await client().rpc('get_my_business_context', {
    p_store_id: DEFAULT_STORE_ID,
  });
  if (error) throw error;
  return data as BusinessContext;
}

export async function updateMyBusinessAccount(input: {
  businessAccountId: string;
  legalName: string;
  tradeName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}) {
  const { data, error } = await client().rpc('update_my_business_account', {
    p_store_id: DEFAULT_STORE_ID,
    p_business_account_id: input.businessAccountId,
    p_legal_name: input.legalName,
    p_trade_name: input.tradeName || null,
    p_contact_name: input.contactName,
    p_contact_phone: input.contactPhone,
    p_contact_email: input.contactEmail || null,
  });
  if (error) throw error;
  return data as { id: string; updated: boolean };
}

export async function createBusinessQuote(input: {
  businessAccountId: string;
  requestedDeliveryAt: string | null;
  recurrence: 'once' | 'weekly' | 'biweekly' | 'monthly';
  notes: string;
  items: { productId: string; quantity: number }[];
}) {
  const { data, error } = await client().rpc('create_business_quote', {
    p_store_id: DEFAULT_STORE_ID,
    p_quote_id: createId(),
    p_business_account_id: input.businessAccountId,
    p_requested_delivery_at: input.requestedDeliveryAt,
    p_recurrence: input.recurrence,
    p_notes: input.notes || null,
    p_items: input.items.map((item) => ({ id: createId(), ...item })),
  });
  if (error) throw error;
  return data as { id: string; status: 'requested' };
}

export async function acceptMyBusinessQuote(quoteId: string) {
  const { data, error } = await client().rpc('accept_my_business_quote', {
    p_store_id: DEFAULT_STORE_ID,
    p_quote_id: quoteId,
  });
  if (error) throw error;
  return data as { id: string; status: 'accepted'; orderId: string };
}

export async function saveRecurringBusinessOrder(input: {
  businessAccountId: string;
  name: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  nextRunAt: string;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryAddress: Record<string, unknown> | null;
  items: { productId: string; quantity: number }[];
}) {
  const { data, error } = await client().rpc('save_recurring_order', {
    p_store_id: DEFAULT_STORE_ID,
    p_recurring_id: createId(),
    p_business_account_id: input.businessAccountId,
    p_name: input.name,
    p_frequency: input.frequency,
    p_next_run_at: input.nextRunAt,
    p_fulfillment_type: input.fulfillmentType,
    p_delivery_address: input.deliveryAddress,
    p_items: input.items,
  });
  if (error) throw error;
  return data as { id: string; active: boolean };
}
