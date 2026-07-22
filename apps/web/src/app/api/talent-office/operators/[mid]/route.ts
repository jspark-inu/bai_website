import { requireApiMember } from '@/lib/auth';
import { talentErrorResponse } from '@/lib/talent-office-api';
import { setTalentOperator } from '@/lib/talent-office';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ mid: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const { member } = auth;
  if (member.role !== 'pi') return Response.json({ error: 'PI required' }, { status: 403 });
  try {
    const data = await req.json();
    const { mid } = await ctx.params;
    setTalentOperator(Number(mid), Boolean(data.enabled));
    return Response.json({ ok: true });
  } catch (error) { return talentErrorResponse(error); }
}
