import sharedLegacyApiFixtures from './legacy-api-fixtures.json';

export type LegacyApiMethod = 'GET' | 'POST' | 'DELETE';
export type LegacyAuthScheme = 'none' | 'session' | 'api-key';

export interface LegacyApiRouteContract {
  method: LegacyApiMethod;
  /** Canonical dynamic parameters use :name (for example Flask <int:pid> -> :pid). */
  path: string;
  authorization: {
    scheme: LegacyAuthScheme;
    roles: readonly string[];
    scope?: string;
  };
  request: {
    headers: readonly string[];
    path: readonly string[];
    query: readonly string[];
    json: readonly string[];
  };
  response: {
    successStatus: number;
    success: string;
    statuses: Readonly<Record<number, string>>;
  };
}

const PUBLIC = { scheme: 'none', roles: ['public'] } as const;
const SESSION = {
  scheme: 'session',
  roles: ['student', 'admin_student', 'developer', 'operator', 'pi'],
} as const;
const API_KEY = {
  scheme: 'api-key',
  roles: ['student', 'admin_student', 'developer', 'operator', 'pi'],
} as const;
const PI = { scheme: 'session', roles: ['pi'] } as const;
const OPERATOR = { scheme: 'session', roles: ['operator', 'pi'] } as const;
const EMPTY_REQUEST = { headers: [], path: [], query: [], json: [] } as const;

export const legacyApiManifest = [
  {
    method: 'GET', path: '/api/healthz', authorization: PUBLIC,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{ok:true,service:"bai-site",database:"ok"}', statuses: { 200: 'database healthy', 503: '{ok:false,service:"bai-site"}' } },
  },
  {
    method: 'POST', path: '/api/post', authorization: API_KEY,
    request: { headers: ['X-API-Key'], path: [], query: [], json: ['did?', 'learned?', 'blocked?', 'tags?', 'links?', 'project_id?'] },
    response: { successStatus: 200, success: '{id:number,url:"/post/:id"}', statuses: { 200: 'post created', 400: '{error:"empty post"|"invalid project_id"}', 401: '{error:"invalid api key"}' } },
  },
  {
    method: 'POST', path: '/api/login', authorization: PUBLIC,
    request: { headers: ['X-BAI-Client-IP? (trusted only from loopback)'], path: [], query: [], json: ['name', 'password'] },
    response: { successStatus: 200, success: '{id,name,role}; sets Flask session', statuses: { 200: 'authenticated member', 401: '{error:"invalid credentials"}', 429: '{error:"too many login failures"}; Retry-After header' } },
  },
  {
    method: 'POST', path: '/api/logout', authorization: PUBLIC,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{ok:true}; clears session', statuses: { 200: 'session cleared' } },
  },
  {
    method: 'GET', path: '/api/me', authorization: SESSION,
    request: { headers: [], path: [], query: ['api_key? ("1" includes key and usage)'], json: [] },
    response: { successStatus: 200, success: '{id,name,role}[+ api_key,member_id,usage]', statuses: { 200: 'current member', 401: '{error:"not logged in"}' } },
  },
  {
    method: 'POST', path: '/api/me', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['action="regenerate_api_key"'] },
    response: { successStatus: 200, success: '{api_key,member_id,name,role}', statuses: { 200: 'API key regenerated', 400: '{error:"unknown action"}', 401: '{error:"not logged in"}' } },
  },
  {
    method: 'POST', path: '/api/change-password', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['current_password', 'new_password'] },
    response: { successStatus: 200, success: '{ok:true}', statuses: { 200: 'password changed', 400: '{error:"current password is incorrect"|"new password must be at least 4 characters"}', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/feed', authorization: SESSION,
    request: { headers: [], path: [], query: ['project_id?:int'], json: [] },
    response: { successStatus: 200, success: 'Post[] with reaction_count and comment_count', statuses: { 200: 'filtered feed', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/post/:pid', authorization: SESSION,
    request: { headers: [], path: ['pid:int'], query: [], json: [] },
    response: { successStatus: 200, success: '{post,comments,reacted_by}', statuses: { 200: 'post detail', 401: '{error:"login required"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'GET', path: '/api/member/:mid', authorization: SESSION,
    request: { headers: [], path: ['mid:int'], query: [], json: [] },
    response: { successStatus: 200, success: '{member,posts,post_count,tag_counts,first_post_at,last_post_at}', statuses: { 200: 'member journey', 401: '{error:"login required"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'GET', path: '/api/tag/:tag', authorization: SESSION,
    request: { headers: [], path: ['tag:string'], query: [], json: [] },
    response: { successStatus: 200, success: '{tag,posts}', statuses: { 200: 'tagged posts', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/search', authorization: SESSION,
    request: { headers: [], path: [], query: ['q?'], json: [] },
    response: { successStatus: 200, success: '{q,posts}', statuses: { 200: 'search results', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/questions', authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{posts}', statuses: { 200: 'blocked question posts', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/inquiries', authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{open:Inquiry[],answered:Inquiry[]}', statuses: { 200: 'inquiry lists', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/inquiries', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['question'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'inquiry created', 400: '{error:"question required"}', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/inquiries/:iid/answer', authorization: PI,
    request: { headers: [], path: ['iid:int'], query: [], json: ['answer'] },
    response: { successStatus: 200, success: '{ok:true}', statuses: { 200: 'answer saved', 400: '{error:"answer required"}', 401: '{error:"login required"}', 403: '{error:"pi only"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'GET', path: '/api/members', authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: 'MemberWithStats[]', statuses: { 200: 'member stats', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/projects', authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: 'active Project[]', statuses: { 200: 'active projects', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/projects', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['title', 'type?', 'slug?', 'summary?', 'repo_url?', 'site_url?', 'members?'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'project created', 400: '{error:validation message}', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/projects/:pid', authorization: SESSION,
    request: { headers: [], path: ['pid:int'], query: [], json: [] },
    response: { successStatus: 200, success: '{project,members,activity}', statuses: { 200: 'project detail', 401: '{error:"login required"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/projects/:pid', authorization: { ...SESSION, scope: 'project owner or pi' },
    request: { headers: [], path: ['pid:int'], query: [], json: ['title', 'type?', 'slug?', 'summary?', 'repo_url?', 'site_url?', 'members?'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'project updated', 400: '{error:validation message}', 401: '{error:"login required"}', 403: '{error:"forbidden"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'GET', path: '/api/talent-office', authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{requests:TalentRequest[]}', statuses: { 200: 'role-filtered requests', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/talent-office', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['title', 'problem', 'expected_outcome', 'system_scope_reason'] },
    response: { successStatus: 201, success: '{id}', statuses: { 201: 'request created', 400: '{error:"title, problem, expected_outcome, and system_scope_reason are required"}', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/talent-office/:rid', authorization: { ...SESSION, scope: 'requester, assignee, operator, or pi' },
    request: { headers: [], path: ['rid:int'], query: [], json: [] },
    response: { successStatus: 200, success: '{request,assignees}', statuses: { 200: 'talent request detail', 401: '{error:"login required"}', 403: '{error:"forbidden"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/talent-office/:rid/review', authorization: OPERATOR,
    request: { headers: [], path: ['rid:int'], query: [], json: ['status', 'review_note?', 'approval_reason?'] },
    response: { successStatus: 200, success: '{ok:true}', statuses: { 200: 'review saved', 400: '{error:validation message}', 401: '{error:"login required"}', 403: '{error:"operator only"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/talent-office/:rid/assignees', authorization: OPERATOR,
    request: { headers: [], path: ['rid:int'], query: [], json: ['assignees[{member_id,role?,allocation_ratio}]'] },
    response: { successStatus: 200, success: '{ok:true}', statuses: { 200: 'assignees replaced', 400: '{error:validation message}', 401: '{error:"login required"}', 403: '{error:"operator only"}' } },
  },
  {
    method: 'POST', path: '/api/talent-office/:rid/solution', authorization: { ...SESSION, scope: 'assignee, operator, or pi' },
    request: { headers: [], path: ['rid:int'], query: [], json: ['solution_summary?', 'solution_url?'] },
    response: { successStatus: 200, success: '{ok:true}', statuses: { 200: 'solution submitted', 400: '{error:validation message}', 401: '{error:"login required"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/talent-office/:rid/decision', authorization: { ...SESSION, scope: 'requester or pi' },
    request: { headers: [], path: ['rid:int'], query: [], json: ['decision="completed"|"changes_requested"', 'review_note?'] },
    response: { successStatus: 200, success: '{ok:true,awards?}', statuses: { 200: 'decision applied', 400: '{error:validation message|"invalid decision"}', 401: '{error:"login required"}', 403: '{error:"requester only"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'GET', path: '/api/talent-office/points', authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{points,total}', statuses: { 200: 'current member contribution points', 401: '{error:"login required"}' } },
  },
  ...['/api/members/api-key', '/api/account/api-key', '/api/developer/key'].map((path) => ({
    method: 'GET' as const, path, authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{member_id,name,role,api_key,usage}', statuses: { 200: 'own API key details', 401: '{error:"login required"}' } },
  })),
  ...['/api/members/api-key/regenerate', '/api/account/api-key/regenerate', '/api/developer/key/regenerate'].map((path) => ({
    method: 'POST' as const, path, authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{api_key}', statuses: { 200: 'own API key regenerated', 401: '{error:"login required"}' } },
  })),
  {
    method: 'GET', path: '/api/admin/members', authorization: PI,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{members} without api_key', statuses: { 200: 'admin member list', 401: '{error:"login required"}', 403: '{error:"pi only"}' } },
  },
  {
    method: 'POST', path: '/api/admin/members/:mid/api-key/regenerate', authorization: PI,
    request: { headers: [], path: ['mid:int'], query: [], json: [] },
    response: { successStatus: 200, success: '{member_id,api_key}', statuses: { 200: 'target API key regenerated', 401: '{error:"login required"}', 403: '{error:"pi only"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/admin/members/:mid', authorization: PI,
    request: { headers: [], path: ['mid:int'], query: [], json: ['role?', 'status?'] },
    response: { successStatus: 200, success: '{ok:true}', statuses: { 200: 'member account updated', 400: '{error:"invalid role"|"invalid status"|"cannot demote yourself"}', 401: '{error:"login required"}', 403: '{error:"pi only"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'GET', path: '/api/weekly', authorization: SESSION,
    request: EMPTY_REQUEST,
    response: { successStatus: 200, success: '{total,reported_count,missing,reported}', statuses: { 200: 'weekly report status', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/wall', authorization: SESSION,
    request: { headers: [], path: [], query: ['limit?:int (default 12)'], json: [] },
    response: { successStatus: 200, success: '{messages}', statuses: { 200: 'wall messages', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/wall', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['body (1..80 normalized characters)'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'wall message created', 400: '{error:"message required"|"message too long"}', 401: '{error:"login required"}' } },
  },
  {
    method: 'GET', path: '/api/materials', authorization: SESSION,
    request: { headers: [], path: [], query: ['category?', 'guild?'], json: [] },
    response: { successStatus: 200, success: '{materials}', statuses: { 200: 'filtered materials', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/materials', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['title', 'body?', 'url?', 'category?', 'guild?'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'material created', 400: '{error:"title and body or url required"}', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/materials/:mid', authorization: { ...SESSION, scope: 'material author or pi' },
    request: { headers: [], path: ['mid:int'], query: [], json: ['title', 'body?', 'url?', 'category?', 'guild?'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'material updated', 400: '{error:"title and body or url required"}', 401: '{error:"login required"}', 403: '{error:"forbidden"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'DELETE', path: '/api/materials/:mid', authorization: { ...SESSION, scope: 'material author or pi' },
    request: { headers: [], path: ['mid:int'], query: [], json: [] },
    response: { successStatus: 200, success: '{ok:true}', statuses: { 200: 'material deleted', 401: '{error:"login required"}', 403: '{error:"forbidden"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/web/post', authorization: SESSION,
    request: { headers: [], path: [], query: [], json: ['did?', 'learned?', 'blocked?', 'tags?', 'links?', 'project_id?'] },
    response: { successStatus: 200, success: '{id,url:"/post/:id"}', statuses: { 200: 'web post created', 400: '{error:"empty post"|"invalid project_id"}', 401: '{error:"login required"}' } },
  },
  {
    method: 'POST', path: '/api/post/:pid/edit', authorization: { ...SESSION, scope: 'post author only' },
    request: { headers: [], path: ['pid:int'], query: [], json: ['did?', 'learned?', 'blocked?', 'tags?', 'links?', 'project_id?'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'post updated', 400: '{error:"empty post"|"invalid project_id"}', 401: '{error:"login required"}', 403: '{error:"forbidden"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/post/:pid/comment', authorization: SESSION,
    request: { headers: [], path: ['pid:int'], query: [], json: ['body'] },
    response: { successStatus: 200, success: '{id}', statuses: { 200: 'comment created', 400: '{error:"empty comment"}', 401: '{error:"login required"}', 404: '{error:"not found"}' } },
  },
  {
    method: 'POST', path: '/api/post/:pid/react', authorization: SESSION,
    request: { headers: [], path: ['pid:int'], query: [], json: [] },
    response: { successStatus: 200, success: '{reaction_count}', statuses: { 200: 'thumbsup toggled', 401: '{error:"login required"}', 404: '{error:"not found"}' } },
  },
] satisfies readonly LegacyApiRouteContract[];

interface FixtureRequest {
  method: LegacyApiMethod;
  path: string;
  headers?: Readonly<Record<string, string>>;
  json?: Readonly<Record<string, string>>;
  sessionRole?: string;
}

export interface LegacyApiContractFixture {
  name: 'health-success' | 'goodbai-invalid-api-key' | 'pi-only-forbidden' | 'post-not-found';
  request: FixtureRequest;
  response: { status: 200 | 401 | 403 | 404; json: Readonly<Record<string, unknown>> };
}

const FIXTURE_NAMES = new Set<LegacyApiContractFixture['name']>([
  'health-success',
  'goodbai-invalid-api-key',
  'pi-only-forbidden',
  'post-not-found',
]);
const FIXTURE_STATUSES = new Set<LegacyApiContractFixture['response']['status']>([
  200, 401, 403, 404,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function assertLegacyApiContractFixtures(
  value: unknown,
): asserts value is LegacyApiContractFixture[] {
  if (!Array.isArray(value)) throw new TypeError('legacy API fixtures must be an array');

  for (const fixture of value) {
    if (!isRecord(fixture) || !FIXTURE_NAMES.has(fixture.name as LegacyApiContractFixture['name'])) {
      throw new TypeError('legacy API fixture has an invalid name');
    }
    const request = fixture.request;
    if (
      !isRecord(request)
      || !['GET', 'POST', 'DELETE'].includes(request.method as string)
      || typeof request.path !== 'string'
      || (request.headers !== undefined && !isStringRecord(request.headers))
      || (request.json !== undefined && !isStringRecord(request.json))
      || (request.sessionRole !== undefined && typeof request.sessionRole !== 'string')
    ) {
      throw new TypeError(`legacy API fixture ${fixture.name as string} has an invalid request`);
    }
    const response = fixture.response;
    if (
      !isRecord(response)
      || !FIXTURE_STATUSES.has(response.status as LegacyApiContractFixture['response']['status'])
      || !isRecord(response.json)
    ) {
      throw new TypeError(`legacy API fixture ${fixture.name as string} has an invalid response`);
    }
  }
}

/** Shared fixtures are executed by backend/test_legacy_api_contract.py against Flask + temporary SQLite. */
assertLegacyApiContractFixtures(sharedLegacyApiFixtures);
export const legacyApiContractFixtures: readonly LegacyApiContractFixture[] = sharedLegacyApiFixtures;
