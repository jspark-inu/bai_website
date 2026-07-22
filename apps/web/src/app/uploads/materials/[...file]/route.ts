import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { requireApiMember } from '@/lib/auth';
import { materialUploadDir } from '@/lib/uploads';
import { getMaterialUploadMetadata } from '@/lib/db/repositories/materials';
import { processPendingMaterialCleanups } from '@/lib/services/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ file: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  await processPendingMaterialCleanups();
  const { file } = await ctx.params;
  const storedName = file.join('/');
  if (storedName !== path.basename(storedName)) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  const fileUrl = `/uploads/materials/${storedName}`;
  const metadata = getMaterialUploadMetadata(fileUrl);
  if (!metadata) return Response.json({ error: 'not found' }, { status: 404 });
  const downloadName = path.basename(metadata.file_name || storedName)
    .replace(/[\u0000-\u001F\u007F"]/g, '') || storedName;
  const asciiName = downloadName.replace(/[^\u0020-\u007E]|[\\"]/g, '_');
  const encodedName = encodeURIComponent(downloadName)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const disposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(
      path.join(materialUploadDir(), storedName),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile()) return Response.json({ error: 'not found' }, { status: 404 });
    const bytes = await handle.readFile();
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': disposition,
      },
    });
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'EMLINK'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}
