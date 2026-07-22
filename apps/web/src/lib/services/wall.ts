import { isPythonFalsyJson, splitPythonWhitespace, type FlaskInt } from '../api-params.ts';
import { insertWallMessage, listWallMessageRows } from '../db/repositories/wall.ts';
import type { SqliteInteger } from '../db/read-values.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import type { WriteResult } from './posts.ts';

export function normalizeWallLimit(value: FlaskInt | undefined): number {
  if (value === undefined || value === 0 || value === 0n) return 12;
  if (value < 1) return 1;
  if (value > 40) return 40;
  return Number(value);
}

export function getWallMessages(limit: FlaskInt | undefined) {
  return { messages: listWallMessageRows(normalizeWallLimit(limit)) };
}

export function createWallMessage(
  authorId: number,
  data: Record<string, unknown>,
): WriteResult<{ id: SqliteInteger }> {
  const raw = data.body;
  if (!isPythonFalsyJson(raw) && typeof raw !== 'string') throw new TypeError('body must be a string');
  const body = splitPythonWhitespace(typeof raw === 'string' ? raw : '').join(' ');
  if (!body) return { ok: false, status: 400, error: 'message required' };
  if ([...body].length > 80) return { ok: false, status: 400, error: 'message too long' };
  return withWriteTransaction((conn) => ({
    ok: true,
    value: { id: insertWallMessage(conn, authorId, body) },
  }));
}
