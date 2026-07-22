import { parseFlaskPathInt } from '@/lib/api-params';
import { requireApiMember } from '@/lib/auth';
import { reactToPost } from '@/lib/services/posts';
import { writeResultResponse } from '@/lib/write-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ pid: string }> };

export async function POST(_request: Request, context: Context) {
  const id = parseFlaskPathInt((await context.params).pid);
  if (id === null) return new Response(null, { status: 405 });
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return writeResultResponse(reactToPost(id, auth.member.id));
}
