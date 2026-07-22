import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MATERIAL_SUBDIR = 'materials';
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
type DeleteFaultInjector = (fileUrl: string) => Error | null;
let deleteFaultInjector: DeleteFaultInjector | null = null;

export class MaterialUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'MaterialUploadError';
  }
}

export function uploadRoot() {
  return process.env.BAI_UPLOAD_DIR || path.join(process.cwd(), '..', '..', 'backend', 'uploads');
}

export function materialUploadDir() {
  return path.join(uploadRoot(), MATERIAL_SUBDIR);
}

export function setMaterialUploadDeleteFaultForTests(injector: DeleteFaultInjector | null) {
  if (process.env.NODE_ENV !== 'test') throw new Error('material upload fault injection is test-only');
  deleteFaultInjector = injector;
}

export function isManagedMaterialUploadUrl(fileUrl?: string): fileUrl is string {
  const prefix = '/uploads/materials/';
  if (!fileUrl?.startsWith(prefix)) return false;
  const storedName = fileUrl.slice(prefix.length);
  return Boolean(storedName) && storedName === path.basename(storedName);
}

function safeFilePart(name: string) {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'material'}${ext.startsWith('.') ? ext : ''}`;
}

export async function saveMaterialUpload(
  file: File,
  reserveCleanup?: (fileUrl: string) => void | Promise<void>,
) {
  const configuredLimit = Number(process.env.BAI_MAX_UPLOAD_BYTES || DEFAULT_MAX_UPLOAD_BYTES);
  const maxBytes = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : DEFAULT_MAX_UPLOAD_BYTES;
  if (file.size > maxBytes) {
    throw new MaterialUploadError(`file exceeds ${maxBytes} byte upload limit`, 413);
  }
  const storedName = `${crypto.randomUUID()}-${safeFilePart(file.name)}`;
  const fileUrl = `/uploads/materials/${storedName}`;
  await reserveCleanup?.(fileUrl);
  const dir = materialUploadDir();
  await fs.mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  const finalPath = path.join(dir, storedName);
  const temporaryPath = `${finalPath}.uploading`;
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
    await fs.rename(temporaryPath, finalPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    fileUrl,
    fileName: file.name,
  };
}

export async function deleteMaterialUpload(fileUrl?: string) {
  if (!isManagedMaterialUploadUrl(fileUrl)) return;
  const storedName = fileUrl.slice('/uploads/materials/'.length);
  const injected = deleteFaultInjector?.(fileUrl);
  if (injected) throw injected;
  const finalPath = path.join(materialUploadDir(), storedName);
  for (const target of [finalPath, `${finalPath}.uploading`]) {
    try {
      await fs.unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
