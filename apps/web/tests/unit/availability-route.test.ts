import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/lib/db/migrations';
import { closeDbForTests } from '@/lib/db/client';

const mocks = vi.hoisted(() => ({ requireApiMember: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireApiMember: mocks.requireApiMember }));

import { GET, PUT } from '@/app/api/availability/route';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-availability-route-'));
  process.env.LAB_FEED_DB = path.join(root, 'test.sqlite3');
  process.env.LAB_FEED_DB_READONLY = '0';
  const db = new Database(process.env.LAB_FEED_DB);
  try {
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.exec(`INSERT INTO members (id,name,password_hash,api_key,role,status) VALUES
      (1,'김학생','hash','key-1','student','active'),
      (2,'박교수','hash','key-2','pi','active')`);
  } finally {
    db.close();
  }
  mocks.requireApiMember.mockReset();
  mocks.requireApiMember.mockResolvedValue({
    ok: true, member: { id: 1, name: '김학생', role: 'student' },
  });
});

afterEach(() => {
  closeDbForTests();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
});

describe('weekly availability API', () => {
  it('uses the authenticated member identity when saving and reading slots', async () => {
    const save = await PUT(new Request('http://next.test/api/availability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [{ day: 0, hour: 9 }, { day: 2, hour: 18 }] }),
    }));
    expect(save.status).toBe(200);
    expect(await save.json()).toEqual({ slots: [{ day: 0, hour: 9 }, { day: 2, hour: 18 }] });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      member: { id: 1, name: '김학생', role: 'student' },
      slots: [{ day: 0, hour: 9 }, { day: 2, hour: 18 }],
      summary: null,
    });
  });

  it('returns the aggregate and names only to the PI', async () => {
    await PUT(new Request('http://next.test/api/availability', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [{ day: 0, hour: 9 }] }),
    }));
    mocks.requireApiMember.mockResolvedValue({
      ok: true, member: { id: 2, name: '박교수', role: 'pi' },
    });

    const response = await GET();
    expect(await response.json()).toMatchObject({
      member: { name: '박교수', role: 'pi' },
      summary: {
        memberCount: 2,
        respondedCount: 1,
        slots: [{ day: 0, hour: 9, count: 1, names: ['김학생'] }],
      },
    });
  });

  it('rejects invalid slots and unauthenticated requests without writing', async () => {
    const invalid = await PUT(new Request('http://next.test/api/availability', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [{ day: 7, hour: 9 }] }),
    }));
    expect(invalid.status).toBe(400);

    const unauthorized = Response.json({ error: 'login required' }, { status: 401 });
    mocks.requireApiMember.mockResolvedValue({ ok: false, error: unauthorized });
    expect((await GET()).status).toBe(401);
  });
});
