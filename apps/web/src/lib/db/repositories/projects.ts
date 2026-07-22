import { getDb } from '../client.ts';
import type { FlaskInt } from '../../api-params.ts';
import type { PostRow } from './posts.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';
import type Database from 'better-sqlite3';

export type ProjectRow = Record<string, unknown> & { id: SqliteInteger; status: string };

export function listActiveProjects(): ProjectRow[] {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT pr.*, owner.name AS owner_name,
    (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id=pr.id) AS member_count,
    (SELECT COUNT(*) FROM posts po WHERE po.project_id=pr.id) AS activity_count
    FROM projects pr LEFT JOIN members owner ON owner.id=pr.owner_member_id
    WHERE pr.status='active'
    ORDER BY (pr.status='active') DESC, (pr.deadline='') ASC, pr.deadline ASC, pr.id DESC`).safeIntegers().all()) as ProjectRow[];
}

export function getProject(id: FlaskInt): ProjectRow | null {
  return (normalizeSqliteIntegers(
    getDb().prepare('SELECT * FROM projects WHERE id=?').safeIntegers().get(id),
  ) as ProjectRow | undefined) ?? null;
}

export function listProjectMembers(projectId: FlaskInt) {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT pm.member_id, pm.role, m.name
    FROM project_members pm JOIN members m ON m.id=pm.member_id
    WHERE pm.project_id=? ORDER BY m.name ASC`).safeIntegers().all(projectId)) as Array<Record<string, unknown>>;
}

export function listProjectActivity(projectId: FlaskInt): PostRow[] {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT p.*, m.name AS author_name, pr.title AS project_title,
    COALESCE(rc.reaction_count, 0) AS reaction_count,
    COALESCE(cc.comment_count, 0) AS comment_count
    FROM posts p JOIN members m ON p.author_id=m.id
    LEFT JOIN projects pr ON pr.id=p.project_id
    LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id=p.id
    LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id=p.id
    WHERE p.project_id=? ORDER BY p.id DESC`).safeIntegers().all(projectId)) as PostRow[];
}

export type ProjectWritePayload = {
  title: string;
  type: string;
  summary: string;
  slug: string;
  repoUrl: string;
  siteUrl: string;
};

export function getProjectForWrite(conn: Database.Database, id: FlaskInt): ProjectRow | null {
  return (normalizeSqliteIntegers(
    conn.prepare('SELECT * FROM projects WHERE id=?').safeIntegers().get(id),
  ) as ProjectRow | undefined) ?? null;
}

export function activeMemberExists(conn: Database.Database, id: FlaskInt): boolean {
  return conn.prepare("SELECT 1 FROM members WHERE id=? AND status='active'").get(id) !== undefined;
}

export function insertProjectWithMembers(
  conn: Database.Database,
  payload: ProjectWritePayload,
  ownerId: FlaskInt,
  memberRoles: Array<[FlaskInt, string]>,
): SqliteInteger {
  const result = conn.prepare(`INSERT INTO projects
    (title,type,goal,status,summary,slug,repo_url,site_url,owner_member_id)
    VALUES (?,?,?,'active',?,?,?,?,?)`).run(
    payload.title, payload.type, payload.summary, payload.summary, payload.slug,
    payload.repoUrl, payload.siteUrl, ownerId,
  );
  const projectId = result.lastInsertRowid;
  if (!payload.slug) {
    conn.prepare('UPDATE projects SET slug=? WHERE id=?').run(`project-${projectId}`, projectId);
  }
  replaceProjectMembers(conn, projectId, memberRoles);
  return projectId;
}

export function updateProjectWithMembers(
  conn: Database.Database,
  id: FlaskInt,
  payload: ProjectWritePayload,
  existing: ProjectRow,
  ownerId: FlaskInt,
  memberRoles: Array<[FlaskInt, string]>,
) {
  conn.prepare(`UPDATE projects SET title=?,type=?,status=?,goal=?,summary=?,slug=?,
    repo_url=?,site_url=?,owner_member_id=?,current_stage=?,deadline=?,next_milestone=?,
    risk_level=?,pi_decision=?,updated_at=datetime('now') WHERE id=?`).run(
    payload.title, payload.type, existing.status, payload.summary, payload.summary,
    existing.slug || slugifyProject(payload.title, id), payload.repoUrl, payload.siteUrl,
    ownerId, existing.current_stage, existing.deadline, existing.next_milestone,
    existing.risk_level, existing.pi_decision, id,
  );
  replaceProjectMembers(conn, id, memberRoles);
}

function replaceProjectMembers(
  conn: Database.Database,
  projectId: FlaskInt,
  memberRoles: Array<[FlaskInt, string]>,
) {
  conn.prepare('DELETE FROM project_members WHERE project_id=?').run(projectId);
  const insert = conn.prepare('INSERT INTO project_members (project_id,member_id,role) VALUES (?,?,?)');
  for (const [memberId, role] of memberRoles) insert.run(projectId, memberId, role);
}

export function slugifyProject(title: string, id?: FlaskInt): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || (id === undefined ? '' : `project-${id}`);
}