import { SupabaseSyncTransport } from './supabase-sync-transport';

export function createSupabaseSyncTransportFromEnv(
  getAccessToken: () => Promise<string | null> | string | null
) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      'Configura EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY para sincronizar.'
    );
  }
  return new SupabaseSyncTransport({
    supabaseUrl,
    anonKey,
    getAccessToken,
  });
}
