import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { getProjectDetail, projectUpdateAccess, updateProject } from '@/lib/services/projects';
import { parseFlaskPathInt } from '@/lib/api-params';
import { exactJsonResponse } from '@/lib/exact-json-response';
import { readJsonObject, writeResultResponse } from '@/lib/write-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ pid: string }> };

export async function GET(_request: Request, context: Context) {
  const id = parseFlaskPathInt((await context.params).pid);
  if (id === null) return Response.json({ error: 'not found' }, { status: 404 });
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const detail = getProjectDetail(id);
  return detail ? exactJsonResponse(detail) : Response.json({ error: 'not found' }, { status: 404 });
}

export async function POST(request: NextRequest, context: Context) {
  const { pid } = await context.params;
  const id = parseFlaskPathInt(pid);
  if (id === null) {
    return new Response('<!doctype html>\n<html lang=en>\n<title>405 Method Not Allowed</title>\n<h1>Method Not Allowed</h1>\n<p>The method is not allowed for the requested URL.</p>\n', {
      status: 405, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const access = projectUpdateAccess(id, auth.member.id, auth.member.role);
  if (!access.ok) return writeResultResponse(access);
  return writeResultResponse(updateProject(
    id, auth.member.id, auth.member.role, await readJsonObject(request),
  ));
}