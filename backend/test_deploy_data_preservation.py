import importlib.util
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
BACKUP_SCRIPT = ROOT / "scripts" / "backup_db.py"
DEPLOY_SCRIPT = ROOT / "scripts" / "deploy-react-to-live.sh"
AUTODEPLOY_SCRIPT = ROOT / "scripts" / "autodeploy-main.sh"
PR_REVIEW_SCRIPT = ROOT / "scripts" / "run-pr-ai-review.sh"

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("bai_backup_db", BACKUP_SCRIPT)
backup_db = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(backup_db)


class VerifiedBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="bai-preservation-test-")
        self.root = Path(self.temp_dir.name)
        self.db_path = self.root / "live" / "lab-feed.db"
        self.backup_dir = self.root / "backups"
        self.db_path.parent.mkdir()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _create_live_db(self, wal=False):
        conn = sqlite3.connect(self.db_path)
        if wal:
            self.assertEqual(conn.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
        conn.executescript(
            """
            CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE posts(id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, body TEXT NOT NULL);
            INSERT INTO members(id, name) VALUES (1, '기존 멤버');
            INSERT INTO posts(id, author_id, body) VALUES (1, 1, '보존할 활동');
            """
        )
        conn.commit()
        return conn

    def test_online_backup_preserves_rows_including_wal_content(self):
        live = self._create_live_db(wal=True)
        try:
            before = self.db_path.read_bytes()
            dest = Path(
                backup_db.create_verified_backup(
                    self.db_path, self.backup_dir, stamp="wal-fixture", keep=3
                )
            )
            self.assertEqual(self.db_path.read_bytes(), before)
            self.assertTrue(dest.is_file())
            restored = sqlite3.connect(dest)
            try:
                self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(restored.execute("SELECT name FROM members").fetchone()[0], "기존 멤버")
                self.assertEqual(restored.execute("SELECT body FROM posts").fetchone()[0], "보존할 활동")
            finally:
                restored.close()
        finally:
            live.close()

    def test_missing_database_fails_without_creating_backup(self):
        with self.assertRaises(backup_db.BackupError):
            backup_db.create_verified_backup(
                self.root / "missing.db", self.backup_dir, stamp="missing"
            )
        self.assertFalse(self.backup_dir.exists())

    def test_corrupt_database_fails_without_final_or_temporary_backup(self):
        self.db_path.write_bytes(b"not a sqlite database")
        with self.assertRaises(backup_db.BackupError):
            backup_db.create_verified_backup(
                self.db_path, self.backup_dir, stamp="corrupt"
            )
        self.assertFalse((self.backup_dir / "lab-feed-corrupt.db").exists())
        if self.backup_dir.exists():
            self.assertEqual(list(self.backup_dir.iterdir()), [])

    def test_unrelated_sqlite_database_is_not_accepted_as_a_bai_backup(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("CREATE TABLE unrelated(id INTEGER PRIMARY KEY)")
        conn.close()

        with self.assertRaisesRegex(backup_db.BackupError, "핵심 테이블 누락"):
            backup_db.create_verified_backup(
                self.db_path, self.backup_dir, stamp="unrelated"
            )
        self.assertFalse(self.backup_dir.exists())

    def test_foreign_key_violations_block_backup_publication(self):
        conn = sqlite3.connect(self.db_path)
        conn.executescript(
            """
            CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE posts(
                id INTEGER PRIMARY KEY,
                author_id INTEGER NOT NULL REFERENCES members(id),
                body TEXT NOT NULL
            );
            INSERT INTO posts(id, author_id, body) VALUES (1, 999, 'orphan');
            """
        )
        conn.close()

        with self.assertRaisesRegex(backup_db.BackupError, "foreign_key_check"):
            backup_db.create_verified_backup(
                self.db_path, self.backup_dir, stamp="broken-fk"
            )
        self.assertFalse(self.backup_dir.exists())

    def test_existing_backup_is_never_overwritten(self):
        live = self._create_live_db()
        live.close()
        first = Path(
            backup_db.create_verified_backup(
                self.db_path, self.backup_dir, stamp="same", keep=3
            )
        )
        before = first.read_bytes()
        with self.assertRaises(backup_db.BackupError):
            backup_db.create_verified_backup(
                self.db_path, self.backup_dir, stamp="same", keep=3
            )
        self.assertEqual(first.read_bytes(), before)

    def test_failed_backup_integrity_check_never_publishes_partial_file(self):
        live = self._create_live_db()
        live.close()
        original_check = backup_db._check_database

        def fail_destination_check(path, pragma):
            if pragma == "integrity_check":
                raise backup_db.BackupError("simulated destination corruption")
            return original_check(path, pragma)

        with mock.patch.object(backup_db, "_check_database", fail_destination_check):
            with self.assertRaises(backup_db.BackupError):
                backup_db.create_verified_backup(
                    self.db_path, self.backup_dir, stamp="partial", keep=3
                )
        self.assertEqual(list(self.backup_dir.iterdir()), [])


class DeployPreservationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="bai-deploy-preservation-")
        self.root = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _preserve_args(self):
        command = (
            f"source {shlex.quote(str(DEPLOY_SCRIPT))}; "
            "printf '%s\\n' \"${BACKEND_STATIC_PRESERVE_ARGS[@]}\""
        )
        result = subprocess.run(
            ["bash", "-c", command], check=True, text=True, capture_output=True
        )
        return result.stdout.splitlines()

    def _write_executable(self, directory, name, body):
        path = directory / name
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + body, encoding="utf-8")
        path.chmod(0o755)
        return path

    @unittest.skipUnless(shutil.which("rsync"), "rsync is required for preservation test")
    def test_backend_rsync_filters_preserve_uploads_and_all_sqlite_sidecars(self):
        source = self.root / "source"
        live = self.root / "live"
        source.mkdir()
        live.mkdir()
        (source / "app.py").write_text("new backend", encoding="utf-8")
        (live / "obsolete.py").write_text("delete me", encoding="utf-8")
        protected = {
            "lab-feed.db": b"database",
            "lab-feed.db-journal": b"journal",
            "lab-feed.db-wal": b"wal",
            "lab-feed.db-shm": b"shm",
            "other.sqlite-journal": b"sqlite journal",
            "other.sqlite-wal": b"sqlite wal",
            "other.sqlite3-shm": b"sqlite3 shm",
        }
        for name, data in protected.items():
            (live / name).write_bytes(data)
        upload = live / "uploads" / "materials" / "evidence.pdf"
        upload.parent.mkdir(parents=True)
        upload.write_bytes(b"existing attachment")

        subprocess.run(
            ["rsync", "-a", "--delete", *self._preserve_args(), f"{source}/", f"{live}/"],
            check=True,
        )

        self.assertEqual((live / "app.py").read_text(encoding="utf-8"), "new backend")
        self.assertFalse((live / "obsolete.py").exists())
        self.assertEqual(upload.read_bytes(), b"existing attachment")
        for name, data in protected.items():
            self.assertEqual((live / name).read_bytes(), data)

    def test_deploy_fails_before_build_or_sync_when_live_db_is_missing(self):
        repo = self.root / "repo"
        (repo / "apps" / "web").mkdir(parents=True)
        (repo / "scripts").mkdir()
        live_backend = self.root / "live-backend"
        live_backend.mkdir()
        marker = live_backend / "must-remain.txt"
        marker.write_text("untouched", encoding="utf-8")
        env = os.environ.copy()
        env.update(
            {
                "BAI_WEBSITE_REPO": str(repo),
                "BAI_LIVE_BACKEND_DIR": str(live_backend),
                "BAI_LIVE_WEB_DIR": str(self.root / "live-web"),
                "LAB_FEED_DB": str(live_backend / "lab-feed.db"),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks"),
                "BAI_UPLOAD_DIR": str(live_backend / "uploads"),
                "LAB_FEED_SECRET": "s" * 32,
                "LAB_FEED_COOKIE_SECURE": "1",
                "BAI_API_ORIGIN": "http://127.0.0.1:5066",
            }
        )
        result = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT)], env=env, text=True, capture_output=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("live DB is missing", result.stderr)
        self.assertEqual(marker.read_text(encoding="utf-8"), "untouched")
        self.assertFalse((self.root / "live-web").exists())

    def test_deploy_refuses_missing_session_secret_before_live_mutation(self):
        repo = self.root / "repo-no-secret"
        (repo / "apps" / "web").mkdir(parents=True)
        live_backend = self.root / "live-backend-no-secret"
        live_backend.mkdir()
        db_path = live_backend / "lab-feed.db"
        db_path.write_bytes(b"must remain untouched")
        env = os.environ.copy()
        env.pop("LAB_FEED_SECRET", None)
        env.update(
            {
                "BAI_WEBSITE_REPO": str(repo),
                "BAI_LIVE_BACKEND_DIR": str(live_backend),
                "BAI_LIVE_WEB_DIR": str(self.root / "live-web-no-secret"),
                "LAB_FEED_DB": str(db_path),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups-no-secret"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks-no-secret"),
                "BAI_UPLOAD_DIR": str(live_backend / "uploads"),
                "LAB_FEED_COOKIE_SECURE": "1",
                "BAI_API_ORIGIN": "http://127.0.0.1:5066",
                "BAI_RUNTIME_ENV_FILE": str(self.root / "missing-runtime.env"),
            }
        )

        result = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT)], env=env, text=True, capture_output=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("LAB_FEED_SECRET must be explicit", result.stderr)
        self.assertEqual(db_path.read_bytes(), b"must remain untouched")
        self.assertFalse((self.root / "live-web-no-secret").exists())

    def test_initial_install_override_refuses_preexisting_uploads(self):
        repo = self.root / "repo-override"
        (repo / "apps" / "web").mkdir(parents=True)
        (repo / "scripts").mkdir()
        live_backend = self.root / "live-backend-override"
        upload = live_backend / "uploads" / "materials" / "existing.pdf"
        upload.parent.mkdir(parents=True)
        upload.write_bytes(b"must survive")
        env = os.environ.copy()
        env.update(
            {
                "BAI_WEBSITE_REPO": str(repo),
                "BAI_LIVE_BACKEND_DIR": str(live_backend),
                "BAI_LIVE_WEB_DIR": str(self.root / "live-web-override"),
                "LAB_FEED_DB": str(live_backend / "lab-feed.db"),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups-override"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks-override"),
                "BAI_UPLOAD_DIR": str(live_backend / "uploads"),
                "LAB_FEED_SECRET": "s" * 32,
                "LAB_FEED_COOKIE_SECURE": "1",
                "BAI_API_ORIGIN": "http://127.0.0.1:5066",
                "BAI_ALLOW_MISSING_LIVE_DB_FOR_INITIAL_INSTALL": (
                    "I_UNDERSTAND_THIS_CREATES_A_NEW_EMPTY_BAI_DATABASE"
                ),
            }
        )
        result = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT)], env=env, text=True, capture_output=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("existing uploads", result.stderr)
        self.assertEqual(upload.read_bytes(), b"must survive")
        self.assertFalse((self.root / "live-web-override").exists())

    @unittest.skipUnless(shutil.which("rsync"), "rsync is required for preservation test")
    def test_web_sync_preserves_configured_upload_directory_below_web_root(self):
        repo = self.root / "repo-web-upload"
        for relative in ("apps/web", "backend", "frontend", "scripts"):
            (repo / relative).mkdir(parents=True, exist_ok=True)
        (repo / "apps/web" / "page.tsx").write_text("new web", encoding="utf-8")
        (repo / "backend" / "app.py").write_text("new backend", encoding="utf-8")
        (repo / "frontend" / "krds.js").write_text("new frontend", encoding="utf-8")

        live_web = self.root / "live-web"
        live_backend = self.root / "live-backend"
        upload = live_web / "runtime-uploads" / "materials" / "existing.pdf"
        upload.parent.mkdir(parents=True)
        upload.write_bytes(b"must survive web rsync")
        (live_web / ".env.local").write_text("PRESERVE=1", encoding="utf-8")
        (live_web / "obsolete.txt").write_text("delete", encoding="utf-8")
        live_backend.mkdir()
        (live_backend / "lab-feed.db").write_bytes(b"backup stub fixture")
        live_frontend = live_backend.parent / "frontend"
        live_frontend.mkdir()
        (live_frontend / "krds.js").write_text("old frontend", encoding="utf-8")

        stubs = self.root / "stubs"
        stubs.mkdir()
        self._write_executable(stubs, "npm", "exit 0\n")
        self._write_executable(stubs, "launchctl", "exit 0\n")
        self._write_executable(stubs, "git", "printf 'deadbee\\n'\n")
        backup_python = self._write_executable(stubs, "backup-python", "exit 0\n")
        self._write_executable(
            stubs,
            "curl",
            """
case "$*" in
  *127.0.0.1:5066/healthz*) printf '200' ;;
  *127.0.0.1:5067/login*) printf '200' ;;
  *127.0.0.1:5067/api/healthz*) printf '200' ;;
  *127.0.0.1:5067/api/me*) printf '401' ;;
  *127.0.0.1:5067/api/runtime-health*) printf '200' ;;
  *127.0.0.1:5066/api/wall*) printf '401' ;;
esac
exit 0
""",
        )

        env = os.environ.copy()
        env.update(
            {
                "PATH": str(stubs) + os.pathsep + env.get("PATH", ""),
                "BAI_WEBSITE_REPO": str(repo),
                "BAI_LIVE_WEB_DIR": str(live_web),
                "BAI_LIVE_BACKEND_DIR": str(live_backend),
                "LAB_FEED_DB": str(live_backend / "lab-feed.db"),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks"),
                "BAI_UPLOAD_DIR": str(live_web / "runtime-uploads"),
                "BAI_BACKUP_PYTHON": str(backup_python),
                "LAB_FEED_SECRET": "s" * 32,
                "LAB_FEED_COOKIE_SECURE": "1",
                "BAI_API_ORIGIN": "http://127.0.0.1:5066",
            }
        )
        subprocess.run(["bash", str(DEPLOY_SCRIPT)], env=env, check=True)

        self.assertEqual(upload.read_bytes(), b"must survive web rsync")
        self.assertEqual((live_web / ".env.local").read_text(), "PRESERVE=1")
        self.assertFalse((live_web / "obsolete.txt").exists())
        self.assertEqual((live_web / "page.tsx").read_text(), "new web")
        self.assertEqual((live_backend / "app.py").read_text(), "new backend")
        self.assertEqual((live_frontend / "krds.js").read_text(), "new frontend")

        # A later release that fails its runtime health check must restore the
        # preceding code while leaving data/config untouched.
        (repo / "apps/web" / "page.tsx").write_text("bad web", encoding="utf-8")
        (repo / "backend" / "app.py").write_text("bad backend", encoding="utf-8")
        (repo / "frontend" / "krds.js").write_text("bad frontend", encoding="utf-8")
        self._write_executable(
            stubs,
            "curl",
            """
case "$*" in
  *127.0.0.1:5066/healthz*) printf '200' ;;
  *127.0.0.1:5067/login*) printf '200' ;;
  *127.0.0.1:5067/api/healthz*) printf '200' ;;
  *127.0.0.1:5067/api/me*) printf '401' ;;
  *127.0.0.1:5067/api/runtime-health*) exit 22 ;;
  *127.0.0.1:5066/api/wall*) printf '401' ;;
esac
exit 0
""",
        )
        failed = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT)], env=env, text=True, capture_output=True
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("restoring previous code", failed.stderr)
        self.assertEqual((live_web / "page.tsx").read_text(), "new web")
        self.assertEqual((live_backend / "app.py").read_text(), "new backend")
        self.assertEqual((live_frontend / "krds.js").read_text(), "new frontend")
        self.assertEqual(upload.read_bytes(), b"must survive web rsync")
        self.assertEqual((live_web / ".env.local").read_text(), "PRESERVE=1")

    def test_backup_gate_runs_after_checks_and_before_first_live_sync(self):
        source = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        backup_call = source.index('"$repo_dir/scripts/backup_db.py"')
        first_build = source.index("npm ci")
        first_rsync = source.index("rsync -a --checksum --delete")
        self.assertLess(first_build, backup_call)
        self.assertLess(backup_call, first_rsync)
        self.assertIn("I_UNDERSTAND_THIS_CREATES_A_NEW_EMPTY_BAI_DATABASE", source)
        self.assertIn('"$api_origin/healthz"', source)
        self.assertIn('"$next_origin/api/healthz"', source)
        self.assertIn('"$next_origin/api/me"', source)
        self.assertIn('"$next_origin/api/runtime-health"', source)
        self.assertIn("Deployment failed; restoring previous code", source)
        backend_restart = source.rindex(
            'launchctl kickstart -k "gui/$(id -u)/${backend_launchd_label}"'
        )
        backend_ready = source.index(
            'wait_http_status "$api_origin/healthz" "200"', backend_restart
        )
        next_restart = source.index(
            'launchctl kickstart -k "gui/$(id -u)/${launchd_label}"', backend_ready
        )
        self.assertLess(backend_restart, backend_ready)
        self.assertLess(backend_ready, next_restart)

    def test_automation_uses_the_same_node_runtime_as_production(self):
        expected_path_prefix = 'export PATH="/Users/hai_1/.local/bin:'
        for script in (AUTODEPLOY_SCRIPT, PR_REVIEW_SCRIPT):
            with self.subTest(script=script.name):
                self.assertIn(expected_path_prefix, script.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
