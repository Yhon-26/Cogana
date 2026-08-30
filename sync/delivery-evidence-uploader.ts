import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import type { DatabaseAdapter } from '../database/contracts';
import {
  completeDeliveryEvidenceUpload,
  listPendingDeliveryEvidence,
  markDeliveryEvidenceError,
  markDeliveryEvidenceUploading,
  recoverStuckEvidenceUploads,
} from '../database/repositories/delivery-evidence-repository';

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'No se pudo subir la evidencia.';
}

function isAlreadyUploaded(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { statusCode?: string | number; message?: string };
  return (
    Number(candidate.statusCode) === 409 ||
    candidate.message?.toLowerCase().includes('already exists') === true
  );
}

export async function uploadPendingDeliveryEvidence(
  database: DatabaseAdapter,
  supabase: SupabaseClient,
  storeId: string,
  actorUserId: string
) {
  const pending = await listPendingDeliveryEvidence(
    database,
    storeId,
    actorUserId
  );
  await recoverStuckEvidenceUploads(database, storeId, new Date().toISOString());
  let uploaded = 0;
  for (const evidence of pending) {
    const timestamp = new Date().toISOString();
    if (!(await markDeliveryEvidenceUploading(database, evidence.id, timestamp))) {
      continue;
    }
    try {
      const file = new File(evidence.localUri);
      if (!file.exists) {
        throw new Error('La foto local ya no existe en el dispositivo.');
      }
      const bytes = await file.arrayBuffer();
      const { error } = await supabase.storage
        .from('delivery-evidence')
        .upload(evidence.storagePath, bytes, {
          contentType: evidence.contentType,
          upsert: false,
        });
      if (error && !isAlreadyUploaded(error)) throw error;
      await completeDeliveryEvidenceUpload(
        database,
        evidence,
        new Date().toISOString()
      );
      uploaded += 1;
    } catch (error) {
      await markDeliveryEvidenceError(
        database,
        evidence.id,
        errorMessage(error),
        new Date().toISOString()
      );
    }
  }
  return uploaded;
}
