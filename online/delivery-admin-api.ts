import { getSupabaseClient } from '@/auth/supabase-client';
import { createId } from '@/database/ids';
import { DEFAULT_STORE_ID } from '@/database/seed';

export type DeliveryOperator = {
  id: string;
  name: string;
  operatorType: 'own' | 'external';
  integrationMode: 'manual' | 'api';
  trackingBaseUrl: string | null;
  supportPhone: string | null;
  priority: number;
  isActive: boolean;
};

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error('Supabase no está configurado.');
  return value;
}

export async function listDeliveryOperators() {
  const { data, error } = await client()
    .from('delivery_operators')
    .select(
      'id,name,operator_type,integration_mode,tracking_base_url,support_phone,priority,is_active'
    )
    .eq('store_id', DEFAULT_STORE_ID)
    .order('priority');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    operatorType: row.operator_type as DeliveryOperator['operatorType'],
    integrationMode:
      row.integration_mode as DeliveryOperator['integrationMode'],
    trackingBaseUrl: row.tracking_base_url as string | null,
    supportPhone: row.support_phone as string | null,
    priority: row.priority as number,
    isActive: row.is_active as boolean,
  }));
}

export async function saveDeliveryOperator(input: {
  name: string;
  operatorType: 'own' | 'external';
  integrationMode: 'manual' | 'api';
  trackingBaseUrl: string;
  supportPhone: string;
  priority: number;
}) {
  const { data, error } = await client().rpc('upsert_delivery_operator', {
    p_store_id: DEFAULT_STORE_ID,
    p_operator_id: createId(),
    p_name: input.name,
    p_operator_type: input.operatorType,
    p_integration_mode: input.integrationMode,
    p_tracking_base_url: input.trackingBaseUrl || null,
    p_support_phone: input.supportPhone || null,
    p_priority: input.priority,
    p_is_active: true,
  });
  if (error) throw error;
  return data;
}
