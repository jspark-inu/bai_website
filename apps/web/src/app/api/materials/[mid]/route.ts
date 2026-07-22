import { NextRequest } from 'next/server';
import { requireApiMember } from '@/lib/auth';
import { parseFlaskPathInt } from '@/lib/api-params';
import { exactJsonResponse } from '@/lib/exact-json-response';
import { readJsonObject, writeResultResponse } from '@/lib/write-route';
import {
  getMaterialAccess, parseMaterialPayload, processMaterialCleanup, processPendingMaterialCleanups,
  removeMaterial, reserveMaterialUploadCleanup, updateMaterial,
} from '@/lib/services/materials';
import { MaterialUploadError, saveMaterialUpload } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ mid: string }> };

const METHOD_NOT_ALLOWED = '<!doctype html>\n<html lang=en>\n<title>405 Method Not Allowed</title>\n<h1>Method Not Allowed</h1>\n<p>The method is not allowed for the requested URL.</p>\n';

function methodNotAllowed() {
  return new Response(METHOD_NOT_ALLOWED, {
    status: 405,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function mediaType(request: Request) {
  return (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
}

async function editableMaterial(ctx: Ctx) {
  const id = parseFlaskPathInt((await ctx.params).mid);
  if (id === null) return { ok: false as const, error: methodNotAllowed() };
  const auth = await requireApiMember();
  if (!auth.ok) return { ok: false as const, error: auth.error };
  await processPendingMaterialCleanups();
  const access = getMaterialAccess(id, auth.member.id, auth.member.role);
  if (!access.ok) {
    return { ok: false as const, error: Response.json({ error: access.error }, { status: access.status }) };
  }
  return { ok: true as const, id, member: auth.member, material: access.value };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const current = await editableMaterial(ctx);
  if (!current.ok) return current.error;

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

  let replacement: { fileUrl: string; fileName: string } | undefined;
  let reservedFileUrl = '';
  try {
    if (file instanceof File && file.size > 0) {
      replacement = await saveMaterialUpload(file, (fileUrl) => {
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
    const result = updateMaterial(current.id, current.member.id, payload, replacement);
    if (!result.ok) {
      if (replacement) await processMaterialCleanup(replacement.fileUrl);
      return writeResultResponse(result);
    }
    if (result.value.cleanupFileUrl) await processMaterialCleanup(result.value.cleanupFileUrl);
    return exactJsonResponse({ id: result.value.id });
  } catch (error) {
    if (replacement) await processMaterialCleanup(replacement.fileUrl);
    throw error;
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const current = await editableMaterial(ctx);
  if (!current.ok) return current.error;
  const result = removeMaterial(current.id, current.member.id);
  if (!result.ok) return writeResultResponse(result);
  await processMaterialCleanup(result.value.cleanupFileUrl);
  return exactJsonResponse({ ok: true });
}
