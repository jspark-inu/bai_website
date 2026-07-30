import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '@/lib/db/migrations';
import {
  readAvailabilityForMember,
  readAvailabilityResponseForMember,
  readAvailabilitySummary,
  replaceAvailabilityInTransaction,
} from '@/lib/db/repositories/availability';
import {
  AvailabilityInputError,
  nextWeekWindow,
  parseAvailabilityPayload,
} from '@/lib/services/availability';

function testDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.exec(`
    INSERT INTO members (id,name,password_hash,api_key,role,status) VALUES
      (1,'김학생','hash','key-1','student','active'),
      (2,'이학생','hash','key-2','student','active'),
      (3,'박교수','hash','key-3','pi','active'),
      (4,'비활성','hash','key-4','student','disabled');
  `);
  return db;
}

describe('weekly availability domain', () => {
  it('normalizes unique one-hour slots and rejects invalid coordinates', () => {
    expect(parseAvailabilityPayload({ weekStart: '2026-07-27', unavailable: false, slots: [
      { day: 2, hour: 18 }, { day: 0, hour: 10 }, { day: 2, hour: 18 },
    ] })).toEqual({
      weekStart: '2026-07-27',
      unavailable: false,
      slots: [{ day: 0, hour: 10 }, { day: 2, hour: 18 }],
    });
    expect(parseAvailabilityPayload({ weekStart: '2026-07-27', unavailable: true, slots: [] })).toEqual({
      weekStart: '2026-07-27', unavailable: true, slots: [],
    });

    for (const payload of [
      {},
      { slots: '0-9' },
      { weekStart: '2026-07-27', slots: [{ day: 5, hour: 9 }] },
      { weekStart: '2026-07-27', slots: [{ day: 6, hour: 9 }] },
      { weekStart: '2026-07-27', slots: [{ day: 7, hour: 9 }] },
      { weekStart: '2026-07-27', slots: [{ day: 0, hour: 9 }] },
      { weekStart: '2026-07-27', slots: [{ day: 0, hour: 24 }] },
      { weekStart: '2026-07-27', slots: [{ day: 0.5, hour: 9 }] },
      { weekStart: '2026-07-27', unavailable: true, slots: [{ day: 0, hour: 10 }] },
    ]) {
      expect(() => parseAvailabilityPayload(payload)).toThrow(AvailabilityInputError);
    }
  });

  it('targets the next Korean calendar week instead of a repeating schedule', () => {
    expect(nextWeekWindow(new Date('2026-07-23T12:00:00Z'))).toEqual({
      start: '2026-07-27',
      end: '2026-07-31',
      days: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'],
    });
    expect(nextWeekWindow(new Date('2026-07-26T16:00:00Z')).start).toBe('2026-08-03');
  });

  it('replaces only the signed-in member slots, including clearing all slots', () => {
    const db = testDb();
    const weekStart = '2026-07-27';
    try {
      expect(replaceAvailabilityInTransaction(db, 1, weekStart, [
        { day: 0, hour: 10 }, { day: 2, hour: 18 },
      ], false)).toBe(true);
      expect(readAvailabilityForMember(db, 1, weekStart)).toEqual([
        { day: 0, hour: 10 }, { day: 2, hour: 18 },
      ]);
      expect(readAvailabilityResponseForMember(db, 1, weekStart)).toEqual({
        responded: true, unavailable: false,
      });
      expect(readAvailabilityForMember(db, 1, '2026-08-03')).toEqual([]);
      expect(readAvailabilityResponseForMember(db, 1, '2026-08-03')).toEqual({
        responded: false, unavailable: false,
      });

      expect(replaceAvailabilityInTransaction(db, 2, weekStart, [], true)).toBe(true);
      expect(readAvailabilityForMember(db, 2, weekStart)).toEqual([]);
      expect(readAvailabilityResponseForMember(db, 2, weekStart)).toEqual({
        responded: true, unavailable: true,
      });
      expect(replaceAvailabilityInTransaction(db, 4, weekStart, [], true)).toBe(false);
    } finally {
      db.close();
    }
  });

  it('keeps each member response and slots when a later week is submitted', () => {
    const db = testDb();
    try {
      expect(replaceAvailabilityInTransaction(db, 1, '2026-07-27', [
        { day: 0, hour: 10 },
      ], false)).toBe(true);
      expect(replaceAvailabilityInTransaction(db, 1, '2026-08-03', [
        { day: 2, hour: 18 },
      ], false)).toBe(true);

      expect(readAvailabilityResponseForMember(db, 1, '2026-07-27')).toEqual({
        responded: true, unavailable: false,
      });
      expect(readAvailabilityForMember(db, 1, '2026-07-27')).toEqual([
        { day: 0, hour: 10 },
      ]);
      expect(readAvailabilityResponseForMember(db, 1, '2026-08-03')).toEqual({
        responded: true, unavailable: false,
      });
      expect(readAvailabilityForMember(db, 1, '2026-08-03')).toEqual([
        { day: 2, hour: 18 },
      ]);
    } finally {
      db.close();
    }
  });

  it('builds a PI summary from active members and names for each overlapping slot', () => {
    const db = testDb();
    const weekStart = '2026-07-27';
    try {
      replaceAvailabilityInTransaction(db, 1, weekStart, [{ day: 0, hour: 10 }], false);
      replaceAvailabilityInTransaction(db, 2, weekStart, [
        { day: 0, hour: 10 }, { day: 1, hour: 11 },
      ], false);
      replaceAvailabilityInTransaction(db, 3, weekStart, [], true);

      expect(readAvailabilitySummary(db, weekStart)).toEqual({
        memberCount: 3,
        respondedCount: 3,
        unavailableCount: 1,
        unavailableNames: ['박교수'],
        slots: [
          { day: 0, hour: 10, count: 2, names: ['김학생', '이학생'] },
          { day: 1, hour: 11, count: 1, names: ['이학생'] },
        ],
      });
    } finally {
      db.close();
    }
  });
});
