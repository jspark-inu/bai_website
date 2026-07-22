import crypto from 'node:crypto';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pragma: vi.fn(),
  tableAll: vi.fn(),
  migrationAll: vi.fn(),
  resolveDbPath: vi.fn(() => '/srv/bai/data/lab-feed.db'),
  uploadRoot: vi.fn(() => process.cwd()),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    pragma: mocks.pragma,
    prepare: (sql: string) => ({
      all: sql.includes('schema_migrations') ? mocks.migrationAll : mocks.tableAll,
    }),
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
    mocks.tableAll.mockReset().mockReturnValue([{ name: 'members' }, { name: 'posts' }]);
    mocks.migrationAll.mockReset().mockReturnValue([
      { id: '001_core_schema' },
      { id: '002_legacy_compatibility' },
      { id: '003_timestamp_compatibility' },
      { id: '004_material_file_cleanup_queue' },
      { id: '005_auth_sessions' },
    ]);
    mocks.uploadRoot.mockReset().mockReturnValue(process.cwd());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
  });

  it('verifies Next DB, migration ledger, and writable upload paths without a Flask request', async () => {
    const query = `?db=${fingerprint('/srv/bai/data/lab-feed.db')}&uploads=${fingerprint(process.cwd())}`;
    const response = await GET(request(query));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'bai-next',
      database: 'ok',
      migrations: 'ok',
      uploads: 'ok',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the deployed Next process points at another database', async () => {
    const response = await GET(request(`?db=${fingerprint('/wrong/database.db')}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'database path mismatch' });
  });

  it('fails closed when a required migration is absent', async () => {
    mocks.migrationAll.mockReturnValueOnce([{ id: '001_core_schema' }]);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'migration health check failed' });
  });

  it('fails closed when the configured upload directory is unavailable', async () => {
    mocks.uploadRoot.mockReturnValueOnce('/definitely/missing/bai/uploads');
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'upload health check failed' });
  });
});
