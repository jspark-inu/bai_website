import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';
import { processPendingMaterialCleanups } from '@/lib/services/materials';
import { materialUploadDir, setMaterialUploadDeleteFaultForTests } from '@/lib/uploads';

let root = '';
let dbPath = '';

function seedDebt(fileName: string, attempts = 1) {
  const fileUrl = `/uploads/materials/${fileName}`;
  fs.mkdirSync(materialUploadDir(), { recursive: true });
  fs.writeFileSync(path.join(materialUploadDir(), fileName), 'orphan');
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO material_file_cleanup_queue
    (file_url, reason, attempts, last_error) VALUES (?, 'material_deleted', ?, 'initial')`)
    .run(fileUrl, attempts);
  db.close();
  return fileUrl;
}

function debt(fileUrl: string) {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare(`SELECT file_url,attempts,last_error,completed_at
    FROM material_file_cleanup_queue WHERE file_url=?`).get(fileUrl);
  db.close();
  return row;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-material-cleanup-'));
  dbPath = path.join(root, 'fixture.sqlite3');
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  process.env.BAI_UPLOAD_DIR = path.join(root, 'uploads');
  runMigrations();
  setMaterialUploadDeleteFaultForTests(null);
});

afterEach(() => {
  closeDbForTests();
  setMaterialUploadDeleteFaultForTests(null);
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
  delete process.env.BAI_UPLOAD_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('durable material cleanup retries', () => {
  it('deletes a pending orphan and clears its debt', async () => {
    const fileUrl = seedDebt('orphan.pdf');

    await processPendingMaterialCleanups();

    expect(fs.existsSync(path.join(materialUploadDir(), 'orphan.pdf'))).toBe(false);
    expect(debt(fileUrl)).toBeUndefined();
  });

  it('keeps failed debt pending while incrementing attempts and recording the error', async () => {
    const fileUrl = seedDebt('busy.pdf', 2);
    setMaterialUploadDeleteFaultForTests(() => Object.assign(new Error('still busy'), { code: 'EBUSY' }));

    await processPendingMaterialCleanups();

    expect(fs.existsSync(path.join(materialUploadDir(), 'busy.pdf'))).toBe(true);
    expect(debt(fileUrl)).toEqual({
      file_url: fileUrl,
      attempts: 3,
      last_error: 'EBUSY: still busy',
      completed_at: null,
    });
  });

  it('backs off a failing oldest debt so the next debt is not starved', async () => {
    const firstUrl = seedDebt('first.pdf');
    const secondUrl = seedDebt('second.pdf');
    setMaterialUploadDeleteFaultForTests((fileUrl) => fileUrl === firstUrl
      ? Object.assign(new Error('blocked'), { code: 'EBUSY' })
      : null);

    await processPendingMaterialCleanups();
    await processPendingMaterialCleanups();

    expect(debt(firstUrl)).toEqual(expect.objectContaining({ attempts: 2, last_error: 'EBUSY: blocked' }));
    expect(debt(secondUrl)).toBeUndefined();
    expect(fs.existsSync(path.join(materialUploadDir(), 'second.pdf'))).toBe(false);
  });

  it('clears stale debt without deleting a file that is still referenced', async () => {
    const fileUrl = seedDebt('shared.pdf');
    const db = new Database(dbPath);
    db.prepare(`INSERT INTO members (id,name,password_hash,api_key,role,status)
      VALUES (1,'Member','hash','key','student','active')`).run();
    db.prepare(`INSERT INTO materials (id,author_id,title,body,file_url,file_name)
      VALUES (1,1,'자료','본문',?,'shared.pdf')`).run(fileUrl);
    db.close();

    await processPendingMaterialCleanups();

    expect(debt(fileUrl)).toBeUndefined();
    expect(fs.existsSync(path.join(materialUploadDir(), 'shared.pdf'))).toBe(true);
  });
});
