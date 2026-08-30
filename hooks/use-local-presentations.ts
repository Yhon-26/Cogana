import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { ProductPresentationRecord } from '@/database/models';
import { listActivePresentations } from '@/database/repositories/presentation-repository';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';
import { getOperatorErrorMessage } from '@/lib/user-facing-error';

export function useLocalPresentations() {
  const database = useLocalDatabase();
  const [presentations, setPresentations] = useState<ProductPresentationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setPresentations(await listActivePresentations(database, DEFAULT_STORE_ID));
    } catch (caughtError) {
      setError(
        new Error(
          getOperatorErrorMessage(
            caughtError,
            'No se pudieron cargar las presentaciones locales.'
          )
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [database]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  return { presentations, isLoading, error, refresh };
}
