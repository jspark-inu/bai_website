import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addWallMessage, getDb, listMaterials, listMembers, listWallMessages, resolveDbPath } from '@/lib/db';
import { closeDbForTests, openWriteDb } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';

const originalDbPath = process.env.LAB_FEED_DB;
const originalReadonly = process.env.LAB_FEED_DB_READONLY;
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'bai-db-test-'));
const fixtureDbPath = path.join(fixtureDir, 'lab-feed.db');

beforeAll(() => {
  const fixture = new Database(fixtureDbPath);
  fixture.exec(`
    CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, password_hash TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '');
    CREATE TABLE materials (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '자료', guild TEXT NOT NULL DEFAULT '');
    INSERT INTO members (id, name, role, status) VALUES (1, '테스트 멤버', 'student', 'active');
    INSERT INTO materials (id, author_id, title, body) VALUES (1, 1, '테스트 자료', 'fixture body');
  `);
  fixture.close();
  process.env.LAB_FEED_DB = fixtureDbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  runMigrations();
});

afterAll(() => {
  closeDbForTests();
  if (originalDbPath === undefined) delete process.env.LAB_FEED_DB;
  else process.env.LAB_FEED_DB = originalDbPath;
  if (originalReadonly === undefined) delete process.env.LAB_FEED_DB_READONLY;
  else process.env.LAB_FEED_DB_READONLY = originalReadonly;
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('SQLite adapter', () => {
  it('uses the isolated database fixture in tests', () => {
    expect(resolveDbPath()).toBe(fixtureDbPath);
  });

  it('rejects ambiguous relative database paths in production', () => {
    vi.stubEnv('LAB_FEED_DB', 'backend/lab-feed.db');
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() => resolveDbPath()).toThrow(/absolute path/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('opens the fixture database read-only by default', () => {
    const db = getDb();
    const row = db.prepare("select name from sqlite_master where type='table' and name='materials'").get() as { name?: string } | undefined;
    expect(row?.name).toBe('materials');
  });

  it('fails closed for writes unless LAB_FEED_DB_READONLY is exactly zero', () => {
    for (const value of [undefined, '1', 'false']) {
      if (value === undefined) delete process.env.LAB_FEED_DB_READONLY;
      else process.env.LAB_FEED_DB_READONLY = value;
      expect(() => openWriteDb()).toThrow(/LAB_FEED_DB_READONLY/);
    }
    process.env.LAB_FEED_DB_READONLY = '0';
    const conn = openWriteDb();
    conn.close();
  });

  it('does not reuse a pooled handle after the readonly mode changes', () => {
    process.env.LAB_FEED_DB_READONLY = '1';
    const readonly = getDb();
    expect(readonly.readonly).toBe(true);
    process.env.LAB_FEED_DB_READONLY = '0';
    const writable = getDb();
    expect(writable).not.toBe(readonly);
    expect(writable.readonly).toBe(false);
  });

  it('lists existing members without exposing credential columns', () => {
    const members = listMembers();
    expect(members.length).toBeGreaterThan(0);
    expect(members[0]).toHaveProperty('id');
    expect(members[0]).toHaveProperty('name');
    expect(members[0]).not.toHaveProperty('password_hash');
    expect(members[0]).not.toHaveProperty('api_key');
  });

  it('lists materials with markdown source body preserved', () => {
    const materials = listMaterials();
    expect(Array.isArray(materials)).toBe(true);
    if (materials.length > 0) {
      expect(materials[0]).toHaveProperty('title');
      expect(materials[0]).toHaveProperty('body');
    }
  });

  it('creates and reads anonymous wall messages without exposing an author identity', () => {
    const id = addWallMessage(1, '응원합니다');
    expect(id).toBeGreaterThan(0);
    expect(listWallMessages()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, body: '응원합니다' }),
    ]));
    expect(listWallMessages()[0]).not.toHaveProperty('author_id');
  });
});
