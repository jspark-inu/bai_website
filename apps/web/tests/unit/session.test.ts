import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from '@/lib/auth/session';

const SECRET = 'task-7-test-secret-that-is-at-least-32-characters';
const NOW = 1_800_000_000_000;

afterEach(() => {
  delete process.env.LAB_FEED_SECRET;
  vi.unstubAllEnvs();
});

describe('Next session token', () => {
  it('signs and verifies expiry-bound tokens without losing a bigint member ID', () => {
    const memberId = 9_007_199_254_740_993n;
    const token = signSessionToken(memberId, {
      now: () => NOW,
      randomId: () => 'fixed-session-id',
      secret: SECRET,
    });

    expect(verifySessionToken(token, { now: () => NOW + 1_000, secret: SECRET })).toEqual({
      memberId,
      sessionId: 'fixed-session-id',
      expiresAt: NOW + SESSION_MAX_AGE_SECONDS * 1_000,
    });
  });

  it('rejects tampering, expiry, and malformed cookies', () => {
    const token = signSessionToken(7, {
      now: () => NOW,
      randomId: () => 'fixed-session-id',
      secret: SECRET,
    });
    const tampered = token.replace('.7.', '.8.');

    expect(verifySessionToken(tampered, { now: () => NOW, secret: SECRET })).toBeNull();
    expect(verifySessionToken(token, {
      now: () => NOW + SESSION_MAX_AGE_SECONDS * 1_000 + 1,
      secret: SECRET,
    })).toBeNull();
    expect(verifySessionToken('not-a-session', { now: () => NOW, secret: SECRET })).toBeNull();
  });

  it('fails closed when a production secret is missing or unsafe', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => signSessionToken(1, { now: () => NOW, randomId: () => 'id' }))
      .toThrow(/LAB_FEED_SECRET/);
    process.env.LAB_FEED_SECRET = 'dev';
    expect(() => verifySessionToken('v1.invalid', { now: () => NOW }))
      .toThrow(/LAB_FEED_SECRET/);
  });

  it('uses an explicit hardened cookie contract', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(SESSION_COOKIE_NAME).toBe('bai_next_session');
    expect(sessionCookieOptions(NOW)).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      expires: new Date(NOW + SESSION_MAX_AGE_SECONDS * 1_000),
    });
  });
});
