import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
  getMemberById: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}));
vi.mock('@/lib/db', () => ({ getMemberById: mocks.getMemberById }));

import { getCurrentMember, requireApiMember } from '@/lib/auth';

describe('Flask-backed current-member authentication', () => {
  beforeEach(() => {
    process.env.BAI_API_ORIGIN = 'http://legacy.test:5066';
    delete process.env.BAI_DEV_MEMBER_ID;
    mocks.cookies.mockReset();
    mocks.headers.mockReset().mockResolvedValue(new Headers({ cookie: 'session=valid' }));
    mocks.getMemberById.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BAI_API_ORIGIN;
  });

  it('returns null only when Flask explicitly reports an anonymous session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(
      { error: 'not logged in' },
      { status: 401 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentMember()).resolves.toBeNull();
    expect(mocks.getMemberById).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://legacy.test:5066/api/me'),
      { headers: { cookie: 'session=valid' }, cache: 'no-store' },
    );
  });

  it('returns the member only after Flask and the shared database agree', async () => {
    const member = { id: 7, name: '테스트 멤버', role: 'student' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(member)));
    mocks.getMemberById.mockReturnValue(member);

    await expect(getCurrentMember()).resolves.toEqual(member);
    expect(mocks.getMemberById).toHaveBeenCalledWith(7);
  });

  it('does not convert an upstream 5xx into a logged-out session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(
      { error: 'database unavailable' },
      { status: 500 },
    )));

    await expect(getCurrentMember()).rejects.toMatchObject({
      name: 'AuthServiceError',
      status: 503,
    });
  });

  it('reports a shared-database mismatch instead of logging the user out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      id: 9,
      name: 'Flask에는 존재',
      role: 'student',
    })));
    mocks.getMemberById.mockReturnValue(null);

    const result = await requireApiMember();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an authentication error');
    expect(result.error.status).toBe(503);
  });

  it('maps network failures to a non-cacheable 503 API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const result = await requireApiMember();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an authentication error');
    expect(result.error.status).toBe(503);
    expect(result.error.headers.get('cache-control')).toBe('no-store');
    await expect(result.error.json()).resolves.toEqual({ error: 'authentication service unavailable' });
  });

  it('treats a malformed successful response as a bad gateway, not anonymous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ name: 'id 없음' })));

    const result = await requireApiMember();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an authentication error');
    expect(result.error.status).toBe(502);
  });
});
