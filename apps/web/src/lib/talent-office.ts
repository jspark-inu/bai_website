import type Database from 'better-sqlite3';
import { openWriteDb } from './db/client';
import { withTransaction } from './db/transaction';

export const TALENT_REQUEST_STATES = ['submitted', 'accepted', 'declined', 'approval_required', 'assigned', 'ready_for_review', 'changes_requested', 'completed'] as const;
export type TalentRequestState = typeof TALENT_REQUEST_STATES[number];

export class TalentOfficeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'TalentOfficeError';
  }
}

export type AssigneeInput = { memberId: number; ratio: number };

function withDb<T>(fn: (conn: Database.Database) => T, supplied?: Database.Database): T {
  let conn: Database.Database;
  if (supplied) {
    conn = supplied;
  } else {
    try {
      conn = openWriteDb();
    } catch (error) {
      if (process.env.LAB_FEED_DB_READONLY !== '0') {
        throw new TalentOfficeError('database writes are disabled by LAB_FEED_DB_READONLY=1', 503);
      }
      throw error;
    }
  }
  try {
    return fn(conn);
  } finally {
    if (!supplied) conn.close();
  }
}

function requireMember(conn: Database.Database, memberId: number) {
  const row = conn.prepare("SELECT id FROM members WHERE id=? AND status='active'").get(memberId);
  if (!row) throw new TalentOfficeError('active member not found', 404);
}

function getRequestOrThrow(conn: Database.Database, requestId: number) {
  const request = conn.prepare('SELECT * FROM talent_requests WHERE id=?').get(requestId) as Record<string, unknown> | undefined;
  if (!request) throw new TalentOfficeError('request not found', 404);
  return request;
}

export function createTalentRequest(input: { title: string; problem: string; desiredOutcome?: string; systemScopeReason?: string; requesterId: number }, conn?: Database.Database) {
  const title = input.title.trim();
  const problem = input.problem.trim();
  const systemScopeReason = input.systemScopeReason?.trim() ?? '';
  if (!title || !problem || !systemScopeReason) throw new TalentOfficeError('title, problem, and system scope reason are required');
  return withDb((db) => {
    requireMember(db, input.requesterId);
    const result = db.prepare('INSERT INTO talent_requests (title, problem, expected_outcome, system_scope_reason, requester_member_id) VALUES (?, ?, ?, ?, ?)')
      .run(title, problem, input.desiredOutcome?.trim() ?? '', systemScopeReason, input.requesterId);
    return Number(result.lastInsertRowid);
  }, conn);
}

export function listTalentRequests(conn?: Database.Database) {
  return withDb((db) => db.prepare(`SELECT tr.*, m.name AS requester_name,
    (SELECT COUNT(*) FROM talent_request_assignees ta WHERE ta.request_id=tr.id) AS assignee_count
    FROM talent_requests tr JOIN members m ON m.id=tr.requester_member_id ORDER BY tr.id DESC`).all(), conn);
}

export function getTalentRequest(requestId: number, conn?: Database.Database) {
  return withDb((db) => {
    const request = getRequestOrThrow(db, requestId);
    const assignees = db.prepare(`SELECT ta.member_id, ta.allocation_ratio, m.name FROM talent_request_assignees ta
      JOIN members m ON m.id=ta.member_id WHERE ta.request_id=? ORDER BY ta.member_id`).all(requestId);
    const points = db.prepare('SELECT member_id, points FROM contribution_points WHERE request_id=? ORDER BY member_id').all(requestId);
    return { ...request, assignees, points };
  }, conn);
}

const transitions: Partial<Record<TalentRequestState, TalentRequestState[]>> = {
  submitted: ['accepted', 'declined', 'approval_required'],
  accepted: ['assigned'],
  assigned: ['ready_for_review'],
  ready_for_review: ['completed', 'changes_requested'],
  changes_requested: ['assigned'],
};

export function changeTalentRequestState(requestId: number, next: TalentRequestState, conn?: Database.Database) {
  return withDb((db) => {
    const request = getRequestOrThrow(db, requestId);
    const current = request.status as TalentRequestState;
    if (!transitions[current]?.includes(next)) throw new TalentOfficeError(`invalid transition: ${current} -> ${next}`, 409);
    db.prepare("UPDATE talent_requests SET status=?, updated_at=datetime('now') WHERE id=?").run(next, requestId);
    return next;
  }, conn);
}

export function assignTalentRequest(requestId: number, assignees: AssigneeInput[], conn?: Database.Database) {
  if (!assignees.length) throw new TalentOfficeError('at least one assignee is required');
  const ids = new Set(assignees.map((a) => a.memberId));
  const ratio = assignees.reduce((sum, a) => sum + a.ratio, 0);
  if (ids.size !== assignees.length || assignees.some((a) => !Number.isFinite(a.ratio) || a.ratio <= 0) || Math.abs(ratio - 1) > 0.000001) {
    throw new TalentOfficeError('assignee allocation ratios must be positive and total exactly 1');
  }
  return withDb((db) => {
    const request = getRequestOrThrow(db, requestId);
    if (request.status !== 'accepted' && request.status !== 'changes_requested') throw new TalentOfficeError('request is not ready for assignment', 409);
    withTransaction(db, () => {
      for (const assignee of assignees) requireMember(db, assignee.memberId);
      db.prepare('DELETE FROM talent_request_assignees WHERE request_id=?').run(requestId);
      const stmt = db.prepare('INSERT INTO talent_request_assignees (request_id, member_id, allocation_ratio) VALUES (?, ?, ?)');
      assignees.forEach((a) => stmt.run(requestId, a.memberId, a.ratio));
      db.prepare("UPDATE talent_requests SET status='assigned', updated_at=datetime('now') WHERE id=?").run(requestId);
    });
  }, conn);
}

export function submitTalentSolution(requestId: number, input: { summary: string; url?: string }, conn?: Database.Database) {
  const summary = input.summary.trim();
  if (!summary) throw new TalentOfficeError('solution summary is required');
  return withDb((db) => {
    const request = getRequestOrThrow(db, requestId);
    if (request.status !== 'assigned') throw new TalentOfficeError('request is not assigned', 409);
    db.prepare("UPDATE talent_requests SET solution_summary=?, solution_url=?, status='ready_for_review', updated_at=datetime('now') WHERE id=?")
      .run(summary, input.url?.trim() ?? '', requestId);
  }, conn);
}

export function completeTalentRequest(requestId: number, note: string, conn?: Database.Database) {
  const completionNote = note.trim();
  if (!completionNote) throw new TalentOfficeError('completion note is required');
  return withDb((db) => {
    withTransaction(db, () => {
      const request = getRequestOrThrow(db, requestId);
      if (request.status !== 'ready_for_review') throw new TalentOfficeError('request is not ready for completion', 409);
      const assignees = db.prepare('SELECT member_id AS memberId, allocation_ratio AS ratio FROM talent_request_assignees WHERE request_id=? ORDER BY member_id').all(requestId) as AssigneeInput[];
      if (!assignees.length) throw new TalentOfficeError('request has no assignees', 409);
      const totalRatio = assignees.reduce((sum, a) => sum + a.ratio, 0);
      if (Math.abs(totalRatio - 1) > 0.000001) throw new TalentOfficeError('assignee allocation ratios are invalid', 409);
      const existing = db.prepare('SELECT COUNT(*) AS count FROM contribution_points WHERE request_id=?').get(requestId) as { count: number };
      if (existing.count) throw new TalentOfficeError('points have already been awarded', 409);
      const award = db.prepare('INSERT INTO contribution_points (request_id, member_id, points, reason) VALUES (?, ?, ?, ?)');
      // The final member receives the remainder, preserving the fixed total of 10 points.
      let assigned = 0;
      assignees.forEach((a, index) => {
        const points = index === assignees.length - 1 ? 10 - assigned : 10 * a.ratio;
        assigned += points;
        if (points > 0) award.run(requestId, a.memberId, points, '인력사무소 완료 인정');
      });
      db.prepare("UPDATE talent_requests SET status='completed', completion_note=?, completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
        .run(completionNote, requestId);
    });
    return getTalentRequest(requestId, db);
  }, conn);
}

export function setTalentOperator(memberId: number, enabled: boolean, conn?: Database.Database) {
  return withDb((db) => {
    requireMember(db, memberId);
    db.prepare('UPDATE members SET role=? WHERE id=?').run(enabled ? 'operator' : 'student', memberId);
  }, conn);
}
