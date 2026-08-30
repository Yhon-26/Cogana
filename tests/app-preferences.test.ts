import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_APP_PREFERENCES,
  getAppPreferences,
  saveAppPreferences,
} from '../database/repositories/app-preferences-repository';
import {
  DEFAULT_STORE_ID,
  DEMO_ADMIN_USER_ID,
} from '../database/seed';
import { createTestDatabase } from './helpers/test-database';

test('guarda preferencias por operador y conserva valores predeterminados', async (context) => {
  const database = await createTestDatabase();
  context.after(() => database.close());

  assert.deepEqual(
    await getAppPreferences(database, DEFAULT_STORE_ID, DEMO_ADMIN_USER_ID),
    DEFAULT_APP_PREFERENCES
  );
  await saveAppPreferences(database, DEFAULT_STORE_ID, DEMO_ADMIN_USER_ID, {
    density: 'compact',
    reduceMotion: true,
    hapticsEnabled: false,
    locale: 'es-PE',
  });
  assert.deepEqual(
    await getAppPreferences(database, DEFAULT_STORE_ID, DEMO_ADMIN_USER_ID),
    {
      density: 'compact',
      reduceMotion: true,
      hapticsEnabled: false,
      locale: 'es-PE',
    }
  );
});
