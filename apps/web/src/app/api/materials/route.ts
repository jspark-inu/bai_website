import { NextRequest } from 'next/server';
import { addMaterial, listMaterials } from '@/lib/db';
import { getCurrentMember } from '@/lib/auth';
import { saveMaterialUpload } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });
  const category = req.nextUrl.searchParams.get('category') || undefined;
  const guild = req.nextUrl.searchParams.get('guild') || undefined;
  return Response.json({ materials: listMaterials({ category, guild }) });
}

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: 'login required' }, { status: 401 });

  const form = await req.formData();
  const title = String(form.get('title') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const url = String(form.get('url') ?? '').trim();
  const category = String(form.get('category') ?? '자료').trim() || '자료';
  const guild = String(form.get('guild') ?? '').trim();
  const file = form.get('file');

  if (!title) return Response.json({ error: 'title required' }, { status: 400 });

  let upload = { fileUrl: '', fileName: '' };
  if (file instanceof File && file.size > 0) {
    upload = await saveMaterialUpload(file);
  }
  if (!body && !url && !upload.fileUrl) {
    return Response.json({ error: 'title and body, url, or file required' }, { status: 400 });
  }

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
}
