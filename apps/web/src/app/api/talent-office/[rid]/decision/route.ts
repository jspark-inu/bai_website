import { getCurrentMember } from '@/lib/auth';
import { talentErrorResponse } from '@/lib/talent-office-api';
import { changeTalentRequestState, completeTalentRequest, getTalentRequest } from '@/lib/talent-office';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ rid: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  try {
    const { rid } = await ctx.params;
    const id = Number(rid);
    const request = getTalentRequest(id) as unknown as { requester_member_id: number };
    if (request.requester_member_id !== member.id && member.role !== 'pi') return Response.json({ error: 'requester or PI required' }, { status: 403 });
    const data = await req.json();
    if (data.decision === 'completed') completeTalentRequest(id, String(data.note ?? '요청자가 완료를 인정했습니다.'));
    else if (data.decision === 'changes_requested') changeTalentRequestState(id, 'changes_requested');
    else return Response.json({ error: 'invalid decision' }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) { return talentErrorResponse(error); }
}
