import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getMemberById, getMemberByName } from './db';
import type { MemberPublic } from './types';

const COOKIE_NAME = 'bai_next_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = MemberPublic & { exp: number };

function secret() {
  const value = process.env.LAB_FEED_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LAB_FEED_SECRET is required in production');
  }
  return 'dev-insecure-secret';
}

function safeEqualHex(a: string, b: string) {
  const aa = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function safeEqualText(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function verifyWerkzeugPassword(password: string, storedHash: string) {
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [method, salt, expected] = parts;
  if (method.startsWith('scrypt:')) {
    const [, nRaw, rRaw, pRaw] = method.split(':');
    const n = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!n || !r || !p) return false;
    const actual = crypto.scryptSync(password, salt, expected.length / 2, { N: n, r, p, maxmem: 128 * n * r * p + 1024 * 1024 }).toString('hex');
    return safeEqualHex(actual, expected);
  }
  if (method.startsWith('pbkdf2:')) {
    const [, digest, iterationsRaw] = method.split(':');
    const iterations = Number(iterationsRaw);
    if (!digest || !iterations) return false;
    const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length / 2, digest).toString('hex');
    return safeEqualHex(actual, expected);
  }
  return false;
}

function sign(value: string) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function encodeSession(member: MemberPublic) {
  const payload = Buffer.from(JSON.stringify({
    id: member.id,
    name: member.name,
    role: member.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  } satisfies SessionPayload), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decodeSession(raw?: string): MemberPublic | null {
  if (!raw) return null;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || !safeEqualText(signature, sign(payload))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof decoded.id !== 'number' || typeof decoded.exp !== 'number') return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: decoded.id, name: decoded.name, role: decoded.role };
  } catch {
    return null;
  }
}

export async function login(name: string, password: string) {
  const member = getMemberByName(name.trim());
  if (!member || !verifyWerkzeugPassword(password, member.password_hash)) return null;
  return { id: member.id, name: member.name, role: member.role } satisfies MemberPublic;
}

export async function setSessionCookie(member: MemberPublic) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, encodeSession(member), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getCurrentMember(): Promise<MemberPublic | null> {
  if (process.env.NODE_ENV !== 'production' && process.env.BAI_DEV_MEMBER_ID) {
    return getMemberById(Number(process.env.BAI_DEV_MEMBER_ID));
  }
  const jar = await cookies();
  const sessionMember = decodeSession(jar.get(COOKIE_NAME)?.value);
  if (sessionMember) return getMemberById(sessionMember.id);

  // The retained Feed login is Flask-backed. New Next routes must honor that
  // existing session until the whole Feed authentication surface is migrated.
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;
  try {
    const origin = process.env.BAI_API_ORIGIN || 'http://127.0.0.1:5066';
    const response = await fetch(new URL('/api/me', origin), { headers: { cookie }, cache: 'no-store' });
    if (!response.ok) return null;
    const legacyMember = await response.json() as MemberPublic;
    if (!Number.isInteger(legacyMember.id)) return null;
    return getMemberById(legacyMember.id);
  } catch {
    return null;
  }
}
