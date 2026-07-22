import { requireApiMember } from '@/lib/auth';
import { getPostDetail } from '@/lib/services/posts';
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
  const detail = getPostDetail(id);
  return detail ? exactJsonResponse(detail) : Response.json({ error: 'not found' }, { status: 404 });
}