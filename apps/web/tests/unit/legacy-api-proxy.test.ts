import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyLegacyApi } from '@/lib/legacy-api-proxy';

describe('legacy Flask API proxy', () => {
  beforeEach(() => {
    process.env.BAI_API_ORIGIN = 'http://legacy.test:5066';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BAI_API_ORIGIN;
  });

  it('forwards method, cookies, query, and body while preserving Flask Set-Cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":7}', {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'session=flask-session; HttpOnly; Path=/; SameSite=Lax',
        'content-encoding': 'gzip',
        'content-length': '8',
        'transfer-encoding': 'chunked',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const payload = JSON.stringify({ title: '요청' });
    const request = new Request('http://next.test/api/talent-office?view=mine', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'session=incoming-session',
        connection: 'keep-alive',
        'content-length': String(payload.length),
        'x-real-ip': '203.0.113.7',
        'x-bai-client-ip': '198.51.100.99',
      },
      body: payload,
    });

    const response = await proxyLegacyApi(request, 'talent-office');
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const forwarded = init.headers as Headers;

    expect(target.toString()).toBe('http://legacy.test:5066/api/talent-office?view=mine');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(forwarded.get('host')).toBe('legacy.test:5066');
    expect(forwarded.get('cookie')).toBe('session=incoming-session');
    expect(forwarded.has('connection')).toBe(false);
    expect(forwarded.has('content-length')).toBe(false);
    expect(forwarded.get('x-bai-client-ip')).toBe('203.0.113.7');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(payload);
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('session=flask-session');
    expect(response.headers.has('content-encoding')).toBe(false);
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('transfer-encoding')).toBe(false);
  });

  it('builds nested Flask paths and does not attach a body to GET requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('http://next.test/api/talent-office/42/review?audit=1');

    await proxyLegacyApi(request, ['talent-office', '42', 'review']);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(target.toString()).toBe('http://legacy.test:5066/api/talent-office/42/review?audit=1');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('preserves the anonymous /api/me status for a public Next-to-Flask smoke check', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(
      { error: 'not logged in' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('https://bai.example/api/auth/me');

    const response = await proxyLegacyApi(request, 'me');
    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(target.toString()).toBe('http://legacy.test:5066/api/me');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'not logged in' });
  });
});
