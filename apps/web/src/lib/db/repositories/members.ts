import type Database from 'better-sqlite3';
import type { MemberPrivate, MemberPublic } from '../../types.ts';
import type { FlaskInt } from '../../api-params.ts';
import { getDb } from '../client.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';

export type ReadMemberPublic = Omit<MemberPublic, 'id'> & { id: SqliteInteger };

export function listMembers(): ReadMemberPublic[] {
  return normalizeSqliteIntegers(
    getDb().prepare("SELECT id, name, role FROM members WHERE status='active' ORDER BY name ASC").safeIntegers().all(),
  ) as ReadMemberPublic[];
}

export function listMembersWithStats() {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT m.id, m.name, m.role,
    COUNT(p.id) AS post_count,
    MAX(p.created_at) AS last_post_at
    FROM members m
    LEFT JOIN posts p ON p.author_id=m.id
    WHERE m.status='active'
    GROUP BY m.id
    ORDER BY (MAX(p.created_at) IS NULL), MAX(p.created_at) DESC, m.name ASC`).safeIntegers().all()) as Array<ReadMemberPublic & { post_count: number; last_post_at: string | null }>;
}

export type WeeklyMemberRow = ReadMemberPublic & {
  last_post_at: string | null;
  week_count: number;
};

export function listWeeklyMemberRows(weekStartUtc: string): WeeklyMemberRow[] {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT m.id, m.name, m.role,
    MAX(p.created_at) AS last_post_at,
    SUM(CASE WHEN p.created_at >= ? THEN 1 ELSE 0 END) AS week_count
    FROM members m LEFT JOIN posts p ON p.author_id=m.id
    WHERE m.status='active'
    GROUP BY m.id
    ORDER BY m.name ASC`).safeIntegers().all(weekStartUtc)) as WeeklyMemberRow[];
}

export function getMemberByName(name: string): MemberPrivate | null {
  const row = normalizeSqliteIntegers(
    getDb().prepare("SELECT id, name, role, status, password_hash FROM members WHERE name=? AND status='active'").safeIntegers().get(name),
  ) as MemberPrivate | undefined;
  return row ?? null;
}

export function getMemberById(id: number): MemberPublic | null;
export function getMemberById(id: FlaskInt): ReadMemberPublic | null;
export function getMemberById(id: FlaskInt): ReadMemberPublic | null {
  const row = normalizeSqliteIntegers(
    getDb().prepare("SELECT id, name, role FROM members WHERE id=? AND status='active'").safeIntegers().get(id),
  ) as ReadMemberPublic | undefined;
  return row ?? null;
}

export type DbConnection = Database.Database;

export type MemberAccountRow = {
  id: SqliteInteger;
  name: string;
  api_key: string;
  role: string;
  status: string;
};

export function getMemberAccountById(id: FlaskInt, includeDisabled = false): MemberAccountRow | null {
  const statusClause = includeDisabled ? '' : " AND status='active'";
  return (normalizeSqliteIntegers(getDb().prepare(
    `SELECT id,name,api_key,role,status FROM members WHERE id=?${statusClause}`,
  ).safeIntegers().get(id)) as MemberAccountRow | undefined) ?? null;
}

export function getMemberAccountByApiKey(apiKey: string): MemberAccountRow | null {
  return (normalizeSqliteIntegers(getDb().prepare(
    "SELECT id,name,api_key,role,status FROM members WHERE api_key=? AND status='active'",
  ).safeIntegers().get(apiKey)) as MemberAccountRow | undefined) ?? null;
}

export type AdminMemberRow = Omit<MemberAccountRow, 'api_key'> & {
  created_at: string;
  post_count: number;
  last_post_at: string | null;
};

export function listAdminMembers(): AdminMemberRow[] {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT m.id,m.name,m.role,m.status,m.created_at,
    COUNT(p.id) AS post_count,MAX(p.created_at) AS last_post_at
    FROM members m LEFT JOIN posts p ON p.author_id=m.id
    GROUP BY m.id
    ORDER BY (m.status='active') DESC,m.name ASC`).safeIntegers().all()) as AdminMemberRow[];
}

export function memberExists(conn: Database.Database, id: FlaskInt): boolean {
  return Boolean(conn.prepare("SELECT 1 FROM members WHERE id=? AND status='active'").get(id));
}

export function memberExistsAnyStatus(conn: Database.Database, id: FlaskInt): boolean {
  return Boolean(conn.prepare('SELECT 1 FROM members WHERE id=?').get(id));
}

export function activeMemberRole(conn: Database.Database, id: FlaskInt): string | null {
  const row = conn.prepare("SELECT role FROM members WHERE id=? AND status='active'").get(id) as
    | { role: string }
    | undefined;
  return row?.role ?? null;
}

export function apiKeyAuthenticatesMember(
  conn: Database.Database,
  apiKey: string,
  id: FlaskInt,
): boolean {
  return Boolean(conn.prepare(
    "SELECT 1 FROM members WHERE id=? AND api_key=? AND status='active'",
  ).get(id, apiKey));
}

export function updateMemberApiKey(conn: Database.Database, id: FlaskInt, apiKey: string) {
  conn.prepare('UPDATE members SET api_key=? WHERE id=?').run(apiKey, id);
}

export function updateMemberAccount(
  conn: Database.Database,
  id: FlaskInt,
  role: string | null,
  status: string | null,
) {
  const fields: string[] = [];
  const values: Array<string | FlaskInt> = [];
  if (role !== null) { fields.push('role=?'); values.push(role); }
  if (status !== null) { fields.push('status=?'); values.push(status); }
  if (fields.length) conn.prepare(`UPDATE members SET ${fields.join(',')} WHERE id=?`).run(...values, id);
}

export function insertAuditLog(
  conn: Database.Database,
  actorId: number,
  action: string,
  targetMemberId: FlaskInt,
  detail = '',
) {
  conn.prepare('INSERT INTO audit_log (actor_id,target_member_id,action,detail) VALUES (?,?,?,?)')
    .run(actorId, targetMemberId, action, detail);
}
