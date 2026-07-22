import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { createProject, getActiveProjects } from '@/lib/services/projects';
import { exactJsonResponse } from '@/lib/exact-json-response';
import { readJsonObject, writeResultResponse } from '@/lib/write-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return exactJsonResponse(getActiveProjects());
}

export async function POST(request: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return writeResultResponse(createProject(auth.member.id, await readJsonObject(request)));
}