import {
  inquiryExists, insertInquiry, listInquiryRows, updateInquiryAnswer,
} from '../db/repositories/inquiries.ts';
import { isPythonFalsyJson, trimPythonWhitespace, type FlaskInt } from '../api-params.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import type { SqliteInteger } from '../db/read-values.ts';
import type { WriteResult } from './posts.ts';

export function getInquiries() {
  const rows = listInquiryRows();
  const open = rows.filter((row) => row.status === 'open');
  const answered = rows.filter((row) => row.status === 'answered')
    .sort((a, b) => (b.answered_at ?? '').localeCompare(a.answered_at ?? ''));
  return { open, answered };
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (isPythonFalsyJson(value)) return '';
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`);
  return trimPythonWhitespace(value);
}

export function createInquiry(
  memberId: number,
  data: Record<string, unknown>,
): WriteResult<{ id: SqliteInteger }> {
  const question = stringField(data, 'question');
  if (!question) return { ok: false, status: 400, error: 'question required' };
  return withWriteTransaction((conn) => ({
    ok: true,
    value: { id: insertInquiry(conn, memberId, question) },
  }));
}

export function answerInquiry(
  id: FlaskInt,
  memberId: number,
  data: Record<string, unknown>,
): WriteResult<{ ok: true }> {
  return withWriteTransaction((conn) => {
    if (!inquiryExists(conn, id)) {
      return { ok: false, status: 404, error: 'not found' };
    }
    const answer = stringField(data, 'answer');
    if (!answer) return { ok: false, status: 400, error: 'answer required' };
    updateInquiryAnswer(conn, id, answer, memberId);
    return { ok: true, value: { ok: true } };
  });
}