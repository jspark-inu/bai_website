import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { searchPosts } from '@/lib/services/posts';
import { exactJsonResponse } from '@/lib/exact-json-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const q = request.nextUrl.searchParams.get('q') ?? '';
  return exactJsonResponse({ q, posts: searchPosts(q) });
}