import type Database from 'better-sqlite3';
import { openWriteDb } from './client.ts';

export function withTransaction<T>(conn: Database.Database, operation: () => T): T {
  return conn.transaction(operation)();
}

export function withWriteTransaction<T>(operation: (conn: Database.Database) => T): T {
  const conn = openWriteDb();
  try {
    return conn.transaction(() => operation(conn)).immediate();
  } finally {
    conn.close();
  }
}
