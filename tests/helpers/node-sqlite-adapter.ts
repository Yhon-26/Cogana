import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type {
  DatabaseAdapter,
  DatabaseRunResult,
  SqlValue,
} from '../../database/contracts';

export class NodeSQLiteAdapter implements DatabaseAdapter {
  private readonly database: DatabaseSync;

  constructor(filename = ':memory:') {
    this.database = new DatabaseSync(filename);
  }

  close() {
    this.database.close();
  }

  async exec(sql: string) {
    this.database.exec(sql);
  }

  async run(
    sql: string,
    params: readonly SqlValue[] = []
  ): Promise<DatabaseRunResult> {
    const statement = this.database.prepare(sql);
    const result = statement.run(...(params as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirst<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    const statement = this.database.prepare(sql);
    const row = statement.get(...(params as SQLInputValue[]));
    return (row as T | undefined) ?? null;
  }

  async getAll<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    const statement = this.database.prepare(sql);
    return statement.all(...(params as SQLInputValue[])) as T[];
  }

  async transaction<T>(task: (database: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = await task(this);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
