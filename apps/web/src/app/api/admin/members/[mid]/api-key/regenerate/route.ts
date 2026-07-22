import { adminMemberKeyRegeneratePOST } from '@/lib/admin-goodbai-routes';
export const runtime = 'nodejs';
type Context = { params: Promise<{ mid: string }> };
export async function POST(_request: Request, context: Context) {
  return adminMemberKeyRegeneratePOST((await context.params).mid);
}