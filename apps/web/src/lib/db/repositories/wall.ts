import type Database from 'better-sqlite3';
import { getDb } from '../client.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';

export type WallMessageRow = {
  id: SqliteInteger;
  body: string;
  created_at: string;
};

export function listWallMessageRows(limit: number): WallMessageRow[] {
  const rows = getDb().prepare(`SELECT id,body,created_at FROM wall_messages
    ORDER BY id DESC LIMIT ?`).safeIntegers().all(limit);
  return (normalizeSqliteIntegers(rows) as WallMessageRow[]).reverse();
}

export function insertWallMessage(
  conn: Database.Database,
  authorId: number,
  body: string,
): SqliteInteger {
  return conn.prepare('INSERT INTO wall_messages (author_id,body) VALUES (?,?)')
    .safeIntegers().run(authorId, body).lastInsertRowid;
}
