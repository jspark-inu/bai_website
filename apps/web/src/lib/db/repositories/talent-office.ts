import type Database from 'better-sqlite3';
import type { FlaskInt } from '../../api-params.ts';
import { normalizeSqliteIntegers, type SqliteInteger } from '../read-values.ts';

type Row = Record<string, unknown>;

function rows(statement: Database.Statement, ...params: unknown[]): Row[] {
  return normalizeSqliteIntegers(statement.safeIntegers().all(...params)) as Row[];
}

function row(statement: Database.Statement, ...params: unknown[]): Row | null {
  return (normalizeSqliteIntegers(statement.safeIntegers().get(...params)) as Row | undefined) ?? null;
}

export function activeTalentActor(conn: Database.Database, memberId: number): { id: SqliteInteger; role: string } | null {
  return row(conn.prepare("SELECT id,role FROM members WHERE id=? AND status='active'"), memberId) as { id: SqliteInteger; role: string } | null;
}

export function talentMemberExists(conn: Database.Database, memberId: FlaskInt): boolean {
  return Boolean(conn.prepare("SELECT 1 FROM members WHERE id=? AND status='active'").get(memberId));
}

export function listTalentRequestRows(conn: Database.Database, memberId: number, operator: boolean): Row[] {
  const where = operator ? '' : `WHERE tr.requester_member_id=? OR EXISTS (
    SELECT 1 FROM talent_request_assignees ta WHERE ta.request_id=tr.id AND ta.member_id=?)`;
  const statement = conn.prepare(`SELECT tr.*,m.name AS requester_name,
    (SELECT COUNT(*) FROM talent_request_assignees ta WHERE ta.request_id=tr.id) AS assignee_count
    FROM talent_requests tr JOIN members m ON m.id=tr.requester_member_id
    ${where} ORDER BY tr.id DESC`);
  return operator ? rows(statement) : rows(statement, memberId, memberId);
}

export function getTalentRequestRow(conn: Database.Database, requestId: FlaskInt): Row | null {
  return row(conn.prepare(`SELECT tr.*,m.name AS requester_name
    FROM talent_requests tr JOIN members m ON m.id=tr.requester_member_id WHERE tr.id=?`), requestId);
}

export function listTalentAssigneeRows(conn: Database.Database, requestId: FlaskInt): Row[] {
  return rows(conn.prepare(`SELECT ta.member_id,ta.role,ta.allocation_ratio,m.name
    FROM talent_request_assignees ta JOIN members m ON m.id=ta.member_id
    WHERE ta.request_id=? ORDER BY ta.member_id`), requestId);
}

export function insertTalentRequest(conn: Database.Database, requesterId: number, payload: {
  title: string; problem: string; expectedOutcome: string; systemScopeReason: string;
}): SqliteInteger {
  const result = conn.prepare(`INSERT INTO talent_requests
    (requester_member_id,title,problem,expected_outcome,system_scope_reason,submitted_at,created_at,updated_at)
    VALUES (?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'))`)
    .run(requesterId, payload.title, payload.problem, payload.expectedOutcome, payload.systemScopeReason);
  return result.lastInsertRowid;
}

export function updateTalentReview(conn: Database.Database, requestId: FlaskInt, status: string, reviewNote: string, approvalReason: string) {
  conn.prepare(`UPDATE talent_requests SET status=?,review_note=?,requires_approval=?,approval_reason=?,updated_at=datetime('now') WHERE id=?`)
    .run(status, reviewNote, status === 'approval_required' ? 1 : 0, approvalReason, requestId);
}

export type TalentAssignee = { memberId: FlaskInt; role: string; ratio: number };

export function replaceTalentAssignees(conn: Database.Database, requestId: FlaskInt, assignees: TalentAssignee[]) {
  conn.prepare('DELETE FROM talent_request_assignees WHERE request_id=?').run(requestId);
  const insert = conn.prepare(`INSERT INTO talent_request_assignees
    (request_id,member_id,role,allocation_ratio,assigned_at) VALUES (?,?,?,?,datetime('now'))`);
  for (const assignee of assignees) insert.run(requestId, assignee.memberId, assignee.role, assignee.ratio);
  conn.prepare("UPDATE talent_requests SET status='assigned',updated_at=datetime('now') WHERE id=?").run(requestId);
}

export function talentAssigneeExists(conn: Database.Database, requestId: FlaskInt, memberId: FlaskInt): boolean {
  return Boolean(conn.prepare('SELECT 1 FROM talent_request_assignees WHERE request_id=? AND member_id=?').get(requestId, memberId));
}

export function updateTalentSolution(conn: Database.Database, requestId: FlaskInt, summary: string, url: string) {
  conn.prepare(`UPDATE talent_requests SET status='ready_for_review',solution_summary=?,solution_url=?,updated_at=datetime('now') WHERE id=?`)
    .run(summary, url, requestId);
}

export function updateTalentChangesRequested(conn: Database.Database, requestId: FlaskInt, note: string) {
  conn.prepare("UPDATE talent_requests SET status='changes_requested',review_note=?,updated_at=datetime('now') WHERE id=?")
    .run(note, requestId);
}

export function insertContributionPoint(conn: Database.Database, requestId: FlaskInt, memberId: FlaskInt, points: number) {
  conn.prepare(`INSERT OR IGNORE INTO contribution_points (member_id,request_id,points,reason)
    VALUES (?,?,?,'인력사무소 요청 완료 인정')`).run(memberId, requestId, points);
}

export function markTalentCompleted(conn: Database.Database, requestId: FlaskInt) {
  conn.prepare("UPDATE talent_requests SET status='completed',completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?")
    .run(requestId);
}

export function listContributionPointRows(conn: Database.Database, memberId: number): Row[] {
  return rows(conn.prepare(`SELECT cp.*,tr.title AS request_title FROM contribution_points cp
    JOIN talent_requests tr ON tr.id=cp.request_id WHERE cp.member_id=? ORDER BY cp.id DESC`), memberId);
}

export function insertTalentAudit(conn: Database.Database, actorId: number, action: string, requestId: FlaskInt) {
  conn.prepare('INSERT INTO audit_log (actor_id,target_member_id,action,detail) VALUES (?,NULL,?,?)')
    .run(actorId, action, `request_id=${requestId.toString()}`);
}
