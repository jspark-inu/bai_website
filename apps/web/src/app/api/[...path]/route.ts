import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

const DEFAULT_API_ORIGIN = 'http://127.0.0.1:5066';

async function proxy(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const origin = process.env.BAI_API_ORIGIN || DEFAULT_API_ORIGIN;
  const target = new URL(`/api/${path.join('/')}${req.nextUrl.search}`, origin);

  const headers = new Headers(req.headers);
  headers.set('host', new URL(origin).host);
  headers.delete('connection');
  headers.delete('content-length');

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(target, init);
  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete('content-encoding');
  resHeaders.delete('content-length');
  resHeaders.delete('transfer-encoding');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
