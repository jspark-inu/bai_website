import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import rawFixture from './read-api-parity-fixture.json';
import {
  parseFlaskPathInt, parsePythonIntQuery, splitPythonWhitespace, trimPythonWhitespace,
} from '@/lib/api-params';
import { closeDbForTests } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';
import { comparePythonStrings } from '@/lib/services/posts';

let authenticated = true;
const proxyLegacyApi = vi.hoisted(() => vi.fn(
  async (_request: Request, _target: string | string[]) => Response.json({ forwarded: true }),
));
vi.mock('@/lib/auth', () => ({
  requireApiMember: async () => authenticated
    ? { ok: true, member: { id: 1, name: 'Fixture Alice', role: 'student' } }
    : { ok: false, error: Response.json({ error: 'login required' }, { status: 401 }) },
}));
vi.mock('@/lib/legacy-api-proxy', () => ({ proxyLegacyApi }));

import { GET as feed } from '@/app/api/feed/route';
import { GET as postDetail } from '@/app/api/post/[pid]/route';
import { GET as memberDetail } from '@/app/api/member/[mid]/route';
import { GET as tag } from '@/app/api/tag/[tag]/route';
import { GET as search } from '@/app/api/search/route';
import { GET as questions } from '@/app/api/questions/route';
import { GET as inquiries } from '@/app/api/inquiries/route';
import { GET as members } from '@/app/api/members/route';
import { GET as projects, POST as createProject } from '@/app/api/projects/route';
import { GET as projectDetail, POST as updateProject } from '@/app/api/projects/[pid]/route';
import { GET as weekly } from '@/app/api/weekly/route';

type JsonRecord = Record<string, unknown>;
type Seed = Record<string, JsonRecord[]>;
type FixtureCase = {
  name: string;
  path: string;
  authenticated: boolean;
  response: { status: number; json: unknown };
};
type Fixture = { seed: Seed; requests: FixtureCase[] };
type DynamicContext = { params: Promise<Record<string, string>> };
type Handler = (request: NextRequest, context: DynamicContext) => Promise<Response>;

function assertFixture(value: unknown): asserts value is Fixture {
  if (typeof value !== 'object' || value === null) throw new TypeError('fixture must be an object');
  const candidate = value as Partial<Fixture>;
  if (typeof candidate.seed !== 'object' || candidate.seed === null || !Array.isArray(candidate.requests)) {
    throw new TypeError('fixture seed and requests are required');
  }
  for (const request of candidate.requests) {
    if (
      typeof request?.name !== 'string'
      || typeof request.path !== 'string'
      || typeof request.authenticated !== 'boolean'
      || typeof request.response?.status !== 'number'
      || !('json' in request.response)
    ) throw new TypeError('invalid read API fixture request');
  }
}
assertFixture(rawFixture);
const fixture: Fixture = rawFixture;

const originalDbPath = process.env.LAB_FEED_DB;
const originalReadonly = process.env.LAB_FEED_DB_READONLY;
const tempDirectory = mkdtempSync(path.join(tmpdir(), 'bai-next-read-api-'));
const dbPath = path.join(tempDirectory, 'fixture.sqlite3');

function seedFixture() {
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  runMigrations();
  const db = new Database(dbPath);
  try {
    const insert = db.transaction(() => {
      for (const table of ['members', 'projects', 'project_members', 'posts', 'comments', 'reactions', 'inquiries']) {
        const rows = fixture.seed[table];
        if (!rows?.length) continue;
        const columns = Object.keys(rows[0]);
        const statement = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        for (const row of rows) statement.run(...columns.map((column) => row[column]));
      }
    });
    insert();
  } finally {
    db.close();
  }
  process.env.LAB_FEED_DB_READONLY = '1';
}

function handlerFor(url: URL): { handler: Handler; params: Record<string, string> } {
  const parts = url.pathname.split('/').filter(Boolean);
  const param = (value: string) => decodeURIComponent(value);
  if (url.pathname === '/api/feed') return { handler: feed as Handler, params: {} };
  if (parts[1] === 'post' && parts.length === 3) return { handler: postDetail as unknown as Handler, params: { pid: param(parts[2]) } };
  if (parts[1] === 'member' && parts.length === 3) return { handler: memberDetail as unknown as Handler, params: { mid: param(parts[2]) } };
  if (parts[1] === 'tag' && parts.length === 3) return { handler: tag as unknown as Handler, params: { tag: param(parts[2]) } };
  if (url.pathname === '/api/search') return { handler: search as Handler, params: {} };
  if (url.pathname === '/api/questions') return { handler: questions as Handler, params: {} };
  if (url.pathname === '/api/inquiries') return { handler: inquiries as Handler, params: {} };
  if (url.pathname === '/api/members') return { handler: members as Handler, params: {} };
  if (url.pathname === '/api/projects') return { handler: projects as Handler, params: {} };
  if (parts[1] === 'projects' && parts.length === 3) return { handler: projectDetail as unknown as Handler, params: { pid: param(parts[2]) } };
  if (url.pathname === '/api/weekly') return { handler: weekly as Handler, params: {} };
  throw new Error(`No explicit handler for ${url.pathname}`);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-22T00:00:00Z'));
  seedFixture();
});
afterAll(() => {
  closeDbForTests();
  if (originalDbPath === undefined) delete process.env.LAB_FEED_DB;
  else process.env.LAB_FEED_DB = originalDbPath;
  if (originalReadonly === undefined) delete process.env.LAB_FEED_DB_READONLY;
  else process.env.LAB_FEED_DB_READONLY = originalReadonly;
  rmSync(tempDirectory, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('Flask ↔ explicit Next read API parity', () => {
  it.each(fixture.requests)('$name has exact Flask status and JSON', async (testCase) => {
    authenticated = testCase.authenticated;
    const url = new URL(testCase.path, 'http://fixture.invalid');
    const { handler, params } = handlerFor(url);
    const request = new NextRequest(url);
    const response = await handler(request, { params: Promise.resolve(params) });
    expect(response.status).toBe(testCase.response.status);
    expect(await response.json()).toEqual(testCase.response.json);
  });

  it('owns every in-scope route explicitly ahead of the catch-all', () => {
    const routeFiles = [
      'feed/route.ts', 'post/[pid]/route.ts', 'member/[mid]/route.ts',
      'tag/[tag]/route.ts', 'search/route.ts', 'questions/route.ts',
      'inquiries/route.ts', 'members/route.ts', 'projects/route.ts',
      'projects/[pid]/route.ts', 'weekly/route.ts',
    ];
    const apiRoot = path.resolve(process.cwd(), 'src/app/api');
    for (const relativePath of routeFiles) {
      const routePath = path.join(apiRoot, relativePath);
      expect(existsSync(routePath), relativePath).toBe(true);
    }
  });

  it('performs no domain-data network request while executing every authenticated GET handler', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    try {
      for (const testCase of fixture.requests.filter((item) => item.authenticated)) {
        authenticated = true;
        const url = new URL(testCase.path, 'http://fixture.invalid');
        const { handler, params } = handlerFor(url);
        const response = await handler(new NextRequest(url), { params: Promise.resolve(params) });
        expect(response.status, testCase.name).toBe(testCase.response.status);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('preserves out-of-scope project writes through the legacy proxy', async () => {
    proxyLegacyApi.mockClear();
    await createProject(new NextRequest('http://fixture.invalid/api/projects', { method: 'POST' }));
    await updateProject(
      new NextRequest('http://fixture.invalid/api/projects/10', { method: 'POST' }),
      { params: Promise.resolve({ pid: '10' }) },
    );
    expect(proxyLegacyApi.mock.calls.map(([, target]) => target)).toEqual([
      'projects', ['projects', '10'],
    ]);
  });

  it.each([
    ['post', postDetail, 'pid', '100.0'],
    ['member', memberDetail, 'mid', '1.0'],
    ['project', projectDetail, 'pid', '10.0'],
  ] as const)('rejects a non-Flask-int %s path instead of resolving an existing row', async (
    _name, handler, paramName, value,
  ) => {
    for (const authState of [true, false]) {
      authenticated = authState;
      const response = await (handler as unknown as Handler)(
        new NextRequest(`http://fixture.invalid/api/invalid/${value}`),
        { params: Promise.resolve({ [paramName]: value }) },
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ error: 'not found' });
    }
  });

  it.each([
    ['post', postDetail, 'pid'],
    ['member', memberDetail, 'mid'],
    ['project', projectDetail, 'pid'],
  ] as const)('treats a large valid Flask-int %s path as routed before authentication', async (
    _name, handler, paramName,
  ) => {
    const value = '9007199254740993';
    const db = new Database(dbPath);
    try {
      if (_name === 'post') {
        db.prepare(`INSERT INTO posts
          (id,author_id,did,learned,blocked,tags,links,source,project_id,created_at,updated_at)
          VALUES (?,1,'Large post','','','','','web',NULL,'2020-01-01 00:00:00','2020-01-01 00:00:00')`)
          .run(BigInt(value));
      } else if (_name === 'member') {
        db.prepare(`INSERT INTO members
          (id,name,password_hash,api_key,role,status,created_at)
          VALUES (?,'Large member','hash','large-key','student','active','2020-01-01 00:00:00')`)
          .run(BigInt(value));
      } else {
        db.prepare(`INSERT INTO projects
          (id,title,type,slug,summary,repo_url,site_url,status,owner_member_id,deadline,created_at,updated_at)
          VALUES (?,'Large project','research','large-project','','','','active',1,'','2020-01-01 00:00:00','2020-01-01 00:00:00')`)
          .run(BigInt(value));
      }
    } finally {
      db.close();
    }
    authenticated = false;
    const unauthorized = await (handler as unknown as Handler)(
      new NextRequest(`http://fixture.invalid/api/invalid/${value}`),
      { params: Promise.resolve({ [paramName]: value }) },
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: 'login required' });

    authenticated = true;
    const missing = await (handler as unknown as Handler)(
      new NextRequest(`http://fixture.invalid/api/invalid/${value}`),
      { params: Promise.resolve({ [paramName]: value }) },
    );
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain('"id":9007199254740993');
  });

  it.each([
    ['1_0', 10], ['١٠', 10], ['９', 9], ['+10', 10], [' 10 ', 10],
    ['9007199254740992', 9007199254740992n], ['10.0', undefined],
    ['0xA', undefined],
    ['\uFEFF10\uFEFF', undefined],
    ['\u001C10\u001C', undefined],
    ['\u008510\u0085', 10],
    ['\u{1E5F1}', undefined],
  ])('matches Python int query conversion for %s', (value, expected) => {
    expect(parsePythonIntQuery(value)).toBe(expected);
  });

  it('treats a FEFF-wrapped project filter as invalid and returns the unfiltered feed', async () => {
    authenticated = true;
    const unfiltered = await feed(new NextRequest('http://fixture.invalid/api/feed'));
    const feff = await feed(
      new NextRequest('http://fixture.invalid/api/feed?project_id=%EF%BB%BF10%EF%BB%BF'),
    );
    expect(feff.status).toBe(unfiltered.status);
    expect(await feff.json()).toEqual(await unfiltered.json());
  });

  it('preserves a valid Flask path integer above the JavaScript safe range', () => {
    expect(parseFlaskPathInt('9007199254740992')).toBe(9007199254740992n);
  });

  it('rejects a Node-17 decimal digit absent from the Flask Python Unicode database', async () => {
    expect(parseFlaskPathInt('\u{1E5F1}')).toBeNull();
    authenticated = false;
    const response = await postDetail(
      new NextRequest('http://fixture.invalid/api/post/%F0%9E%97%B1'),
      { params: Promise.resolve({ pid: '\u{1E5F1}' }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });

  it('matches Python strip and split whitespace semantics for search and tags', async () => {
    expect(trimPythonWhitespace('\u001Cneedle\u001C')).toBe('needle');
    expect(trimPythonWhitespace('\uFEFFneedle\uFEFF')).toBe('\uFEFFneedle\uFEFF');
    expect(splitPythonWhitespace(`alpha\u001Cquestion`)).toEqual(['alpha', 'question']);
    expect(splitPythonWhitespace(`alpha\uFEFFquestion`)).toEqual(['alpha\uFEFFquestion']);

    authenticated = true;
    const controlSearch = await search(
      new NextRequest('http://fixture.invalid/api/search?q=%1CNEEDLE%1C'),
    );
    expect((await controlSearch.json()).posts.map((post: JsonRecord) => post.id)).toEqual([103, 101]);
    const feffSearch = await search(
      new NextRequest('http://fixture.invalid/api/search?q=%EF%BB%BFNEEDLE%EF%BB%BF'),
    );
    expect((await feffSearch.json()).posts).toEqual([]);

    const db = new Database(dbPath);
    try {
      db.prepare('UPDATE posts SET tags=? WHERE id=103').run('alpha\u001Cquestion');
    } finally {
      db.close();
    }
    const controlTag = await tag(
      new NextRequest('http://fixture.invalid/api/tag/question'),
      { params: Promise.resolve({ tag: 'question' }) },
    );
    expect((await controlTag.json()).posts.map((post: JsonRecord) => post.id)).toEqual([104, 103]);

    const db2 = new Database(dbPath);
    try {
      db2.prepare('UPDATE posts SET tags=? WHERE id=103').run('alpha\uFEFFquestion');
    } finally {
      db2.close();
    }
    const feffTag = await tag(
      new NextRequest('http://fixture.invalid/api/tag/question'),
      { params: Promise.resolve({ tag: 'question' }) },
    );
    expect((await feffTag.json()).posts.map((post: JsonRecord) => post.id)).toEqual([104]);
  });

  it('matches Python code-point ordering instead of locale collation', () => {
    expect(['a', 'Z', 'Å'].sort(comparePythonStrings)).toEqual(['Z', 'a', 'Å']);
    expect(['\u{10000}', '\uE000'].sort(comparePythonStrings)).toEqual(['\uE000', '\u{10000}']);
  });
});
