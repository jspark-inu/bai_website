import { getDb } from '../client.ts';
import {
  splitPythonWhitespace, trimPythonWhitespace, type FlaskInt,
} from '../../api-params.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';

export type PostRow = {
  id: SqliteInteger;
  author_id: SqliteInteger;
  did: string;
  learned: string;
  blocked: string;
  tags: string;
  links: string;
  source: string;
  created_at: string;
  updated_at: string;
  project_id: SqliteInteger | null;
  author_name: string;
  project_title: string | null;
  reaction_count: number;
  comment_count: number;
};

const ENRICHED_POST_SELECT = `SELECT p.*, m.name AS author_name, pr.title AS project_title,
  COALESCE(rc.reaction_count, 0) AS reaction_count,
  COALESCE(cc.comment_count, 0) AS comment_count
  FROM posts p JOIN members m ON p.author_id=m.id
  LEFT JOIN projects pr ON pr.id=p.project_id
  LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id=p.id
  LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id=p.id`;

const POST_DETAIL_SELECT = `SELECT p.*, m.name AS author_name, pr.title AS project_title,
  COALESCE(rc.reaction_count, 0) AS reaction_count,
  COALESCE(cc.comment_count, 0) AS comment_count
  FROM posts p JOIN members m ON p.author_id=m.id
  LEFT JOIN projects pr ON pr.id=p.project_id
  LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions WHERE kind='thumbsup' GROUP BY post_id) rc ON rc.post_id=p.id
  LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id=p.id`;

export function listPosts(projectId?: number | bigint): PostRow[] {
  const where = projectId === undefined ? '' : ' WHERE p.project_id=?';
  return normalizeSqliteIntegers(
    getDb().prepare(`${ENRICHED_POST_SELECT}${where} ORDER BY p.id DESC`).safeIntegers()
      .all(...(projectId === undefined ? [] : [projectId])),
  ) as PostRow[];
}

export function getPost(id: FlaskInt): PostRow | null {
  return (normalizeSqliteIntegers(
    getDb().prepare(`${POST_DETAIL_SELECT} WHERE p.id=?`).safeIntegers().get(id),
  ) as PostRow | undefined) ?? null;
}

export function listPostsByMember(memberId: FlaskInt): PostRow[] {
  return normalizeSqliteIntegers(
    getDb().prepare(`${ENRICHED_POST_SELECT} WHERE p.author_id=? ORDER BY p.id ASC`).safeIntegers().all(memberId),
  ) as PostRow[];
}

export function listPostsByTag(tag: string): PostRow[] {
  return (normalizeSqliteIntegers(
    getDb().prepare(`${ENRICHED_POST_SELECT} ORDER BY p.id DESC`).safeIntegers().all(),
  ) as PostRow[])
    .filter((post) => splitPythonWhitespace(post.tags.replaceAll(',', ' ')).includes(tag));
}

export function searchPosts(query: string): PostRow[] {
  const normalized = trimPythonWhitespace(query);
  if (!normalized) return [];
  const like = `%${normalized.toLowerCase()}%`;
  return normalizeSqliteIntegers(getDb().prepare(`${ENRICHED_POST_SELECT}
    WHERE lower(p.did) LIKE ? OR lower(p.learned) LIKE ? OR lower(p.blocked) LIKE ?
      OR lower(p.tags) LIKE ? OR lower(p.links) LIKE ?
    ORDER BY p.id DESC`).safeIntegers().all(like, like, like, like, like)) as PostRow[];
}

export function listOpenQuestions(): PostRow[] {
  return (normalizeSqliteIntegers(getDb().prepare(`${ENRICHED_POST_SELECT}
    WHERE TRIM(p.blocked) <> '' ORDER BY p.id ASC`).safeIntegers().all()) as PostRow[])
    .filter((post) => post.comment_count === 0);
}

export function listComments(postId: FlaskInt) {
  return normalizeSqliteIntegers(getDb().prepare(`SELECT c.*, m.name AS author_name
    FROM comments c JOIN members m ON c.author_id=m.id
    WHERE c.post_id=? ORDER BY c.id ASC`).safeIntegers().all(postId)) as Array<Record<string, unknown>>;
}

export function listReactedMemberIds(postId: FlaskInt): SqliteInteger[] {
  return (normalizeSqliteIntegers(
    getDb().prepare("SELECT member_id FROM reactions WHERE post_id=? AND kind='thumbsup'")
      .safeIntegers().all(postId),
  ) as Array<{ member_id: SqliteInteger }>).map(({ member_id }) => member_id);
}