import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { OrderSummaryRecord } from '@/database/models';
import { listOrders } from '@/database/repositories/order-repository';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';
import { getOperatorErrorMessage } from '@/lib/user-facing-error';

export function useOrders() {
  const database = useLocalDatabase();
  const [orders, setOrders] = useState<OrderSummaryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(
    async (showLoading = true) => {
      if (showLoading) setIsLoading(true);
      setError(null);
      try {
        setOrders(await listOrders(database, DEFAULT_STORE_ID));
      } catch (caughtError) {
        setError(
          new Error(
            getOperatorErrorMessage(
              caughtError,
              'No se pudieron cargar los pedidos.'
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

  return { database, orders, isLoading, error, refresh };
}
