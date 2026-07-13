import { getCurrentMember } from '@/lib/auth';
import { apiTalentRequest, talentErrorResponse } from '@/lib/talent-office-api';
import { getTalentRequest } from '@/lib/talent-office';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ rid: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!await getCurrentMember()) return Response.json({ error: 'login required' }, { status: 401 });
  try {
    const { rid } = await ctx.params;
    const detail = getTalentRequest(Number(rid));
    const { assignees, points, ...request } = detail;
    return Response.json({ request: apiTalentRequest(request), assignees, points });
  } catch (error) {
    return talentErrorResponse(error);
  }
}
