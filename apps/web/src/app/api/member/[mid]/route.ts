import { requireApiMember } from '@/lib/auth';
import { getMemberJourney } from '@/lib/services/posts';
import { parseFlaskPathInt } from '@/lib/api-params';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ mid: string }> };

export async function GET(_request: Request, context: Context) {
  const id = parseFlaskPathInt((await context.params).mid);
  if (id === null) return Response.json({ error: 'not found' }, { status: 404 });
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const journey = getMemberJourney(id);
  return journey ? exactJsonResponse(journey) : Response.json({ error: 'not found' }, { status: 404 });
}