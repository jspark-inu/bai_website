import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MATERIAL_SUBDIR = 'materials';
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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

function safeFilePart(name: string) {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'material'}${ext.startsWith('.') ? ext : ''}`;
}

export async function saveMaterialUpload(file: File) {
  const configuredLimit = Number(process.env.BAI_MAX_UPLOAD_BYTES || DEFAULT_MAX_UPLOAD_BYTES);
  const maxBytes = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : DEFAULT_MAX_UPLOAD_BYTES;
  if (file.size > maxBytes) {
    throw new MaterialUploadError(`file exceeds ${maxBytes} byte upload limit`, 413);
  }
  const dir = materialUploadDir();
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${crypto.randomUUID()}-${safeFilePart(file.name)}`;
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
    fileUrl: `/uploads/materials/${storedName}`,
    fileName: file.name,
  };
}

export async function deleteMaterialUpload(fileUrl?: string) {
  const prefix = '/uploads/materials/';
  if (!fileUrl?.startsWith(prefix)) return;
  const storedName = fileUrl.slice(prefix.length);
  if (storedName !== path.basename(storedName)) return;
  try {
    await fs.unlink(path.join(materialUploadDir(), storedName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
