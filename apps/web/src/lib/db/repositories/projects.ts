import { getDb } from '../client.ts';
import type { FlaskInt } from '../../api-params.ts';
import type { PostRow } from './posts.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';

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