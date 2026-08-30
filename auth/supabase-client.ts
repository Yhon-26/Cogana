import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;
let customerClient: SupabaseClient | null | undefined;

export function getSupabasePublicConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const publishableKey =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    '';
  return {
    url,
    publishableKey,
    isConfigured: Boolean(url && publishableKey),
  };
}

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const config = getSupabasePublicConfig();
  if (!config.isConfigured) {
    client = null;
    return client;
  }
  client = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function getCustomerSupabaseClient(): SupabaseClient | null {
  if (customerClient !== undefined) return customerClient;
  const config = getSupabasePublicConfig();
  if (!config.isConfigured) {
    customerClient = null;
    return customerClient;
  }
  customerClient = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      storageKey: 'coguana-customer-auth',
    },
  });
  return customerClient;
}
