import { getCurrentMember } from '@/lib/auth';
import { apiTalentRequest, talentErrorResponse } from '@/lib/talent-office-api';
import { createTalentRequest, listTalentRequests } from '@/lib/talent-office';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  return Response.json({ requests: listTalentRequests().map((row) => apiTalentRequest(row as Record<string, unknown>)) });
}

export async function POST(req: Request) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  try {
    const data = await req.json();
    const id = createTalentRequest({
      title: String(data.title ?? ''),
      problem: String(data.problem ?? ''),
      desiredOutcome: String(data.expected_outcome ?? data.desired_outcome ?? ''),
      systemScopeReason: String(data.system_scope_reason ?? ''),
      requesterId: member.id,
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return talentErrorResponse(error);
  }
}
