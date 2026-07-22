import type Database from 'better-sqlite3';
import type { MemberPrivate, MemberPublic } from '../../types.ts';
import { getDb } from '../client.ts';

export function listMembers(): MemberPublic[] {
  return getDb().prepare("SELECT id, name, role FROM members WHERE status='active' ORDER BY name ASC").all() as MemberPublic[];
}

export function listMembersWithStats() {
  return getDb().prepare(`SELECT m.id, m.name, m.role,
    COUNT(p.id) AS post_count,
    MAX(p.created_at) AS last_post_at
    FROM members m
    LEFT JOIN posts p ON p.author_id=m.id
    WHERE m.status='active'
    GROUP BY m.id
    ORDER BY m.name ASC`).all() as Array<MemberPublic & { post_count: number; last_post_at: string | null }>;
}

export function getMemberByName(name: string): MemberPrivate | null {
  const row = getDb().prepare("SELECT id, name, role, status, password_hash FROM members WHERE name=? AND status='active'").get(name) as MemberPrivate | undefined;
  return row ?? null;
}

export function getMemberById(id: number): MemberPublic | null {
  const row = getDb().prepare("SELECT id, name, role FROM members WHERE id=? AND status='active'").get(id) as MemberPublic | undefined;
  return row ?? null;
}

export type DbConnection = Database.Database;
