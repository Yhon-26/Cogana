import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { SupplierRecord } from '@/database/models';
import { listSuppliers } from '@/database/repositories/supplier-repository';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';
import { getOperatorErrorMessage } from '@/lib/user-facing-error';

export function useLocalSuppliers() {
  const database = useLocalDatabase();
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError(null);
    try {
      setSuppliers(await listSuppliers(database, DEFAULT_STORE_ID));
    } catch (caughtError) {
      setError(
        new Error(
          getOperatorErrorMessage(
            caughtError,
            'No se pudieron cargar los proveedores locales.'
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

  return { database, suppliers, isLoading, error, refresh };
}
