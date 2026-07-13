import { getCurrentMember } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  const rows = getDb().prepare(`SELECT cp.request_id, cp.points, cp.reason, cp.awarded_at, tr.title
    FROM contribution_points cp JOIN talent_requests tr ON tr.id=cp.request_id
    WHERE cp.member_id=? ORDER BY cp.awarded_at DESC, cp.id DESC`).all(member.id);
  const total = (rows as Array<{ points: number }>).reduce((sum, row) => sum + row.points, 0);
  return Response.json({ total, points: rows });
}
