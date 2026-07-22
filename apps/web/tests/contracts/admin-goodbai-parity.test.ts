import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureJson from './admin-goodbai-parity-fixture.json';

let member: AuthIdentity | null = null;
const proxyLegacyApi = vi.fn(async () => {
  throw new Error('Task 5 route still called the Flask legacy proxy');
});
const forbiddenFetch = vi.fn(async () => {
  throw new Error('network fetch is forbidden while executing Task 5 owned routes');
});

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(() => Buffer.alloc(24, 7)) };
});
vi.mock('@/lib/auth', () => ({
  requireApiMember: async () => member
    ? { ok: true, member }
    : { ok: false, error: Response.json({ error: 'login required' }, { status: 401 }) },
}));
vi.mock('@/lib/legacy-api-proxy', () => ({ proxyLegacyApi }));

import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type AuthIdentity = { id: number; name: string; role: string };
type SeedRow = Record<string, JsonValue>;
type Projection = { query: string; safeIntegers?: boolean; rows: Array<Record<string, JsonValue>> };
type ContractCase = {
  name: string;
  seedVariant?: string;
  auth: AuthIdentity | null;
  headers?: Record<string, string>;
  method: 'GET' | 'POST';
  path: string;
  rawBody?: string | null;
  jsonBody?: Record<string, JsonValue>;
  requestContentType?: string;
  expectUnhandled?: boolean;
  status: number;
  contentType: string;
  json?: JsonValue;
  body?: string;
  expectedDb: Projection[];
  noMutation: boolean;
};
type SeedVariant = {
  members?: SeedRow[];
  projects?: SeedRow[];
  sqliteSequences?: Array<{ table: string; seq: JsonValue }>;
  failProjectMemberInsert?: boolean;
};
type Fixture = {
  version: number;
  routeMethods: string[];
  generatedApiKey: string;
  seed: Record<string, SeedRow[]>;
  seedVariants: Record<string, SeedVariant>;
  cases: ContractCase[];
};
type RouteModule = {
  GET?: (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
  POST?: (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
};

const EXPECTED_ROUTE_METHODS = new Set([
  'POST /api/projects',
  'POST /api/projects/:pid',
  'GET /api/members/api-key',
  'POST /api/members/api-key/regenerate',
  'GET /api/account/api-key',
  'POST /api/account/api-key/regenerate',
  'GET /api/developer/key',
  'POST /api/developer/key/regenerate',
  'GET /api/admin/members',
  'POST /api/admin/members/:mid/api-key/regenerate',
  'POST /api/admin/members/:mid',
  'POST /api/post',
]);

function materialize(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(materialize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0][0] === '$integer' && typeof entries[0][1] === 'string') {
      return BigInt(entries[0][1]);
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, materialize(item)]));
  }
  return value;
}

function parseLosslessJson(text: string): unknown {
  const parseWithSource = JSON.parse as (
    source: string,
    reviver: (key: string, value: unknown, context?: { source: string }) => unknown,
  ) => unknown;
  return parseWithSource(text, (_key, value, context) => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)
      && context && /^-?\d+$/.test(context.source)) return BigInt(context.source);
    return value;
  });
}

function routeMethod(contract: ContractCase) {
  let pathname = new URL(contract.path, 'http://fixture.invalid').pathname;
  if (/^\/api\/projects\/\d+$/.test(pathname)) pathname = '/api/projects/:pid';
  else if (/^\/api\/admin\/members\/\d+\/api-key\/regenerate$/.test(pathname)) {
    pathname = '/api/admin/members/:mid/api-key/regenerate';
  } else if (/^\/api\/admin\/members\/\d+$/.test(pathname)) pathname = '/api/admin/members/:mid';
  return `${contract.method} ${pathname}`;
}

function assertFixture(value: unknown): asserts value is Fixture {
  if (!value || typeof value !== 'object') throw new Error('admin/Goodbai fixture must be an object');
  const candidate = value as Partial<Fixture>;
  if (candidate.version !== 1 || !candidate.seed || !candidate.seedVariants
    || !Array.isArray(candidate.routeMethods) || !Array.isArray(candidate.cases)) {
    throw new Error('unsupported admin/Goodbai fixture shape');
  }
  if (candidate.routeMethods.length !== 12
    || candidate.routeMethods.some((route) => !EXPECTED_ROUTE_METHODS.has(route))
    || [...EXPECTED_ROUTE_METHODS].some((route) => !candidate.routeMethods?.includes(route))) {
    throw new Error('admin/Goodbai fixture route-method scope must be exactly Task 5');
  }
  if (candidate.cases.length < 30) throw new Error('admin/Goodbai fixture is missing required cases');
  const names = candidate.cases.map((item) => item.name);
  for (const fragment of [
    'owner update', 'PI may update', 'non-owner', 'self demotion', 'aliases duplicate members',
    'rolls back', 'disabled member', 'active first disabled last', 'writes audit',
    'malformed JSON', 'text plain', 'malformed project POST path',
    'malformed admin member POST path', 'Python whitespace', 'underscore coercion',
    'boolean project id', 'unsafe numeric member id', 'unsafe numeric project',
  ]) {
    if (!names.some((name) => name.includes(fragment))) {
      throw new Error(`admin/Goodbai fixture is missing: ${fragment}`);
    }
  }
  const covered = new Set<string>();
  for (const item of candidate.cases) {
    if (!item || typeof item.name !== 'string' || !['GET', 'POST'].includes(item.method)
      || typeof item.path !== 'string' || typeof item.status !== 'number'
      || typeof item.contentType !== 'string' || !Array.isArray(item.expectedDb)
      || item.expectedDb.length === 0 || typeof item.noMutation !== 'boolean') {
      throw new Error('invalid admin/Goodbai parity case');
    }
    if (('jsonBody' in item) === ('rawBody' in item)) {
      throw new Error(`${item.name}: choose exactly one of rawBody or jsonBody`);
    }
    if (item.status >= 400 && !item.noMutation) {
      throw new Error(`${item.name}: rejected writes must assert noMutation`);
    }
    if (item.contentType === 'application/json' && !('json' in item)) {
      throw new Error(`${item.name}: JSON responses require an exact JSON body`);
    }
    if (item.contentType !== 'application/json' && !('body' in item)) {
      throw new Error(`${item.name}: non-JSON responses require an exact raw body`);
    }
    const owned = routeMethod(item);
    if (EXPECTED_ROUTE_METHODS.has(owned)) covered.add(owned);
  }
  if ([...EXPECTED_ROUTE_METHODS].some((route) => !covered.has(route))) {
    throw new Error('admin/Goodbai fixture cases do not execute every Task 5 route-method');
  }
}

assertFixture(fixtureJson);
const fixture = fixtureJson;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-admin-goodbai-parity-'));
const relevantTables = ['members', 'projects', 'project_members', 'posts', 'audit_log'] as const;
let dbPath = '';
let caseNumber = 0;

function insertRows(db: Database.Database, table: string, rows: SeedRow[]) {
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((column) => `@${column}`).join(',');
    const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, materialize(value)]));
    db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`).run(values);
  }
}

function seed(contract: ContractCase) {
  closeDbForTests();
  dbPath = path.join(tempRoot, `case-${caseNumber++}.sqlite3`);
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  runMigrations();
  const db = new Database(dbPath);
  try {
    for (const table of ['members', 'projects', 'project_members', 'posts']) {
      insertRows(db, table, fixture.seed[table]);
    }
    if (contract.seedVariant) {
      const variant = fixture.seedVariants[contract.seedVariant];
      if (!variant) throw new Error(`unknown seed variant: ${contract.seedVariant}`);
      insertRows(db, 'members', variant.members ?? []);
      insertRows(db, 'projects', variant.projects ?? []);
      for (const sequence of variant.sqliteSequences ?? []) {
        db.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?')
          .run(materialize(sequence.seq), sequence.table);
      }
      if (variant.failProjectMemberInsert) {
        db.exec(`
          CREATE TRIGGER fixture_fail_project_member_insert
          BEFORE INSERT ON project_members
          WHEN NEW.project_id > 10
          BEGIN
            SELECT RAISE(ABORT, 'fixture project member failure');
          END;
        `);
      }
    }
  } finally {
    db.close();
  }
}

function snapshot() {
  const db = new Database(dbPath, { readonly: true });
  db.defaultSafeIntegers(true);
  try {
    return Object.fromEntries(relevantTables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]));
  } finally {
    db.close();
  }
}

function requestFor(contract: ContractCase) {
  const headers = new Headers(contract.headers ?? {});
  const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {
    method: contract.method,
    headers,
  };
  if ('jsonBody' in contract) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(contract.jsonBody);
  } else if (contract.rawBody !== null) {
    headers.set('Content-Type', contract.requestContentType ?? 'application/json');
    init.body = contract.rawBody;
  }
  return new NextRequest(`http://fixture.invalid${contract.path}`, init);
}

async function importRoute(specifier: string) {
  return vi.importActual<RouteModule>(specifier);
}

async function execute(contract: ContractCase) {
  const request = requestFor(contract);
  const pathname = new URL(request.url).pathname;
  let module: RouteModule;
  let params: Record<string, string> = {};

  if (pathname === '/api/projects') module = await importRoute('@/app/api/projects/route');
  else if (/^\/api\/projects\/[^/]+$/.test(pathname)) {
    module = await importRoute('@/app/api/projects/[pid]/route');
    params = { pid: pathname.split('/').at(-1) ?? '' };
  } else if (pathname === '/api/members/api-key') module = await importRoute('@/app/api/members/api-key/route');
  else if (pathname === '/api/members/api-key/regenerate') module = await importRoute('@/app/api/members/api-key/regenerate/route');
  else if (pathname === '/api/account/api-key') module = await importRoute('@/app/api/account/api-key/route');
  else if (pathname === '/api/account/api-key/regenerate') module = await importRoute('@/app/api/account/api-key/regenerate/route');
  else if (pathname === '/api/developer/key') module = await importRoute('@/app/api/developer/key/route');
  else if (pathname === '/api/developer/key/regenerate') module = await importRoute('@/app/api/developer/key/regenerate/route');
  else if (pathname === '/api/admin/members') module = await importRoute('@/app/api/admin/members/route');
  else if (/^\/api\/admin\/members\/[^/]+\/api-key\/regenerate$/.test(pathname)) {
    module = await importRoute('@/app/api/admin/members/[mid]/api-key/regenerate/route');
    params = { mid: pathname.split('/')[4] };
  } else if (/^\/api\/admin\/members\/[^/]+$/.test(pathname)) {
    module = await importRoute('@/app/api/admin/members/[mid]/route');
    params = { mid: pathname.split('/')[4] };
  } else if (pathname === '/api/post') module = await importRoute('@/app/api/post/route');
  else throw new Error(`fixture path is not a Task 5 route: ${pathname}`);

  const handler = module[contract.method];
  if (!handler) throw new Error(`${contract.method} ${pathname} has no explicit Task 5 handler`);
  return handler(request, { params: Promise.resolve(params) });
}

function assertDbProjection(expected: Projection[]) {
  const db = new Database(dbPath, { readonly: true });
  try {
    for (const projection of expected) {
      const statement = db.prepare(projection.query);
      const actual = projection.safeIntegers ? statement.safeIntegers().all() : statement.all();
      expect(actual, projection.query).toEqual(materialize(projection.rows));
    }
  } finally {
    db.close();
  }
}

beforeEach(() => {
  member = null;
  proxyLegacyApi.mockClear();
  forbiddenFetch.mockClear();
  vi.stubGlobal('fetch', forbiddenFetch);
});

afterAll(() => {
  closeDbForTests();
  vi.unstubAllGlobals();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
});

describe('Flask ↔ explicit Next Task 5 admin/Goodbai shared parity fixture', () => {
  it.each(fixture.cases)('$name', async (contract) => {
    seed(contract);
    member = contract.auth;
    const before = snapshot();

    let response: Response;
    try {
      response = await execute(contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!contract.expectUnhandled || message.includes('Cannot find module')) throw error;
      response = new Response(
        '<!doctype html>\n<html lang=en>\n<title>500 Internal Server Error</title>\n<h1>Internal Server Error</h1>\n<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>\n',
        { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    expect(response.status).toBe(contract.status);
    expect(response.headers.get('content-type')).toBe(contract.contentType);
    const body = await response.text();
    if ('json' in contract) expect(parseLosslessJson(body)).toEqual(materialize(contract.json as JsonValue));
    if ('body' in contract) expect(body).toBe(contract.body);
    assertDbProjection(contract.expectedDb);
    if (contract.noMutation) expect(snapshot()).toEqual(before);
    expect(proxyLegacyApi).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
});
