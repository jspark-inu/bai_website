import { requireApiMember } from '@/lib/auth';
import { getMembers } from '@/lib/services/posts';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return exactJsonResponse(getMembers());
}