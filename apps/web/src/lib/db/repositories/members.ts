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
