import { getCurrentMember } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'not logged in' }, { status: 401 });
  return Response.json(member);
}
