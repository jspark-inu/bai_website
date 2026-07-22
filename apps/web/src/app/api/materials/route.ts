import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { trimPythonWhitespace } from '@/lib/api-params';
import { exactJsonResponse } from '@/lib/exact-json-response';
import { readJsonObject, writeResultResponse } from '@/lib/write-route';
import {
  createMaterial, getMaterials, parseMaterialPayload, processMaterialCleanup,
  processPendingMaterialCleanups, reserveMaterialUploadCleanup,
} from '@/lib/services/materials';
import { MaterialUploadError, saveMaterialUpload } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mediaType(request: Request) {
  return (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  await processPendingMaterialCleanups();
  const category = trimPythonWhitespace(req.nextUrl.searchParams.get('category') ?? '') || undefined;
  const guild = trimPythonWhitespace(req.nextUrl.searchParams.get('guild') ?? '') || undefined;
  return exactJsonResponse({ materials: getMaterials({ category, guild }) });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiMember();
  if (!auth.ok) return auth.error;
  await processPendingMaterialCleanups();

  const multipart = mediaType(req) === 'multipart/form-data';
  let data: Record<string, unknown>;
  let file: FormDataEntryValue | null = null;
  if (multipart) {
    const form = await req.formData();
    data = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'));
    file = form.get('file');
  } else {
    data = await readJsonObject(req);
  }
  const payload = parseMaterialPayload(data);

  let upload = { fileUrl: '', fileName: '' };
  let reservedFileUrl = '';
  try {
    if (file instanceof File && file.size > 0) {
      upload = await saveMaterialUpload(file, (fileUrl) => {
        reservedFileUrl = fileUrl;
        reserveMaterialUploadCleanup(fileUrl);
      });
    }
  } catch (error) {
    if (error instanceof MaterialUploadError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (reservedFileUrl) await processMaterialCleanup(reservedFileUrl);
    throw error;
  }

  try {
    const result = createMaterial(auth.member.id, payload, upload);
    if (!result.ok && upload.fileUrl) await processMaterialCleanup(upload.fileUrl);
    return writeResultResponse(result);
  } catch (error) {
    if (upload.fileUrl) await processMaterialCleanup(upload.fileUrl);
    throw error;
  }
}
