import { getDb } from '../client.ts';
import type Database from 'better-sqlite3';
import type { FlaskInt } from '../../api-params.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';

export type InquiryRow = Record<string, unknown> & {
  id: SqliteInteger;
  status: string;
  answered_at: string | null;
};

export function listInquiryRows(): InquiryRow[] {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT i.*, m.name AS author_name, a.name AS answerer_name
    FROM inquiries i JOIN members m ON i.member_id=m.id
    LEFT JOIN members a ON i.answered_by=a.id
    ORDER BY i.id ASC`).safeIntegers().all()) as InquiryRow[];
}

export function inquiryExists(conn: Database.Database, id: FlaskInt): boolean {
  return Boolean(conn.prepare('SELECT 1 FROM inquiries WHERE id=?').get(id));
}

export function insertInquiry(
  conn: Database.Database,
  memberId: number,
  question: string,
): SqliteInteger {
  return conn.prepare('INSERT INTO inquiries (member_id,question) VALUES (?,?)')
    .safeIntegers().run(memberId, question).lastInsertRowid;
}

export function updateInquiryAnswer(
  conn: Database.Database,
  id: FlaskInt,
  answer: string,
  answeredBy: number,
) {
  conn.prepare(`UPDATE inquiries SET answer=?,status='answered',
    answered_at=datetime('now'),answered_by=? WHERE id=?`).run(answer, answeredBy, id);
}