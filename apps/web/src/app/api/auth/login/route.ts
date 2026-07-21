import { NextRequest } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';
import { proxyLegacyApi } from '@/lib/legacy-api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await clearSessionCookie();
  return proxyLegacyApi(req, 'login');
}
