import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MATERIAL_SUBDIR = 'materials';

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
  const dir = materialUploadDir();
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${crypto.randomUUID()}-${safeFilePart(file.name)}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, storedName), bytes);
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
