import { clearSessionCookie } from '@/lib/auth';
import { proxyLegacyApi } from '@/lib/legacy-api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const response = await proxyLegacyApi(req, 'logout');
  await clearSessionCookie();
  return response;
}
