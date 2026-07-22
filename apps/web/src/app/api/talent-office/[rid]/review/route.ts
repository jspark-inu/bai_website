import { proxyLegacyApi } from '@/lib/legacy-api-proxy';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ rid: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { rid } = await ctx.params;
  return proxyLegacyApi(req, ['talent-office', rid, 'review']);
}
