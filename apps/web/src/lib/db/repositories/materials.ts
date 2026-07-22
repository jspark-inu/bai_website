import type Database from 'better-sqlite3';
import type { FlaskInt } from '../../api-params.ts';
import { getDb } from '../client.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';

export type MaterialRow = Record<string, unknown> & {
  id: SqliteInteger;
  author_id: SqliteInteger;
  title: string;
  body: string;
  url: string;
  category: string;
  guild: string;
  file_url: string;
  file_name: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_role: string;
};

export type MaterialWritePayload = {
  title: string;
  body: string;
  url: string;
  category: string;
  guild: string;
  fileUrl: string;
  fileName: string;
};

const MATERIAL_SELECT = `SELECT mt.*, m.name AS author_name, m.role AS author_role
  FROM materials mt JOIN members m ON m.id=mt.author_id`;

export function listMaterials(filters: { category?: string; guild?: string } = {}): MaterialRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.category) {
    clauses.push('mt.category=?');
    params.push(filters.category);
  }
  if (filters.guild) {
    clauses.push('mt.guild=?');
    params.push(filters.guild);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return normalizeSqliteIntegers(
    getDb().prepare(`${MATERIAL_SELECT}${where} ORDER BY mt.id DESC`).safeIntegers().all(...params),
  ) as MaterialRow[];
}

export function getMaterial(id: FlaskInt): MaterialRow | null {
  return (normalizeSqliteIntegers(
    getDb().prepare(`${MATERIAL_SELECT} WHERE mt.id=?`).safeIntegers().get(id),
  ) as MaterialRow | undefined) ?? null;
}

export function getMaterialUploadMetadata(fileUrl: string): { file_name: string } | null {
  return (getDb().prepare('SELECT file_name FROM materials WHERE file_url=? LIMIT 1').get(fileUrl) as
    | { file_name: string }
    | undefined) ?? null;
}

export function getMaterialForWrite(conn: Database.Database, id: FlaskInt): MaterialRow | null {
  return (normalizeSqliteIntegers(
    conn.prepare(`${MATERIAL_SELECT} WHERE mt.id=?`).safeIntegers().get(id),
  ) as MaterialRow | undefined) ?? null;
}

export function getActiveMaterialActorRole(conn: Database.Database, id: FlaskInt): string | null {
  const row = conn.prepare("SELECT role FROM members WHERE id=? AND status='active'").get(id) as
    | { role: string }
    | undefined;
  return row?.role ?? null;
}

export function insertMaterial(
  conn: Database.Database,
  authorId: FlaskInt,
  payload: MaterialWritePayload,
): SqliteInteger {
  return conn.prepare(`INSERT INTO materials
    (author_id,title,body,url,category,guild,file_url,file_name)
    VALUES (?,?,?,?,?,?,?,?)`).safeIntegers().run(
    authorId, payload.title, payload.body, payload.url, payload.category, payload.guild,
    payload.fileUrl, payload.fileName,
  ).lastInsertRowid;
}

export function updateMaterialRow(
  conn: Database.Database,
  id: FlaskInt,
  payload: MaterialWritePayload,
) {
  conn.prepare(`UPDATE materials SET title=?,body=?,url=?,category=?,guild=?,file_url=?,file_name=?,
    updated_at=datetime('now') WHERE id=?`).run(
    payload.title, payload.body, payload.url, payload.category, payload.guild,
    payload.fileUrl, payload.fileName, id,
  );
}

export function deleteMaterialRow(conn: Database.Database, id: FlaskInt) {
  conn.prepare('DELETE FROM materials WHERE id=?').run(id);
}

export function materialFileIsReferenced(conn: Database.Database, fileUrl: string): boolean {
  return Boolean(conn.prepare('SELECT 1 FROM materials WHERE file_url=? LIMIT 1').get(fileUrl));
}

export function queueMaterialCleanupIntent(
  conn: Database.Database,
  fileUrl: string,
  reason: string,
  delaySeconds = 0,
) {
  const modifier = `+${Math.max(0, Math.trunc(delaySeconds))} seconds`;
  conn.prepare(`INSERT INTO material_file_cleanup_queue
    (file_url,reason,next_attempt_at) VALUES (?,?,datetime('now',?))
    ON CONFLICT(file_url) DO UPDATE SET
      reason=excluded.reason,
      last_error='',
      next_attempt_at=excluded.next_attempt_at,
      lease_until=NULL,
      completed_at=NULL`).run(fileUrl, reason, modifier);
}

export type CleanupClaim = { id: number; file_url: string; attempts: number };

export function claimPendingMaterialCleanups(conn: Database.Database, limit = 1): CleanupClaim[] {
  return conn.prepare(`UPDATE material_file_cleanup_queue
    SET lease_until=datetime('now','+60 seconds')
    WHERE id IN (
      SELECT id FROM material_file_cleanup_queue
      WHERE completed_at IS NULL
        AND next_attempt_at <= datetime('now')
        AND (lease_until IS NULL OR lease_until <= datetime('now'))
      ORDER BY next_attempt_at,id LIMIT ?
    )
    RETURNING id,file_url,attempts`).all(Math.max(1, Math.min(Math.trunc(limit), 5))) as CleanupClaim[];
}

export function claimMaterialCleanupByUrl(conn: Database.Database, fileUrl: string): CleanupClaim | null {
  return (conn.prepare(`UPDATE material_file_cleanup_queue
    SET lease_until=datetime('now','+60 seconds')
    WHERE file_url=? AND completed_at IS NULL
      AND (lease_until IS NULL OR lease_until <= datetime('now'))
    RETURNING id,file_url,attempts`).get(fileUrl) as CleanupClaim | undefined) ?? null;
}

export function completeMaterialCleanup(conn: Database.Database, id: number | bigint) {
  conn.prepare('DELETE FROM material_file_cleanup_queue WHERE id=?').run(id);
}

export function completeMaterialCleanupByUrl(conn: Database.Database, fileUrl: string) {
  conn.prepare('DELETE FROM material_file_cleanup_queue WHERE file_url=?').run(fileUrl);
}

export function failMaterialCleanup(
  conn: Database.Database,
  id: number | bigint,
  lastError: string,
  delaySeconds: number,
) {
  const modifier = `+${Math.max(1, Math.min(Math.trunc(delaySeconds), 3600))} seconds`;
  conn.prepare(`UPDATE material_file_cleanup_queue
    SET attempts=attempts+1,last_error=?,next_attempt_at=datetime('now',?),lease_until=NULL
    WHERE id=? AND completed_at IS NULL`).run(lastError, modifier, id);
}
