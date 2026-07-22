import { getMemberById, listMembersWithStats, listWeeklyMemberRows } from '../db/repositories/members.ts';
import { splitPythonWhitespace, type FlaskInt } from '../api-params.ts';
import {
  getPost, listComments, listOpenQuestions, listPosts, listPostsByMember,
  listPostsByTag, listReactedMemberIds, searchPosts,
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

export function getOpenQuestions() {
  return { posts: listOpenQuestions() };
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