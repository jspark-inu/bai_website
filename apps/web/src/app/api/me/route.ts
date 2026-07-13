import { NextRequest } from 'next/server';
import { getCurrentMember } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_API_ORIGIN = 'http://127.0.0.1:5066';

async function legacyProxy(req: NextRequest) {
  const origin = process.env.BAI_API_ORIGIN || DEFAULT_API_ORIGIN;
  const target = new URL(`/api/me${req.nextUrl.search}`, origin);
  const headers = new Headers(req.headers);
  headers.set('host', new URL(origin).host);
  headers.delete('connection');
  headers.delete('content-length');
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export async function GET(req: NextRequest) {
  // Goodbai API-key retrieval remains an existing Flask Feed capability.
  if (req.nextUrl.searchParams.get('api_key') === '1') return legacyProxy(req);
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'not logged in' }, { status: 401 });
  return Response.json(member);
}

export const POST = legacyProxy;
