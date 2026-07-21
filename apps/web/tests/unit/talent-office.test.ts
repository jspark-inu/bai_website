import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TalentOfficeError,
  assignTalentRequest,
  changeTalentRequestState,
  completeTalentRequest,
  createTalentRequest,
  ensureTalentOfficeSchema,
  getTalentRequest,
  submitTalentSolution,
} from '@/lib/talent-office';

const connections: Database.Database[] = [];

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE members (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student',
    status TEXT NOT NULL DEFAULT 'active'
  ); CREATE TABLE projects (id INTEGER PRIMARY KEY)`);
  db.exec("INSERT INTO members (id, name, role, status) VALUES (1, '요청자', 'student', 'active'), (2, '개발자A', 'operator', 'active'), (3, '개발자B', 'operator', 'active')");
  ensureTalentOfficeSchema(db);
  connections.push(db);
  return db;
}

function requestReadyForReview(db: Database.Database) {
  const id = createTalentRequest({ title: '출결 흐름 개선', problem: '수기 확인이 반복됩니다.', systemScopeReason: '매 학기 모든 수강생이 겪습니다.', requesterId: 1 }, db);
  changeTalentRequestState(id, 'accepted', db);
  assignTalentRequest(id, [{ memberId: 2, ratio: 0.6 }, { memberId: 3, ratio: 0.4 }], db);
  submitTalentSolution(id, { summary: 'QR 출결 도구를 만들었습니다.' }, db);
  return id;
}

afterEach(() => {
  connections.splice(0).forEach((db) => db.close());
});

describe('talent office domain invariants', () => {
  it('upgrades the Flask-first schema without changing existing request identities', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', status TEXT NOT NULL DEFAULT 'active');
      CREATE TABLE projects (id INTEGER PRIMARY KEY);
      CREATE TABLE talent_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, requester_member_id INTEGER NOT NULL REFERENCES members(id),
        title TEXT NOT NULL, problem TEXT NOT NULL, expected_outcome TEXT NOT NULL, system_scope_reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted', review_note TEXT NOT NULL DEFAULT '', requires_approval INTEGER NOT NULL DEFAULT 0,
        approval_reason TEXT NOT NULL DEFAULT '', linked_project_id INTEGER REFERENCES projects(id), solution_summary TEXT NOT NULL DEFAULT '',
        solution_url TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL DEFAULT '2026-07-01 00:00:00', updated_at TEXT NOT NULL DEFAULT '2026-07-01 00:00:00', completed_at TEXT
      );
      CREATE TABLE talent_request_assignees (request_id INTEGER NOT NULL, member_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT '', allocation_ratio REAL NOT NULL DEFAULT 1.0, PRIMARY KEY (request_id, member_id));
      CREATE TABLE contribution_points (id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL, request_id INTEGER NOT NULL, points REAL NOT NULL, reason TEXT NOT NULL, awarded_at TEXT NOT NULL DEFAULT '');
      INSERT INTO members (id, name) VALUES (1, '기존 요청자');
      INSERT INTO talent_requests (id, requester_member_id, title, problem, expected_outcome, system_scope_reason) VALUES (41, 1, '기존 요청', '기존 문제', '기존 결과', '기존 근거');
    `);
    ensureTalentOfficeSchema(db);
    connections.push(db);

    const row = db.prepare('SELECT id, title, submitted_at, created_at, completion_note FROM talent_requests WHERE id=41').get();
    expect(row).toEqual({ id: 41, title: '기존 요청', submitted_at: '2026-07-01 00:00:00', created_at: '2026-07-01 00:00:00', completion_note: '' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('enforces the permitted state machine', () => {
    const db = setup();
    const id = createTalentRequest({ title: '요청', problem: '시스템 문제', systemScopeReason: '여러 구성원이 반복해서 겪습니다.', requesterId: 1 }, db);
    expect(() => changeTalentRequestState(id, 'completed', db)).toThrow(/invalid transition/);
    changeTalentRequestState(id, 'accepted', db);
    expect(() => changeTalentRequestState(id, 'ready_for_review', db)).toThrow(/invalid transition/);
  });

  it('requires agreed assignee ratios to total exactly one', () => {
    const db = setup();
    const id = createTalentRequest({ title: '요청', problem: '시스템 문제', systemScopeReason: '여러 구성원이 반복해서 겪습니다.', requesterId: 1 }, db);
    changeTalentRequestState(id, 'accepted', db);
    expect(() => assignTalentRequest(id, [{ memberId: 2, ratio: 0.7 }, { memberId: 3, ratio: 0.2 }], db))
      .toThrow(/total exactly 1/);
  });

  it('awards exactly ten points once after requester-review state', () => {
    const db = setup();
    const id = requestReadyForReview(db);
    const completed = completeTalentRequest(id, '요청자가 실제 사용을 확인했습니다.', db) as unknown as { status: string; points: Array<{ points: number }> };
    expect(completed.status).toBe('completed');
    expect(completed.points.reduce((sum, point) => sum + point.points, 0)).toBe(10);
    expect(completed.points.map((point) => point.points)).toEqual([6, 4]);
    expect(() => completeTalentRequest(id, '다시 인정', db)).toThrow(TalentOfficeError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM contribution_points WHERE request_id=?').get(id)).toEqual({ count: 2 });
  });
});
