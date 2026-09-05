import { useCallback } from 'react';

import { useLocalOperator } from '@/context/local-operator-context';
import { useSupabaseAuth } from '@/context/supabase-auth-context';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useSync } from '@/hooks/use-sync';
import type { SyncCycleResult } from '@/sync/contracts';

export type SaveSyncState = 'synced' | 'pending';

const FLUSH_TIMEOUT_MS = 6_000;

function delay(ms: number) {
  return new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), ms);
  });
}

export function useSaveSync() {
  const { selectedUser, deviceId } = useLocalOperator();
  const { state, getAccessToken } = useSupabaseAuth();
  const { syncNow } = useSync({
    storeId: DEFAULT_STORE_ID,
    deviceId,
    actorUserId: selectedUser?.id ?? '',
    getAccessToken,
  });

  const flushNow = useCallback(async (): Promise<SaveSyncState> => {
    if (state !== 'authenticated' || !selectedUser?.id || !deviceId) {
      return 'pending';
    }
    let result: SyncCycleResult | 'timeout';
    try {
      result = await Promise.race([syncNow(), delay(FLUSH_TIMEOUT_MS)]);
    } catch {
      return 'pending';
    }
    if (
      result !== 'timeout' &&
      result.status === 'completed' &&
      result.error === null &&
      result.rejected === 0
    ) {
      return 'synced';
    }
    return 'pending';
  }, [deviceId, selectedUser?.id, state, syncNow]);

  return { flushNow };
}
