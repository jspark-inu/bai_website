import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getMemberById: vi.fn(),
  authSessionExists: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/db/repositories/members', () => ({ getMemberById: mocks.getMemberById }));
vi.mock('@/lib/db/repositories/auth-sessions', () => ({
  authSessionExists: mocks.authSessionExists,
  deleteAuthSession: vi.fn(),
  deleteExpiredAuthSessions: vi.fn(),
  insertAuthSession: vi.fn(),
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: mocks.unstableRethrow }));

import { getCurrentMember, requireApiMember } from '@/lib/auth';
import { signSessionToken } from '@/lib/auth/session';

const SECRET = 'task-7-auth-unit-secret-at-least-32-characters';

describe('Next-native current-member authentication', () => {
  beforeEach(() => {
    process.env.LAB_FEED_SECRET = SECRET;
    delete process.env.BAI_DEV_MEMBER_ID;
    mocks.cookies.mockReset().mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
    mocks.getMemberById.mockReset();
    mocks.authSessionExists.mockReset();
    mocks.unstableRethrow.mockReset().mockImplementation((error: unknown) => {
      if (error && typeof error === 'object' && 'digest' in error) throw error;
    });
  });

  afterEach(() => {
    delete process.env.LAB_FEED_SECRET;
  });

  it('returns null for an anonymous request without consulting the database', async () => {
    await expect(getCurrentMember()).resolves.toBeNull();
    expect(mocks.authSessionExists).not.toHaveBeenCalled();
    expect(mocks.getMemberById).not.toHaveBeenCalled();
  });

  it('returns a member only when the signature, server-side session, and active database row agree', async () => {
    const token = signSessionToken(7, { secret: SECRET });
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: token }) });
    mocks.authSessionExists.mockReturnValue(true);
    mocks.getMemberById.mockReturnValue({ id: 7, name: '테스트 멤버', role: 'student' });

    await expect(getCurrentMember()).resolves.toEqual({ id: 7, name: '테스트 멤버', role: 'student' });
    expect(mocks.getMemberById).toHaveBeenCalledWith(7);
  });

  it('rejects a valid signed token after the server-side session is gone', async () => {
    const token = signSessionToken(7, { secret: SECRET });
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: token }) });
    mocks.authSessionExists.mockReturnValue(false);

    await expect(getCurrentMember()).resolves.toBeNull();
    expect(mocks.getMemberById).not.toHaveBeenCalled();
  });

  it('rechecks member status and does not accept a removed or disabled row', async () => {
    const token = signSessionToken(7, { secret: SECRET });
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: token }) });
    mocks.authSessionExists.mockReturnValue(true);
    mocks.getMemberById.mockReturnValue(null);

    await expect(getCurrentMember()).resolves.toBeNull();
  });

  it('maps session storage failure to a non-cacheable 503 response', async () => {
    const token = signSessionToken(7, { secret: SECRET });
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: token }) });
    mocks.authSessionExists.mockImplementation(() => { throw new Error('database unavailable'); });

    const result = await requireApiMember();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an authentication error');
    expect(result.error.status).toBe(503);
    expect(result.error.headers.get('cache-control')).toBe('private, no-store');
    await expect(result.error.json()).resolves.toEqual({ error: 'authentication service unavailable' });
  });

  it('lets Next handle request-time rendering control-flow errors', async () => {
    const frameworkError = Object.assign(new Error('dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' });
    mocks.cookies.mockRejectedValue(frameworkError);

    await expect(getCurrentMember()).rejects.toBe(frameworkError);
    expect(mocks.unstableRethrow).toHaveBeenCalledWith(frameworkError);
  });
});
