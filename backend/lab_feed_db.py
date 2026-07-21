import sqlite3

SQLITE_BUSY_TIMEOUT_MS = 10_000

SCHEMA = """
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
CREATE TABLE IF NOT EXISTS talent_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_member_id INTEGER NOT NULL REFERENCES members(id),
    title TEXT NOT NULL,
    problem TEXT NOT NULL,
    expected_outcome TEXT NOT NULL,
    system_scope_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
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
);
CREATE TABLE IF NOT EXISTS talent_request_assignees (
    request_id INTEGER NOT NULL REFERENCES talent_requests(id),
    member_id INTEGER NOT NULL REFERENCES members(id),
    role TEXT NOT NULL DEFAULT '',
    allocation_ratio REAL NOT NULL DEFAULT 1.0,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (request_id, member_id)
);
CREATE TABLE IF NOT EXISTS contribution_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id),
    request_id INTEGER NOT NULL REFERENCES talent_requests(id),
    points REAL NOT NULL,
    reason TEXT NOT NULL,
    awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(member_id, request_id)
);
"""


class LabFeedDB:
    def __init__(self, db_path):
        self.db_path = db_path

    def _conn(self):
        conn = sqlite3.connect(
            self.db_path,
            timeout=SQLITE_BUSY_TIMEOUT_MS / 1000,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = %d" % SQLITE_BUSY_TIMEOUT_MS)
        return conn

    def health_check(self):
        """Verify that the configured BAI database is readable and coherent."""
        conn = self._conn()
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            missing = {"members", "posts"} - tables
            if missing:
                raise RuntimeError("missing core tables: %s" % ", ".join(sorted(missing)))
            if conn.execute("PRAGMA quick_check(1)").fetchone()[0] != "ok":
                raise RuntimeError("SQLite quick_check failed")
            if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("SQLite foreign_key_check failed")
            conn.execute("SELECT id FROM members LIMIT 1").fetchone()
            conn.execute("SELECT id FROM posts LIMIT 1").fetchone()
        finally:
            conn.close()

    def init_schema(self):
        conn = self._conn()
        try:
            # executescript normally commits before it starts. Put the complete
            # create/upgrade sequence inside one explicit transaction so a
            # failed compatibility migration cannot leave a half-upgraded DB.
            conn.executescript("BEGIN IMMEDIATE;\n" + SCHEMA)
            self._ensure_column(conn, "members", "status", "TEXT NOT NULL DEFAULT 'active'")
            self._ensure_column(conn, "posts", "links", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "posts", "project_id", "INTEGER REFERENCES projects(id)")
            self._ensure_column(conn, "materials", "body", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "materials", "url", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "materials", "category", "TEXT NOT NULL DEFAULT '자료'")
            self._ensure_column(conn, "materials", "guild", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "materials", "file_url", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "materials", "file_name", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "materials", "created_at", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "materials", "updated_at", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "projects", "summary", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "projects", "slug", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "projects", "repo_url", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "projects", "site_url", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "projects", "owner_member_id", "INTEGER REFERENCES members(id)")
            # Next can be the first process to create these tables. Its schema
            # intentionally contains a few different metadata columns; add the
            # Flask-required superset without rebuilding tables or changing IDs.
            self._ensure_column(conn, "talent_requests", "review_note", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "talent_requests", "requires_approval", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(conn, "talent_requests", "approval_reason", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "talent_requests", "linked_project_id", "INTEGER REFERENCES projects(id)")
            self._ensure_column(conn, "talent_requests", "completion_note", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "talent_requests", "submitted_at", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "talent_requests", "created_at", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "talent_request_assignees", "role", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "talent_request_assignees", "assigned_at", "TEXT NOT NULL DEFAULT ''")

            conn.execute(
                "UPDATE materials SET created_at=datetime('now') "
                "WHERE created_at IS NULL OR TRIM(created_at)=''"
            )
            conn.execute(
                "UPDATE materials SET updated_at=created_at "
                "WHERE updated_at IS NULL OR TRIM(updated_at)=''"
            )
            conn.execute(
                "UPDATE talent_requests SET submitted_at="
                "COALESCE(NULLIF(created_at,''), NULLIF(updated_at,''), datetime('now')) "
                "WHERE submitted_at IS NULL OR TRIM(submitted_at)=''"
            )
            conn.execute(
                "UPDATE talent_requests SET created_at="
                "COALESCE(NULLIF(submitted_at,''), NULLIF(updated_at,''), datetime('now')) "
                "WHERE created_at IS NULL OR TRIM(created_at)=''"
            )
            conn.execute(
                "UPDATE talent_request_assignees SET assigned_at="
                "COALESCE((SELECT tr.submitted_at FROM talent_requests tr "
                "WHERE tr.id=talent_request_assignees.request_id), datetime('now')) "
                "WHERE assigned_at IS NULL OR TRIM(assigned_at)=''"
            )

            # ALTER TABLE cannot add a non-constant datetime default. These
            # triggers give upgraded DBs the same behavior as newly-created DBs
            # for inserts made by either the Flask or Next process.
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS materials_fill_timestamps_after_insert
                AFTER INSERT ON materials
                WHEN NEW.created_at IS NULL OR NEW.created_at='' OR
                     NEW.updated_at IS NULL OR NEW.updated_at=''
                BEGIN
                    UPDATE materials
                    SET created_at=COALESCE(NULLIF(NEW.created_at,''), datetime('now')),
                        updated_at=COALESCE(NULLIF(NEW.updated_at,''),
                                           NULLIF(NEW.created_at,''), datetime('now'))
                    WHERE id=NEW.id;
                END
            """)
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS talent_requests_fill_timestamps_after_insert
                AFTER INSERT ON talent_requests
                WHEN NEW.submitted_at IS NULL OR NEW.submitted_at='' OR
                     NEW.created_at IS NULL OR NEW.created_at=''
                BEGIN
                    UPDATE talent_requests
                    SET submitted_at=COALESCE(NULLIF(NEW.submitted_at,''),
                                              NULLIF(NEW.created_at,''), datetime('now')),
                        created_at=COALESCE(NULLIF(NEW.created_at,''),
                                            NULLIF(NEW.submitted_at,''), datetime('now'))
                    WHERE id=NEW.id;
                END
            """)
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS talent_assignees_fill_timestamp_after_insert
                AFTER INSERT ON talent_request_assignees
                WHEN NEW.assigned_at IS NULL OR NEW.assigned_at=''
                BEGIN
                    UPDATE talent_request_assignees
                    SET assigned_at=datetime('now')
                    WHERE request_id=NEW.request_id AND member_id=NEW.member_id;
                END
            """)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _ensure_column(self, conn, table, column, decl):
        """기존 DB에 컬럼이 없으면 추가(마이그레이션). 이미 있으면 무시."""
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(%s)" % table).fetchall()]
        if column not in cols:
            conn.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, column, decl))

    # --- members ---
    def add_member(self, name, password_hash, api_key, role="student"):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO members (name, password_hash, api_key, role) VALUES (?,?,?,?)",
                (name, password_hash, api_key, role),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_member_by_id(self, mid, include_disabled=False):
        if include_disabled:
            return self._get_one("SELECT * FROM members WHERE id=?", (mid,))
        return self._get_one("SELECT * FROM members WHERE id=? AND status='active'", (mid,))

    def get_member_by_name(self, name):
        return self._get_one("SELECT * FROM members WHERE name=? AND status='active'", (name,))

    def get_member_by_api_key(self, api_key):
        return self._get_one("SELECT * FROM members WHERE api_key=? AND status='active'", (api_key,))

    def get_member_by_name_any_status(self, name):
        return self._get_one("SELECT * FROM members WHERE name=?", (name,))

    def list_members_admin(self):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT m.id, m.name, m.role, m.status, m.created_at, "
                "  COUNT(p.id) AS post_count, MAX(p.created_at) AS last_post_at "
                "FROM members m LEFT JOIN posts p ON p.author_id = m.id "
                "GROUP BY m.id "
                "ORDER BY (m.status='active') DESC, m.name ASC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def update_member_account(self, mid, name=None, role=None, status=None):
        fields = []
        params = []
        if name is not None:
            fields.append("name=?")
            params.append(name)
        if role is not None:
            fields.append("role=?")
            params.append(role)
        if status is not None:
            fields.append("status=?")
            params.append(status)
        if not fields:
            return
        params.append(mid)
        conn = self._conn()
        try:
            conn.execute("UPDATE members SET %s WHERE id=?" % ", ".join(fields), params)
            conn.commit()
        finally:
            conn.close()

    def update_member_password(self, mid, password_hash):
        conn = self._conn()
        try:
            conn.execute("UPDATE members SET password_hash=? WHERE id=?", (password_hash, mid))
            conn.commit()
        finally:
            conn.close()

    def update_member_api_key(self, mid, api_key):
        conn = self._conn()
        try:
            conn.execute("UPDATE members SET api_key=? WHERE id=?", (api_key, mid))
            conn.commit()
        finally:
            conn.close()

    def add_audit_log(self, actor_id, action, target_member_id=None, detail=""):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO audit_log (actor_id, target_member_id, action, detail) VALUES (?,?,?,?)",
                (actor_id, target_member_id, action, detail or ""),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def list_audit_log(self, limit=50):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT al.*, a.name AS actor_name, t.name AS target_name "
                "FROM audit_log al "
                "LEFT JOIN members a ON a.id=al.actor_id "
                "LEFT JOIN members t ON t.id=al.target_member_id "
                "ORDER BY al.id ASC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def _get_one(self, sql, params):
        conn = self._conn()
        try:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    # --- projects (1C40 cockpit) ---
    def add_project(self, title, type="", goal="", status="active", summary="",
                    slug="", repo_url="", site_url="", owner_member_id=None,
                    current_stage="", deadline="", next_milestone="",
                    risk_level="normal", pi_decision=""):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO projects (title, type, goal, status, summary, slug, "
                "repo_url, site_url, owner_member_id, current_stage, "
                "deadline, next_milestone, risk_level, pi_decision) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (title, type, goal, status, summary, slug, repo_url, site_url,
                 owner_member_id, current_stage, deadline,
                 next_milestone, risk_level, pi_decision),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def add_project_with_members(self, member_roles, title, type="", goal="",
                                 status="active", summary="", slug="",
                                 repo_url="", site_url="", owner_member_id=None,
                                 current_stage="", deadline="", next_milestone="",
                                 risk_level="normal", pi_decision=""):
        """Create project metadata and its member rows atomically."""
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO projects (title, type, goal, status, summary, slug, "
                "repo_url, site_url, owner_member_id, current_stage, "
                "deadline, next_milestone, risk_level, pi_decision) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (title, type, goal, status, summary, slug, repo_url, site_url,
                 owner_member_id, current_stage, deadline, next_milestone,
                 risk_level, pi_decision),
            )
            project_id = cur.lastrowid
            if not slug:
                conn.execute(
                    "UPDATE projects SET slug=? WHERE id=?",
                    ("project-%s" % project_id, project_id),
                )
            self._replace_project_members(conn, project_id, member_roles)
            conn.commit()
            return project_id
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_project(self, pid):
        return self._get_one("SELECT * FROM projects WHERE id=?", (pid,))

    def update_project(self, pid, title, type, status, goal, current_stage,
                       deadline, next_milestone, risk_level, pi_decision,
                       summary=None, slug=None, repo_url=None, site_url=None,
                       owner_member_id=None):
        existing = self.get_project(pid)
        summary = existing["summary"] if summary is None else summary
        slug = existing["slug"] if slug is None else slug
        repo_url = existing["repo_url"] if repo_url is None else repo_url
        site_url = existing["site_url"] if site_url is None else site_url
        owner_member_id = existing["owner_member_id"] if owner_member_id is None else owner_member_id
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE projects SET title=?, type=?, status=?, goal=?, summary=?, slug=?, "
                "repo_url=?, site_url=?, owner_member_id=?, current_stage=?, "
                "deadline=?, next_milestone=?, risk_level=?, pi_decision=?, "
                "updated_at=datetime('now') WHERE id=?",
                (title, type, status, goal, summary, slug, repo_url, site_url,
                 owner_member_id, current_stage, deadline,
                 next_milestone, risk_level, pi_decision, pid),
            )
            conn.commit()
        finally:
            conn.close()

    def update_project_with_members(self, pid, member_roles, title, type, status,
                                    goal, current_stage, deadline,
                                    next_milestone, risk_level, pi_decision,
                                    summary=None, slug=None, repo_url=None,
                                    site_url=None, owner_member_id=None):
        """Update project metadata and replace its member rows atomically."""
        conn = self._conn()
        try:
            existing = conn.execute(
                "SELECT * FROM projects WHERE id=?", (pid,)
            ).fetchone()
            if not existing:
                raise ValueError("project not found")
            summary = existing["summary"] if summary is None else summary
            slug = existing["slug"] if slug is None else slug
            repo_url = existing["repo_url"] if repo_url is None else repo_url
            site_url = existing["site_url"] if site_url is None else site_url
            owner_member_id = (
                existing["owner_member_id"]
                if owner_member_id is None else owner_member_id
            )
            conn.execute(
                "UPDATE projects SET title=?, type=?, status=?, goal=?, summary=?, slug=?, "
                "repo_url=?, site_url=?, owner_member_id=?, current_stage=?, "
                "deadline=?, next_milestone=?, risk_level=?, pi_decision=?, "
                "updated_at=datetime('now') WHERE id=?",
                (title, type, status, goal, summary, slug, repo_url, site_url,
                 owner_member_id, current_stage, deadline, next_milestone,
                 risk_level, pi_decision, pid),
            )
            self._replace_project_members(conn, pid, member_roles)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def list_projects(self):
        """전 프로젝트 + 멤버 수 + 연결된 활동 수. 활성 먼저, 마감 임박 순."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT pr.*, owner.name AS owner_name, "
                "  (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id=pr.id) AS member_count, "
                "  (SELECT COUNT(*) FROM posts po WHERE po.project_id=pr.id) AS activity_count "
                "FROM projects pr LEFT JOIN members owner ON owner.id=pr.owner_member_id "
                "ORDER BY (pr.status='active') DESC, (pr.deadline='') ASC, pr.deadline ASC, pr.id DESC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def set_project_members(self, project_id, member_roles):
        """member_roles: [(member_id, role), ...]. 기존 멤버 전부 교체."""
        conn = self._conn()
        try:
            self._replace_project_members(conn, project_id, member_roles)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _replace_project_members(self, conn, project_id, member_roles):
        conn.execute("DELETE FROM project_members WHERE project_id=?", (project_id,))
        for mid, role in member_roles:
            conn.execute(
                "INSERT INTO project_members (project_id, member_id, role) VALUES (?,?,?)",
                (project_id, mid, role or ""),
            )

    def list_project_members(self, project_id):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT pm.member_id, pm.role, m.name "
                "FROM project_members pm JOIN members m ON m.id=pm.member_id "
                "WHERE pm.project_id=? ORDER BY m.name ASC",
                (project_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def link_post_project(self, post_id, project_id):
        conn = self._conn()
        try:
            conn.execute("UPDATE posts SET project_id=? WHERE id=?", (project_id, post_id))
            conn.commit()
        finally:
            conn.close()

    # --- BAI talent office ---
    def add_talent_request(self, requester_member_id, title, problem, expected_outcome,
                           system_scope_reason):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO talent_requests "
                "(requester_member_id, title, problem, expected_outcome, system_scope_reason, "
                "submitted_at, created_at, updated_at) "
                "VALUES (?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'))",
                (requester_member_id, title, problem, expected_outcome, system_scope_reason),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def _talent_request_row(self, conn, request_id):
        return conn.execute(
            "SELECT tr.*, m.name AS requester_name "
            "FROM talent_requests tr JOIN members m ON m.id=tr.requester_member_id "
            "WHERE tr.id=?",
            (request_id,),
        ).fetchone()

    def get_talent_request(self, request_id):
        conn = self._conn()
        try:
            row = self._talent_request_row(conn, request_id)
            return dict(row) if row else None
        finally:
            conn.close()

    def list_talent_requests(self, member_id=None, operator=False):
        conn = self._conn()
        try:
            where, params = "", []
            if not operator:
                where = ("WHERE tr.requester_member_id=? OR EXISTS "
                         "(SELECT 1 FROM talent_request_assignees ta "
                         "WHERE ta.request_id=tr.id AND ta.member_id=?)")
                params = [member_id, member_id]
            rows = conn.execute(
                "SELECT tr.*, m.name AS requester_name, "
                "(SELECT COUNT(*) FROM talent_request_assignees ta WHERE ta.request_id=tr.id) AS assignee_count "
                "FROM talent_requests tr JOIN members m ON m.id=tr.requester_member_id "
                f"{where} ORDER BY tr.id DESC",
                params,
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def list_talent_assignees(self, request_id):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT ta.member_id, ta.role, ta.allocation_ratio, m.name "
                "FROM talent_request_assignees ta JOIN members m ON m.id=ta.member_id "
                "WHERE ta.request_id=? ORDER BY ta.member_id",
                (request_id,),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def review_talent_request(self, request_id, status, review_note="", approval_reason=""):
        if status not in {"accepted", "declined", "approval_required"}:
            raise ValueError("invalid review status")
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE talent_requests SET status=?, review_note=?, requires_approval=?, "
                "approval_reason=?, updated_at=datetime('now') WHERE id=?",
                (status, review_note, 1 if status == "approval_required" else 0,
                 approval_reason, request_id),
            )
            conn.commit()
        finally:
            conn.close()

    def assign_talent_request(self, request_id, assignees):
        if not assignees:
            raise ValueError("at least one assignee is required")
        total = sum(float(row[2]) for row in assignees)
        if abs(total - 1.0) > 0.0001:
            raise ValueError("allocation ratios must sum to 1")
        conn = self._conn()
        try:
            request = self._talent_request_row(conn, request_id)
            if not request or request["status"] not in {"accepted", "assigned", "changes_requested"}:
                raise ValueError("request cannot be assigned")
            conn.execute("DELETE FROM talent_request_assignees WHERE request_id=?", (request_id,))
            for member_id, role, ratio in assignees:
                conn.execute(
                    "INSERT INTO talent_request_assignees "
                    "(request_id, member_id, role, allocation_ratio, assigned_at) "
                    "VALUES (?,?,?,?,datetime('now'))",
                    (request_id, member_id, role, ratio),
                )
            conn.execute("UPDATE talent_requests SET status='assigned', updated_at=datetime('now') WHERE id=?", (request_id,))
            conn.commit()
        finally:
            conn.close()

    def submit_talent_solution(self, request_id, member_id, solution_summary, solution_url=""):
        conn = self._conn()
        try:
            assigned = conn.execute(
                "SELECT 1 FROM talent_request_assignees WHERE request_id=? AND member_id=?",
                (request_id, member_id),
            ).fetchone()
            if not assigned:
                raise ValueError("member is not assigned")
            conn.execute(
                "UPDATE talent_requests SET status='ready_for_review', solution_summary=?, solution_url=?, "
                "updated_at=datetime('now') WHERE id=?",
                (solution_summary, solution_url, request_id),
            )
            conn.commit()
        finally:
            conn.close()

    def complete_talent_request(self, request_id, requester_member_id):
        """Complete once and award a fixed 10-point pool by agreed allocation ratios."""
        conn = self._conn()
        try:
            request = self._talent_request_row(conn, request_id)
            if not request or request["requester_member_id"] != requester_member_id:
                raise ValueError("only requester can complete")
            if request["status"] == "completed":
                return []
            if request["status"] != "ready_for_review":
                raise ValueError("request is not ready for review")
            if not (request["solution_summary"].strip() or request["solution_url"].strip()):
                raise ValueError("solution evidence is required")
            assignees = conn.execute(
                "SELECT member_id, allocation_ratio FROM talent_request_assignees WHERE request_id=? ORDER BY member_id",
                (request_id,),
            ).fetchall()
            if not assignees or abs(sum(row["allocation_ratio"] for row in assignees) - 1.0) > 0.0001:
                raise ValueError("valid assignee allocation is required")
            awards = []
            remaining = 10.0
            for index, assignee in enumerate(assignees):
                points = remaining if index == len(assignees) - 1 else round(10.0 * assignee["allocation_ratio"], 2)
                remaining = round(remaining - points, 2)
                conn.execute(
                    "INSERT OR IGNORE INTO contribution_points (member_id, request_id, points, reason) VALUES (?,?,?,?)",
                    (assignee["member_id"], request_id, points, "인력사무소 요청 완료 인정"),
                )
                awards.append({"member_id": assignee["member_id"], "points": points})
            conn.execute(
                "UPDATE talent_requests SET status='completed', completed_at=datetime('now'), "
                "updated_at=datetime('now') WHERE id=?",
                (request_id,),
            )
            conn.commit()
            return awards
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def request_talent_changes(self, request_id, requester_member_id, review_note):
        conn = self._conn()
        try:
            request = self._talent_request_row(conn, request_id)
            if not request or request["requester_member_id"] != requester_member_id:
                raise ValueError("only requester can request changes")
            if request["status"] != "ready_for_review":
                raise ValueError("request is not ready for review")
            conn.execute(
                "UPDATE talent_requests SET status='changes_requested', review_note=?, updated_at=datetime('now') WHERE id=?",
                (review_note, request_id),
            )
            conn.commit()
        finally:
            conn.close()

    def list_contribution_points(self, member_id):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT cp.*, tr.title AS request_title FROM contribution_points cp "
                "JOIN talent_requests tr ON tr.id=cp.request_id "
                "WHERE cp.member_id=? ORDER BY cp.id DESC",
                (member_id,),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    # --- profiles + people load (1C40 cockpit) ---
    def upsert_profile(self, member_id, grade="", participation="", interests="",
                       semester_goal="", load_status="unknown", advisor_memo="", next_action=""):
        conn = self._conn()
        try:
            conn.execute(
                "INSERT INTO member_profiles "
                "(member_id, grade, participation, interests, semester_goal, "
                " load_status, advisor_memo, next_action, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?, datetime('now')) "
                "ON CONFLICT(member_id) DO UPDATE SET "
                "  grade=excluded.grade, participation=excluded.participation, "
                "  interests=excluded.interests, semester_goal=excluded.semester_goal, "
                "  load_status=excluded.load_status, advisor_memo=excluded.advisor_memo, "
                "  next_action=excluded.next_action, updated_at=datetime('now')",
                (member_id, grade, participation, interests, semester_goal,
                 load_status, advisor_memo, next_action),
            )
            conn.commit()
        finally:
            conn.close()

    def get_profile(self, member_id):
        return self._get_one("SELECT * FROM member_profiles WHERE member_id=?", (member_id,))

    def _latest_blocked(self, conn, member_id):
        row = conn.execute(
            "SELECT blocked FROM posts WHERE author_id=? AND TRIM(blocked)<>'' "
            "ORDER BY id DESC LIMIT 1",
            (member_id,),
        ).fetchone()
        return row["blocked"] if row else ""

    def list_people_with_load(self):
        """전 멤버 + 프로필 + 글수 + 마지막활동 + 최근 막힌점. 로드 정렬은 화면에서."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT m.id, m.name, m.role, "
                "  COALESCE(pf.grade,'') AS grade, "
                "  COALESCE(pf.participation,'') AS participation, "
                "  COALESCE(pf.interests,'') AS interests, "
                "  COALESCE(pf.semester_goal,'') AS semester_goal, "
                "  COALESCE(pf.load_status,'unknown') AS load_status, "
                "  COALESCE(pf.advisor_memo,'') AS advisor_memo, "
                "  COALESCE(pf.next_action,'') AS next_action, "
                "  COUNT(po.id) AS post_count, MAX(po.created_at) AS last_post_at "
                "FROM members m "
                "LEFT JOIN member_profiles pf ON pf.member_id=m.id "
                "LEFT JOIN posts po ON po.author_id=m.id "
                "WHERE m.status='active' "
                "GROUP BY m.id "
                "ORDER BY m.name ASC"
            ).fetchall()
            out = []
            for r in rows:
                d = dict(r)
                d["post_count"] = d["post_count"] or 0
                d["latest_blocked"] = self._latest_blocked(conn, d["id"])
                out.append(d)
            return out
        finally:
            conn.close()

    def _member_projects(self, conn, member_id):
        rows = conn.execute(
            "SELECT pr.id, pr.title, pr.status, pr.deadline, pr.risk_level "
            "FROM project_members pm JOIN projects pr ON pr.id=pm.project_id "
            "WHERE pm.member_id=? ORDER BY (pr.deadline='') ASC, pr.deadline ASC",
            (member_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def load_review(self):
        """학생별 로드 리뷰 행: 프로필 + 최근활동 + 막힌점 + 참여 프로젝트 + 가장 가까운 마감."""
        people = self.list_people_with_load()
        conn = self._conn()
        try:
            for p in people:
                projs = self._member_projects(conn, p["id"])
                p["projects"] = projs
                deadlines = [pr["deadline"] for pr in projs if pr["deadline"]]
                p["nearest_deadline"] = min(deadlines) if deadlines else ""
        finally:
            conn.close()
        return people

    # --- materials board ---
    def add_material(self, author_id, title, body="", url="", category="자료", guild=""):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO materials "
                "(author_id, title, body, url, category, guild, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))",
                (author_id, title, body, url, category or "자료", guild or ""),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_material(self, material_id):
        return self._get_one(
            "SELECT mt.*, m.name AS author_name, m.role AS author_role "
            "FROM materials mt JOIN members m ON m.id=mt.author_id WHERE mt.id=?",
            (material_id,),
        )

    def list_materials(self, category=None, guild=None):
        clauses = []
        params = []
        if category:
            clauses.append("mt.category=?")
            params.append(category)
        if guild:
            clauses.append("mt.guild=?")
            params.append(guild)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT mt.*, m.name AS author_name, m.role AS author_role "
                "FROM materials mt JOIN members m ON m.id=mt.author_id "
                f"{where} ORDER BY mt.id DESC",
                params,
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def update_material(self, material_id, title, body="", url="", category="자료", guild=""):
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE materials SET title=?, body=?, url=?, category=?, guild=?, "
                "updated_at=datetime('now') WHERE id=?",
                (title, body, url, category or "자료", guild or "", material_id),
            )
            conn.commit()
        finally:
            conn.close()

    def delete_material(self, material_id):
        conn = self._conn()
        try:
            conn.execute("DELETE FROM materials WHERE id=?", (material_id,))
            conn.commit()
        finally:
            conn.close()

    # --- anonymous wall chat ---
    def add_wall_message(self, author_id, body):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO wall_messages (author_id, body) VALUES (?,?)",
                (author_id, body),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def list_wall_messages(self, limit=12):
        limit = max(1, min(int(limit or 12), 40))
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT id, body, created_at FROM wall_messages ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in reversed(rows)]
        finally:
            conn.close()

    def list_posts_by_project(self, project_id):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT p.*, m.name AS author_name, pr.title AS project_title, "
                "  COALESCE(rc.reaction_count, 0) AS reaction_count, "
                "  COALESCE(cc.comment_count, 0) AS comment_count "
                "FROM posts p JOIN members m ON p.author_id = m.id "
                "LEFT JOIN projects pr ON pr.id = p.project_id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id = p.id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = p.id "
                "WHERE p.project_id=? ORDER BY p.id DESC",
                (project_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- posts ---
    def add_post(self, author_id, did, learned, blocked, tags, source="web",
                 links="", project_id=None):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO posts (author_id, did, learned, blocked, tags, links, source, project_id) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (author_id, did, learned, blocked, tags, links, source, project_id),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def list_posts(self):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT p.*, m.name AS author_name, pr.title AS project_title, "
                "  COALESCE(rc.reaction_count, 0) AS reaction_count, "
                "  COALESCE(cc.comment_count, 0) AS comment_count "
                "FROM posts p JOIN members m ON p.author_id = m.id "
                "LEFT JOIN projects pr ON pr.id = p.project_id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id = p.id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = p.id "
                "ORDER BY p.id DESC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def list_posts_filtered(self, project_id=None):
        if project_id is None:
            return self.list_posts()
        return self.list_posts_by_project(project_id)

    def get_post(self, pid):
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT p.*, m.name AS author_name, pr.title AS project_title "
                "FROM posts p JOIN members m ON p.author_id = m.id "
                "LEFT JOIN projects pr ON pr.id = p.project_id "
                "WHERE p.id=?",
                (pid,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def list_posts_by_member(self, member_id):
        """해당 멤버의 글을 시간순(오래된→최신)으로. 후배가 '성장 여정'으로 읽기 위함."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT p.*, m.name AS author_name, pr.title AS project_title, "
                "  COALESCE(rc.reaction_count, 0) AS reaction_count, "
                "  COALESCE(cc.comment_count, 0) AS comment_count "
                "FROM posts p JOIN members m ON p.author_id = m.id "
                "LEFT JOIN projects pr ON pr.id = p.project_id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id = p.id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = p.id "
                "WHERE p.author_id=? ORDER BY p.id ASC",
                (member_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def member_tag_counts(self, member_id):
        """멤버가 쓴 태그별 글 수. {태그: 개수}, 많은 순."""
        posts = self.list_posts_by_member(member_id)
        counts = {}
        for p in posts:
            for t in (p["tags"] or "").replace(",", " ").split():
                counts[t] = counts.get(t, 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))

    # --- R1: 태그별 모아보기 ---
    def list_posts_by_tag(self, tag):
        """tags에 해당 단어가 정확히 포함된 글, 최신순. (GAN이 GANs를 안 잡게 단어 매치)"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT p.*, m.name AS author_name, pr.title AS project_title, "
                "  COALESCE(rc.reaction_count, 0) AS reaction_count, "
                "  COALESCE(cc.comment_count, 0) AS comment_count "
                "FROM posts p JOIN members m ON p.author_id = m.id "
                "LEFT JOIN projects pr ON pr.id = p.project_id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id = p.id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = p.id "
                "ORDER BY p.id DESC"
            ).fetchall()
            out = []
            for r in rows:
                words = (r["tags"] or "").replace(",", " ").split()
                if tag in words:
                    out.append(dict(r))
            return out
        finally:
            conn.close()

    # --- R2: 검색 ---
    def search_posts(self, q):
        """did/learned/blocked/tags 중 q 포함(대소문자 무시), 최신순. 빈 q는 []."""
        q = (q or "").strip()
        if not q:
            return []
        like = "%" + q.lower() + "%"
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT p.*, m.name AS author_name, pr.title AS project_title, "
                "  COALESCE(rc.reaction_count, 0) AS reaction_count, "
                "  COALESCE(cc.comment_count, 0) AS comment_count "
                "FROM posts p JOIN members m ON p.author_id = m.id "
                "LEFT JOIN projects pr ON pr.id = p.project_id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id = p.id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = p.id "
                "WHERE lower(p.did) LIKE ? OR lower(p.learned) LIKE ? "
                "   OR lower(p.blocked) LIKE ? OR lower(p.tags) LIKE ? "
                "   OR lower(p.links) LIKE ? "
                "ORDER BY p.id DESC",
                (like, like, like, like, like),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- R3: 미해결 질문 보드 ---
    def list_open_questions(self):
        """blocked 비어있지 않고 댓글 0개인 글, 오래된 순(오래 방치된 질문 먼저)."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT p.*, m.name AS author_name, pr.title AS project_title, "
                "  COALESCE(rc.reaction_count, 0) AS reaction_count, "
                "  COALESCE(cc.comment_count, 0) AS comment_count "
                "FROM posts p JOIN members m ON p.author_id = m.id "
                "LEFT JOIN projects pr ON pr.id = p.project_id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS reaction_count FROM reactions GROUP BY post_id) rc ON rc.post_id = p.id "
                "LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) cc ON cc.post_id = p.id "
                "WHERE TRIM(p.blocked) <> '' "
                "ORDER BY p.id ASC",
                (),
            ).fetchall()
            return [dict(r) for r in rows if r["comment_count"] == 0]
        finally:
            conn.close()

    # --- 운영 문의 (질문 접수 → 답변 채워넣기 → FAQ 축적) ---
    def add_inquiry(self, member_id, question):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO inquiries (member_id, question) VALUES (?,?)",
                (member_id, question),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def list_inquiries(self):
        """전체 문의 + 작성자/답변자 이름. 답변 대기는 오래된 순, FAQ는 최근 답변 순."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT i.*, m.name AS author_name, a.name AS answerer_name "
                "FROM inquiries i JOIN members m ON i.member_id = m.id "
                "LEFT JOIN members a ON i.answered_by = a.id "
                "ORDER BY i.id ASC",
                (),
            ).fetchall()
            items = [dict(r) for r in rows]
            open_q = [i for i in items if i["status"] == "open"]
            answered = [i for i in items if i["status"] == "answered"]
            answered.sort(key=lambda i: i["answered_at"] or "", reverse=True)
            return {"open": open_q, "answered": answered}
        finally:
            conn.close()

    def get_inquiry(self, iid):
        return self._get_one("SELECT * FROM inquiries WHERE id=?", (iid,))

    def answer_inquiry(self, iid, answer, answered_by):
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE inquiries SET answer=?, status='answered', "
                "answered_at=datetime('now'), answered_by=? WHERE id=?",
                (answer, answered_by, iid),
            )
            conn.commit()
        finally:
            conn.close()

    # --- R4: 멤버 명단 ---
    def list_members_with_stats(self):
        """전 멤버 + 글 수 + 마지막 글 시각. 최근 활동 순(글 있는 사람 먼저, 그다음 이름)."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT m.id, m.name, m.role, "
                "  COUNT(p.id) AS post_count, MAX(p.created_at) AS last_post_at "
                "FROM members m LEFT JOIN posts p ON p.author_id = m.id "
                "WHERE m.status='active' "
                "GROUP BY m.id "
                "ORDER BY (MAX(p.created_at) IS NULL), MAX(p.created_at) DESC, m.name ASC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- R5: 이번 주 보고 현황 (주간 대면보고 '대체'의 강제력) ---
    def weekly_report_status(self, week_start_utc):
        """week_start_utc: 'YYYY-MM-DD HH:MM:SS' (UTC) 이후 글이 있으면 '이번 주 보고함'.
        반환: 전 멤버 [{id,name,role,last_post_at,week_count,reported}].
        미보고자 먼저(이름순), 그다음 보고자(이름순) — 미보고가 눈에 먼저 띄게."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT m.id, m.name, m.role, "
                "  MAX(p.created_at) AS last_post_at, "
                "  SUM(CASE WHEN p.created_at >= ? THEN 1 ELSE 0 END) AS week_count "
                "FROM members m LEFT JOIN posts p ON p.author_id = m.id "
                "WHERE m.status='active' "
                "GROUP BY m.id "
                "ORDER BY m.name ASC",
                (week_start_utc,),
            ).fetchall()
            out = []
            for r in rows:
                d = dict(r)
                d["week_count"] = d["week_count"] or 0
                d["reported"] = d["week_count"] > 0
                out.append(d)
            # 미보고자 먼저
            out.sort(key=lambda d: (d["reported"], d["name"]))
            return out
        finally:
            conn.close()

    def update_post(self, pid, did, learned, blocked, tags, links="", project_id=None):
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE posts SET did=?, learned=?, blocked=?, tags=?, links=?, project_id=?, "
                "updated_at=datetime('now') WHERE id=?",
                (did, learned, blocked, tags, links, project_id, pid),
            )
            conn.commit()
        finally:
            conn.close()

    # --- comments ---
    def add_comment(self, post_id, author_id, body):
        conn = self._conn()
        try:
            cur = conn.execute(
                "INSERT INTO comments (post_id, author_id, body) VALUES (?,?,?)",
                (post_id, author_id, body),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def list_comments(self, post_id):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT c.*, m.name AS author_name "
                "FROM comments c JOIN members m ON c.author_id = m.id "
                "WHERE c.post_id=? ORDER BY c.id ASC",
                (post_id,),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- reactions ---
    def toggle_reaction(self, post_id, member_id, kind="thumbsup"):
        """추가했으면 True, 이미 있어서 취소했으면 False 반환."""
        conn = self._conn()
        try:
            existing = conn.execute(
                "SELECT id FROM reactions WHERE post_id=? AND member_id=? AND kind=?",
                (post_id, member_id, kind),
            ).fetchone()
            if existing:
                conn.execute("DELETE FROM reactions WHERE id=?", (existing["id"],))
                conn.commit()
                return False
            conn.execute(
                "INSERT INTO reactions (post_id, member_id, kind) VALUES (?,?,?)",
                (post_id, member_id, kind),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def count_reactions(self, post_id, kind="thumbsup"):
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM reactions WHERE post_id=? AND kind=?",
                (post_id, kind),
            ).fetchone()
            return row["n"]
        finally:
            conn.close()

    def reacted_member_ids(self, post_id, kind="thumbsup"):
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT member_id FROM reactions WHERE post_id=? AND kind=?",
                (post_id, kind),
            ).fetchall()
            return [r["member_id"] for r in rows]
        finally:
            conn.close()
