import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { ProductRecord } from '@/database/models';
import { listProducts } from '@/database/repositories/product-repository';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';
import { getOperatorErrorMessage } from '@/lib/user-facing-error';

export function useLocalProducts() {
  const database = useLocalDatabase();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError(null);

    try {
      setProducts(await listProducts(database, DEFAULT_STORE_ID));
    } catch (caughtError) {
      setError(
        new Error(
          getOperatorErrorMessage(
            caughtError,
            'No se pudieron cargar los productos locales.'
          )
        )
      );
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [database]);

  useFocusEffect(
    useCallback(() => {
      void refresh(true);
    }, [refresh])
  );

  return {
    database,
    products,
    isLoading,
    error,
    refresh,
  };
}
