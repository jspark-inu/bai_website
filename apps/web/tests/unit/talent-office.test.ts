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
  )`);
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
