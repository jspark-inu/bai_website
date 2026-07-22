import { cookies, headers } from 'next/headers';
import { getMemberById } from './db';
import type { MemberPublic } from './types';

const COOKIE_NAME = 'bai_next_session';

export class AuthServiceError extends Error {
  constructor(message: string, readonly status = 503, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthServiceError';
  }
}

type ApiMemberResult =
  | { ok: true; member: MemberPublic }
  | { ok: false; error: Response };

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getCurrentMember(): Promise<MemberPublic | null> {
  if (process.env.NODE_ENV !== 'production' && process.env.BAI_DEV_MEMBER_ID) {
    return getMemberById(Number(process.env.BAI_DEV_MEMBER_ID));
  }
  // Flask is the sole production session authority. Direct Next routes validate
  // the same legacy cookie through /api/me instead of accepting a second session.
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;
  const origin = process.env.BAI_API_ORIGIN || 'http://127.0.0.1:5066';
  let response: Response;
  try {
    response = await fetch(new URL('/api/me', origin), { headers: { cookie }, cache: 'no-store' });
  } catch (error) {
    throw new AuthServiceError('authentication service is unavailable', 503, { cause: error });
  }
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new AuthServiceError(`authentication service returned ${response.status}`, response.status >= 500 ? 503 : 502);
  }

  let legacyMember: MemberPublic;
  try {
    legacyMember = await response.json() as MemberPublic;
  } catch (error) {
    throw new AuthServiceError('authentication service returned invalid JSON', 502, { cause: error });
  }
  if (!Number.isInteger(legacyMember.id)) {
    throw new AuthServiceError('authentication service returned an invalid member', 502);
  }
  let member: MemberPublic | null;
  try {
    member = getMemberById(legacyMember.id);
  } catch (error) {
    throw new AuthServiceError('member database is unavailable', 503, { cause: error });
  }
  if (!member) {
    throw new AuthServiceError('authenticated member is missing from the shared database', 503);
  }
  return member;
}

export async function requireApiMember(): Promise<ApiMemberResult> {
  try {
    const member = await getCurrentMember();
    if (!member) {
      return { ok: false, error: Response.json({ error: 'login required' }, { status: 401 }) };
    }
    return { ok: true, member };
  } catch (error) {
    if (!(error instanceof AuthServiceError)) throw error;
    return {
      ok: false,
      error: Response.json(
        { error: 'authentication service unavailable' },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }
}
