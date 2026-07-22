import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureJson from './materials-parity-fixture.json';

let member: AuthIdentity | null = null;
const proxyLegacyApi = vi.fn(async () => {
  throw new Error('Task 6 materials route called the Flask legacy proxy');
});
const forbiddenFetch = vi.fn(async () => {
  throw new Error('network fetch is forbidden while executing Task 6 materials routes');
});

vi.mock('@/lib/auth', () => ({
  requireApiMember: async () => member
    ? { ok: true, member }
    : { ok: false, error: Response.json({ error: 'login required' }, { status: 401 }) },
}));
vi.mock('@/lib/legacy-api-proxy', () => ({ proxyLegacyApi }));

import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';
import { setMaterialUploadDeleteFaultForTests } from '@/lib/uploads';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type AuthIdentity = { id: number; name: string; role: string };
type SeedRow = Record<string, JsonValue>;
type Projection = { query: string; safeIntegers?: boolean; rows: Array<Record<string, JsonValue>> };
type FileExpectation = { storedName?: string; originalName?: string; text: string };
type BaseCase = {
  name: string;
  seedVariant?: string;
  auth: AuthIdentity | null;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  expectUnhandled?: boolean;
  status: number;
  contentType: string;
  json?: JsonValue;
  body?: string;
  expectedDb: Projection[];
  noMutation: boolean;
};
type LegacyCase = BaseCase & {
  rawBody?: string | null;
  jsonBody?: Record<string, JsonValue>;
  requestContentType?: string;
};
type UploadCase = BaseCase & {
  form?: Record<string, string>;
  file?: { name: string; type: string; text: string };
  preexistingFiles?: Array<{ storedName: string; text: string }>;
  outsideFiles?: Array<{ name: string; text: string }>;
  expectedFiles: FileExpectation[];
  expectedOutsideFiles?: Array<{ name: string; text: string }>;
  materialPatch?: Record<string, JsonValue>;
  cleanupQueue?: SeedRow[];
  cleanupFault?: { code: string; message: string };
  cleanupJournal: Array<Record<string, JsonValue> & { originalName?: string }>;
};
type Fixture = {
  version: number;
  routeMethods: string[];
  seed: { members: SeedRow[]; materials: SeedRow[] };
  seedVariants: Record<string, {
    materials?: SeedRow[];
    failMaterialInsert?: boolean;
    failMaterialUpdate?: boolean;
    failMaterialDelete?: boolean;
  }>;
  legacyCases: LegacyCase[];
  uploadCases: UploadCase[];
};
type RouteModule = {
  GET?: (request: NextRequest, context?: RouteContext) => Promise<Response> | Response;
  POST?: (request: NextRequest, context?: RouteContext) => Promise<Response> | Response;
  DELETE?: (request: NextRequest, context?: RouteContext) => Promise<Response> | Response;
};
type RouteContext = { params: Promise<{ mid: string }> };

const EXPECTED_ROUTE_METHODS = new Set([
  'GET /api/materials',
  'POST /api/materials',
  'POST /api/materials/:mid',
  'DELETE /api/materials/:mid',
]);
const FLASK_500 = '<!doctype html>\n<html lang=en>\n<title>500 Internal Server Error</title>\n<h1>Internal Server Error</h1>\n<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>\n';

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

function routeMethod(contract: LegacyCase) {
  let pathname = new URL(contract.path, 'http://fixture.invalid').pathname;
  if (/^\/api\/materials\/\d+$/.test(pathname)) pathname = '/api/materials/:mid';
  return `${contract.method} ${pathname}`;
}

function assertFixture(value: unknown): asserts value is Fixture {
  if (!value || typeof value !== 'object') throw new Error('materials fixture must be an object');
  const candidate = value as Partial<Fixture>;
  if (candidate.version !== 1 || !candidate.seed || !candidate.seedVariants
    || !Array.isArray(candidate.routeMethods) || !Array.isArray(candidate.legacyCases)
    || !Array.isArray(candidate.uploadCases)) throw new Error('unsupported materials fixture shape');
  if (candidate.routeMethods.length !== 4
    || candidate.routeMethods.some((route) => !EXPECTED_ROUTE_METHODS.has(route))
    || [...EXPECTED_ROUTE_METHODS].some((route) => !candidate.routeMethods?.includes(route))) {
    throw new Error('materials fixture route-method scope must be exactly Task 6');
  }
  if (candidate.legacyCases.length < 18 || candidate.uploadCases.length < 10) {
    throw new Error('materials fixture is missing required cases');
  }
  const legacyNames = candidate.legacyCases.map((item) => item.name);
  for (const fragment of [
    'authenticates before', 'orders descending', 'both filters', 'Python whitespace',
    'falsey payload', 'truthy non-string', 'Content-Type', 'non-owner', 'owner update',
    'PI may update', 'PI may delete', 'malformed material POST path', 'unsafe ID',
    'preserves managed file metadata', 'ignores client supplied file metadata',
  ]) if (!legacyNames.some((name) => name.includes(fragment))) throw new Error(`legacy fixture missing: ${fragment}`);
  const uploadNames = candidate.uploadCases.map((item) => item.name);
  for (const fragment of [
    'stages then publishes', 'create SQL failure', 'replacement publishes',
    'replacement SQL failure', 'delete commits', 'delete SQL failure', 'unsafe external',
    'replacement old-file cleanup failure', 'committed delete cleanup failure',
    'rollback compensation cleanup failure',
  ]) if (!uploadNames.some((name) => name.includes(fragment))) throw new Error(`upload fixture missing: ${fragment}`);

  const covered = new Set<string>();
  for (const item of candidate.legacyCases) {
    if (!item || !['GET', 'POST', 'DELETE'].includes(item.method) || !item.path
      || typeof item.status !== 'number' || !item.contentType || !Array.isArray(item.expectedDb)
      || item.expectedDb.length === 0 || typeof item.noMutation !== 'boolean') throw new Error('invalid legacy materials case');
    if (('jsonBody' in item) === ('rawBody' in item)) throw new Error(`${item.name}: choose rawBody or jsonBody`);
    if (item.status >= 400 && !item.noMutation) throw new Error(`${item.name}: rejected legacy case must assert noMutation`);
    const owned = routeMethod(item);
    if (EXPECTED_ROUTE_METHODS.has(owned)) covered.add(owned);
  }
  if ([...EXPECTED_ROUTE_METHODS].some((route) => !covered.has(route))) throw new Error('legacy cases do not cover all four methods');
  for (const item of candidate.uploadCases) {
    if (!Array.isArray(item.expectedFiles) || !Array.isArray(item.cleanupJournal)) throw new Error('upload case must declare file and cleanup journal expectations');
  }
}

assertFixture(fixtureJson);
const fixture = fixtureJson;
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bai-materials-parity-')));
let dbPath = '';
let uploadRoot = '';
let outsideRoot = '';
let caseNumber = 0;

function insertRows(db: Database.Database, table: string, rows: SeedRow[]) {
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((column) => `@${column}`).join(',');
    const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, materialize(value)]));
    db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`).run(values);
  }
}

function seed(contract: BaseCase, upload?: UploadCase) {
  closeDbForTests();
  const caseRoot = path.join(tempRoot, `case-${caseNumber++}`);
  fs.mkdirSync(caseRoot, { recursive: true });
  dbPath = path.join(caseRoot, 'fixture.sqlite3');
  uploadRoot = path.join(caseRoot, 'uploads');
  outsideRoot = path.join(caseRoot, 'outside');
  fs.mkdirSync(uploadRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  process.env.BAI_UPLOAD_DIR = uploadRoot;
  runMigrations();

  const db = new Database(dbPath);
  try {
    insertRows(db, 'members', fixture.seed.members);
    insertRows(db, 'materials', fixture.seed.materials);
    const variant = contract.seedVariant ? fixture.seedVariants[contract.seedVariant] : undefined;
    if (contract.seedVariant && !variant) throw new Error(`unknown seed variant: ${contract.seedVariant}`);
    insertRows(db, 'materials', variant?.materials ?? []);
    insertRows(db, 'material_file_cleanup_queue', upload?.cleanupQueue ?? []);
    if (upload?.materialPatch) {
      const values = Object.fromEntries(Object.entries(upload.materialPatch).map(([key, value]) => [key, materialize(value)]));
      const assignments = Object.keys(values).map((column) => `${column}=@${column}`).join(',');
      db.prepare(`UPDATE materials SET ${assignments} WHERE id=10`).run(values);
    }
    if (variant?.failMaterialInsert) db.exec("CREATE TRIGGER fixture_fail_material_insert BEFORE INSERT ON materials BEGIN SELECT RAISE(ABORT, 'fixture material insert failure'); END;");
    if (variant?.failMaterialUpdate) db.exec("CREATE TRIGGER fixture_fail_material_update BEFORE UPDATE ON materials BEGIN SELECT RAISE(ABORT, 'fixture material update failure'); END;");
    if (variant?.failMaterialDelete) db.exec("CREATE TRIGGER fixture_fail_material_delete BEFORE DELETE ON materials BEGIN SELECT RAISE(ABORT, 'fixture material delete failure'); END;");
  } finally {
    db.close();
  }
  for (const file of upload?.preexistingFiles ?? []) {
    const dir = path.join(uploadRoot, 'materials');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file.storedName), file.text);
  }
  for (const file of upload?.outsideFiles ?? []) fs.writeFileSync(path.join(outsideRoot, file.name), file.text);

  expect(fs.realpathSync(dbPath).startsWith(`${tempRoot}${path.sep}`)).toBe(true);
  expect(fs.realpathSync(uploadRoot).startsWith(`${tempRoot}${path.sep}`)).toBe(true);
}

function snapshot() {
  const db = new Database(dbPath, { readonly: true });
  db.defaultSafeIntegers(true);
  try {
    return db.prepare('SELECT * FROM materials ORDER BY rowid').all();
  } finally {
    db.close();
  }
}

function legacyRequest(contract: LegacyCase) {
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

function uploadRequest(contract: UploadCase) {
  const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = { method: contract.method };
  if (contract.method === 'POST') {
    const form = new FormData();
    for (const [key, value] of Object.entries(contract.form ?? {})) form.set(key, value);
    if (contract.file) form.set('file', new File([contract.file.text], contract.file.name, { type: contract.file.type }));
    init.body = form;
  }
  return new NextRequest(`http://fixture.invalid${contract.path}`, init);
}

async function execute(contract: BaseCase, request: NextRequest) {
  const pathname = new URL(request.url).pathname;
  let module: RouteModule;
  let context: RouteContext | undefined;
  if (pathname === '/api/materials') module = await vi.importActual<RouteModule>('@/app/api/materials/route');
  else if (/^\/api\/materials\/[^/]+$/.test(pathname)) {
    module = await vi.importActual<RouteModule>('@/app/api/materials/[mid]/route');
    context = { params: Promise.resolve({ mid: pathname.split('/').at(-1) ?? '' }) };
  } else throw new Error(`fixture path is not a Task 6 route: ${pathname}`);
  const handler = module[contract.method];
  if (!handler) throw new Error(`${contract.method} ${pathname} has no explicit Task 6 handler`);
  return handler(request, context);
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

function cleanupJournal() {
  const db = new Database(dbPath, { readonly: true });
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='material_file_cleanup_queue'").get();
    if (!exists) return [];
    return db.prepare(`SELECT id,file_url,reason,attempts,last_error,completed_at
      FROM material_file_cleanup_queue ORDER BY id`).all();
  } finally {
    db.close();
  }
}

function actualMaterialFiles() {
  const dir = path.join(uploadRoot, 'materials');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((storedName) => ({
    storedName,
    text: fs.readFileSync(path.join(dir, storedName), 'utf8'),
  }));
}

function assertFiles(contract: UploadCase) {
  const actual = actualMaterialFiles();
  expect(actual.some((file) => file.storedName.endsWith('.uploading'))).toBe(false);
  expect(actual).toHaveLength(contract.expectedFiles.length);
  for (const expected of contract.expectedFiles) {
    const match = expected.storedName
      ? actual.find((file) => file.storedName === expected.storedName)
      : actual.find((file) => file.storedName.endsWith(`-${expected.originalName}`));
    expect(match, JSON.stringify(expected)).toEqual(expect.objectContaining({ text: expected.text }));
  }
  const outside = fs.readdirSync(outsideRoot).sort().map((name) => ({ name, text: fs.readFileSync(path.join(outsideRoot, name), 'utf8') }));
  expect(outside).toEqual(contract.expectedOutsideFiles ?? []);
  const journal = cleanupJournal() as Array<Record<string, unknown>>;
  expect(journal).toHaveLength(contract.cleanupJournal.length);
  for (const [index, expected] of contract.cleanupJournal.entries()) {
    const { originalName, ...fields } = expected;
    expect(journal[index]).toEqual(expect.objectContaining(materialize(fields)));
    if (originalName) expect(journal[index].file_url).toEqual(expect.stringMatching(new RegExp(`-${originalName}$`)));
  }
}

async function responseOrFlask500(contract: BaseCase, request: NextRequest) {
  try {
    return await execute(contract, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exactFixtureSqlError = error instanceof Error
      && error.name === 'SqliteError'
      && (error as NodeJS.ErrnoException).code === 'SQLITE_CONSTRAINT_TRIGGER'
      && [
        'fixture material insert failure',
        'fixture material update failure',
        'fixture material delete failure',
      ].includes(message);
    const expectedUnhandled = contract.expectUnhandled
      && ((error instanceof TypeError
        && (['JSON object required', 'value.replace is not a function'].includes(message)
          || /^(?:title|body|url|category|guild) must be a string$/.test(message)))
        || exactFixtureSqlError);
    if (!expectedUnhandled) throw error;
    return new Response(FLASK_500, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function assertResponse(contract: BaseCase, response: Response) {
  expect(response.status).toBe(contract.status);
  expect(response.headers.get('content-type')).toBe(contract.contentType);
  const body = await response.text();
  if ('json' in contract) expect(parseLosslessJson(body)).toEqual(materialize(contract.json as JsonValue));
  if ('body' in contract) expect(body).toBe(contract.body);
}

beforeEach(() => {
  member = null;
  proxyLegacyApi.mockClear();
  forbiddenFetch.mockClear();
  vi.stubGlobal('fetch', forbiddenFetch);
  setMaterialUploadDeleteFaultForTests(null);
});

afterAll(() => {
  closeDbForTests();
  vi.unstubAllGlobals();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
  delete process.env.BAI_UPLOAD_DIR;
});

describe('Flask ↔ explicit Next Task 6 shared materials legacy fixture', () => {
  it.each(fixture.legacyCases)('$name', async (contract) => {
    seed(contract);
    member = contract.auth;
    const before = snapshot();
    const response = await responseOrFlask500(contract, legacyRequest(contract));
    await assertResponse(contract, response);
    assertDbProjection(contract.expectedDb);
    if (contract.noMutation) expect(snapshot()).toEqual(before);
    expect(proxyLegacyApi).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
});

describe('Task 6 multipart upload publication and compensation contract', () => {
  it.each(fixture.uploadCases)('$name', async (contract) => {
    seed(contract, contract);
    member = contract.auth;
    if (contract.cleanupFault) {
      setMaterialUploadDeleteFaultForTests(() => Object.assign(
        new Error(contract.cleanupFault!.message), { code: contract.cleanupFault!.code },
      ));
    }
    const before = snapshot();
    const response = await responseOrFlask500(contract, uploadRequest(contract));
    await assertResponse(contract, response);
    assertDbProjection(contract.expectedDb);
    assertFiles(contract);
    if (contract.noMutation) expect(snapshot()).toEqual(before);
    expect(proxyLegacyApi).not.toHaveBeenCalled();
    expect(forbiddenFetch).not.toHaveBeenCalled();
  });
});
