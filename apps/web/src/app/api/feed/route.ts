import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { listPosts } from '@/lib/services/posts';
import { parsePythonIntQuery } from '@/lib/api-params';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return exactJsonResponse(listPosts(parsePythonIntQuery(request.nextUrl.searchParams.get('project_id'))));
}