import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentMember } from '@/lib/auth';
import { materialUploadDir } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ file: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  const { file } = await ctx.params;
  const storedName = file.join('/');
  if (storedName !== path.basename(storedName)) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const bytes = await fs.readFile(path.join(materialUploadDir(), storedName));
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${storedName.replace(/"/g, '')}"`,
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    throw error;
  }
}
