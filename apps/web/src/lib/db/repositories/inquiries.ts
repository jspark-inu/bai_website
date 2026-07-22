import { getDb } from '../client.ts';
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