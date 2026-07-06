import { NextRequest } from 'next/server';
import { login, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const member = await login(String(data.name ?? ''), String(data.password ?? ''));
  if (!member) {
    return Response.json({ error: 'invalid credentials' }, { status: 401 });
  }
  await setSessionCookie(member);
  return Response.json(member);
}
