import type Database from 'better-sqlite3';

export function withTransaction<T>(conn: Database.Database, operation: () => T): T {
  return conn.transaction(operation)();
}
