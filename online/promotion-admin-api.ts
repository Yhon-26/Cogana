import { getSupabaseClient } from '@/auth/supabase-client';
import { createId } from '@/database/ids';
import { DEFAULT_STORE_ID } from '@/database/seed';

export type StorePromotion = {
  id: string;
  title: string;
  description: string;
  couponCode: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  version: number;
};

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error('Supabase no está configurado.');
  return value;
}

export async function listStorePromotions() {
  const { data, error } = await client().rpc('get_store_promotions', {
    p_store_id: DEFAULT_STORE_ID,
  });
  if (error) throw error;
  return (data ?? []) as StorePromotion[];
}

export async function saveStorePromotion(
  input: Omit<StorePromotion, 'id' | 'version'> & {
    id?: string;
    expectedVersion?: number | null;
  }
) {
  const { data, error } = await client().rpc('upsert_store_promotion', {
    p_store_id: DEFAULT_STORE_ID,
    p_promotion_id: input.id ?? createId(),
    p_title: input.title,
    p_description: input.description,
    p_coupon_code: input.couponCode,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_is_active: input.isActive,
    p_expected_version: input.expectedVersion ?? null,
  });
  if (error) throw error;
  return data as { id: string; version: number };
}
