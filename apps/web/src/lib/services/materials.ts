import type { FlaskInt } from '../api-params.ts';
import { isPythonFalsyJson, trimPythonWhitespace } from '../api-params.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import {
  claimMaterialCleanupByUrl, claimPendingMaterialCleanups, completeMaterialCleanup,
  completeMaterialCleanupByUrl, deleteMaterialRow, failMaterialCleanup, getActiveMaterialActorRole,
  getMaterial, getMaterialForWrite, insertMaterial, listMaterials, updateMaterialRow,
  materialFileIsReferenced, queueMaterialCleanupIntent,
  type CleanupClaim, type MaterialRow, type MaterialWritePayload,
} from '../db/repositories/materials.ts';
import { deleteMaterialUpload, isManagedMaterialUploadUrl } from '../uploads.ts';
import type { SqliteInteger } from '../db/read-values.ts';
import type { WriteResult } from './posts.ts';

export type MaterialPayload = Omit<MaterialWritePayload, 'fileUrl' | 'fileName'>;

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (isPythonFalsyJson(value)) return '';
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`);
  return trimPythonWhitespace(value);
}

export function parseMaterialPayload(data: Record<string, unknown>): MaterialPayload {
  return {
    title: stringField(data, 'title'),
    body: stringField(data, 'body'),
    url: stringField(data, 'url'),
    category: stringField(data, 'category') || '자료',
    guild: stringField(data, 'guild'),
  };
}

export function getMaterials(filters: { category?: string; guild?: string }) {
  return listMaterials(filters);
}

export function getMaterialAccess(
  id: FlaskInt,
  actorId: FlaskInt,
  actorRole: string,
): WriteResult<MaterialRow> {
  const material = getMaterial(id);
  if (!material) return { ok: false, status: 404, error: 'not found' };
  if (actorRole !== 'pi' && BigInt(material.author_id) !== BigInt(actorId)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  return { ok: true, value: material };
}

export function createMaterial(
  actorId: FlaskInt,
  payload: MaterialPayload,
  upload: { fileUrl: string; fileName: string },
): WriteResult<{ id: SqliteInteger }> {
  if (!payload.title || !(payload.body || payload.url || upload.fileUrl)) {
    return { ok: false, status: 400, error: 'title and body or url required' };
  }
  return withWriteTransaction((conn) => {
    if (getActiveMaterialActorRole(conn, actorId) === null) {
      return { ok: false, status: 403, error: 'forbidden' };
    }
    const id = insertMaterial(conn, actorId, { ...payload, ...upload });
    if (upload.fileUrl) completeMaterialCleanupByUrl(conn, upload.fileUrl);
    return {
      ok: true,
      value: { id },
    };
  });
}

export function updateMaterial(
  id: FlaskInt,
  actorId: FlaskInt,
  payload: MaterialPayload,
  replacement?: { fileUrl: string; fileName: string },
): WriteResult<{ id: FlaskInt; cleanupFileUrl: string }> {
  return withWriteTransaction((conn) => {
    const material = getMaterialForWrite(conn, id);
    if (!material) return { ok: false, status: 404, error: 'not found' };
    const currentRole = getActiveMaterialActorRole(conn, actorId);
    if (currentRole === null
      || (currentRole !== 'pi' && BigInt(material.author_id) !== BigInt(actorId))) {
      return { ok: false, status: 403, error: 'forbidden' };
    }
    const fileUrl = replacement?.fileUrl ?? material.file_url;
    const fileName = replacement?.fileName ?? material.file_name;
    if (!payload.title || !(payload.body || payload.url || fileUrl)) {
      return { ok: false, status: 400, error: 'title and body or url required' };
    }
    updateMaterialRow(conn, id, { ...payload, fileUrl, fileName });
    if (replacement?.fileUrl) completeMaterialCleanupByUrl(conn, replacement.fileUrl);
    const cleanupFileUrl = replacement
      && material.file_url !== replacement.fileUrl
      && isManagedMaterialUploadUrl(material.file_url)
      && !materialFileIsReferenced(conn, material.file_url)
      ? material.file_url
      : '';
    if (cleanupFileUrl) queueMaterialCleanupIntent(conn, cleanupFileUrl, 'replacement');
    return {
      ok: true,
      value: { id, cleanupFileUrl },
    };
  });
}

export function removeMaterial(
  id: FlaskInt,
  actorId: FlaskInt,
): WriteResult<{ cleanupFileUrl: string }> {
  return withWriteTransaction((conn) => {
    const material = getMaterialForWrite(conn, id);
    if (!material) return { ok: false, status: 404, error: 'not found' };
    const currentRole = getActiveMaterialActorRole(conn, actorId);
    if (currentRole === null
      || (currentRole !== 'pi' && BigInt(material.author_id) !== BigInt(actorId))) {
      return { ok: false, status: 403, error: 'forbidden' };
    }
    deleteMaterialRow(conn, id);
    const cleanupFileUrl = isManagedMaterialUploadUrl(material.file_url)
      && !materialFileIsReferenced(conn, material.file_url)
      ? material.file_url
      : '';
    if (cleanupFileUrl) queueMaterialCleanupIntent(conn, cleanupFileUrl, 'material_deleted');
    return { ok: true, value: { cleanupFileUrl } };
  });
}

export function reserveMaterialUploadCleanup(fileUrl: string) {
  withWriteTransaction((conn) => queueMaterialCleanupIntent(conn, fileUrl, 'rollback_compensation', 300));
}

function cleanupError(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code ? `${code}: ${message}` : message;
}

async function processCleanupClaim(debt: CleanupClaim) {
  const referenced = withWriteTransaction((conn) => {
    if (!materialFileIsReferenced(conn, debt.file_url)) return false;
    completeMaterialCleanup(conn, debt.id);
    return true;
  });
  if (referenced) return;
  try {
    await deleteMaterialUpload(debt.file_url);
    withWriteTransaction((conn) => completeMaterialCleanup(conn, debt.id));
  } catch (error) {
    const delaySeconds = Math.min(30 * (2 ** Math.min(debt.attempts, 7)), 3600);
    withWriteTransaction((conn) => failMaterialCleanup(
      conn, debt.id, cleanupError(error), delaySeconds,
    ));
  }
}

export async function processPendingMaterialCleanups(limit = 1) {
  const claims = withWriteTransaction((conn) => claimPendingMaterialCleanups(conn, limit));
  for (const debt of claims) await processCleanupClaim(debt);
}

export async function processMaterialCleanup(fileUrl: string) {
  if (!fileUrl) return;
  const claim = withWriteTransaction((conn) => claimMaterialCleanupByUrl(conn, fileUrl));
  if (claim) await processCleanupClaim(claim);
}
