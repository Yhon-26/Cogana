import type { DatabaseAdapter } from '../contracts';
import { createId } from '../ids';

type DeviceIdentityRow = {
  device_id: string;
};

export async function getOrCreateLocalDeviceId(database: DatabaseAdapter) {
  const existing = await database.getFirst<DeviceIdentityRow>(
    'SELECT device_id FROM local_device_identity WHERE singleton_key = 1'
  );
  if (existing) return existing.device_id;

  return database.transaction(async (transaction) => {
    const current = await transaction.getFirst<DeviceIdentityRow>(
      'SELECT device_id FROM local_device_identity WHERE singleton_key = 1'
    );
    if (current) return current.device_id;

    const deviceId = createId();
    const timestamp = new Date().toISOString();
    await transaction.run(
      `INSERT INTO local_device_identity (
        singleton_key, device_id, created_at, updated_at, version
      ) VALUES (1, ?, ?, ?, 1)`,
      [deviceId, timestamp, timestamp]
    );
    return deviceId;
  });
}
