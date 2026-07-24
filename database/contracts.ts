export type SqlValue = string | number | null | Uint8Array;

export type DatabaseRunResult = {
  changes: number;
  lastInsertRowId: number;
};

export interface DatabaseAdapter {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<DatabaseRunResult>;
  getFirst<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  getAll<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  transaction<T>(task: (database: DatabaseAdapter) => Promise<T>): Promise<T>;
}
