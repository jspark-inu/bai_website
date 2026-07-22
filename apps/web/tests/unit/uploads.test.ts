import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteMaterialUpload, MaterialUploadError, saveMaterialUpload } from '@/lib/uploads';

let root = '';
const previousUploadDir = process.env.BAI_UPLOAD_DIR;
const previousLimit = process.env.BAI_MAX_UPLOAD_BYTES;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bai-upload-test-'));
  process.env.BAI_UPLOAD_DIR = root;
  delete process.env.BAI_MAX_UPLOAD_BYTES;
});

afterEach(() => {
  if (previousUploadDir === undefined) delete process.env.BAI_UPLOAD_DIR;
  else process.env.BAI_UPLOAD_DIR = previousUploadDir;
  if (previousLimit === undefined) delete process.env.BAI_MAX_UPLOAD_BYTES;
  else process.env.BAI_MAX_UPLOAD_BYTES = previousLimit;
  rmSync(root, { recursive: true, force: true });
});

describe('material upload persistence', () => {
  it('publishes a complete file atomically and removes it only through its stored URL', async () => {
    const result = await saveMaterialUpload(new File(['safe payload'], '실험 결과.txt', { type: 'text/plain' }));
    const storedName = result.fileUrl.split('/').at(-1)!;
    const files = readdirSync(path.join(root, 'materials'));

    expect(files).toEqual([storedName]);
    expect(files.some((name) => name.endsWith('.uploading'))).toBe(false);
    expect(readFileSync(path.join(root, 'materials', storedName), 'utf8')).toBe('safe payload');

    await deleteMaterialUpload(result.fileUrl);
    expect(readdirSync(path.join(root, 'materials'))).toEqual([]);
  });

  it('rejects an oversized file before writing any bytes', async () => {
    process.env.BAI_MAX_UPLOAD_BYTES = '4';
    await expect(saveMaterialUpload(new File(['12345'], 'large.txt'))).rejects.toBeInstanceOf(MaterialUploadError);
    expect(() => readdirSync(path.join(root, 'materials'))).toThrow();
  });

  it('persists the cleanup reservation before creating or publishing upload bytes', async () => {
    let reservedUrl = '';
    await expect(saveMaterialUpload(new File(['payload'], 'reserved.txt'), (fileUrl) => {
      reservedUrl = fileUrl;
      expect(existsSync(path.join(root, 'materials'))).toBe(false);
      throw new Error('reservation failed');
    })).rejects.toThrow('reservation failed');

    expect(reservedUrl).toMatch(/^\/uploads\/materials\/.+-reserved\.txt$/);
    expect(existsSync(path.join(root, 'materials'))).toBe(false);
  });
});
