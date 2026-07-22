import { requireApiMember } from '@/lib/auth';
import { exactJsonResponse } from '@/lib/exact-json-response';
import { createWebPost } from '@/lib/services/posts';
import { readJsonObject } from '@/lib/write-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const result = createWebPost(auth.member.id, await readJsonObject(request));
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return exactJsonResponse({ id: result.value.id, url: `/post/${result.value.id}` });
}
