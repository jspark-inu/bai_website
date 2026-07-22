import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireApiMember: async () => ({ ok: true, member: { id: 1, name: 'Member', role: 'student' } }),
}));

import { GET } from '@/app/uploads/materials/[...file]/route';
import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';
import { materialUploadDir } from '@/lib/uploads';

let root = '';
let dbPath = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-material-download-'));
  dbPath = path.join(root, 'fixture.sqlite3');
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  process.env.BAI_UPLOAD_DIR = path.join(root, 'uploads');
  runMigrations();
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO members (id,name,password_hash,api_key,role,status)
    VALUES (1,'Member','hash','key','student','active')`).run();
  db.prepare(`INSERT INTO materials
    (id,author_id,title,body,file_url,file_name)
    VALUES (10,1,'자료','본문','/uploads/materials/stored.pdf','원본 자료.pdf')`).run();
  db.close();
  fs.mkdirSync(materialUploadDir(), { recursive: true });
  fs.writeFileSync(path.join(materialUploadDir(), 'stored.pdf'), 'pdf bytes');
  fs.writeFileSync(path.join(materialUploadDir(), 'orphan.pdf'), 'orphan bytes');
});

afterEach(() => {
  closeDbForTests();
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
  delete process.env.BAI_UPLOAD_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('material upload download ownership', () => {
  it('serves only a referenced upload with a safe original filename', async () => {
    const response = await GET(new Request('http://fixture.invalid/uploads/materials/stored.pdf'), {
      params: Promise.resolve({ file: ['stored.pdf'] }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pdf bytes');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''%EC%9B%90%EB%B3%B8%20%EC%9E%90%EB%A3%8C.pdf");
  });

  it('does not expose an unreferenced orphan', async () => {
    const response = await GET(new Request('http://fixture.invalid/uploads/materials/orphan.pdf'), {
      params: Promise.resolve({ file: ['orphan.pdf'] }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });

  it('does not follow a referenced symlink outside the upload directory', async () => {
    const outside = path.join(root, 'outside-secret.txt');
    fs.writeFileSync(outside, 'TOP-SECRET');
    fs.symlinkSync(outside, path.join(materialUploadDir(), 'link.pdf'));
    const db = new Database(dbPath);
    db.prepare(`INSERT INTO materials
      (id,author_id,title,body,file_url,file_name)
      VALUES (11,1,'링크','본문','/uploads/materials/link.pdf','link.pdf')`).run();
    db.close();

    const response = await GET(new Request('http://fixture.invalid/uploads/materials/link.pdf'), {
      params: Promise.resolve({ file: ['link.pdf'] }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });
});
