import { getCurrentMember } from '@/lib/auth';
import { talentErrorResponse } from '@/lib/talent-office-api';
import { getTalentRequest, submitTalentSolution } from '@/lib/talent-office';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ rid: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  try {
    const { rid } = await ctx.params;
    const id = Number(rid);
    const detail = getTalentRequest(id) as { assignees: Array<{ member_id: number }> };
    if (!detail.assignees.some((assignee) => assignee.member_id === member.id) && member.role !== 'pi') return Response.json({ error: 'assignee required' }, { status: 403 });
    const data = await req.json();
    submitTalentSolution(id, { summary: String(data.solution_summary ?? data.summary ?? ''), url: String(data.solution_url ?? data.url ?? '') });
    return Response.json({ ok: true });
  } catch (error) { return talentErrorResponse(error); }
}
