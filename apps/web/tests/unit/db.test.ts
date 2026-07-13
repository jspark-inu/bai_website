import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, listMaterials, listMembers, resolveDbPath } from '@/lib/db';

const originalDbPath = process.env.LAB_FEED_DB;
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
});

afterAll(() => {
  if (originalDbPath === undefined) delete process.env.LAB_FEED_DB;
  else process.env.LAB_FEED_DB = originalDbPath;
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('SQLite adapter', () => {
  it('uses the isolated database fixture in tests', () => {
    expect(resolveDbPath()).toBe(fixtureDbPath);
  });

  it('opens the fixture database read-only by default', () => {
    const db = getDb();
    const row = db.prepare("select name from sqlite_master where type='table' and name='materials'").get() as { name?: string } | undefined;
    expect(row?.name).toBe('materials');
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
});
