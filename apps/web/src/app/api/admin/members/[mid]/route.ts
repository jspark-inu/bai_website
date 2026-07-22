import { adminMemberPOST } from '@/lib/admin-goodbai-routes';
export const runtime = 'nodejs';
type Context = { params: Promise<{ mid: string }> };
export async function POST(request: Request, context: Context) {
  return adminMemberPOST(request, (await context.params).mid);
}