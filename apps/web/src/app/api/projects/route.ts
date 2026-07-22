import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { getActiveProjects } from '@/lib/services/projects';
import { proxyLegacyApi } from '@/lib/legacy-api-proxy';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return exactJsonResponse(getActiveProjects());
}

// Task 5 owns this write. Keep its existing Flask proxy behavior until then.
export async function POST(request: NextRequest) {
  return proxyLegacyApi(request, 'projects');
}