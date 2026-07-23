import { getMemberById, listMembersWithStats, listWeeklyMemberRows } from '../db/repositories/members.ts';
import {
  isPythonFalsyJson, parsePythonIntValue, splitPythonWhitespace, trimPythonWhitespace,
  type FlaskInt,
} from '../api-params.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import type { SqliteInteger } from '../db/read-values.ts';
import {
  getPost, getPostOwner, insertComment, insertPost, listComments, listQuestions,
  listPosts, listPostsByMember, listPostsByTag, listReactedMemberIds, projectExists,
  searchPosts, toggleThumbsup, updatePost, type WritePostPayload,
} from '../db/repositories/posts.ts';

export { listPosts, listPostsByTag, searchPosts };

export function getPostDetail(id: FlaskInt) {
  const post = getPost(id);
  return post ? { post, comments: listComments(id), reacted_by: listReactedMemberIds(id) } : null;
}

export function getMemberJourney(id: FlaskInt) {
  const member = getMemberById(id);
  if (!member) return null;
  const posts = listPostsByMember(id);
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of splitPythonWhitespace(post.tags.replaceAll(',', ' '))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tag_counts = Object.fromEntries([...counts].sort(
    ([a, ac], [b, bc]) => bc - ac || comparePythonStrings(a, b),
  ));
  return {
    member, posts, post_count: posts.length, tag_counts,
    first_post_at: posts[0]?.created_at ?? null,
    last_post_at: posts.at(-1)?.created_at ?? null,
  };
}

export function getQuestions() {
  return { posts: listQuestions() };
}

export function getMembers() {
  return listMembersWithStats();
}

function weekStartUtc(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const weekday = (kst.getUTCDay() + 6) % 7;
  const mondayUtcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - weekday) - 9 * 60 * 60 * 1000;
  return new Date(mondayUtcMs).toISOString().slice(0, 19).replace('T', ' ');
}

export function comparePythonStrings(left: string, right: string): number {
  const leftPoints = [...left].map((character) => character.codePointAt(0)!);
  const rightPoints = [...right].map((character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] < rightPoints[index] ? -1 : 1;
    }
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}

export function getWeeklyStatus() {
  const rows = listWeeklyMemberRows(weekStartUtc()).map((row) => ({
    ...row,
    week_count: row.week_count || 0,
    reported: (row.week_count || 0) > 0,
  })).sort((a, b) => Number(a.reported) - Number(b.reported) || comparePythonStrings(a.name, b.name));
  const reported = rows.filter((row) => row.reported);
  const missing = rows.filter((row) => !row.reported);
  return { total: rows.length, reported_count: reported.length, missing, reported };
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (isPythonFalsyJson(value)) return '';
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`);
  return trimPythonWhitespace(value);
}

export function parsePostPayload(data: Record<string, unknown>): WritePostPayload {
  return {
    did: stringField(data, 'did'),
    learned: stringField(data, 'learned'),
    blocked: stringField(data, 'blocked'),
    tags: stringField(data, 'tags'),
    links: stringField(data, 'links'),
    projectId: parsePythonIntValue(data.project_id) ?? null,
  };
}

export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export function createWebPost(
  authorId: number,
  data: Record<string, unknown>,
): WriteResult<{ id: SqliteInteger }> {
  const payload = parsePostPayload(data);
  if (!(payload.did || payload.learned || payload.blocked)) {
    return { ok: false, status: 400, error: 'empty post' };
  }
  return withWriteTransaction((conn) => {
    if (payload.projectId !== null && !projectExists(conn, payload.projectId)) {
      return { ok: false, status: 400, error: 'invalid project_id' };
    }
    return { ok: true, value: { id: insertPost(conn, authorId, payload) } };
  });
}

export function editWebPost(
  id: FlaskInt,
  authorId: number,
  data: Record<string, unknown>,
): WriteResult<{ id: FlaskInt }> {
  return withWriteTransaction((conn) => {
    const owner = getPostOwner(conn, id);
    if (owner === null) return { ok: false, status: 404, error: 'not found' };
    if (owner !== authorId && owner !== BigInt(authorId)) {
      return { ok: false, status: 403, error: 'forbidden' };
    }
    const payload = parsePostPayload(data);
    if (!(payload.did || payload.learned || payload.blocked)) {
      return { ok: false, status: 400, error: 'empty post' };
    }
    if (payload.projectId !== null && !projectExists(conn, payload.projectId)) {
      return { ok: false, status: 400, error: 'invalid project_id' };
    }
    updatePost(conn, id, payload);
    return { ok: true, value: { id } };
  });
}

export function commentOnPost(
  id: FlaskInt,
  authorId: number,
  data: Record<string, unknown>,
): WriteResult<{ id: SqliteInteger }> {
  return withWriteTransaction((conn) => {
    if (getPostOwner(conn, id) === null) {
      return { ok: false, status: 404, error: 'not found' };
    }
    const body = stringField(data, 'body');
    if (!body) return { ok: false, status: 400, error: 'empty comment' };
    return { ok: true, value: { id: insertComment(conn, id, authorId, body) } };
  });
}

export function reactToPost(
  id: FlaskInt,
  memberId: number,
): WriteResult<{ reaction_count: number }> {
  return withWriteTransaction((conn) => {
    if (getPostOwner(conn, id) === null) {
      return { ok: false, status: 404, error: 'not found' };
    }
    return { ok: true, value: { reaction_count: toggleThumbsup(conn, id, memberId) } };
  });
}