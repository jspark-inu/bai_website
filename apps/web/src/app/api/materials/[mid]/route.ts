import { NextRequest } from 'next/server';
import { deleteMaterial, getMaterial, updateMaterial } from '@/lib/db';
import { getCurrentMember } from '@/lib/auth';
import { deleteMaterialUpload, saveMaterialUpload } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ mid: string }> };

async function editableMaterial(ctx: Ctx) {
  const member = await getCurrentMember();
  if (!member) return { error: Response.json({ error: 'login required' }, { status: 401 }) };
  const { mid } = await ctx.params;
  const material = getMaterial(Number(mid));
  if (!material) return { error: Response.json({ error: 'not found' }, { status: 404 }) };
  if (member.role !== 'pi' && material.author_id !== member.id) {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { member, material };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const current = await editableMaterial(ctx);
  if ('error' in current) return current.error;
  const form = await req.formData();
  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const url = String(form.get('url') ?? '').trim();
  const category = String(form.get('category') ?? '자료').trim() || '자료';
  const guild = String(form.get('guild') ?? '').trim();
  const file = form.get('file');

  if (!title) return Response.json({ error: 'title required' }, { status: 400 });

  let fileUrl = current.material.file_url || '';
  let fileName = current.material.file_name || '';
  if (file instanceof File && file.size > 0) {
    const upload = await saveMaterialUpload(file);
    if (fileUrl) await deleteMaterialUpload(fileUrl);
    fileUrl = upload.fileUrl;
    fileName = upload.fileName;
  }
  if (!body && !url && !fileUrl) {
    return Response.json({ error: 'title and body, url, or file required' }, { status: 400 });
  }

  updateMaterial(current.material.id, { title, body, url, category, guild, fileUrl, fileName });
  return Response.json({ id: current.material.id });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const current = await editableMaterial(ctx);
  if ('error' in current) return current.error;
  await deleteMaterialUpload(current.material.file_url);
  deleteMaterial(current.material.id);
  return Response.json({ ok: true });
}
