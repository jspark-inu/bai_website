import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assertDatabaseHealth: vi.fn() }));

vi.mock('@/lib/runtime-health', () => ({ assertDatabaseHealth: mocks.assertDatabaseHealth }));

import { GET } from '@/app/api/healthz/route';

describe('explicit Next health endpoint', () => {
  beforeEach(() => mocks.assertDatabaseHealth.mockReset());

  it('preserves the healthy Flask response contract', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'bai-site', database: 'ok' });
  });

  it('fails closed without exposing database details', async () => {
    mocks.assertDatabaseHealth.mockImplementationOnce(() => { throw new Error('sensitive path'); });
    const response = GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, service: 'bai-site' });
  });
});
