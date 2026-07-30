import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/lib/db/migrations';
import { withTransaction } from '@/lib/db/transaction';

const connections: Database.Database[] = [];
const MIGRATION_IDS = [
  '001_core_schema',
  '002_legacy_compatibility',
  '003_timestamp_compatibility',
  '004_material_file_cleanup_queue',
  '005_auth_sessions',
  '006_weekly_availability',
  '007_availability_after_ten',
  '008_next_week_availability_responses',
  '009_availability_week_history',
];
const CANONICAL_TABLES = [
  'audit_log',
  'auth_sessions',
  'availability_responses',
  'comments',
  'contribution_points',
  'inquiries',
  'material_file_cleanup_queue',
  'materials',
  'member_profiles',
  'members',
  'posts',
  'project_members',
  'projects',
  'reactions',
  'schema_migrations',
  'talent_request_assignees',
  'talent_requests',
  'wall_messages',
  'weekly_availability',
];

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  connections.push(db);
  return db;
}

function columnNames(db: Database.Database, table: string) {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name);
}

function legacyPartialDb() {
  const db = memoryDb();
  db.exec(`
    CREATE TABLE members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, api_key TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'student', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', goal TEXT NOT NULL DEFAULT '', current_stage TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '', next_milestone TEXT NOT NULL DEFAULT '', risk_level TEXT NOT NULL DEFAULT 'normal',
      pi_decision TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL REFERENCES members(id),
      did TEXT NOT NULL DEFAULT '', learned TEXT NOT NULL DEFAULT '', blocked TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL REFERENCES members(id), title TEXT NOT NULL
    );
    CREATE TABLE talent_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, requester_member_id INTEGER NOT NULL REFERENCES members(id),
      title TEXT NOT NULL, problem TEXT NOT NULL, expected_outcome TEXT NOT NULL,
      system_scope_reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted'
    );
    CREATE TABLE talent_request_assignees (
      request_id INTEGER NOT NULL REFERENCES talent_requests(id), member_id INTEGER NOT NULL REFERENCES members(id),
      PRIMARY KEY (request_id, member_id)
    );
    CREATE TABLE contribution_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL REFERENCES members(id),
      request_id INTEGER NOT NULL REFERENCES talent_requests(id), points REAL NOT NULL, reason TEXT NOT NULL,
      UNIQUE(member_id, request_id)
    );
    INSERT INTO members (id, name, password_hash, api_key) VALUES (7, 'legacy member', 'hash', 'key');
    INSERT INTO projects (id, title) VALUES (11, 'legacy project');
    INSERT INTO posts (id, author_id, did) VALUES (13, 7, 'legacy post');
    INSERT INTO materials (id, author_id, title) VALUES (17, 7, 'legacy material');
    INSERT INTO talent_requests
      (id, requester_member_id, title, problem, expected_outcome, system_scope_reason)
      VALUES (41, 7, 'legacy request', 'problem', 'outcome', 'reason');
    INSERT INTO talent_request_assignees (request_id, member_id) VALUES (41, 7);
    INSERT INTO contribution_points (id, member_id, request_id, points, reason)
      VALUES (43, 7, 41, 10, 'legacy award');
  `);
  return db;
}

afterEach(() => connections.splice(0).forEach((db) => db.close()));

describe('database transactions', () => {
  it('commits all writes when the callback succeeds', () => {
    const db = memoryDb();
    db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');

    const result = withTransaction(db, () => {
      db.prepare('INSERT INTO events (label) VALUES (?)').run('first');
      db.prepare('INSERT INTO events (label) VALUES (?)').run('second');
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(db.prepare('SELECT label FROM events ORDER BY id').all()).toEqual([{ label: 'first' }, { label: 'second' }]);
  });

  it('rolls back every write when the callback throws', () => {
    const db = memoryDb();
    db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');

    expect(() => withTransaction(db, () => {
      db.prepare('INSERT INTO events (label) VALUES (?)').run('partial');
      throw new Error('stop');
    })).toThrow('stop');

    expect(db.prepare('SELECT * FROM events').all()).toEqual([]);
  });
});

describe('canonical pre-deploy migrations', () => {
  it('bootstraps the complete BAI schema from a completely empty database', () => {
    const db = memoryDb();

    expect(runMigrations(db)).toEqual(MIGRATION_IDS);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all())
      .toEqual(CANONICAL_TABLES.map((name) => ({ name })));
    expect(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all())
      .toEqual(MIGRATION_IDS.map((id) => ({ id })));
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('retains the former Next talent constraints in the fresh canonical schema', () => {
    const db = memoryDb();
    runMigrations(db);
    db.prepare("INSERT INTO members (id, name, password_hash, api_key) VALUES (1, 'member', 'hash', 'key')").run();

    expect(() => db.prepare(`INSERT INTO talent_requests
      (id, requester_member_id, title, problem, expected_outcome, system_scope_reason, status)
      VALUES (1, 1, 'request', 'problem', 'outcome', 'reason', 'invalid')`).run())
      .toThrow(/check constraint/i);

    db.prepare(`INSERT INTO talent_requests
      (id, requester_member_id, title, problem, expected_outcome, system_scope_reason)
      VALUES (1, 1, 'request', 'problem', 'outcome', 'reason')`).run();
    expect(() => db.prepare(`INSERT INTO talent_request_assignees
      (request_id, member_id, allocation_ratio) VALUES (1, 1, 2)`).run())
      .toThrow(/check constraint/i);
    expect(() => db.prepare(`INSERT INTO contribution_points
      (request_id, member_id, points, reason) VALUES (1, 1, -5, 'invalid')`).run())
      .toThrow(/check constraint/i);

    db.prepare('INSERT INTO talent_request_assignees (request_id, member_id, allocation_ratio) VALUES (1, 1, 1)').run();
    db.prepare("INSERT INTO contribution_points (request_id, member_id, points, reason) VALUES (1, 1, 10, 'valid')").run();
    db.prepare('DELETE FROM talent_requests WHERE id=1').run();
    expect(db.prepare('SELECT COUNT(*) AS count FROM talent_request_assignees').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM contribution_points').get()).toEqual({ count: 0 });
  });

  it('installs a durable deduplicated material file cleanup queue', () => {
    const db = memoryDb();
    runMigrations(db);

    db.prepare(`INSERT INTO material_file_cleanup_queue
      (file_url, reason, attempts, last_error) VALUES (?, ?, ?, ?)`)
      .run('/uploads/materials/orphan.pdf', 'material_deleted', 2, 'EACCES');
    expect(db.prepare(`SELECT file_url,reason,attempts,last_error,next_attempt_at,lease_until,completed_at
      FROM material_file_cleanup_queue`).get()).toEqual({
      file_url: '/uploads/materials/orphan.pdf',
      reason: 'material_deleted',
      attempts: 2,
      last_error: 'EACCES',
      next_attempt_at: expect.any(String),
      lease_until: null,
      completed_at: null,
    });
    expect(() => db.prepare(`INSERT INTO material_file_cleanup_queue
      (file_url, reason) VALUES (?, ?)`).run('/uploads/materials/orphan.pdf', 'replacement'))
      .toThrow(/unique constraint/i);
  });

  it('installs revocable expiring Next sessions without changing existing members', () => {
    const db = memoryDb();
    runMigrations(db);
    db.prepare("INSERT INTO members (id,name,password_hash,api_key) VALUES (1,'member','hash','key')").run();
    db.prepare(`INSERT INTO auth_sessions (session_id,member_id,expires_at)
      VALUES ('session-id',1,1800000000000)`).run();

    expect(db.prepare('SELECT session_id,member_id,expires_at FROM auth_sessions').get()).toEqual({
      session_id: 'session-id', member_id: 1, expires_at: 1800000000000,
    });
    expect(() => db.prepare(`INSERT INTO auth_sessions (session_id,member_id,expires_at)
      VALUES ('other',999,1800000000000)`).run()).toThrow(/foreign key/i);
  });

  it('installs one-hour weekly availability slots owned by existing members', () => {
    const db = memoryDb();
    runMigrations(db);
    db.prepare("INSERT INTO members (id,name,password_hash,api_key) VALUES (1,'member','hash','key')").run();

    db.prepare(`INSERT INTO availability_responses (member_id,week_start,unavailable)
      VALUES (1,'2026-07-27',0)`).run();
    db.prepare(`INSERT INTO weekly_availability (member_id,week_start,day_of_week,hour)
      VALUES (1,'2026-07-27',0,10)`).run();
    expect(db.prepare('SELECT member_id,week_start,day_of_week,hour FROM weekly_availability').get()).toEqual({
      member_id: 1, week_start: '2026-07-27', day_of_week: 0, hour: 10,
    });
    expect(() => db.prepare(`INSERT INTO weekly_availability
      (member_id,week_start,day_of_week,hour) VALUES (1,'2026-07-27',5,10)`).run())
      .toThrow(/check constraint/i);
    expect(() => db.prepare(`INSERT INTO weekly_availability
      (member_id,week_start,day_of_week,hour) VALUES (1,'2026-07-27',0,24)`).run())
      .toThrow(/check constraint/i);
    expect(() => db.prepare(`INSERT INTO weekly_availability
      (member_id,week_start,day_of_week,hour) VALUES (1,'2026-07-27',0,10)`).run())
      .toThrow(/unique constraint/i);
    db.prepare('DELETE FROM members WHERE id=1').run();
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_availability').get()).toEqual({ count: 0 });
  });

  it('removes existing morning availability and enforces a 10:00 start', () => {
    const db = memoryDb();
    db.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (id,applied_at) VALUES
        ('001_core_schema','now'),('002_legacy_compatibility','now'),
        ('003_timestamp_compatibility','now'),('004_material_file_cleanup_queue','now'),
        ('005_auth_sessions','now'),('006_weekly_availability','now');
      CREATE TABLE members (id INTEGER PRIMARY KEY);
      INSERT INTO members (id) VALUES (1);
      CREATE TABLE weekly_availability (
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
        hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (member_id,day_of_week,hour)
      );
      CREATE INDEX weekly_availability_slot_idx
        ON weekly_availability (day_of_week,hour,member_id);
      INSERT INTO weekly_availability (member_id,day_of_week,hour) VALUES (1,0,9),(1,0,10);
    `);

    expect(runMigrations(db)).toEqual([
      '007_availability_after_ten', '008_next_week_availability_responses',
      '009_availability_week_history',
    ]);
    expect(db.prepare('SELECT week_start,day_of_week AS day,hour FROM weekly_availability').all())
      .toEqual([{ week_start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), day: 0, hour: 10 }]);
    const migratedWeek = (db.prepare('SELECT week_start FROM availability_responses WHERE member_id=1').get() as { week_start: string }).week_start;
    expect(() => db.prepare(`INSERT INTO weekly_availability
      (member_id,week_start,day_of_week,hour) VALUES (1,?,1,9)`).run(migratedWeek))
      .toThrow(/check constraint/i);
    expect(db.prepare('SELECT member_id,week_start,unavailable FROM availability_responses').get())
      .toEqual({ member_id: 1, week_start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), unavailable: 0 });
    expect(() => db.prepare(`INSERT INTO availability_responses
      (member_id,week_start,unavailable) VALUES (1,'2026-07-27',2)`).run())
      .toThrow(/check constraint/i);
  });

  it('preserves legacy rows and IDs while adding the complete compatibility-column union', () => {
    const db = legacyPartialDb();

    runMigrations(db);

    expect(columnNames(db, 'members')).toEqual(expect.arrayContaining(['status']));
    expect(columnNames(db, 'posts')).toEqual(expect.arrayContaining(['links', 'project_id']));
    expect(columnNames(db, 'materials')).toEqual(expect.arrayContaining([
      'body', 'url', 'category', 'guild', 'file_url', 'file_name', 'created_at', 'updated_at',
    ]));
    expect(columnNames(db, 'projects')).toEqual(expect.arrayContaining([
      'summary', 'slug', 'repo_url', 'site_url', 'owner_member_id',
    ]));
    expect(columnNames(db, 'talent_requests')).toEqual(expect.arrayContaining([
      'review_note', 'requires_approval', 'approval_reason', 'linked_project_id', 'solution_summary',
      'solution_url', 'completion_note', 'submitted_at', 'created_at', 'updated_at', 'completed_at',
    ]));
    expect(columnNames(db, 'talent_request_assignees')).toEqual(expect.arrayContaining([
      'role', 'allocation_ratio', 'assigned_at',
    ]));
    expect(columnNames(db, 'contribution_points')).toEqual(expect.arrayContaining(['awarded_at']));
    expect(db.prepare('SELECT id, name, status FROM members').get()).toEqual({ id: 7, name: 'legacy member', status: 'active' });
    expect(db.prepare('SELECT id, did, links, project_id FROM posts').get()).toEqual({ id: 13, did: 'legacy post', links: '', project_id: null });
    expect(db.prepare('SELECT id, title, body, file_url FROM materials').get()).toEqual({ id: 17, title: 'legacy material', body: '', file_url: '' });
    expect(db.prepare('SELECT id, title, summary FROM projects').get()).toEqual({ id: 11, title: 'legacy project', summary: '' });
    expect(db.prepare('SELECT id, title, completion_note FROM talent_requests').get()).toEqual({ id: 41, title: 'legacy request', completion_note: '' });
    expect(db.prepare('SELECT request_id, member_id, allocation_ratio FROM talent_request_assignees').get())
      .toEqual({ request_id: 41, member_id: 7, allocation_ratio: 1 });
    expect(db.prepare('SELECT id, member_id, request_id, points FROM contribution_points').get())
      .toEqual({ id: 43, member_id: 7, request_id: 41, points: 10 });
    expect(db.pragma('foreign_key_check')).toEqual([]);

    expect(() => db.prepare("UPDATE talent_requests SET status='invalid' WHERE id=41").run())
      .toThrow(/check constraint/i);
    expect(() => db.prepare('UPDATE talent_request_assignees SET allocation_ratio=2 WHERE request_id=41').run())
      .toThrow(/check constraint/i);
    expect(() => db.prepare('UPDATE contribution_points SET points=-5 WHERE id=43').run())
      .toThrow(/check constraint/i);
    db.prepare('DELETE FROM talent_requests WHERE id=41').run();
    expect(db.prepare('SELECT COUNT(*) AS count FROM talent_request_assignees').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM contribution_points').get()).toEqual({ count: 0 });
  });

  it('backfills legacy timestamps and installs working Python-compatible insert triggers', () => {
    const db = legacyPartialDb();
    db.exec(`CREATE TRIGGER talent_requests_fill_timestamps_after_insert
      AFTER INSERT ON talent_requests
      BEGIN
        SELECT 1;
      END`);
    runMigrations(db);

    const material = db.prepare('SELECT created_at, updated_at FROM materials WHERE id=17').get() as Record<string, string>;
    const request = db.prepare('SELECT submitted_at, created_at, updated_at FROM talent_requests WHERE id=41').get() as Record<string, string>;
    const assignee = db.prepare('SELECT assigned_at FROM talent_request_assignees WHERE request_id=41').get() as Record<string, string>;
    expect(material.created_at).not.toBe('');
    expect(material.updated_at).toBe(material.created_at);
    expect(request.submitted_at).not.toBe('');
    expect(request.created_at).toBe(request.submitted_at);
    expect(request.updated_at).toBe(request.submitted_at);
    expect(assignee.assigned_at).toBe(request.submitted_at);

    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).toEqual([
      { name: 'materials_fill_timestamps_after_insert' },
      { name: 'talent_assignees_fill_timestamp_after_insert' },
      { name: 'talent_requests_fill_timestamps_after_insert' },
    ]);

    db.prepare('INSERT INTO materials (id, author_id, title) VALUES (18, 7, ?)').run('new material');
    db.prepare(`INSERT INTO talent_requests
      (id, requester_member_id, title, problem, expected_outcome, system_scope_reason)
      VALUES (42, 7, 'new request', 'problem', 'outcome', 'reason')`).run();
    db.prepare('INSERT INTO talent_request_assignees (request_id, member_id) VALUES (42, 7)').run();
    const insertedMaterial = db.prepare('SELECT created_at, updated_at FROM materials WHERE id=18').get() as Record<string, string>;
    const insertedRequest = db.prepare('SELECT submitted_at, created_at, updated_at FROM talent_requests WHERE id=42').get() as Record<string, string>;
    const insertedAssignee = db.prepare('SELECT assigned_at FROM talent_request_assignees WHERE request_id=42').get() as Record<string, string>;
    expect(insertedMaterial.created_at).not.toBe('');
    expect(insertedMaterial.updated_at).toBe(insertedMaterial.created_at);
    expect(insertedRequest.submitted_at).not.toBe('');
    expect(insertedRequest.created_at).toBe(insertedRequest.submitted_at);
    expect(insertedRequest.updated_at).not.toBe('');
    expect(insertedAssignee.assigned_at).not.toBe('');
  });

  it('treats legacy SQLite column identifiers case-insensitively', () => {
    const db = memoryDb();
    db.exec('CREATE TABLE materials (id INTEGER PRIMARY KEY, BODY TEXT)');

    expect(() => runMigrations(db)).not.toThrow();
    expect(columnNames(db, 'materials').filter((name) => name.toLowerCase() === 'body')).toHaveLength(1);
  });

  it('commits earlier migrations but rolls back the failing migration DDL and ledger row', () => {
    const db = legacyPartialDb();
    db.exec(`CREATE TRIGGER force_timestamp_failure
      BEFORE UPDATE OF created_at ON materials
      BEGIN
        SELECT RAISE(ABORT, 'forced timestamp failure');
      END`);

    expect(() => runMigrations(db)).toThrow(/forced timestamp failure/i);
    expect(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all()).toEqual([
      { id: '001_core_schema' },
      { id: '002_legacy_compatibility' },
    ]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='materials_fill_timestamps_after_insert'").get())
      .toBeUndefined();
    expect(db.prepare('SELECT created_at FROM materials WHERE id=17').get()).toEqual({ created_at: '' });
  });

  it('rolls back the ledger table and all new DDL when the first migration fails', () => {
    const db = memoryDb();
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE members (id INTEGER PRIMARY KEY);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES members(id));
      INSERT INTO posts (id, author_id) VALUES (1, 999);
    `);
    db.pragma('foreign_keys = ON');

    expect(() => runMigrations(db)).toThrow(/001_core_schema.*foreign_key_check/i);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get())
      .toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='materials'").get())
      .toBeUndefined();
  });

  it('rolls back every compatibility change when legacy talent data violates canonical constraints', () => {
    const db = legacyPartialDb();
    db.prepare("UPDATE talent_requests SET status='invalid' WHERE id=41").run();

    expect(() => runMigrations(db)).toThrow(/check constraint/i);
    expect(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all()).toEqual([{ id: '001_core_schema' }]);
    expect(columnNames(db, 'talent_requests')).not.toContain('completion_note');
    expect(db.prepare('SELECT id, status FROM talent_requests WHERE id=41').get()).toEqual({ id: 41, status: 'invalid' });
    expect(db.prepare('SELECT request_id, member_id FROM talent_request_assignees').get()).toEqual({ request_id: 41, member_id: 7 });
    expect(db.prepare('SELECT id, request_id FROM contribution_points').get()).toEqual({ id: 43, request_id: 41 });
  });

  it('preserves AUTOINCREMENT high-water marks across the talent table rebuild', () => {
    const db = legacyPartialDb();
    db.prepare("UPDATE sqlite_sequence SET seq=900 WHERE name='talent_requests'").run();
    db.prepare("UPDATE sqlite_sequence SET seq=950 WHERE name='contribution_points'").run();
    runMigrations(db);

    const request = db.prepare(`INSERT INTO talent_requests
      (requester_member_id, title, problem, expected_outcome, system_scope_reason)
      VALUES (7, 'next request', 'problem', 'outcome', 'reason')`).run();
    const points = db.prepare(`INSERT INTO contribution_points
      (request_id, member_id, points, reason) VALUES (?, 7, 10, 'next award')`).run(request.lastInsertRowid);
    expect(Number(request.lastInsertRowid)).toBe(901);
    expect(Number(points.lastInsertRowid)).toBe(951);
  });

  it('applies zero migrations on a second run without duplicating or changing data', () => {
    const db = legacyPartialDb();
    expect(runMigrations(db)).toEqual(MIGRATION_IDS);
    const before = {
      ledger: db.prepare('SELECT * FROM schema_migrations ORDER BY id').all(),
      members: db.prepare('SELECT * FROM members ORDER BY id').all(),
      materials: db.prepare('SELECT * FROM materials ORDER BY id').all(),
      requests: db.prepare('SELECT * FROM talent_requests ORDER BY id').all(),
      assignees: db.prepare('SELECT * FROM talent_request_assignees ORDER BY request_id, member_id').all(),
      points: db.prepare('SELECT * FROM contribution_points ORDER BY id').all(),
    };

    expect(runMigrations(db)).toEqual([]);
    expect({
      ledger: db.prepare('SELECT * FROM schema_migrations ORDER BY id').all(),
      members: db.prepare('SELECT * FROM members ORDER BY id').all(),
      materials: db.prepare('SELECT * FROM materials ORDER BY id').all(),
      requests: db.prepare('SELECT * FROM talent_requests ORDER BY id').all(),
      assignees: db.prepare('SELECT * FROM talent_request_assignees ORDER BY request_id, member_id').all(),
      points: db.prepare('SELECT * FROM contribution_points ORDER BY id').all(),
    }).toEqual(before);
  });

  it('keeps schema DDL out of request-path modules', () => {
    const dbSource = readFileSync(new URL('../../src/lib/db.ts', import.meta.url), 'utf8');
    const talentRepositorySource = readFileSync(
      new URL('../../src/lib/db/repositories/talent-office.ts', import.meta.url), 'utf8',
    );
    const talentServiceSource = readFileSync(
      new URL('../../src/lib/services/talent-office.ts', import.meta.url), 'utf8',
    );
    for (const source of [dbSource, talentRepositorySource, talentServiceSource]) {
      expect(source).not.toMatch(/\b(?:CREATE|ALTER)\s+TABLE\b/i);
      expect(source).not.toMatch(/ensure(?:Column|WallSchema|TalentOfficeSchema)/);
    }
  });
});
