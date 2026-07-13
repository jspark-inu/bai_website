import { getCurrentMember } from '@/lib/auth';
import { isTalentOperator, talentErrorResponse } from '@/lib/talent-office-api';
import { assignTalentRequest } from '@/lib/talent-office';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ rid: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  if (!isTalentOperator(member)) return Response.json({ error: 'operator required' }, { status: 403 });
  try {
    const data = await req.json();
    const { rid } = await ctx.params;
    const assignees = Array.isArray(data.assignees) ? data.assignees.map((a: Record<string, unknown>) => ({ memberId: Number(a.member_id ?? a.memberId), ratio: Number(a.allocation_ratio ?? a.ratio) })) : [];
    assignTalentRequest(Number(rid), assignees);
    return Response.json({ ok: true });
  } catch (error) { return talentErrorResponse(error); }
}
