import type Database from 'better-sqlite3';
import { openWriteDb } from './client.ts';
import { withTransaction } from './transaction.ts';

type Migration = {
  id: string;
  up: (conn: Database.Database) => void;
};

type Column = { table: string; name: string; declaration: string };

function addMissingColumns(conn: Database.Database, columns: readonly Column[]) {
  for (const column of columns) {
    const existing = conn.pragma(`table_info(${column.table})`) as Array<{ name: string }>;
    if (!existing.some((item) => item.name.toLowerCase() === column.name.toLowerCase())) {
      // All identifiers and declarations are defined in this module; no user input is interpolated.
      conn.exec(`ALTER TABLE ${column.table} ADD COLUMN ${column.name} ${column.declaration}`);
    }
  }
}

// These identifiers are internal migration constants. Keeping the canonical
// talent DDL in factories prevents fresh and legacy-rebuild schemas drifting.
function talentRequestTableSql(table: string, ifNotExists = false) {
  return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${table} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_member_id INTEGER NOT NULL REFERENCES members(id),
    title TEXT NOT NULL,
    problem TEXT NOT NULL,
    expected_outcome TEXT NOT NULL,
    system_scope_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted'
      CHECK (status IN ('submitted','accepted','declined','approval_required','assigned','ready_for_review','changes_requested','completed')),
    review_note TEXT NOT NULL DEFAULT '',
    requires_approval INTEGER NOT NULL DEFAULT 0,
    approval_reason TEXT NOT NULL DEFAULT '',
    linked_project_id INTEGER REFERENCES projects(id),
    solution_summary TEXT NOT NULL DEFAULT '',
    solution_url TEXT NOT NULL DEFAULT '',
    completion_note TEXT NOT NULL DEFAULT '',
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );`;
}

function talentChildTablesSql(
  requestTable: string,
  assigneeTable: string,
  pointsTable: string,
  ifNotExists = false,
) {
  const guard = ifNotExists ? 'IF NOT EXISTS ' : '';
  return `
    CREATE TABLE ${guard}${assigneeTable} (
      request_id INTEGER NOT NULL REFERENCES ${requestTable}(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id),
      role TEXT NOT NULL DEFAULT '',
      allocation_ratio REAL NOT NULL DEFAULT 1.0
        CHECK (allocation_ratio > 0 AND allocation_ratio <= 1),
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (request_id, member_id)
    );
    CREATE TABLE ${guard}${pointsTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      request_id INTEGER NOT NULL REFERENCES ${requestTable}(id) ON DELETE CASCADE,
      points REAL NOT NULL CHECK (points > 0),
      reason TEXT NOT NULL,
      awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(member_id, request_id)
    );`;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: '001_core_schema',
    up(conn) {
      // Canonical port of backend/lab_feed_db.py SCHEMA. IF NOT EXISTS is
      // intentional: compatibility upgrades must retain existing tables and IDs.
      conn.exec(`
        CREATE TABLE IF NOT EXISTS members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          api_key TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id INTEGER NOT NULL REFERENCES members(id),
          did TEXT NOT NULL DEFAULT '',
          learned TEXT NOT NULL DEFAULT '',
          blocked TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '',
          links TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'web',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL REFERENCES posts(id),
          author_id INTEGER NOT NULL REFERENCES members(id),
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS reactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL REFERENCES posts(id),
          member_id INTEGER NOT NULL REFERENCES members(id),
          kind TEXT NOT NULL DEFAULT 'thumbsup',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(post_id, member_id, kind)
        );
        CREATE TABLE IF NOT EXISTS member_profiles (
          member_id INTEGER PRIMARY KEY REFERENCES members(id),
          grade TEXT NOT NULL DEFAULT '',
          participation TEXT NOT NULL DEFAULT '',
          interests TEXT NOT NULL DEFAULT '',
          semester_goal TEXT NOT NULL DEFAULT '',
          load_status TEXT NOT NULL DEFAULT 'unknown',
          advisor_memo TEXT NOT NULL DEFAULT '',
          next_action TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          goal TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          slug TEXT NOT NULL DEFAULT '',
          repo_url TEXT NOT NULL DEFAULT '',
          site_url TEXT NOT NULL DEFAULT '',
          owner_member_id INTEGER REFERENCES members(id),
          current_stage TEXT NOT NULL DEFAULT '',
          deadline TEXT NOT NULL DEFAULT '',
          next_milestone TEXT NOT NULL DEFAULT '',
          risk_level TEXT NOT NULL DEFAULT 'normal',
          pi_decision TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS project_members (
          project_id INTEGER NOT NULL REFERENCES projects(id),
          member_id INTEGER NOT NULL REFERENCES members(id),
          role TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (project_id, member_id)
        );
        CREATE TABLE IF NOT EXISTS inquiries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id INTEGER NOT NULL REFERENCES members(id),
          question TEXT NOT NULL,
          answer TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          answered_at TEXT,
          answered_by INTEGER REFERENCES members(id)
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id INTEGER REFERENCES members(id),
          target_member_id INTEGER REFERENCES members(id),
          action TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS materials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id INTEGER NOT NULL REFERENCES members(id),
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '자료',
          guild TEXT NOT NULL DEFAULT '',
          file_url TEXT NOT NULL DEFAULT '',
          file_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS wall_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id INTEGER NOT NULL REFERENCES members(id),
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ${talentRequestTableSql('talent_requests', true)}
        ${talentChildTablesSql(
          'talent_requests',
          'talent_request_assignees',
          'contribution_points',
          true,
        )}
      `);
    },
  },
  {
    id: '002_legacy_compatibility',
    up(conn) {
      // Union of Python init_schema additions and the former Next request-path helpers.
      addMissingColumns(conn, [
        { table: 'members', name: 'status', declaration: "TEXT NOT NULL DEFAULT 'active'" },
        { table: 'posts', name: 'links', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'posts', name: 'project_id', declaration: 'INTEGER REFERENCES projects(id)' },
        { table: 'materials', name: 'body', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'materials', name: 'url', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'materials', name: 'category', declaration: "TEXT NOT NULL DEFAULT '자료'" },
        { table: 'materials', name: 'guild', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'materials', name: 'file_url', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'materials', name: 'file_name', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'materials', name: 'created_at', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'materials', name: 'updated_at', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'projects', name: 'summary', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'projects', name: 'slug', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'projects', name: 'repo_url', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'projects', name: 'site_url', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'projects', name: 'owner_member_id', declaration: 'INTEGER REFERENCES members(id)' },
        { table: 'talent_requests', name: 'review_note', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'requires_approval', declaration: 'INTEGER NOT NULL DEFAULT 0' },
        { table: 'talent_requests', name: 'approval_reason', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'linked_project_id', declaration: 'INTEGER REFERENCES projects(id)' },
        { table: 'talent_requests', name: 'solution_summary', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'solution_url', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'completion_note', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'submitted_at', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'created_at', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'updated_at', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_requests', name: 'completed_at', declaration: 'TEXT' },
        { table: 'talent_request_assignees', name: 'role', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'talent_request_assignees', name: 'allocation_ratio', declaration: 'REAL NOT NULL DEFAULT 1.0' },
        { table: 'talent_request_assignees', name: 'assigned_at', declaration: "TEXT NOT NULL DEFAULT ''" },
        { table: 'contribution_points', name: 'awarded_at', declaration: "TEXT NOT NULL DEFAULT ''" },
      ]);

      conn.exec(`
        CREATE TEMP TABLE _migration_talent_assignees AS
          SELECT request_id, member_id, role, allocation_ratio, assigned_at
          FROM talent_request_assignees;
        CREATE TEMP TABLE _migration_contribution_points AS
          SELECT id, member_id, request_id, points, reason, awarded_at
          FROM contribution_points;
        CREATE TEMP TABLE _migration_talent_sequences AS
          SELECT name, seq FROM sqlite_sequence
          WHERE name IN ('talent_requests', 'contribution_points');

        ${talentRequestTableSql('_migration_talent_requests')}
        INSERT INTO _migration_talent_requests (
          id, requester_member_id, title, problem, expected_outcome,
          system_scope_reason, status, review_note, requires_approval,
          approval_reason, linked_project_id, solution_summary, solution_url,
          completion_note, submitted_at, created_at, updated_at, completed_at
        )
        SELECT
          id, requester_member_id, title, problem, expected_outcome,
          system_scope_reason, status, review_note, requires_approval,
          approval_reason, linked_project_id, solution_summary, solution_url,
          completion_note, submitted_at, created_at, updated_at, completed_at
        FROM talent_requests;

        DROP TABLE talent_request_assignees;
        DROP TABLE contribution_points;
        DROP TABLE talent_requests;
        ALTER TABLE _migration_talent_requests RENAME TO talent_requests;

        ${talentChildTablesSql(
          'talent_requests',
          'talent_request_assignees',
          'contribution_points',
        )}
        INSERT INTO talent_request_assignees (
          request_id, member_id, role, allocation_ratio, assigned_at
        )
        SELECT request_id, member_id, role, allocation_ratio, assigned_at
        FROM _migration_talent_assignees;
        INSERT INTO contribution_points (
          id, member_id, request_id, points, reason, awarded_at
        )
        SELECT id, member_id, request_id, points, reason, awarded_at
        FROM _migration_contribution_points;

        DELETE FROM sqlite_sequence
        WHERE name IN ('talent_requests', 'contribution_points');
        INSERT INTO sqlite_sequence (name, seq)
          SELECT name, seq FROM _migration_talent_sequences;
        DROP TABLE _migration_talent_assignees;
        DROP TABLE _migration_contribution_points;
        DROP TABLE _migration_talent_sequences;
      `);
    },
  },
  {
    id: '003_timestamp_compatibility',
    up(conn) {
      conn.exec(`
        DROP TRIGGER IF EXISTS materials_fill_timestamps_after_insert;
        DROP TRIGGER IF EXISTS talent_requests_fill_timestamps_after_insert;
        DROP TRIGGER IF EXISTS talent_assignees_fill_timestamp_after_insert;

        UPDATE materials
        SET created_at=datetime('now')
        WHERE created_at IS NULL OR TRIM(created_at)='';
        UPDATE materials
        SET updated_at=created_at
        WHERE updated_at IS NULL OR TRIM(updated_at)='';

        UPDATE talent_requests
        SET submitted_at=COALESCE(NULLIF(created_at,''), NULLIF(updated_at,''), datetime('now'))
        WHERE submitted_at IS NULL OR TRIM(submitted_at)='';
        UPDATE talent_requests
        SET created_at=COALESCE(NULLIF(submitted_at,''), NULLIF(updated_at,''), datetime('now'))
        WHERE created_at IS NULL OR TRIM(created_at)='';
        UPDATE talent_requests
        SET updated_at=COALESCE(NULLIF(updated_at,''), NULLIF(submitted_at,''), datetime('now'))
        WHERE updated_at IS NULL OR TRIM(updated_at)='';
        UPDATE talent_request_assignees
        SET assigned_at=COALESCE(
          (SELECT tr.submitted_at FROM talent_requests tr WHERE tr.id=talent_request_assignees.request_id),
          datetime('now')
        )
        WHERE assigned_at IS NULL OR TRIM(assigned_at)='';

        CREATE TRIGGER IF NOT EXISTS materials_fill_timestamps_after_insert
        AFTER INSERT ON materials
        WHEN NEW.created_at IS NULL OR NEW.created_at='' OR
             NEW.updated_at IS NULL OR NEW.updated_at=''
        BEGIN
          UPDATE materials
          SET created_at=COALESCE(NULLIF(NEW.created_at,''), datetime('now')),
              updated_at=COALESCE(NULLIF(NEW.updated_at,''), NULLIF(NEW.created_at,''), datetime('now'))
          WHERE id=NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS talent_requests_fill_timestamps_after_insert
        AFTER INSERT ON talent_requests
        WHEN NEW.submitted_at IS NULL OR NEW.submitted_at='' OR
             NEW.created_at IS NULL OR NEW.created_at='' OR
             NEW.updated_at IS NULL OR NEW.updated_at=''
        BEGIN
          UPDATE talent_requests
          SET submitted_at=COALESCE(NULLIF(NEW.submitted_at,''), NULLIF(NEW.created_at,''), datetime('now')),
              created_at=COALESCE(NULLIF(NEW.created_at,''), NULLIF(NEW.submitted_at,''), datetime('now')),
              updated_at=COALESCE(
                NULLIF(NEW.updated_at,''),
                NULLIF(NEW.submitted_at,''),
                NULLIF(NEW.created_at,''),
                datetime('now')
              )
          WHERE id=NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS talent_assignees_fill_timestamp_after_insert
        AFTER INSERT ON talent_request_assignees
        WHEN NEW.assigned_at IS NULL OR NEW.assigned_at=''
        BEGIN
          UPDATE talent_request_assignees
          SET assigned_at=datetime('now')
          WHERE request_id=NEW.request_id AND member_id=NEW.member_id;
        END;
      `);
    },
  },
  {
    id: '004_material_file_cleanup_queue',
    up(conn) {
      conn.exec(`
        CREATE TABLE material_file_cleanup_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_url TEXT NOT NULL UNIQUE
            CHECK (file_url LIKE '/uploads/materials/%'),
          reason TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
          last_error TEXT NOT NULL DEFAULT '',
          next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
          lease_until TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
        );
        CREATE INDEX material_file_cleanup_pending_idx
          ON material_file_cleanup_queue (completed_at, next_attempt_at, lease_until, id);
      `);
    },
  },
  {
    id: '005_auth_sessions',
    up(conn) {
      conn.exec(`
        CREATE TABLE auth_sessions (
          session_id TEXT PRIMARY KEY,
          member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);
        CREATE INDEX auth_sessions_member_idx ON auth_sessions (member_id);
      `);
    },
  },
  {
    id: '006_weekly_availability',
    up(conn) {
      conn.exec(`
        CREATE TABLE weekly_availability (
          member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
          hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (member_id, day_of_week, hour)
        );
        CREATE INDEX weekly_availability_slot_idx
          ON weekly_availability (day_of_week, hour, member_id);
      `);
    },
  },
  {
    id: '007_availability_after_ten',
    up(conn) {
      conn.exec(`
        ALTER TABLE weekly_availability RENAME TO weekly_availability_before_ten;
        CREATE TABLE weekly_availability (
          member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
          hour INTEGER NOT NULL CHECK (hour BETWEEN 10 AND 23),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (member_id, day_of_week, hour)
        );
        INSERT INTO weekly_availability (member_id,day_of_week,hour,updated_at)
          SELECT member_id,day_of_week,hour,updated_at
          FROM weekly_availability_before_ten
          WHERE hour >= 10;
        DROP TABLE weekly_availability_before_ten;
        CREATE INDEX weekly_availability_slot_idx
          ON weekly_availability (day_of_week, hour, member_id);
      `);
    },
  },
];

export const MIGRATION_IDS = MIGRATIONS.map(({ id }) => id) as readonly string[];

export function runMigrations(supplied?: Database.Database) {
  const conn = supplied ?? openWriteDb();
  const shouldClose = supplied === undefined;
  const applied: string[] = [];
  try {
    const ledgerExists = conn.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    ).get();
    const recorded = new Set(
      ledgerExists
        ? (conn.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map((row) => row.id)
        : [],
    );

    for (const migration of MIGRATIONS) {
      if (recorded.has(migration.id)) continue;
      withTransaction(conn, () => {
        conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        )`);
        migration.up(conn);
        const violations = conn.pragma('foreign_key_check') as unknown[];
        if (violations.length) throw new Error(`migration ${migration.id} failed foreign_key_check`);
        conn.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, datetime('now'))").run(migration.id);
      });
      applied.push(migration.id);
    }
    return applied;
  } finally {
    if (shouldClose) conn.close();
  }
}
