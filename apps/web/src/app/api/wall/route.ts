import { parsePythonIntQuery } from '@/lib/api-params';
import { requireApiMember } from '@/lib/auth';
import { exactJsonResponse } from '@/lib/exact-json-response';
import { createWallMessage, getWallMessages } from '@/lib/services/wall';
import { readJsonObject, writeResultResponse } from '@/lib/write-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const limit = parsePythonIntQuery(new URL(request.url).searchParams.get('limit'));
  return exactJsonResponse(getWallMessages(limit));
}

export async function POST(request: Request) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  return writeResultResponse(createWallMessage(auth.member.id, await readJsonObject(request)));
}
