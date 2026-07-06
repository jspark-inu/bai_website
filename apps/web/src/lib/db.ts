import Database from 'better-sqlite3';
import type { Material, MemberPrivate, MemberPublic } from './types';

const DEFAULT_DB_PATH = '/Users/hai_1/AI-Workspace/10-working/1C-개발/1C38-lab-feed/backend/lab-feed.db';

let db: Database.Database | null = null;
let dbPathForHandle = '';

export function resolveDbPath() {
  return process.env.LAB_FEED_DB || DEFAULT_DB_PATH;
}

export function getDb() {
  const nextPath = resolveDbPath();
  if (!db || dbPathForHandle !== nextPath) {
    db?.close();
    db = new Database(nextPath, { readonly: process.env.LAB_FEED_DB_READONLY !== '0' });
    db.pragma('foreign_keys = ON');
    dbPathForHandle = nextPath;
  }
  return db;
}

function getWriteDb() {
  const writeDb = new Database(resolveDbPath(), { readonly: false });
  writeDb.pragma('foreign_keys = ON');
  return writeDb;
}

function ensureColumn(conn: Database.Database, table: string, column: string, decl: string) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) {
    conn.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`).run();
  }
}

export function ensureMaterialUploadSchema(conn = getWriteDb()) {
  let shouldClose = arguments.length === 0;
  try {
    ensureColumn(conn, 'materials', 'file_url', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(conn, 'materials', 'file_name', "TEXT NOT NULL DEFAULT ''");
  } finally {
    if (shouldClose) conn.close();
  }
}

export function listMembers(): MemberPublic[] {
  return getDb()
    .prepare("SELECT id, name, role FROM members WHERE status='active' ORDER BY name ASC")
    .all() as MemberPublic[];
}

export function listMembersWithStats() {
  return getDb()
    .prepare(`SELECT m.id, m.name, m.role,
      COUNT(p.id) AS post_count,
      MAX(p.created_at) AS last_post_at
      FROM members m
      LEFT JOIN posts p ON p.author_id=m.id
      WHERE m.status='active'
      GROUP BY m.id
      ORDER BY m.name ASC`)
    .all() as Array<MemberPublic & { post_count: number; last_post_at: string | null }>;
}

export function getMemberByName(name: string): MemberPrivate | null {
  const row = getDb()
    .prepare("SELECT id, name, role, status, password_hash FROM members WHERE name=? AND status='active'")
    .get(name) as MemberPrivate | undefined;
  return row ?? null;
}

export function getMemberById(id: number): MemberPublic | null {
  const row = getDb()
    .prepare("SELECT id, name, role FROM members WHERE id=? AND status='active'")
    .get(id) as MemberPublic | undefined;
  return row ?? null;
}

export function listMaterials(filters: { category?: string; guild?: string } = {}): Material[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.category) {
    clauses.push('mt.category=?');
    params.push(filters.category);
  }
  if (filters.guild) {
    clauses.push('mt.guild=?');
    params.push(filters.guild);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT mt.*, m.name AS author_name, m.role AS author_role FROM materials mt JOIN members m ON m.id=mt.author_id ${where} ORDER BY mt.id DESC`)
    .all(...params) as Material[];
}

export function getMaterial(id: number): Material | null {
  const row = getDb()
    .prepare('SELECT mt.*, m.name AS author_name, m.role AS author_role FROM materials mt JOIN members m ON m.id=mt.author_id WHERE mt.id=?')
    .get(id) as Material | undefined;
  return row ?? null;
}

export function addMaterial(input: {
  authorId: number;
  title: string;
  body?: string;
  url?: string;
  category?: string;
  guild?: string;
  fileUrl?: string;
  fileName?: string;
}) {
  const conn = getWriteDb();
  try {
    ensureMaterialUploadSchema(conn);
    const result = conn
      .prepare(`INSERT INTO materials
        (author_id, title, body, url, category, guild, file_url, file_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        input.authorId,
        input.title,
        input.body ?? '',
        input.url ?? '',
        input.category || '자료',
        input.guild ?? '',
        input.fileUrl ?? '',
        input.fileName ?? '',
      );
    return Number(result.lastInsertRowid);
  } finally {
    conn.close();
  }
}

export function updateMaterial(id: number, input: {
  title: string;
  body?: string;
  url?: string;
  category?: string;
  guild?: string;
  fileUrl?: string;
  fileName?: string;
}) {
  const conn = getWriteDb();
  try {
    ensureMaterialUploadSchema(conn);
    conn
      .prepare(`UPDATE materials SET
        title=?, body=?, url=?, category=?, guild=?, file_url=?, file_name=?,
        updated_at=datetime('now')
        WHERE id=?`)
      .run(
        input.title,
        input.body ?? '',
        input.url ?? '',
        input.category || '자료',
        input.guild ?? '',
        input.fileUrl ?? '',
        input.fileName ?? '',
        id,
      );
  } finally {
    conn.close();
  }
}

export function deleteMaterial(id: number) {
  const conn = getWriteDb();
  try {
    conn.prepare('DELETE FROM materials WHERE id=?').run(id);
  } finally {
    conn.close();
  }
}

export function listPosts(limit = 50) {
  return getDb()
    .prepare(`SELECT p.*, m.name AS author_name, m.role AS author_role,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comment_count,
      (SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id) AS reaction_count
      FROM posts p
      JOIN members m ON m.id=p.author_id
      ORDER BY p.id DESC
      LIMIT ?`)
    .all(limit) as Array<Record<string, unknown>>;
}

export function getPost(id: number) {
  const row = getDb()
    .prepare(`SELECT p.*, m.name AS author_name, m.role AS author_role,
      pr.title AS project_title,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comment_count,
      (SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id) AS reaction_count
      FROM posts p
      JOIN members m ON m.id=p.author_id
      LEFT JOIN projects pr ON pr.id=p.project_id
      WHERE p.id=?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function listPostsByMember(memberId: number) {
  return getDb()
    .prepare(`SELECT p.*, m.name AS author_name, m.role AS author_role
      FROM posts p
      JOIN members m ON m.id=p.author_id
      WHERE p.author_id=?
      ORDER BY p.id DESC`)
    .all(memberId) as Array<Record<string, unknown>>;
}

export function searchPosts(query: string) {
  const like = `%${query}%`;
  return getDb()
    .prepare(`SELECT p.*, m.name AS author_name
      FROM posts p
      JOIN members m ON m.id=p.author_id
      WHERE p.did LIKE ? OR p.learned LIKE ? OR p.blocked LIKE ? OR p.tags LIKE ?
      ORDER BY p.id DESC
      LIMIT 80`)
    .all(like, like, like, like) as Array<Record<string, unknown>>;
}

export function listPostsByTag(tag: string) {
  const like = `%${tag}%`;
  return getDb()
    .prepare(`SELECT p.*, m.name AS author_name
      FROM posts p
      JOIN members m ON m.id=p.author_id
      WHERE p.tags LIKE ?
      ORDER BY p.id DESC`)
    .all(like) as Array<Record<string, unknown>>;
}

export function listProjects() {
  return getDb()
    .prepare(`SELECT p.*, m.name AS owner_name
      FROM projects p
      LEFT JOIN members m ON m.id=p.owner_member_id
      ORDER BY p.id DESC`)
    .all() as Array<Record<string, unknown>>;
}

export function getProject(id: number) {
  const row = getDb()
    .prepare(`SELECT p.*, m.name AS owner_name
      FROM projects p
      LEFT JOIN members m ON m.id=p.owner_member_id
      WHERE p.id=?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function listPostsByProject(projectId: number) {
  return getDb()
    .prepare(`SELECT p.*, m.name AS author_name
      FROM posts p
      JOIN members m ON m.id=p.author_id
      WHERE p.project_id=?
      ORDER BY p.id DESC`)
    .all(projectId) as Array<Record<string, unknown>>;
}

export function listOpenQuestions() {
  return getDb()
    .prepare(`SELECT p.*, m.name AS author_name
      FROM posts p JOIN members m ON m.id=p.author_id
      WHERE TRIM(p.blocked) != ''
      ORDER BY p.id DESC`)
    .all() as Array<Record<string, unknown>>;
}

export function getStats() {
  const count = (sql: string) => Number((getDb().prepare(sql).get() as { count: number }).count);
  return {
    posts: count('SELECT COUNT(*) AS count FROM posts'),
    members: count("SELECT COUNT(*) AS count FROM members WHERE status='active'"),
    projects: count('SELECT COUNT(*) AS count FROM projects'),
    materials: count('SELECT COUNT(*) AS count FROM materials'),
    blocked: count("SELECT COUNT(*) AS count FROM posts WHERE TRIM(blocked) != ''"),
  };
}
