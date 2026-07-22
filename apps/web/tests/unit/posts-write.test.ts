import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { toggleThumbsup } from '@/lib/db/repositories/posts';

describe('post write repository', () => {
  it('counts only thumbsup reactions while preserving other reaction kinds', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        UNIQUE(post_id, member_id, kind)
      );`);
      db.prepare("INSERT INTO reactions (post_id,member_id,kind) VALUES (100,2,'clap')").run();

      expect(toggleThumbsup(db, 100, 1)).toBe(1);
      expect(toggleThumbsup(db, 100, 1)).toBe(0);
      expect(db.prepare('SELECT member_id,kind FROM reactions').all()).toEqual([
        { member_id: 2, kind: 'clap' },
      ]);
    } finally {
      db.close();
    }
  });
});
