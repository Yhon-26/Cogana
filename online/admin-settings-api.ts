import { getSupabaseClient } from '@/auth/supabase-client';
import { DEFAULT_STORE_ID } from '@/database/seed';

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error('Supabase no está configurado.');
  return value;
}

export type AdminSettings = {
  store: {
    legalName: string;
    taxId: string;
    address: string;
    phone: string;
    businessHours: string;
    receiptFooter: string;
  };
  fiscal: {
    provider: string;
    environment: 'disabled' | 'demo' | 'production';
    invoiceSeries: string;
    receiptSeries: string;
    isEnabled: boolean;
    lastError: string | null;
  };
  stores: StoreBranch[];
};

export type StoreBranch = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
  status: 'active' | 'suspended' | 'archived';
};

export type StoreBranchInput = Omit<StoreBranch, 'id'> & {
  id?: string;
};

export async function getAdminSettings(): Promise<AdminSettings> {
  const [settings, fiscal, stores] = await Promise.all([
    client()
      .from('store_settings')
      .select(
        'legal_name,tax_id,address,phone,business_hours,receipt_footer'
      )
      .eq('store_id', DEFAULT_STORE_ID)
      .maybeSingle(),
    client()
      .from('fiscal_integrations')
      .select(
        'provider,environment,invoice_series,receipt_series,is_enabled,last_error'
      )
      .eq('store_id', DEFAULT_STORE_ID)
      .maybeSingle(),
    client().rpc('get_organization_stores', {
      p_origin_store_id: DEFAULT_STORE_ID,
    }),
  ]);
  if (settings.error) throw settings.error;
  if (fiscal.error) throw fiscal.error;
  if (stores.error) throw stores.error;
  return {
    store: {
      legalName: settings.data?.legal_name ?? '',
      taxId: settings.data?.tax_id ?? '',
      address: settings.data?.address ?? '',
      phone: settings.data?.phone ?? '',
      businessHours: settings.data?.business_hours ?? '',
      receiptFooter: settings.data?.receipt_footer ?? '',
    },
    fiscal: {
      provider: fiscal.data?.provider ?? 'none',
      environment: (fiscal.data?.environment ??
        'disabled') as AdminSettings['fiscal']['environment'],
      invoiceSeries: fiscal.data?.invoice_series ?? '',
      receiptSeries: fiscal.data?.receipt_series ?? '',
      isEnabled: fiscal.data?.is_enabled ?? false,
      lastError: fiscal.data?.last_error ?? null,
    },
    stores: (stores.data ?? []) as AdminSettings['stores'],
  };
}

export async function updateStoreSettings(input: AdminSettings['store']) {
  const { data, error } = await client().rpc('update_store_settings', {
    p_store_id: DEFAULT_STORE_ID,
    p_legal_name: input.legalName,
    p_tax_id: input.taxId || null,
    p_address: input.address,
    p_phone: input.phone,
    p_business_hours: input.businessHours,
    p_receipt_footer: input.receiptFooter,
  });
  if (error) throw error;
  return data;
}

export async function configureFiscalIntegration(
  input: AdminSettings['fiscal']
) {
  const { data, error } = await client().rpc(
    'configure_fiscal_integration',
    {
      p_store_id: DEFAULT_STORE_ID,
      p_provider: input.provider,
      p_environment: input.environment,
      p_invoice_series: input.invoiceSeries || null,
      p_receipt_series: input.receiptSeries || null,
      p_is_enabled: input.isEnabled,
    }
  );
  if (error) throw error;
  return data as {
    storeId: string;
    enabled: boolean;
    requiresServerSecret: boolean;
  };
}

export async function saveStoreBranch(input: StoreBranchInput) {
  const { data, error } = await client().rpc('save_store_branch', {
    p_origin_store_id: DEFAULT_STORE_ID,
    p_store_id: input.id ?? null,
    p_code: input.code,
    p_name: input.name,
    p_address: input.address,
    p_timezone: input.timezone,
    p_status: input.status,
  });
  if (error) throw error;
  return data as StoreBranch & { created: boolean };
}
