import { NextRequest } from 'next/server';
import { addMaterial, listMaterials } from '@/lib/db';
import { requireApiMember } from '@/lib/auth';
import { deleteMaterialUpload, MaterialUploadError, saveMaterialUpload } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const category = req.nextUrl.searchParams.get('category') || undefined;
  const guild = req.nextUrl.searchParams.get('guild') || undefined;
  return Response.json({ materials: listMaterials({ category, guild }) });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  const { member } = auth;

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

  let upload = { fileUrl: '', fileName: '' };
  try {
    if (file instanceof File && file.size > 0) upload = await saveMaterialUpload(file);
  } catch (error) {
    if (error instanceof MaterialUploadError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (!body && !url && !upload.fileUrl) {
    return Response.json({ error: 'title and body, url, or file required' }, { status: 400 });
  }

  try {
    const id = addMaterial({
      authorId: member.id,
      title,
      body,
      url,
      category,
      guild,
      fileUrl: upload.fileUrl,
      fileName: upload.fileName,
    });
    return Response.json({ id });
  } catch (error) {
    if (upload.fileUrl) await deleteMaterialUpload(upload.fileUrl).catch(() => undefined);
    throw error;
  }
}
