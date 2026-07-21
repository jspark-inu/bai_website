import { NextRequest } from 'next/server';
import { deleteMaterial, getMaterial, updateMaterial } from '@/lib/db';
import { requireApiMember } from '@/lib/auth';
import { deleteMaterialUpload, MaterialUploadError, saveMaterialUpload } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ mid: string }> };

async function editableMaterial(ctx: Ctx) {
  const auth = await requireApiMember();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  const { member } = auth;
  const { mid } = await ctx.params;
  const material = getMaterial(Number(mid));
  if (!material) return { ok: false as const, error: Response.json({ error: 'not found' }, { status: 404 }) };
  if (member.role !== 'pi' && material.author_id !== member.id) {
    return { ok: false as const, error: Response.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, member, material };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const current = await editableMaterial(ctx);
  if (!current.ok) return current.error;
  const contentType = req.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await req.json().catch(() => ({})) : null;
  const form = isJson ? null : await req.formData();
  const field = (name: string, fallback = '') =>
    String(isJson ? (data as Record<string, unknown>)[name] ?? fallback : form?.get(name) ?? fallback).trim();
  const title = field('title');
  const body = field('body');
  const url = field('url');
  const category = field('category', '자료') || '자료';
  const guild = field('guild');
  const file = form?.get('file');

  if (!title) return Response.json({ error: 'title required' }, { status: 400 });

  let fileUrl = current.material.file_url || '';
  let fileName = current.material.file_name || '';
  let replacementUrl = '';
  try {
    if (file instanceof File && file.size > 0) {
      const upload = await saveMaterialUpload(file);
      replacementUrl = upload.fileUrl;
      fileUrl = upload.fileUrl;
      fileName = upload.fileName;
    }
  } catch (error) {
    if (error instanceof MaterialUploadError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (!body && !url && !fileUrl) {
    return Response.json({ error: 'title and body, url, or file required' }, { status: 400 });
  }

  try {
    updateMaterial(current.material.id, { title, body, url, category, guild, fileUrl, fileName });
  } catch (error) {
    if (replacementUrl) await deleteMaterialUpload(replacementUrl).catch(() => undefined);
    throw error;
  }
  if (replacementUrl && current.material.file_url) {
    await deleteMaterialUpload(current.material.file_url).catch((error) => console.error('material upload cleanup failed', error));
  }
  return Response.json({ id: current.material.id });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const current = await editableMaterial(ctx);
  if (!current.ok) return current.error;
  deleteMaterial(current.material.id);
  await deleteMaterialUpload(current.material.file_url).catch((error) => console.error('material upload cleanup failed', error));
  return Response.json({ ok: true });
}
