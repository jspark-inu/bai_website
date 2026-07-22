import { unstable_rethrow } from 'next/navigation';
import { privateJsonResponse } from '../exact-json-response.ts';
import { getMemberById } from '../db/repositories/members.ts';
import { authSessionExists, deleteAuthSession, deleteExpiredAuthSessions, insertAuthSession } from '../db/repositories/auth-sessions.ts';
import { openWriteDb } from '../db/client.ts';
import { withTransaction } from '../db/transaction.ts';
import type { MemberPublic } from '../types.ts';
import {
  readSessionCookie,
  signSessionToken,
  verifySessionToken,
} from './session.ts';

export class AuthServiceError extends Error {
  constructor(message: string, readonly status = 503, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthServiceError';
  }
}

export type ApiMemberResult =
  | { ok: true; member: MemberPublic }
  | { ok: false; error: Response };

export function createMemberSession(memberId: number, now = Date.now()) {
  const token = signSessionToken(memberId, { now: () => now });
  const payload = verifySessionToken(token, { now: () => now - 1 });
  if (!payload) throw new Error('newly signed session could not be verified');
  const conn = openWriteDb();
  try {
    withTransaction(conn, () => {
      deleteExpiredAuthSessions(conn, now);
      insertAuthSession(conn, payload.sessionId, payload.memberId, payload.expiresAt);
    });
  } finally {
    conn.close();
  }
  return token;
}

export function revokeMemberSession(token: string | undefined, now = Date.now()) {
  const payload = verifySessionToken(token, { now: () => now });
  if (!payload) return;
  const conn = openWriteDb();
  try {
    withTransaction(conn, () => deleteAuthSession(conn, payload.sessionId));
  } finally {
    conn.close();
  }
}

export async function getCurrentMember(): Promise<MemberPublic | null> {
  if (process.env.NODE_ENV !== 'production' && process.env.BAI_DEV_MEMBER_ID) {
    return getMemberById(Number(process.env.BAI_DEV_MEMBER_ID));
  }
  try {
    const payload = verifySessionToken(await readSessionCookie());
    if (!payload || !authSessionExists(payload.sessionId, payload.memberId, Date.now())) return null;
    const member = getMemberById(payload.memberId);
    if (!member) return null;
    if (typeof member.id === 'bigint') {
      throw new AuthServiceError('member id exceeds the supported UI range', 503);
    }
    return { id: member.id, name: member.name, role: member.role };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthServiceError) throw error;
    throw new AuthServiceError('authentication storage is unavailable', 503, { cause: error });
  }
}

export async function requireApiMember(): Promise<ApiMemberResult> {
  try {
    const member = await getCurrentMember();
    if (!member) {
      return { ok: false, error: privateJsonResponse({ error: 'login required' }, { status: 401 }) };
    }
    return { ok: true, member };
  } catch (error) {
    if (!(error instanceof AuthServiceError)) throw error;
    return {
      ok: false,
      error: privateJsonResponse(
        { error: 'authentication service unavailable' },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }
}
