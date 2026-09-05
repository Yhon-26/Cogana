import type { SupabaseClient } from '@supabase/supabase-js';

export type OperatorDevicePlatform = 'android' | 'ios' | 'web';

export async function ensureStoreDeviceAuthorized(
  client: SupabaseClient,
  input: {
    storeId: string;
    deviceId: string;
    platform: OperatorDevicePlatform;
  }
) {
  const { error } = await client.from('devices').upsert(
    {
      id: input.deviceId,
      store_id: input.storeId,
      name: 'Dispositivo móvil Cogana',
      platform: input.platform,
      status: 'authorized',
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  if (error) throw error;
}
