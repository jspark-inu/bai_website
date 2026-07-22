import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureJson from './write-api-parity-fixture.json';

let member: AuthIdentity | null = null;
const proxyLegacyApi = vi.fn(async () => Response.json({ proxied: true }));
const forbiddenFetch = vi.fn(async () => {
  throw new Error('fetch is forbidden while executing migrated write routes');
});

vi.mock('@/lib/auth', () => ({
  requireApiMember: async () => member
    ? { ok: true, member }
    : { ok: false, error: Response.json({ error: 'login required' }, { status: 401 }) },
}));
vi.mock('@/lib/legacy-api-proxy', () => ({ proxyLegacyApi }));

import { POST as createWebPost } from '@/app/api/web/post/route';
import { POST as editPost } from '@/app/api/post/[pid]/edit/route';
import { POST as commentPost } from '@/app/api/post/[pid]/comment/route';
import { POST as reactPost } from '@/app/api/post/[pid]/react/route';
import { GET as listWall, POST as createWall } from '@/app/api/wall/route';
import { POST as createInquiry } from '@/app/api/inquiries/route';
import { POST as answerInquiry } from '@/app/api/inquiries/[iid]/answer/route';
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
  method: 'GET' | 'POST';
  path: string;
  rawBody?: string | null;
  contentType?: string;
  expectUnhandled?: boolean;
  jsonBody?: Record<string, JsonValue>;
  status: number;
  json?: JsonValue;
  expectedDb: Projection[];
  noMutation: boolean;
};
type Fixture = {
  version: number;
  seed: Record<string, SeedRow[]>;
  seedVariants: Record<string, {
    reactions?: SeedRow[];
    projects?: SeedRow[];
    inquiryUpdates?: SeedRow[];
    sqliteSequences?: Array<{ table: string; seq: JsonValue }>;
  }>;
  cases: ContractCase[];
};

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

function assertFixture(value: unknown): asserts value is Fixture {
  if (!value || typeof value !== 'object') throw new Error('write parity fixture must be an object');
  const candidate = value as Partial<Fixture>;
  if (candidate.version !== 1 || !candidate.seed || !candidate.seedVariants || !Array.isArray(candidate.cases)) {
    throw new Error('unsupported write parity fixture shape');
  }
  if (candidate.cases.length < 25) throw new Error('write parity fixture is missing required cases');
  const names = candidate.cases.map((item) => item.name);
  for (const fragment of [
    'authenticates before parsing', 'non-owner', 'not found before body validation',
    'invalid project', 'reaction inserts', 'reaction deletes', 'limit zero', 'negative',
    'limit two', 'malformed limit', 'huge limit', 'U+FEFF', 'eighty emoji',
    'eighty-one emoji', 'PI role before existence', 'overwrites',
    'malformed typed POST path', 'unsafe numeric JSON', 'truthy non-object JSON',
    'empty containers',
  ]) {
    if (!names.some((name) => name.includes(fragment))) {
      throw new Error(`write parity fixture is missing: ${fragment}`);
    }
  }
  for (const item of candidate.cases) {
    if (!item || typeof item.name !== 'string' || !['GET', 'POST'].includes(item.method)
      || typeof item.path !== 'string' || typeof item.status !== 'number'
      || !Array.isArray(item.expectedDb) || typeof item.noMutation !== 'boolean') {
      throw new Error('invalid write parity case');
    }
    if (('jsonBody' in item) === ('rawBody' in item)) throw new Error(`${item.name}: choose rawBody or jsonBody`);
    if (item.status >= 400 && !item.noMutation) throw new Error(`${item.name}: rejected writes must assert noMutation`);
  }
}

assertFixture(fixtureJson);
const fixture = fixtureJson;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-write-parity-'));
const relevantTables = ['posts', 'comments', 'reactions', 'wall_messages', 'inquiries'] as const;
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
    for (const table of ['members', 'projects', 'posts', 'inquiries', 'wall_messages']) {
      insertRows(db, table, fixture.seed[table]);
    }
    if (contract.seedVariant) {
      const variant = fixture.seedVariants[contract.seedVariant];
      if (!variant) throw new Error(`unknown seed variant: ${contract.seedVariant}`);
      insertRows(db, 'projects', variant.projects ?? []);
      insertRows(db, 'reactions', variant.reactions ?? []);
      for (const update of variant.inquiryUpdates ?? []) {
        const { id, ...values } = update;
        const assignments = Object.keys(values).map((column) => `${column}=@${column}`).join(',');
        db.prepare(`UPDATE inquiries SET ${assignments} WHERE id=@id`).run({ id, ...values });
      }
      for (const sequence of variant.sqliteSequences ?? []) {
        db.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?')
          .run(materialize(sequence.seq), sequence.table);
      }
    }
  } finally {
    db.close();
  }
}

function snapshot() {
  const db = new Database(dbPath, { readonly: true });
  try {
    return Object.fromEntries(relevantTables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]));
  } finally {
    db.close();
  }
}

function materializeJsonBody(body: Record<string, JsonValue>) {
  const result = { ...body };
  const repeat = result.bodyRepeat;
  if (repeat && typeof repeat === 'object' && !Array.isArray(repeat)) {
    const value = repeat.value;
    const count = repeat.count;
    if (typeof value !== 'string' || typeof count !== 'number') throw new Error('invalid bodyRepeat');
    delete result.bodyRepeat;
    result.body = value.repeat(count);
  }
  return result;
}

function requestFor(contract: ContractCase) {
  const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = { method: contract.method };
  if ('jsonBody' in contract) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(materializeJsonBody(contract.jsonBody ?? {}));
  } else if (contract.rawBody !== null) {
    init.headers = { 'Content-Type': contract.contentType ?? 'application/json' };
    init.body = contract.rawBody;
  }
  return new NextRequest(`http://fixture.invalid${contract.path}`, init);
}

async function execute(contract: ContractCase) {
  const request = requestFor(contract);
  const pathname = new URL(request.url).pathname;
  if (pathname === '/api/web/post') return createWebPost(request);
  if (pathname === '/api/wall') return contract.method === 'GET' ? listWall(request) : createWall(request);
  if (pathname === '/api/inquiries') return createInquiry(request);

  let match = pathname.match(/^\/api\/post\/([^/]+)\/(edit|comment|react)$/);
  if (match) {
    const context = { params: Promise.resolve({ pid: match[1] }) };
    if (match[2] === 'edit') return editPost(request, context);
    if (match[2] === 'comment') return commentPost(request, context);
    return reactPost(request, context);
  }
  match = pathname.match(/^\/api\/inquiries\/([^/]+)\/answer$/);
  if (match) return answerInquiry(request, { params: Promise.resolve({ iid: match[1] }) });
  throw new Error(`fixture path is not a Task 4 route: ${pathname}`);
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

describe('Flask ↔ explicit Next shared write API fixture parity', () => {
  it.each(fixture.cases)('$name', async (contract) => {
    seed(contract);
    member = contract.auth;
    const before = snapshot();

    let response: Response;
    try {
      response = await execute(contract);
    } catch (error) {
      if (!contract.expectUnhandled) throw error;
      response = new Response(null, { status: 500 });
    }

    expect(response.status).toBe(contract.status);
    if ('json' in contract) {
      expect(parseLosslessJson(await response.text())).toEqual(materialize(contract.json as JsonValue));
    }
    assertDbProjection(contract.expectedDb);
    if (contract.noMutation) expect(snapshot()).toEqual(before);
    expect(proxyLegacyApi).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
});
