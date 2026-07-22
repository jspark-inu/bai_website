import { proxyLegacyApi } from '@/lib/legacy-api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return proxyLegacyApi(req, 'me');
}

export async function POST(req: Request) {
  return proxyLegacyApi(req, 'me');
}
