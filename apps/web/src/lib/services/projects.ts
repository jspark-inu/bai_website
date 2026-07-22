import type Database from 'better-sqlite3';
import {
  activeMemberExists, getProject, getProjectForWrite, insertProjectWithMembers,
  listActiveProjects, listProjectActivity, listProjectMembers, slugifyProject,
  updateProjectWithMembers, type ProjectRow, type ProjectWritePayload,
} from '../db/repositories/projects.ts';
import { activeMemberRole } from '../db/repositories/members.ts';
import { isPythonFalsyJson, parsePythonIntValue, trimPythonWhitespace, type FlaskInt } from '../api-params.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import type { SqliteInteger } from '../db/read-values.ts';
import type { WriteResult } from './posts.ts';

export function getActiveProjects() {
  return listActiveProjects();
}

export function getProjectDetail(id: FlaskInt) {
  const project = getProject(id);
  return project ? { project, members: listProjectMembers(id), activity: listProjectActivity(id) } : null;
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (isPythonFalsyJson(value)) return '';
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`);
  return trimPythonWhitespace(value);
}

function parseProjectPayload(data: Record<string, unknown>): ProjectWritePayload & { members: unknown } {
  return {
    title: stringField(data, 'title'),
    type: stringField(data, 'type') || stringField(data, 'guild'),
    summary: stringField(data, 'summary'),
    slug: stringField(data, 'slug'),
    repoUrl: stringField(data, 'repo_url'),
    siteUrl: stringField(data, 'site_url'),
    members: isPythonFalsyJson(data.members) ? [] : data.members,
  };
}

function parseMemberRoles(
  conn: Database.Database,
  rows: unknown,
  ownerId: FlaskInt,
): WriteResult<Array<[FlaskInt, string]>> {
  if (!Array.isArray(rows)) {
    // Python iterates strings and dict keys, then rejects each scalar row as an
    // invalid mapping. JSON numbers/booleans are non-iterable and remain 500s.
    if (typeof rows === 'string' || (rows !== null && typeof rows === 'object')) {
      return { ok: false, status: 400, error: 'invalid members payload' };
    }
    throw new TypeError('members payload must be iterable');
  }
  const seen = new Map<string, [FlaskInt, string]>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, status: 400, error: 'invalid members payload' };
    }
    const record = row as Record<string, unknown>;
    const memberId = parsePythonIntValue(record.member_id);
    if (memberId === undefined) return { ok: false, status: 400, error: 'invalid members payload' };
    if (!activeMemberExists(conn, memberId)) return { ok: false, status: 400, error: 'invalid member_id' };
    let role = '';
    if (!isPythonFalsyJson(record.role)) {
      if (typeof record.role !== 'string') throw new TypeError('role must be a string');
      role = trimPythonWhitespace(record.role);
    }
    seen.set(BigInt(memberId).toString(), [memberId, role]);
  }
  const ownerKey = BigInt(ownerId).toString();
  if (!seen.has(ownerKey)) {
    if (!activeMemberExists(conn, ownerId)) return { ok: false, status: 400, error: 'invalid member_id' };
    seen.set(ownerKey, [ownerId, '리드']);
  }
  return { ok: true, value: [...seen.values()] };
}

function validPayload(payload: ProjectWritePayload): boolean {
  return Boolean(payload.title && (payload.summary || payload.repoUrl || payload.siteUrl));
}

export function createProject(
  ownerId: number,
  data: Record<string, unknown>,
): WriteResult<{ id: SqliteInteger }> {
  const parsed = parseProjectPayload(data);
  if (!validPayload(parsed)) {
    return { ok: false, status: 400, error: 'title and summary or link required' };
  }
  return withWriteTransaction((conn) => {
    const roles = parseMemberRoles(conn, parsed.members, ownerId);
    if (!roles.ok) return roles;
    const payload = { ...parsed, slug: slugifyProject(parsed.slug || parsed.title) };
    return { ok: true, value: { id: insertProjectWithMembers(conn, payload, ownerId, roles.value) } };
  });
}

export function projectUpdateAccess(
  id: FlaskInt,
  memberId: number,
  memberRole: string,
): WriteResult<ProjectRow> {
  const project = getProject(id);
  if (!project) return { ok: false, status: 404, error: 'not found' };
  if (memberRole !== 'pi' && BigInt(project.owner_member_id as FlaskInt) !== BigInt(memberId)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  return { ok: true, value: project };
}

export function updateProject(
  id: FlaskInt,
  memberId: number,
  memberRole: string,
  data: Record<string, unknown>,
): WriteResult<{ id: FlaskInt }> {
  const parsed = parseProjectPayload(data);
  if (!validPayload(parsed)) {
    return { ok: false, status: 400, error: 'title and summary or link required' };
  }
  return withWriteTransaction((conn) => {
    const existing = getProjectForWrite(conn, id);
    if (!existing) return { ok: false, status: 404, error: 'not found' };
    const isOwner = BigInt(existing.owner_member_id as FlaskInt) === BigInt(memberId);
    if (!isOwner && (memberRole !== 'pi' || activeMemberRole(conn, memberId) !== 'pi')) {
      return { ok: false, status: 403, error: 'forbidden' };
    }
    const ownerId = (existing.owner_member_id || memberId) as FlaskInt;
    const roles = parseMemberRoles(conn, parsed.members, ownerId);
    if (!roles.ok) return roles;
    updateProjectWithMembers(conn, id, parsed, existing, ownerId, roles.value);
    return { ok: true, value: { id } };
  });
}
