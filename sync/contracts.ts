export const SYNC_SCHEMA_VERSION = 1;

export type PushOperation = {
  operation_id: string;
  entity_type: string;
  entity_id: string;
  operation_type: string;
  payload: Record<string, unknown>;
};

export type PushOperationResult = {
  operationId: string;
  status: 'applied' | 'duplicate' | 'rejected';
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
};

export type PushBatchResponse = {
  schemaVersion: number;
  results: PushOperationResult[];
  serverTime: string;
};

export type PullChange = {
  sequence: number;
  entityType: string;
  entityId: string;
  operation: string;
  version: number;
  payload: Record<string, unknown>;
  changedAt: string;
  sourceDeviceId: string | null;
  operationId: string | null;
};

export type PullChangesResponse = {
  schemaVersion: number;
  changes: PullChange[];
  nextCursor: number;
  hasMore: boolean;
  serverTime: string;
};

export interface SyncTransport {
  push(input: {
    storeId: string;
    deviceId: string;
    schemaVersion: number;
    operations: PushOperation[];
  }): Promise<PushBatchResponse>;
  pull(input: {
    storeId: string;
    deviceId: string;
    cursor: number;
    limit: number;
  }): Promise<PullChangesResponse>;
}

export type SyncCycleResult = {
  status: 'completed' | 'skipped' | 'offline';
  pushed: number;
  rejected: number;
  pulled: number;
  cursor: number;
  hasMore: boolean;
  error: string | null;
};
