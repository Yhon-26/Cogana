import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { CashSessionRecord, RecentSaleRecord } from '@/database/models';
import { useLocalOperator } from '@/context/local-operator-context';
import {
  type CashSessionSummary,
  getCashSessionSummary,
  getOpenCashSession,
} from '@/database/repositories/cash-repository';
import { listRecentSalesForSession } from '@/database/repositories/sales-repository';
import { DEFAULT_STORE_ID } from '@/database/seed';
import { useLocalDatabase } from '@/hooks/use-local-database';
import { getOperatorErrorMessage } from '@/lib/user-facing-error';

export function useCashSession() {
  const database = useLocalDatabase();
  const { deviceId } = useLocalOperator();
  const [session, setSession] = useState<CashSessionRecord | null>(null);
  const [summary, setSummary] = useState<CashSessionSummary | null>(null);
  const [recentSales, setRecentSales] = useState<RecentSaleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setError(null);

    try {
      if (!deviceId) {
        setSession(null);
        setSummary(null);
        setRecentSales([]);
        return;
      }
      const openSession = await getOpenCashSession(
        database,
        DEFAULT_STORE_ID,
        deviceId
      );
      setSession(openSession);

      if (!openSession) {
        setSummary(null);
        setRecentSales([]);
        return;
      }

      const [cashSummary, sales] = await Promise.all([
        getCashSessionSummary(database, DEFAULT_STORE_ID, openSession.id),
        listRecentSalesForSession(database, DEFAULT_STORE_ID, openSession.id, 10),
      ]);
      setSummary(cashSummary);
      setRecentSales(sales);
    } catch (caughtError) {
      setError(
        new Error(
          getOperatorErrorMessage(
            caughtError,
            'No se pudo consultar el turno de caja.'
          )
        )
      );
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [database, deviceId]);

  useFocusEffect(
    useCallback(() => {
      void refresh(true);
    }, [refresh])
  );

  return {
    database,
    session,
    summary,
    recentSales,
    isLoading,
    error,
    refresh,
  };
}
