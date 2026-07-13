import { NextRequest } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { addWallMessage, listWallMessages } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 12);
  return Response.json({ messages: listWallMessages(limit) });
}

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  const data = await req.json().catch(() => ({}));
  const body = String(data.body ?? '').replace(/\s+/g, ' ').trim();
  if (!body) return Response.json({ error: 'message required' }, { status: 400 });
  if (body.length > 80) return Response.json({ error: 'message too long' }, { status: 400 });
  return Response.json({ id: addWallMessage(member.id, body) }, { status: 201 });
}
