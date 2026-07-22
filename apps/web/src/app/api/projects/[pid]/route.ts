import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { getProjectDetail } from '@/lib/services/projects';
import { proxyLegacyApi } from '@/lib/legacy-api-proxy';
import { parseFlaskPathInt } from '@/lib/api-params';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ pid: string }> };

export async function GET(_request: Request, context: Context) {
  const id = parseFlaskPathInt((await context.params).pid);
  if (id === null) return Response.json({ error: 'not found' }, { status: 404 });
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const detail = getProjectDetail(id);
  return detail ? exactJsonResponse(detail) : Response.json({ error: 'not found' }, { status: 404 });
}

// Task 5 owns this write. Keep its existing Flask proxy behavior until then.
export async function POST(request: NextRequest, context: Context) {
  const { pid } = await context.params;
  return proxyLegacyApi(request, ['projects', pid]);
}