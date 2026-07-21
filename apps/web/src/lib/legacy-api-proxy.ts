import { isIP } from 'node:net';

const DEFAULT_API_ORIGIN = 'http://127.0.0.1:5066';

export type LegacyApiPath = string | readonly string[];

function apiPath(path: LegacyApiPath) {
  const value = Array.isArray(path) ? path.join('/') : path;
  return String(value).replace(/^\/+|\/+$/g, '');
}

export async function proxyLegacyApi(req: Request, path: LegacyApiPath) {
  const origin = process.env.BAI_API_ORIGIN || DEFAULT_API_ORIGIN;
  const incoming = new URL(req.url);
  const target = new URL(`/api/${apiPath(path)}${incoming.search}`, origin);

  const headers = new Headers(req.headers);
  headers.set('host', new URL(origin).host);
  headers.delete('connection');
  headers.delete('content-length');
  // Never trust a client-supplied internal header. The public reverse proxy is
  // expected to overwrite x-real-ip/x-forwarded-for; Next then sends one
  // validated address to the loopback-only Flask hop for per-client throttling.
  headers.delete('x-bai-client-ip');
  const forwarded = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '').trim();
  if (isIP(forwarded)) headers.set('x-bai-client-ip', forwarded);

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
