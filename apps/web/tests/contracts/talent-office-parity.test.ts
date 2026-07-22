import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureJson from './talent-office-parity-fixture.json';

let member: AuthIdentity | null = null;
const proxyLegacyApi = vi.fn(async () => {
  throw new Error('Task 6 talent-office route still called the Flask legacy proxy');
});
const forbiddenFetch = vi.fn(async () => {
  throw new Error('network fetch is forbidden while executing Task 6 owned routes');
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
type Projection = { query: string; rows: Array<Record<string, JsonValue>> };
type ContractCase = {
  name: string;
  seedVariant?: string;
  auth: AuthIdentity | null;
  method: 'GET' | 'POST';
  path: string;
  rawBody?: string | null;
  jsonBody?: JsonValue;
  requestContentType?: string;
  status: number;
  contentType: string;
  json?: JsonValue;
  body?: string;
  expectedDb: Projection[];
  noMutation: boolean;
};
type Fixture = {
  version: number;
  routeMethods: string[];
  seed: Record<string, SeedRow[]>;
  seedVariants: Record<string, { failAssigneeInsert?: boolean; failPointInsert?: boolean }>;
  cases: ContractCase[];
};
type RouteModule = {
  GET?: (request: NextRequest, context?: RouteContext) => Promise<Response> | Response;
  POST?: (request: NextRequest, context?: RouteContext) => Promise<Response> | Response;
};
type RouteContext = { params: Promise<{ rid: string }> };

const EXPECTED_ROUTE_METHODS = new Set([
  'GET /api/talent-office',
  'POST /api/talent-office',
  'GET /api/talent-office/:rid',
  'POST /api/talent-office/:rid/review',
  'POST /api/talent-office/:rid/assignees',
  'POST /api/talent-office/:rid/solution',
  'POST /api/talent-office/:rid/decision',
  'GET /api/talent-office/points',
]);

function routeMethod(contract: ContractCase) {
  let pathname = new URL(contract.path, 'http://fixture.invalid').pathname;
  if (pathname !== '/api/talent-office/points') {
    pathname = pathname.replace(/^\/api\/talent-office\/\d+(?=\/|$)/, '/api/talent-office/:rid');
  }
  return `${contract.method} ${pathname}`;
}

function assertFixture(value: unknown): asserts value is Fixture {
  if (!value || typeof value !== 'object') throw new Error('talent-office fixture must be an object');
  const candidate = value as Partial<Fixture>;
  if (candidate.version !== 1 || !candidate.seed || !candidate.seedVariants
    || !Array.isArray(candidate.routeMethods) || !Array.isArray(candidate.cases)) {
    throw new Error('unsupported talent-office fixture shape');
  }
  if (candidate.routeMethods.length !== 8
    || candidate.routeMethods.some((route) => !EXPECTED_ROUTE_METHODS.has(route))
    || [...EXPECTED_ROUTE_METHODS].some((route) => !candidate.routeMethods?.includes(route))) {
    throw new Error('talent-office fixture scope must be exactly the eight Task 6 route-methods');
  }
  if (candidate.routeMethods.some((route) => route.includes('operators') || route.includes(':mid'))) {
    throw new Error('Next-only operators/:mid endpoint must not enter the shared fixture');
  }
  if (candidate.cases.length < 45) throw new Error('talent-office fixture is missing mandatory audit cases');
  const names = candidate.cases.map((item) => item.name);
  for (const fragment of [
    'authentication', 'operator', 'visibility', 'before', 'loose state', 'tolerance',
    'duplicate', 'disabled', 'delegates', 'changes_requested', 'completion', 'idempotent',
    'audit', 'falsey', 'truthy', 'malformed', 'unsafe', 'rollback injection',
  ]) {
    if (!names.some((name) => name.includes(fragment))) throw new Error(`missing mandatory case: ${fragment}`);
  }
  const covered = new Set<string>();
  for (const item of candidate.cases) {
    if (!item || typeof item.name !== 'string' || !['GET', 'POST'].includes(item.method)
      || typeof item.path !== 'string' || typeof item.status !== 'number'
      || typeof item.contentType !== 'string' || !Array.isArray(item.expectedDb)
      || item.expectedDb.length !== 4 || typeof item.noMutation !== 'boolean') {
      throw new Error('invalid talent-office parity case');
    }
    if (('jsonBody' in item) === ('rawBody' in item)) throw new Error(`${item.name}: choose one request body form`);
    const owned = routeMethod(item);
    if (EXPECTED_ROUTE_METHODS.has(owned)) covered.add(owned);
  }
  if ([...EXPECTED_ROUTE_METHODS].some((route) => !covered.has(route))) {
    throw new Error('fixture cases do not execute every Task 6 route-method');
  }
}

assertFixture(fixtureJson);
const fixture = fixtureJson;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-talent-office-parity-'));
const relevantTables = ['talent_requests', 'talent_request_assignees', 'contribution_points', 'audit_log'] as const;
let dbPath = '';
let caseNumber = 0;

function insertRows(db: Database.Database, table: string, rows: SeedRow[]) {
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((column) => `@${column}`).join(',');
    db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`).run(row);
  }
}

function seed(contract: ContractCase) {
  closeDbForTests();
  dbPath = path.join(tempRoot, `case-${caseNumber++}.sqlite3`);
  expect(path.relative(tempRoot, dbPath).startsWith('..')).toBe(false);
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  runMigrations();
  const db = new Database(dbPath);
  try {
    for (const table of ['members', 'talent_requests', 'talent_request_assignees', 'contribution_points']) {
      insertRows(db, table, fixture.seed[table]);
    }
    const variant = contract.seedVariant ? fixture.seedVariants[contract.seedVariant] : undefined;
    if (contract.seedVariant && !variant) throw new Error(`unknown seed variant: ${contract.seedVariant}`);
    if (variant?.failAssigneeInsert) {
      db.exec("CREATE TRIGGER fixture_fail_assignee BEFORE INSERT ON talent_request_assignees BEGIN SELECT RAISE(ABORT,'fixture assignee failure'); END");
    }
    if (variant?.failPointInsert) {
      db.exec("CREATE TRIGGER fixture_fail_point BEFORE INSERT ON contribution_points BEGIN SELECT RAISE(ABORT,'fixture point failure'); END");
    }
  } finally {
    db.close();
  }
}

function snapshot() {
  const db = new Database(dbPath, { readonly: true });
  try {
    return Object.fromEntries(relevantTables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally {
    db.close();
  }
}

function requestFor(contract: ContractCase) {
  const headers = new Headers();
  const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = { method: contract.method, headers };
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
  let rid = '';
  if (pathname === '/api/talent-office') module = await importRoute('@/app/api/talent-office/route');
  else if (pathname === '/api/talent-office/points') module = await importRoute('@/app/api/talent-office/points/route');
  else {
    const match = pathname.match(/^\/api\/talent-office\/([^/]+)(?:\/(review|assignees|solution|decision))?$/);
    if (!match) throw new Error(`fixture path is not a Task 6 route: ${pathname}`);
    [, rid] = match;
    const suffix = match[2];
    if (!suffix) module = await importRoute('@/app/api/talent-office/[rid]/route');
    else module = await importRoute(`@/app/api/talent-office/[rid]/${suffix}/route`);
  }
  const handler = module[contract.method];
  if (!handler) throw new Error(`${contract.method} ${pathname} has no explicit Task 6 handler`);
  return handler(request, { params: Promise.resolve({ rid }) });
}

function assertDbProjection(expected: Projection[]) {
  const db = new Database(dbPath, { readonly: true });
  try {
    for (const projection of expected) {
      expect(db.prepare(projection.query).all(), projection.query).toEqual(projection.rows);
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

describe('Flask ↔ actual Next Task 6 talent-office shared parity fixture', () => {
  it.each(fixture.cases)('$name', async (contract) => {
    seed(contract);
    member = contract.auth;
    const before = snapshot();
    let response: Response;
    try {
      response = await execute(contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exactFixtureSqlError = error instanceof Error
        && error.name === 'SqliteError'
        && (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_TRIGGER'
        && ['fixture assignee failure', 'fixture point failure'].includes(message);
      const expectedUnhandled = contract.status === 500
        && ((error instanceof TypeError
          && ['JSON object required', 'value.replace is not a function'].includes(message))
          || exactFixtureSqlError);
      if (!expectedUnhandled) throw error;
      response = new Response(
        '<!doctype html>\n<html lang=en>\n<title>500 Internal Server Error</title>\n<h1>Internal Server Error</h1>\n<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>\n',
        { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    expect(response.status).toBe(contract.status);
    expect(response.headers.get('content-type')).toBe(contract.contentType);
    const body = await response.text();
    if ('json' in contract) expect(JSON.parse(body)).toEqual(contract.json);
    if ('body' in contract) expect(body).toBe(contract.body);
    assertDbProjection(contract.expectedDb);
    if (contract.noMutation) expect(snapshot()).toEqual(before);
    expect(proxyLegacyApi).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
});
