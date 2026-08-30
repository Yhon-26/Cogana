import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { DeliveryZoneRecord } from '@/database/models';
import { listDeliveryZones } from '@/database/repositories/delivery-zone-repository';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';
import { getOperatorErrorMessage } from '@/lib/user-facing-error';

export function useDeliveryZones() {
  const database = useLocalDatabase();
  const [zones, setZones] = useState<DeliveryZoneRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(
    async (showLoading = true) => {
      if (showLoading) setIsLoading(true);
      setError(null);
      try {
        setZones(await listDeliveryZones(database, DEFAULT_STORE_ID));
      } catch (caughtError) {
        setError(
          new Error(
            getOperatorErrorMessage(
              caughtError,
              'No se pudieron cargar las zonas de delivery.'
            )
          )
        );
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [database]
  );

  useFocusEffect(
    useCallback(() => {
      void refresh(true);
    }, [refresh])
  );

  return { database, zones, isLoading, error, refresh };
}
