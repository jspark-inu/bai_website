import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { FlaskInt } from '../api-params.ts';

export const SESSION_COOKIE_NAME = 'bai_next_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const MAX_SQLITE_INTEGER = 9_223_372_036_854_775_807n;
const KNOWN_INSECURE_SECRETS = new Set([
  'dev',
  'dev-insecure-secret',
  'change-me-generate-with-python-secrets',
]);

type SessionOptions = {
  now?: () => number;
  randomId?: () => string;
  secret?: string;
};

export type SessionPayload = {
  memberId: FlaskInt;
  sessionId: string;
  expiresAt: number;
};

function sessionSecret(explicit?: string): Buffer {
  const configured = explicit ?? process.env.LAB_FEED_SECRET ?? '';
  const unsafe = configured.length < 32 || KNOWN_INSECURE_SECRETS.has(configured);
  if (unsafe) {
    throw new Error('LAB_FEED_SECRET must be a non-placeholder secret of at least 32 characters');
  }
  return Buffer.from(configured, 'utf8');
}

function signature(body: string, secret?: string) {
  return createHmac('sha256', sessionSecret(secret)).update(body).digest('base64url');
}

function normalizedMemberId(memberId: FlaskInt): string {
  const parsed = typeof memberId === 'bigint' ? memberId : BigInt(memberId);
  if (parsed < 1 || parsed > MAX_SQLITE_INTEGER) throw new RangeError('invalid member id');
  return parsed.toString();
}

export function signSessionToken(memberId: FlaskInt, options: SessionOptions = {}): string {
  sessionSecret(options.secret);
  const now = options.now?.() ?? Date.now();
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1_000;
  const sessionId = options.randomId?.() ?? randomBytes(32).toString('base64url');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) throw new Error('invalid session id');
  const body = `v1.${normalizedMemberId(memberId)}.${expiresAt}.${sessionId}`;
  return `${body}.${signature(body, options.secret)}`;
}

export function verifySessionToken(token: string | undefined, options: Pick<SessionOptions, 'now' | 'secret'> = {}): SessionPayload | null {
  // Resolve the secret before parsing so a missing production secret can never
  // degrade into an anonymous-but-otherwise-running authentication path.
  const secret = sessionSecret(options.secret);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [, memberIdText, expiresAtText, sessionId, suppliedSignature] = parts;
  if (!/^[1-9]\d*$/.test(memberIdText) || !/^\d{13,16}$/.test(expiresAtText)
    || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) return null;
  const memberIdBig = BigInt(memberIdText);
  const expiresAt = Number(expiresAtText);
  if (memberIdBig > MAX_SQLITE_INTEGER || !Number.isSafeInteger(expiresAt)) return null;
  if (expiresAt <= (options.now?.() ?? Date.now())) return null;

  const body = parts.slice(0, 4).join('.');
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const memberId = memberIdBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(memberIdBig) : memberIdBig;
  return { memberId, sessionId, expiresAt };
}

export function sessionCookieOptions(now = Date.now()) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: new Date(now + SESSION_MAX_AGE_SECONDS * 1_000),
  };
}

export async function readSessionCookie() {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

export async function setSessionCookie(token: string, now = Date.now()) {
  (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions(now));
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}
