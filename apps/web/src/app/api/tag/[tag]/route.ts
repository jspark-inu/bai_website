import { requireApiMember } from '@/lib/auth';
import { listPostsByTag } from '@/lib/services/posts';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ tag: string }> };

export async function GET(_request: Request, context: Context) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const { tag } = await context.params;
  return exactJsonResponse({ tag, posts: listPostsByTag(tag) });
}