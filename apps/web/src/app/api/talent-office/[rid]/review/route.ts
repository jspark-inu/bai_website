import { getCurrentMember } from '@/lib/auth';
import { isTalentOperator, talentErrorResponse } from '@/lib/talent-office-api';
import { changeTalentRequestState } from '@/lib/talent-office';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ rid: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  if (!isTalentOperator(member)) return Response.json({ error: 'operator required' }, { status: 403 });
  try {
    const data = await req.json();
    const { rid } = await ctx.params;
    const status = String(data.status ?? '');
    if (!['accepted', 'declined', 'approval_required'].includes(status)) return Response.json({ error: 'invalid review decision' }, { status: 400 });
    changeTalentRequestState(Number(rid), status as 'accepted' | 'declined' | 'approval_required');
    return Response.json({ ok: true });
  } catch (error) { return talentErrorResponse(error); }
}
