import { parseFlaskPathInt } from '@/lib/api-params';
import { requireApiMember } from '@/lib/auth';
import { answerInquiry } from '@/lib/services/inquiries';
import { readJsonObject, writeResultResponse } from '@/lib/write-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ iid: string }> };

export async function POST(request: Request, context: Context) {
  const id = parseFlaskPathInt((await context.params).iid);
  if (id === null) return new Response(null, { status: 405 });
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  if (auth.member.role !== 'pi') {
    return Response.json({ error: 'pi only' }, { status: 403 });
  }
  return writeResultResponse(answerInquiry(id, auth.member.id, await readJsonObject(request)));
}
