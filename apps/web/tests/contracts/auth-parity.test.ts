import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import fixtureJson from './auth-parity-fixture.json';

const jar = vi.hoisted(() => new Map<string, string>());
const proxyLegacyApi = vi.hoisted(() => vi.fn(async () => {
  throw new Error('Task 7 auth route called the Flask legacy proxy');
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get(name: string) {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name: string, value: string) {
      jar.set(name, value);
    },
    delete(name: string) {
      jar.delete(name);
    },
  }),
}));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn((size: number) => Buffer.alloc(size, 7)) };
});
vi.mock('@/lib/legacy-api-proxy', () => ({ proxyLegacyApi }));

import { POST as changePassword } from '@/app/api/change-password/route';
import { POST as login } from '@/app/api/login/route';
import { POST as logout } from '@/app/api/logout/route';
import { GET as meGet, POST as mePost } from '@/app/api/me/route';
import { hashWerkzeugPassword, verifyWerkzeugPassword } from '@/lib/auth/password';
import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type DbExpectation = {
  memberId: number;
  apiKey?: string;
  passwordAccepts?: 'original' | 'replacement';
  passwordRejects?: 'original' | 'replacement';
  auditActions?: string[];
};
type ContractStep = {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  jsonBody?: JsonValue;
  rawBody?: string;
  contentType?: string;
  status: number;
  json?: JsonValue;
  unhandled?: boolean;
  db?: DbExpectation;
};
type Fixture = {
  version: number;
  generatedApiKey: string;
  nextGeneratedHash: string;
  passwords: Record<'original' | 'replacement', string>;
  members: Array<{
    id: number;
    name: string;
    password_hash: string;
    api_key: string;
    role: string;
    status: string;
  }>;
  steps: ContractStep[];
};

const fixture = fixtureJson as Fixture;
const tempRoot = mkdtempSync(join(tmpdir(), 'bai-auth-parity-'));
const dbPath = join(tempRoot, 'auth.sqlite3');

afterAll(() => {
  closeDbForTests();
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
  delete process.env.LAB_FEED_SECRET;
  rmSync(tempRoot, { recursive: true, force: true });
});

function requestFor(step: ContractStep) {
  const headers = new Headers();
  const init: RequestInit = { method: step.method, headers };
  if ('jsonBody' in step) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(step.jsonBody);
  } else if ('rawBody' in step) {
    headers.set('content-type', step.contentType ?? 'application/json');
    init.body = step.rawBody;
  }
  return new Request(`http://next.test${step.path}`, init);
}

function handlerFor(step: ContractStep) {
  const pathname = new URL(step.path, 'http://next.test').pathname;
  if (step.method === 'POST' && pathname === '/api/login') return login;
  if (step.method === 'POST' && pathname === '/api/logout') return logout;
  if (step.method === 'GET' && pathname === '/api/me') return meGet;
  if (step.method === 'POST' && pathname === '/api/me') return mePost;
  if (step.method === 'POST' && pathname === '/api/change-password') return changePassword;
  throw new Error(`unsupported auth fixture route: ${step.method} ${pathname}`);
}

async function assertDb(expectation: DbExpectation) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const member = db.prepare('SELECT password_hash,api_key FROM members WHERE id=?')
      .get(expectation.memberId) as { password_hash: string; api_key: string };
    if (expectation.apiKey !== undefined) expect(member.api_key).toBe(expectation.apiKey);
    if (expectation.passwordAccepts) {
      await expect(verifyWerkzeugPassword(
        fixture.passwords[expectation.passwordAccepts],
        member.password_hash,
      )).resolves.toBe(true);
    }
    if (expectation.passwordRejects) {
      await expect(verifyWerkzeugPassword(
        fixture.passwords[expectation.passwordRejects],
        member.password_hash,
      )).resolves.toBe(false);
    }
    if (expectation.auditActions) {
      expect(db.prepare('SELECT action FROM audit_log ORDER BY id').all())
        .toEqual(expectation.auditActions.map((action) => ({ action })));
    }
  } finally {
    db.close();
  }
}

describe('shared Flask/Next authentication oracle', () => {
  it('executes the ordered lifecycle entirely through explicit Next handlers', async () => {
    expect(fixture.version).toBe(1);
    expect(fixture.steps).toHaveLength(21);
    process.env.LAB_FEED_DB = dbPath;
    process.env.LAB_FEED_DB_READONLY = '0';
    process.env.LAB_FEED_SECRET = 'shared-auth-parity-secret-at-least-32-characters';
    closeDbForTests();
    runMigrations();
    const db = new Database(dbPath);
    try {
      const insert = db.prepare(`INSERT INTO members
        (id,name,password_hash,api_key,role,status) VALUES
        (@id,@name,@password_hash,@api_key,@role,@status)`);
      for (const member of fixture.members) insert.run(member);
    } finally {
      db.close();
    }

    await expect(hashWerkzeugPassword(fixture.passwords.replacement, { salt: 'fixedtestsalts1x' }))
      .resolves.toBe(fixture.nextGeneratedHash);

    for (const step of fixture.steps) {
      let response: Response;
      try {
        response = await handlerFor(step)(requestFor(step) as never);
      } catch (error) {
        expect(step.unhandled, step.name).toBe(true);
        expect(step.status, step.name).toBe(500);
        expect(error, step.name).toBeInstanceOf(TypeError);
        continue;
      }
      expect(step.unhandled, step.name).not.toBe(true);
      expect(response.status, step.name).toBe(step.status);
      if (step.json !== undefined) {
        await expect(response.json(), step.name).resolves.toEqual(step.json);
      }
      if (step.db) await assertDb(step.db);
    }
    expect(proxyLegacyApi).not.toHaveBeenCalled();
  }, 15_000);
});
