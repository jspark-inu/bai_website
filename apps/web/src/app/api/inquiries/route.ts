import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { getInquiries } from '@/lib/services/inquiries';
import { proxyLegacyApi } from '@/lib/legacy-api-proxy';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return exactJsonResponse(getInquiries());
}

// Task 4 owns this write. Keep its existing Flask proxy behavior until then.
export async function POST(request: NextRequest) {
  return proxyLegacyApi(request, 'inquiries');
}