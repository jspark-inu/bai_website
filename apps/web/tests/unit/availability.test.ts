import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '@/lib/db/migrations';
import {
  readAvailabilityForMember,
  readAvailabilitySummary,
  replaceAvailabilityInTransaction,
} from '@/lib/db/repositories/availability';
import { AvailabilityInputError, parseAvailabilityPayload } from '@/lib/services/availability';

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
    expect(parseAvailabilityPayload({ slots: [
      { day: 2, hour: 18 }, { day: 0, hour: 9 }, { day: 2, hour: 18 },
    ] })).toEqual([
      { day: 0, hour: 9 }, { day: 2, hour: 18 },
    ]);

    for (const payload of [
      {},
      { slots: '0-9' },
      { slots: [{ day: 7, hour: 9 }] },
      { slots: [{ day: 0, hour: 24 }] },
      { slots: [{ day: 0.5, hour: 9 }] },
    ]) {
      expect(() => parseAvailabilityPayload(payload)).toThrow(AvailabilityInputError);
    }
  });

  it('replaces only the signed-in member slots, including clearing all slots', () => {
    const db = testDb();
    try {
      db.prepare('INSERT INTO weekly_availability (member_id,day_of_week,hour) VALUES (2,1,10)').run();

      expect(replaceAvailabilityInTransaction(db, 1, [
        { day: 0, hour: 9 }, { day: 2, hour: 18 },
      ])).toBe(true);
      expect(readAvailabilityForMember(db, 1)).toEqual([
        { day: 0, hour: 9 }, { day: 2, hour: 18 },
      ]);
      expect(readAvailabilityForMember(db, 2)).toEqual([{ day: 1, hour: 10 }]);

      expect(replaceAvailabilityInTransaction(db, 1, [])).toBe(true);
      expect(readAvailabilityForMember(db, 1)).toEqual([]);
      expect(replaceAvailabilityInTransaction(db, 4, [{ day: 0, hour: 9 }])).toBe(false);
    } finally {
      db.close();
    }
  });

  it('builds a PI summary from active members and names for each overlapping slot', () => {
    const db = testDb();
    try {
      db.exec(`
        INSERT INTO weekly_availability (member_id,day_of_week,hour) VALUES
          (1,0,9),(2,0,9),(2,1,10),(3,0,9),(4,0,9);
      `);

      expect(readAvailabilitySummary(db)).toEqual({
        memberCount: 3,
        respondedCount: 3,
        slots: [
          { day: 0, hour: 9, count: 3, names: ['김학생', '박교수', '이학생'] },
          { day: 1, hour: 10, count: 1, names: ['이학생'] },
        ],
      });
    } finally {
      db.close();
    }
  });
});
