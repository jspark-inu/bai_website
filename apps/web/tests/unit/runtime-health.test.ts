import crypto from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pragma: vi.fn(),
  all: vi.fn(),
  resolveDbPath: vi.fn(() => '/srv/bai/data/lab-feed.db'),
  uploadRoot: vi.fn(() => '/srv/bai/data/uploads'),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    pragma: mocks.pragma,
    prepare: () => ({ all: mocks.all }),
  }),
  resolveDbPath: mocks.resolveDbPath,
}));
vi.mock('@/lib/uploads', () => ({ uploadRoot: mocks.uploadRoot }));

import { GET } from '@/app/api/runtime-health/route';

function fingerprint(value: string) {
  return crypto.createHash('sha256').update(path.resolve(value)).digest('hex');
}

function request(query = '') {
  return { nextUrl: new URL(`http://next.test/api/runtime-health${query}`) } as never;
}

describe('runtime deployment health', () => {
  beforeEach(() => {
    mocks.pragma.mockReset().mockImplementation((name: string) => name.startsWith('quick_check') ? 'ok' : []);
    mocks.all.mockReset().mockReturnValue([{ name: 'members' }, { name: 'posts' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
  });

  it('verifies Next DB/upload paths and the Flask database health endpoint', async () => {
    const query = `?db=${fingerprint('/srv/bai/data/lab-feed.db')}&uploads=${fingerprint('/srv/bai/data/uploads')}`;
    const response = await GET(request(query));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, database: 'ok', backend: 'ok' });
    expect(fetch).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:5066/api/healthz'),
      { cache: 'no-store' },
    );
  });

  it('fails closed when the deployed Next process points at another database', async () => {
    const response = await GET(request(`?db=${fingerprint('/wrong/database.db')}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'database path mismatch' });
  });

  it('fails closed when Flask or its database is unhealthy', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unhealthy', { status: 503 }));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'backend health check failed' });
  });
});
