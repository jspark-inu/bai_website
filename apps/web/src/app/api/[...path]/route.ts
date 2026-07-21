import { NextRequest } from 'next/server';
import { proxyLegacyApi } from '@/lib/legacy-api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxyLegacyApi(req, path);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
