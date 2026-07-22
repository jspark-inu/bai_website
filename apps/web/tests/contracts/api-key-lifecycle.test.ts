import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const currentMember = { id: 1, name: 'Member', role: 'developer' };

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(() => Buffer.alloc(24, 7)) };
});
vi.mock('@/lib/auth', () => ({
  requireApiMember: async () => ({ ok: true, member: currentMember }),
}));
vi.mock('@/lib/legacy-api-proxy', () => ({
  proxyLegacyApi: vi.fn(async () => {
    throw new Error('Task 5 lifecycle route called the Flask legacy proxy');
  }),
}));

import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-api-key-lifecycle-'));
const dbPath = path.join(tempRoot, 'lifecycle.sqlite3');
const generatedKey = Buffer.alloc(24, 7).toString('base64url');

beforeAll(() => {
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  runMigrations();
  const db = new Database(dbPath);
  try {
    db.prepare(`INSERT INTO members
      (id, name, password_hash, api_key, role, status)
      VALUES (1, 'Member', 'hash', 'old-key', 'developer', 'active')`).run();
  } finally {
    db.close();
  }
});

afterAll(() => {
  closeDbForTests();
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Next-owned API key lifecycle', () => {
  it('revokes the old key immediately and accepts the regenerated key', async () => {
    const regenerate = await import('@/app/api/developer/key/regenerate/route');
    const regenerateResponse = await regenerate.POST(new NextRequest(
      'http://fixture.invalid/api/developer/key/regenerate',
      { method: 'POST' },
    ));
    expect(regenerateResponse.status).toBe(200);
    expect(await regenerateResponse.json()).toEqual({ api_key: generatedKey });

    const goodbai = await import('@/app/api/post/route');
    const oldKeyResponse = await goodbai.POST(new NextRequest(
      'http://fixture.invalid/api/post',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'old-key' },
        body: JSON.stringify({ did: 'must not write' }),
      },
    ));
    expect(oldKeyResponse.status).toBe(401);
    expect(await oldKeyResponse.json()).toEqual({ error: 'invalid api key' });

    const newKeyResponse = await goodbai.POST(new NextRequest(
      'http://fixture.invalid/api/post',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': generatedKey },
        body: JSON.stringify({ did: 'new key works' }),
      },
    ));
    expect(newKeyResponse.status).toBe(200);

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.prepare('SELECT api_key FROM members WHERE id=1').get()).toEqual({ api_key: generatedKey });
      expect(db.prepare('SELECT did, source FROM posts').all()).toEqual([
        { did: 'new key works', source: 'skill' },
      ]);
      expect(db.prepare('SELECT action FROM audit_log').all()).toEqual([
        { action: 'regenerate_own_api_key' },
      ]);
    } finally {
      db.close();
    }
  });
});
