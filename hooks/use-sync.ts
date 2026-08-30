import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import { getSupabaseClient } from '@/auth/supabase-client';
import { ExpoSQLiteAdapter } from '@/database/expo-sqlite-adapter';
import { createSupabaseSyncTransportFromEnv } from '@/sync/config';
import type { SyncCycleResult } from '@/sync/contracts';
import { uploadPendingDeliveryEvidence } from '@/sync/delivery-evidence-uploader';
import { runSyncCycle } from '@/sync/sync-engine';

type UseSyncOptions = {
  storeId: string;
  deviceId: string;
  actorUserId: string;
  getAccessToken: () => Promise<string | null> | string | null;
};

export function useSync({
  storeId,
  deviceId,
  actorUserId,
  getAccessToken,
}: UseSyncOptions) {
  const sqlite = useSQLiteContext();
  const database = useMemo(() => new ExpoSQLiteAdapter(sqlite), [sqlite]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncCycleResult | null>(null);

  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        await uploadPendingDeliveryEvidence(
          database,
          supabase,
          storeId,
          actorUserId
        );
      }
      const result = await runSyncCycle(
        database,
        createSupabaseSyncTransportFromEnv(getAccessToken),
        { storeId, deviceId, actorUserId }
      );
      setLastResult(result);
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [actorUserId, deviceId, getAccessToken, sqlite, storeId]);

  return {
    isSyncing,
    lastResult,
    syncNow,
  };
}
