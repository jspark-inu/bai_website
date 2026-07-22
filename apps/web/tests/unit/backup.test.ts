import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(process.cwd(), 'scripts', 'backup-db.mjs');
let root = '';

function runBackup(db: string, backupDir: string, stamp: string) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--db', db,
    '--backup-dir', backupDir,
    '--stamp', stamp,
    '--keep', '3',
  ], { encoding: 'utf8' });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bai-next-backup-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Next-only verified database backup', () => {
  it('backs up a WAL database and verifies the published image', () => {
    const dbPath = path.join(root, 'live.db');
    const backupDir = path.join(root, 'backups');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE posts(id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES members(id));
      INSERT INTO members(id,name) VALUES (1,'기존 멤버');
      INSERT INTO posts(id,author_id) VALUES (1,1);
    `);
    const result = runBackup(dbPath, backupDir, 'wal-fixture');
    expect(result.status, result.stderr).toBe(0);
    db.close();

    const destination = path.join(backupDir, 'lab-feed-wal-fixture.db');
    expect(existsSync(destination)).toBe(true);
    const restored = new Database(destination, { readonly: true, fileMustExist: true });
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(restored.prepare('SELECT name FROM members').pluck().get()).toBe('기존 멤버');
    expect(restored.pragma('foreign_key_check')).toEqual([]);
    restored.close();
  });

  it('rejects an unrelated SQLite file without publishing a backup', () => {
    const dbPath = path.join(root, 'unrelated.db');
    const backupDir = path.join(root, 'backups');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY)');
    db.close();

    const result = runBackup(dbPath, backupDir, 'unrelated');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/core table|members|posts/i);
    expect(existsSync(backupDir) ? readdirSync(backupDir) : []).toEqual([]);
  });

  it('rejects foreign-key violations without publishing a backup', () => {
    const dbPath = path.join(root, 'broken-fk.db');
    const backupDir = path.join(root, 'backups');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE posts(id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES members(id));
    `);
    db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO posts(id,author_id) VALUES (1,999)').run();
    db.close();

    const result = runBackup(dbPath, backupDir, 'broken-fk');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/foreign_key_check/i);
    expect(existsSync(backupDir) ? readdirSync(backupDir) : []).toEqual([]);
  });

  it('never overwrites an existing published backup', () => {
    const dbPath = path.join(root, 'live.db');
    const backupDir = path.join(root, 'backups');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE posts(id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES members(id));
    `);
    db.close();

    expect(runBackup(dbPath, backupDir, 'same').status).toBe(0);
    const destination = path.join(backupDir, 'lab-feed-same.db');
    const before = readFileSync(destination);
    const changed = new Database(dbPath);
    changed.prepare("INSERT INTO members(id,name) VALUES (1,'new source row')").run();
    changed.close();

    const second = runBackup(dbPath, backupDir, 'same');
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/refusing to overwrite/i);
    expect(readFileSync(destination)).toEqual(before);
    expect(readdirSync(backupDir)).toEqual(['lab-feed-same.db']);
  });
});
