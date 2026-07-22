import { proxyLegacyApi } from '@/lib/legacy-api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ rid: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { rid } = await ctx.params;
  return proxyLegacyApi(req, ['talent-office', rid]);
}
