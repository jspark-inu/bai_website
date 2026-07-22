import type Database from 'better-sqlite3';
import type { FlaskInt } from '../../api-params.ts';
import { getDb } from '../client.ts';

export function authSessionExists(sessionId: string, memberId: FlaskInt, now: number) {
  return Boolean(getDb().prepare(`SELECT 1 FROM auth_sessions
    WHERE session_id=? AND member_id=? AND expires_at>?`).get(sessionId, memberId, now));
}

export function deleteAuthSession(conn: Database.Database, sessionId: string) {
  conn.prepare('DELETE FROM auth_sessions WHERE session_id=?').run(sessionId);
}

export function deleteExpiredAuthSessions(conn: Database.Database, now: number) {
  conn.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
}

export function insertAuthSession(
  conn: Database.Database,
  sessionId: string,
  memberId: FlaskInt,
  expiresAt: number,
) {
  conn.prepare(`INSERT INTO auth_sessions (session_id,member_id,expires_at)
    VALUES (?,?,?)`).run(sessionId, memberId, expiresAt);
}
