import type {
  PullChangesResponse,
  PushBatchResponse,
  SyncTransport,
} from './contracts';

type SupabaseSyncTransportOptions = {
  supabaseUrl: string;
  anonKey: string;
  getAccessToken: () => Promise<string | null> | string | null;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export class SupabaseSyncTransport implements SyncTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: SupabaseSyncTransportOptions) {
    if (!options.supabaseUrl.trim() || !options.anonKey.trim()) {
      throw new Error('La URL y la clave publica de Supabase son obligatorias.');
    }
    this.baseUrl = trimTrailingSlash(options.supabaseUrl.trim());
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  private async rpc<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
    const accessToken = await this.options.getAccessToken();
    if (!accessToken) {
      throw new Error('No hay una sesion autenticada para sincronizar.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}/rest/v1/rpc/${functionName}`,
        {
          method: 'POST',
          headers: {
            apikey: this.options.anonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      const responseText = await response.text();
      const parsed = responseText ? (JSON.parse(responseText) as unknown) : null;
      if (!response.ok) {
        const errorPayload = parsed as { message?: unknown; code?: unknown } | null;
        const message =
          typeof errorPayload?.message === 'string'
            ? errorPayload.message
            : `Supabase respondio HTTP ${response.status}.`;
        const error = new Error(message);
        error.name =
          typeof errorPayload?.code === 'string'
            ? `SupabaseRpcError:${errorPayload.code}`
            : 'SupabaseRpcError';
        throw error;
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('La sincronizacion excedio el tiempo de espera.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  push(input: {
    storeId: string;
    deviceId: string;
    schemaVersion: number;
    operations: Parameters<SyncTransport['push']>[0]['operations'];
  }) {
    return this.rpc<PushBatchResponse>('process_sync_batch', {
      p_store_id: input.storeId,
      p_device_id: input.deviceId,
      p_schema_version: input.schemaVersion,
      p_operations: input.operations,
    });
  }

  pull(input: {
    storeId: string;
    deviceId: string;
    cursor: number;
    limit: number;
  }) {
    return this.rpc<PullChangesResponse>('pull_changes', {
      p_store_id: input.storeId,
      p_device_id: input.deviceId,
      p_cursor: input.cursor,
      p_limit: input.limit,
    });
  }
}
