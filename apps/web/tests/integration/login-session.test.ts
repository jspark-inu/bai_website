import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jarState = vi.hoisted(() => ({
  values: new Map<string, string>(),
  lastSet: null as null | { name: string; value: string; options: Record<string, unknown> },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get(name: string) {
      const value = jarState.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name: string, value: string, options: Record<string, unknown>) {
      jarState.values.set(name, value);
      jarState.lastSet = { name, value, options };
    },
    delete(name: string) {
      jarState.values.delete(name);
    },
  }),
}));

import { POST as authLogin } from '@/app/api/auth/login/route';
import { POST as authLogout } from '@/app/api/auth/logout/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { GET as feed } from '@/app/api/feed/route';
import { POST as compatLogin } from '@/app/api/login/route';
import { POST as compatLogout } from '@/app/api/logout/route';
import { GET as compatMe, POST as compatMePost } from '@/app/api/me/route';
import { POST as changePassword } from '@/app/api/change-password/route';
import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';
import { replaceActiveMemberPassword } from '@/lib/db/repositories/members';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

const PBKDF2_HASH = 'pbkdf2:sha256:1000000$FSVw4UciNL5tg1Sm$e087bd1acf2b14ed4ff54025901da3f9446b0415868ff7586713eca50c21141d';
const SCRYPT_HASH = 'scrypt:32768:8:1$JXwljJAL77bFOjHS$d68d46b69570eddcc09dd0090fd722a4436cdc1b5feace65d5e9ee91aef691f32c2e2b6d2b5c66976783e8743b482cecd7de3f24f892e3e68912cf6a391b65c5';
const PASSWORD = 'correct horse battery staple';
let directory = '';
let dbPath = '';

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://next.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function seedDatabase() {
  const db = new Database(dbPath);
  runMigrations(db);
  db.prepare(`INSERT INTO members (id,name,password_hash,api_key,role,status) VALUES
    (1,'PBKDF2 member',?,'pbkdf2-key','student','active'),
    (2,'Scrypt member',?,'scrypt-key','developer','active'),
    (3,'Disabled member',?,'disabled-key','student','disabled')`).run(PBKDF2_HASH, SCRYPT_HASH, PBKDF2_HASH);
  db.close();
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'bai-task7-auth-'));
  dbPath = join(directory, 'auth.sqlite3');
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  process.env.LAB_FEED_SECRET = 'task-7-integration-secret-at-least-32-characters';
  vi.stubEnv('NODE_ENV', 'test');
  jarState.values.clear();
  jarState.lastSet = null;
  closeDbForTests();
  seedDatabase();
});

afterEach(() => {
  closeDbForTests();
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
  delete process.env.LAB_FEED_SECRET;
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe('Flask-free login lifecycle through real Next handlers', () => {
  it.each([
    ['primary', authLogin, 'PBKDF2 member'],
    ['compatibility', compatLogin, 'Scrypt member'],
  ] as const)('%s login issues a hardened Next cookie and authenticates protected routes', async (_label, login, name) => {
    const response = await login(jsonRequest('/api/login', { name, password: PASSWORD }) as never);
    expect(response.status).toBe(200);
    expect(jarState.lastSet).toMatchObject({
      name: SESSION_COOKIE_NAME,
      options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: expect.any(Number) },
    });
    expect((await authMe(new Request('http://next.test/api/auth/me'))).status).toBe(200);
    expect((await feed(new NextRequest('http://next.test/api/feed'))).status).toBe(200);
  });

  it('preserves failure, disabled-member, falsey, and non-JSON login contracts', async () => {
    expect((await authLogin(jsonRequest('/api/auth/login', {
      name: 'PBKDF2 member', password: 'wrong',
    }) as never)).status).toBe(401);
    expect((await authLogin(jsonRequest('/api/auth/login', {
      name: 'Disabled member', password: PASSWORD,
    }) as never)).status).toBe(401);
    expect((await authLogin(jsonRequest('/api/auth/login', false) as never)).status).toBe(401);
    expect((await authLogin(new Request('http://next.test/api/auth/login', {
      method: 'POST', body: 'not json',
    }) as never)).status).toBe(401);
    await expect(authLogin(jsonRequest('/api/auth/login', [1]) as never)).rejects.toThrow(/JSON object required/);
  });

  it('fails closed instead of rounding an unsafe SQLite member ID', async () => {
    const db = new Database(dbPath);
    db.prepare(`INSERT INTO members (id,name,password_hash,api_key,role,status)
      VALUES (9007199254740993,'Bigint member',?,'bigint-key','student','active')`).run(PBKDF2_HASH);
    db.close();

    const response = await authLogin(jsonRequest('/api/auth/login', {
      name: 'Bigint member', password: PASSWORD,
    }) as never);
    expect(response.status).toBe(503);
    expect(jarState.values.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it('rejects a tampered cookie and revalidates the current database role and status', async () => {
    expect((await authLogin(jsonRequest('/api/auth/login', {
      name: 'PBKDF2 member', password: PASSWORD,
    }) as never)).status).toBe(200);
    const valid = jarState.values.get(SESSION_COOKIE_NAME)!;
    jarState.values.set(SESSION_COOKIE_NAME, `${valid}tampered`);
    expect((await compatMe(new Request('http://next.test/api/me'))).status).toBe(401);

    jarState.values.set(SESSION_COOKIE_NAME, valid);
    const db = new Database(dbPath);
    db.prepare("UPDATE members SET role='operator' WHERE id=1").run();
    db.close();
    await expect((await compatMe(new Request('http://next.test/api/me'))).json())
      .resolves.toMatchObject({ id: 1, role: 'operator' });

    const disableDb = new Database(dbPath);
    disableDb.prepare("UPDATE members SET status='disabled' WHERE id=1").run();
    disableDb.close();
    expect((await compatMe(new Request('http://next.test/api/me'))).status).toBe(401);
  });

  it('invalidates the server-side session on both logout routes so replay is rejected', async () => {
    await authLogin(jsonRequest('/api/auth/login', { name: 'PBKDF2 member', password: PASSWORD }) as never);
    const replay = jarState.values.get(SESSION_COOKIE_NAME)!;
    expect((await authLogout(new Request('http://next.test/api/auth/logout', { method: 'POST' }))).status).toBe(200);
    jarState.values.set(SESSION_COOKIE_NAME, replay);
    expect((await compatMe(new Request('http://next.test/api/me'))).status).toBe(401);

    await compatLogin(jsonRequest('/api/login', { name: 'PBKDF2 member', password: PASSWORD }) as never);
    expect((await compatLogout(new Request('http://next.test/api/logout', { method: 'POST' }))).status).toBe(200);
  });

  it('preserves /api/me API-key compatibility through the Next session', async () => {
    await authLogin(jsonRequest('/api/auth/login', { name: 'PBKDF2 member', password: PASSWORD }) as never);
    const before = await compatMe(new Request('http://next.test/api/me?api_key=1'));
    await expect(before.json()).resolves.toEqual({
      id: 1,
      name: 'PBKDF2 member',
      role: 'student',
      api_key: 'pbkdf2-key',
      member_id: 1,
      usage: { endpoint: '/api/post', header: 'X-API-Key', method: 'POST' },
    });

    const regenerated = await compatMePost(jsonRequest('/api/me', { action: 'regenerate_api_key' }));
    expect(regenerated.status).toBe(200);
    await expect(regenerated.json()).resolves.toMatchObject({
      member_id: 1, name: 'PBKDF2 member', role: 'student', api_key: expect.any(String),
    });
  });

  it('changes the password through the explicit Next route without breaking Werkzeug login compatibility', async () => {
    expect((await changePassword(jsonRequest('/api/change-password', {
      current_password: PASSWORD, new_password: 'replacement password',
    }) as never)).status).toBe(401);
    await authLogin(jsonRequest('/api/auth/login', { name: 'PBKDF2 member', password: PASSWORD }) as never);
    expect((await changePassword(jsonRequest('/api/change-password', {
      current_password: 'wrong', new_password: 'replacement password',
    }) as never)).status).toBe(400);
    expect((await changePassword(jsonRequest('/api/change-password', {
      current_password: PASSWORD, new_password: '123',
    }) as never)).status).toBe(400);
    expect((await changePassword(jsonRequest('/api/change-password', {
      current_password: PASSWORD, new_password: 'replacement password',
    }) as never)).status).toBe(200);

    await authLogout(new Request('http://next.test/api/auth/logout', { method: 'POST' }));
    expect((await authLogin(jsonRequest('/api/auth/login', {
      name: 'PBKDF2 member', password: PASSWORD,
    }) as never)).status).toBe(401);
    expect((await authLogin(jsonRequest('/api/auth/login', {
      name: 'PBKDF2 member', password: 'replacement password',
    }) as never)).status).toBe(200);
  });

  it('rejects password change after the authenticated member is disabled without mutating the hash', async () => {
    await authLogin(jsonRequest('/api/auth/login', { name: 'PBKDF2 member', password: PASSWORD }) as never);
    const db = new Database(dbPath);
    const before = db.prepare('SELECT password_hash FROM members WHERE id=1').get() as { password_hash: string };
    db.prepare("UPDATE members SET status='disabled' WHERE id=1").run();
    db.close();

    expect((await changePassword(jsonRequest('/api/change-password', {
      current_password: PASSWORD, new_password: 'replacement password',
    }) as never)).status).toBe(401);
    const verifyDb = new Database(dbPath, { readonly: true });
    expect(verifyDb.prepare('SELECT password_hash FROM members WHERE id=1').get()).toEqual(before);
    verifyDb.close();
  });

  it('does not overwrite a password when the transaction sees a stale expected hash', () => {
    const db = new Database(dbPath);
    expect(replaceActiveMemberPassword(db, 1, 'stale-hash', 'replacement-hash')).toBe('changed');
    expect(db.prepare('SELECT password_hash FROM members WHERE id=1').get())
      .toEqual({ password_hash: PBKDF2_HASH });
    db.close();
  });
});
