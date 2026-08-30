import type { DatabaseAdapter } from '../contracts';

export type AppDensity = 'comfortable' | 'compact';

export type AppPreferences = {
  density: AppDensity;
  reduceMotion: boolean;
  hapticsEnabled: boolean;
  locale: 'es-PE';
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  density: 'comfortable',
  reduceMotion: false,
  hapticsEnabled: true,
  locale: 'es-PE',
};

type PreferencesRow = {
  density: AppDensity;
  reduce_motion: number;
  haptics_enabled: number;
  locale: 'es-PE';
};

export async function getAppPreferences(
  database: DatabaseAdapter,
  storeId: string,
  userId: string
): Promise<AppPreferences> {
  const row = await database.getFirst<PreferencesRow>(
    `SELECT density,reduce_motion,haptics_enabled,locale
     FROM app_preferences WHERE store_id = ? AND user_id = ?`,
    [storeId, userId]
  );
  if (!row) return DEFAULT_APP_PREFERENCES;
  return {
    density: row.density,
    reduceMotion: row.reduce_motion === 1,
    hapticsEnabled: row.haptics_enabled === 1,
    locale: row.locale,
  };
}

export async function saveAppPreferences(
  database: DatabaseAdapter,
  storeId: string,
  userId: string,
  preferences: AppPreferences
) {
  const timestamp = new Date().toISOString();
  await database.run(
    `INSERT INTO app_preferences(
      store_id,user_id,density,reduce_motion,haptics_enabled,locale,
      updated_at,version
    ) VALUES(?,?,?,?,?,?,?,1)
    ON CONFLICT(store_id,user_id) DO UPDATE SET
      density = excluded.density,
      reduce_motion = excluded.reduce_motion,
      haptics_enabled = excluded.haptics_enabled,
      locale = excluded.locale,
      updated_at = excluded.updated_at,
      version = app_preferences.version + 1`,
    [
      storeId,
      userId,
      preferences.density,
      preferences.reduceMotion ? 1 : 0,
      preferences.hapticsEnabled ? 1 : 0,
      preferences.locale,
      timestamp,
    ]
  );
}

