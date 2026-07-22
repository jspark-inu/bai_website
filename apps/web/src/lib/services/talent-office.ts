import type Database from 'better-sqlite3';
import type { MemberPublic } from '../types.ts';
import { getDb } from '../db/client.ts';
import { withWriteTransaction } from '../db/transaction.ts';
import { isPythonFalsyJson, parsePythonIntValue, trimPythonWhitespace, type FlaskInt } from '../api-params.ts';
import {
  activeTalentActor, getTalentRequestRow, insertContributionPoint, insertTalentAudit,
  insertTalentRequest, listContributionPointRows, listTalentAssigneeRows, listTalentRequestRows,
  markTalentCompleted, replaceTalentAssignees, talentAssigneeExists, talentMemberExists,
  updateTalentChangesRequested, updateTalentReview, updateTalentSolution,
  type TalentAssignee,
} from '../db/repositories/talent-office.ts';

export type TalentResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const ok = <T>(value: T): TalentResult<T> => ({ ok: true, value });
const fail = (status: number, error: string): TalentResult<never> => ({ ok: false, status, error });

export function isTalentOperatorRole(role: string): boolean {
  return role === 'pi' || role === 'operator';
}

function sameId(left: unknown, right: number): boolean {
  return (typeof left === 'number' || typeof left === 'bigint') && BigInt(left) === BigInt(right);
}

export function pythonStringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (isPythonFalsyJson(value)) return '';
  if (typeof value !== 'string') throw new TypeError(`${key}.strip is not a function`);
  return trimPythonWhitespace(value);
}

export function listTalentRequests(identity: MemberPublic): TalentResult<{ requests: Record<string, unknown>[] }> {
  const conn = getDb();
  const actor = activeTalentActor(conn, identity.id);
  if (!actor) return fail(401, 'login required');
  return ok({ requests: listTalentRequestRows(conn, identity.id, isTalentOperatorRole(actor.role)) });
}

export function getTalentRequestDetail(identity: MemberPublic, requestId: FlaskInt): TalentResult<{
  request: Record<string, unknown>; assignees: Record<string, unknown>[];
}> {
  const conn = getDb();
  const actor = activeTalentActor(conn, identity.id);
  if (!actor) return fail(401, 'login required');
  const request = getTalentRequestRow(conn, requestId);
  if (!request) return fail(404, 'not found');
  const assignees = listTalentAssigneeRows(conn, requestId);
  const allowed = isTalentOperatorRole(actor.role)
    || sameId(request.requester_member_id, identity.id)
    || assignees.some((assignee) => sameId(assignee.member_id, identity.id));
  return allowed ? ok({ request, assignees }) : fail(403, 'forbidden');
}

export function talentRequestExists(requestId: FlaskInt): boolean {
  return Boolean(getTalentRequestRow(getDb(), requestId));
}

export function getTalentRequestForDecision(requestId: FlaskInt): Record<string, unknown> | null {
  return getTalentRequestRow(getDb(), requestId);
}

export function createTalentRequest(identity: MemberPublic, data: Record<string, unknown>): TalentResult<{ id: FlaskInt }> {
  const payload = {
    title: pythonStringField(data, 'title'),
    problem: pythonStringField(data, 'problem'),
    expectedOutcome: pythonStringField(data, 'expected_outcome'),
    systemScopeReason: pythonStringField(data, 'system_scope_reason'),
  };
  if (!payload.title || !payload.problem || !payload.expectedOutcome || !payload.systemScopeReason) {
    return fail(400, 'title, problem, expected_outcome, and system_scope_reason are required');
  }
  return withWriteTransaction((conn) => {
    if (!activeTalentActor(conn, identity.id)) return fail(401, 'login required');
    const id = insertTalentRequest(conn, identity.id, payload);
    insertTalentAudit(conn, identity.id, 'talent_request_create', id);
    return ok({ id });
  });
}

export function reviewTalentRequest(identity: MemberPublic, requestId: FlaskInt, data: Record<string, unknown>): TalentResult<{ ok: true }> {
  const status = pythonStringField(data, 'status');
  const reviewNote = pythonStringField(data, 'review_note');
  const approvalReason = pythonStringField(data, 'approval_reason');
  return withWriteTransaction((conn) => {
    const actor = activeTalentActor(conn, identity.id);
    if (!actor || !isTalentOperatorRole(actor.role)) return fail(403, 'operator only');
    if (!getTalentRequestRow(conn, requestId)) return fail(404, 'not found');
    if (!['accepted', 'declined', 'approval_required'].includes(status)) return fail(400, 'invalid review status');
    updateTalentReview(conn, requestId, status, reviewNote, approvalReason);
    insertTalentAudit(conn, identity.id, 'talent_request_review', requestId);
    return ok({ ok: true });
  });
}

function pythonFloat(value: unknown): number | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string' || !trimPythonWhitespace(value)) return null;
  const parsed = Number(trimPythonWhitespace(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function iterableAssigneeRows(value: unknown): unknown[] {
  if (isPythonFalsyJson(value)) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [...value];
  if (value && typeof value === 'object') return Object.keys(value);
  throw new TypeError('assignees is not iterable');
}

function parseTalentAssignees(conn: Database.Database, data: Record<string, unknown>): TalentResult<TalentAssignee[]> {
  const parsed: TalentAssignee[] = [];
  const seen = new Set<string>();
  for (const value of iterableAssigneeRows(data.assignees)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(400, 'invalid assignee');
    const item = value as Record<string, unknown>;
    const memberId = parsePythonIntValue(item.member_id);
    const ratio = pythonFloat(item.allocation_ratio);
    if (memberId === undefined || ratio === null || ratio <= 0 || !talentMemberExists(conn, memberId)) {
      return fail(400, 'invalid assignee');
    }
    const key = memberId.toString();
    if (seen.has(key)) return fail(400, 'invalid assignee');
    seen.add(key);
    parsed.push({ memberId, role: pythonStringField(item, 'role'), ratio });
  }
  return ok(parsed);
}

export function assignTalentRequest(identity: MemberPublic, requestId: FlaskInt, data: Record<string, unknown>): TalentResult<{ ok: true }> {
  return withWriteTransaction((conn) => {
    const actor = activeTalentActor(conn, identity.id);
    if (!actor || !isTalentOperatorRole(actor.role)) return fail(403, 'operator only');
    const assignees = parseTalentAssignees(conn, data);
    if (!assignees.ok) return assignees;
    if (!assignees.value.length) return fail(400, 'at least one assignee is required');
    const total = assignees.value.reduce((sum, assignee) => sum + assignee.ratio, 0);
    if (Math.abs(total - 1) > 0.0001) return fail(400, 'allocation ratios must sum to 1');
    const request = getTalentRequestRow(conn, requestId);
    if (!request || !['accepted', 'assigned', 'changes_requested'].includes(String(request.status))) {
      return fail(400, 'request cannot be assigned');
    }
    replaceTalentAssignees(conn, requestId, assignees.value);
    insertTalentAudit(conn, identity.id, 'talent_request_assign', requestId);
    return ok({ ok: true });
  });
}

export function submitTalentSolution(identity: MemberPublic, requestId: FlaskInt, data: Record<string, unknown>): TalentResult<{ ok: true }> {
  const summary = pythonStringField(data, 'solution_summary');
  const url = pythonStringField(data, 'solution_url');
  if (!summary && !url) return fail(400, 'solution summary or URL is required');
  return withWriteTransaction((conn) => {
    const actor = activeTalentActor(conn, identity.id);
    if (!actor) return fail(401, 'login required');
    let delegateId: FlaskInt = identity.id;
    if (isTalentOperatorRole(actor.role)) {
      if (!getTalentRequestRow(conn, requestId)) return fail(404, 'not found');
      const assignees = listTalentAssigneeRows(conn, requestId);
      if (!assignees.length) return fail(400, 'at least one assignee is required');
      delegateId = assignees[0].member_id as FlaskInt;
    }
    if (!talentAssigneeExists(conn, requestId, delegateId)) return fail(400, 'member is not assigned');
    updateTalentSolution(conn, requestId, summary, url);
    insertTalentAudit(conn, identity.id, 'talent_request_solution', requestId);
    return ok({ ok: true });
  });
}

function roundHalfEven(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const difference = scaled - floor;
  if (Math.abs(difference - 0.5) <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round(scaled) / factor;
}

function completeTalentRequest(conn: Database.Database, requestId: FlaskInt, requesterId: FlaskInt): TalentResult<Array<{ member_id: FlaskInt; points: number }>> {
  const request = getTalentRequestRow(conn, requestId);
  if (!request || BigInt(request.requester_member_id as FlaskInt) !== BigInt(requesterId)) {
    return fail(400, 'only requester can complete');
  }
  if (request.status === 'completed') return ok([]);
  if (request.status !== 'ready_for_review') return fail(400, 'request is not ready for review');
  if (!trimPythonWhitespace(String(request.solution_summary)) && !trimPythonWhitespace(String(request.solution_url))) {
    return fail(400, 'solution evidence is required');
  }
  const assignees = listTalentAssigneeRows(conn, requestId);
  const total = assignees.reduce((sum, assignee) => sum + Number(assignee.allocation_ratio), 0);
  if (!assignees.length || Math.abs(total - 1) > 0.0001) return fail(400, 'valid assignee allocation is required');
  const awards: Array<{ member_id: FlaskInt; points: number }> = [];
  let remaining = 10;
  assignees.forEach((assignee, index) => {
    const points = index === assignees.length - 1
      ? remaining
      : roundHalfEven(10 * Number(assignee.allocation_ratio), 2);
    remaining = roundHalfEven(remaining - points, 2);
    const memberId = assignee.member_id as FlaskInt;
    insertContributionPoint(conn, requestId, memberId, points);
    awards.push({ member_id: memberId, points });
  });
  markTalentCompleted(conn, requestId);
  return ok(awards);
}

export function decideTalentRequestInTransaction(
  conn: Database.Database,
  identity: MemberPublic,
  requestId: FlaskInt,
  decision: string,
  reviewNote = '',
): TalentResult<{ ok: true; awards?: Array<{ member_id: FlaskInt; points: number }> }> {
  const actor = activeTalentActor(conn, identity.id);
  if (!actor) return fail(401, 'login required');
  const request = getTalentRequestRow(conn, requestId);
  if (!request) return fail(404, 'not found');
  if (!sameId(request.requester_member_id, identity.id) && actor.role !== 'pi') return fail(403, 'requester only');
  if (decision === 'completed') {
    const awards = completeTalentRequest(conn, requestId, request.requester_member_id as FlaskInt);
    if (!awards.ok) return awards;
    insertTalentAudit(conn, identity.id, 'talent_request_complete', requestId);
    return ok({ ok: true, awards: awards.value });
  }
  if (decision === 'changes_requested') {
    if (request.status !== 'ready_for_review') return fail(400, 'request is not ready for review');
    updateTalentChangesRequested(conn, requestId, reviewNote);
    insertTalentAudit(conn, identity.id, 'talent_request_changes_requested', requestId);
    return ok({ ok: true });
  }
  return fail(400, 'invalid decision');
}

export function decideTalentRequest(identity: MemberPublic, requestId: FlaskInt, data: Record<string, unknown>): TalentResult<{ ok: true; awards?: Array<{ member_id: FlaskInt; points: number }> }> {
  const decision = pythonStringField(data, 'decision');
  const reviewNote = decision === 'changes_requested' ? pythonStringField(data, 'review_note') : '';
  return withWriteTransaction((conn) => decideTalentRequestInTransaction(conn, identity, requestId, decision, reviewNote));
}

export function listTalentPoints(identity: MemberPublic): TalentResult<{ points: Record<string, unknown>[]; total: number }> {
  const conn = getDb();
  if (!activeTalentActor(conn, identity.id)) return fail(401, 'login required');
  const points = listContributionPointRows(conn, identity.id);
  return ok({ points, total: points.reduce((sum, point) => sum + Number(point.points), 0) });
}
