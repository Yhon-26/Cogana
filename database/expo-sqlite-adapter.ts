import type { SQLiteDatabase } from 'expo-sqlite';

import type { DatabaseAdapter, DatabaseRunResult, SqlValue } from './contracts';

export class ExpoSQLiteAdapter implements DatabaseAdapter {
  constructor(private readonly database: SQLiteDatabase) {}

  exec(sql: string) {
    return this.database.execAsync(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<DatabaseRunResult> {
    const result = await this.database.runAsync(sql, [...params]);
    return {
      changes: result.changes,
      lastInsertRowId: result.lastInsertRowId,
    };
  }

  getFirst<T>(sql: string, params: readonly SqlValue[] = []) {
    return this.database.getFirstAsync<T>(sql, [...params]);
  }

  getAll<T>(sql: string, params: readonly SqlValue[] = []) {
    return this.database.getAllAsync<T>(sql, [...params]);
  }

  async transaction<T>(task: (database: DatabaseAdapter) => Promise<T>): Promise<T> {
    let result: T | undefined;

    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      result = await task(new ExpoSQLiteAdapter(transaction));
    });

    return result as T;
  }
}
