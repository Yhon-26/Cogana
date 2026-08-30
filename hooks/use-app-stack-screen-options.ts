import { useMemo } from 'react';

import { useAppPreferences } from '@/context/app-preferences-context';

export function useAppStackScreenOptions() {
  const { preferences } = useAppPreferences();

  return useMemo(
    () => ({
      headerShown: false,
      animation: preferences.reduceMotion
        ? ('none' as const)
        : ('default' as const),
    }),
    [preferences.reduceMotion]
  );
}
