import { randomBytes } from 'node:crypto';
import type { MemberPublic } from '../types.ts';
import type { FlaskInt } from '../api-params.ts';
import { parsePostPayload, type WriteResult } from './posts.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import type { SqliteInteger } from '../db/read-values.ts';
import { insertPost, projectExists } from '../db/repositories/posts.ts';
import {
  activeMemberRole, apiKeyAuthenticatesMember, getMemberAccountByApiKey,
  getMemberAccountById, insertAuditLog, listAdminMembers, memberExists,
  memberExistsAnyStatus, updateMemberAccount, updateMemberApiKey,
} from '../db/repositories/members.ts';

export const API_KEY_USAGE = { endpoint: '/api/post', header: 'X-API-Key', method: 'POST' } as const;

export function getOwnApiKey(identity: MemberPublic) {
  const member = getMemberAccountById(identity.id);
  return member ? {
    api_key: member.api_key,
    member_id: member.id,
    name: member.name,
    role: member.role,
    usage: API_KEY_USAGE,
  } : null;
}

function makeApiKey() {
  return randomBytes(24).toString('base64url');
}

export function regenerateOwnApiKey(identity: MemberPublic) {
  const member = getMemberAccountById(identity.id);
  if (!member) return null;
  const apiKey = makeApiKey();
  return withWriteTransaction((conn) => {
    if (!memberExists(conn, member.id)) return null;
    updateMemberApiKey(conn, member.id, apiKey);
    insertAuditLog(conn, identity.id, 'regenerate_own_api_key', member.id);
    return apiKey;
  });
}

export function getAdminMembers() {
  return listAdminMembers();
}

export function adminMemberExists(targetId: FlaskInt) {
  return getMemberAccountById(targetId, true) !== null;
}

export function regenerateMemberApiKey(
  actorId: number,
  targetId: FlaskInt,
): WriteResult<{ api_key: string; member_id: FlaskInt }> {
  if (!getMemberAccountById(targetId, true)) {
    return { ok: false, status: 404, error: 'not found' };
  }
  const apiKey = makeApiKey();
  return withWriteTransaction((conn) => {
    if (activeMemberRole(conn, actorId) !== 'pi') {
      return { ok: false, status: 403, error: 'pi only' };
    }
    if (!memberExistsAnyStatus(conn, targetId)) {
      return { ok: false, status: 404, error: 'not found' };
    }
    updateMemberApiKey(conn, targetId, apiKey);
    insertAuditLog(conn, actorId, 'admin_regenerate_api_key', targetId);
    return { ok: true, value: { api_key: apiKey, member_id: targetId } };
  });
}

const ALLOWED_ROLES = new Set(['student', 'admin_student', 'developer', 'operator', 'pi']);
const ALLOWED_STATUSES = new Set(['active', 'disabled']);

export function updateAdminMember(
  actorId: number,
  targetId: FlaskInt,
  data: Record<string, unknown>,
): WriteResult<{ ok: true }> {
  if (!adminMemberExists(targetId)) return { ok: false, status: 404, error: 'not found' };
  const role = data.role == null ? null : data.role;
  const status = data.status == null ? null : data.status;
  if (role !== null && (typeof role !== 'string' || !ALLOWED_ROLES.has(role))) {
    return { ok: false, status: 400, error: 'invalid role' };
  }
  if (status !== null && (typeof status !== 'string' || !ALLOWED_STATUSES.has(status))) {
    return { ok: false, status: 400, error: 'invalid status' };
  }
  if ((targetId === actorId || targetId === BigInt(actorId)) && role !== null && role !== 'pi') {
    return { ok: false, status: 400, error: 'cannot demote yourself' };
  }
  return withWriteTransaction((conn) => {
    if (activeMemberRole(conn, actorId) !== 'pi') {
      return { ok: false, status: 403, error: 'pi only' };
    }
    if (!memberExistsAnyStatus(conn, targetId)) {
      return { ok: false, status: 404, error: 'not found' };
    }
    updateMemberAccount(conn, targetId, role, status);
    insertAuditLog(
      conn, actorId, 'admin_update_member', targetId,
      `role=${role ?? ''} status=${status ?? ''}`,
    );
    return { ok: true, value: { ok: true } };
  });
}

export function getApiKeyMember(apiKey: string | null) {
  return apiKey ? getMemberAccountByApiKey(apiKey) : null;
}

export function createGoodbaiPost(
  authorId: FlaskInt,
  apiKey: string,
  data: Record<string, unknown>,
): WriteResult<{ id: SqliteInteger; url: string }> {
  const payload = parsePostPayload(data);
  if (!(payload.did || payload.learned || payload.blocked)) {
    return { ok: false, status: 400, error: 'empty post' };
  }
  return withWriteTransaction((conn) => {
    if (!apiKeyAuthenticatesMember(conn, apiKey, authorId)) {
      return { ok: false, status: 401, error: 'invalid api key' };
    }
    if (payload.projectId !== null && !projectExists(conn, payload.projectId)) {
      return { ok: false, status: 400, error: 'invalid project_id' };
    }
    const id = insertPost(conn, authorId, payload, 'skill');
    return { ok: true, value: { id, url: `/post/${id}` } };
  });
}