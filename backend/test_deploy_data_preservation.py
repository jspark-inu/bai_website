import importlib.util
import os
from pathlib import Path
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

    def _write_executable(self, directory, name, body):
        path = directory / name
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + body, encoding="utf-8")
        path.chmod(0o755)
        return path

    def test_deploy_fails_before_build_or_sync_when_live_db_is_missing(self):
        repo = self.root / "repo"
        (repo / "apps" / "web").mkdir(parents=True)
        (repo / "scripts").mkdir()
        live_data = self.root / "live-data"
        live_data.mkdir()
        marker = live_data / "must-remain.txt"
        marker.write_text("untouched", encoding="utf-8")
        env = os.environ.copy()
        env.update(
            {
                "BAI_WEBSITE_REPO": str(repo),
                "BAI_LIVE_WEB_DIR": str(self.root / "live-web"),
                "LAB_FEED_DB": str(live_data / "lab-feed.db"),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks"),
                "BAI_UPLOAD_DIR": str(live_data / "uploads"),
                "LAB_FEED_SECRET": "s" * 32,
                "LAB_FEED_COOKIE_SECURE": "1",
                "BAI_HEALTH_ATTEMPTS": "1",
                "BAI_HEALTH_DELAY_SECONDS": "0",
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
        live_data = self.root / "live-data-no-secret"
        live_data.mkdir()
        db_path = live_data / "lab-feed.db"
        db_path.write_bytes(b"must remain untouched")
        env = os.environ.copy()
        env.pop("LAB_FEED_SECRET", None)
        env.update(
            {
                "BAI_WEBSITE_REPO": str(repo),
                "BAI_LIVE_WEB_DIR": str(self.root / "live-web-no-secret"),
                "LAB_FEED_DB": str(db_path),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups-no-secret"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks-no-secret"),
                "BAI_UPLOAD_DIR": str(live_data / "uploads"),
                "LAB_FEED_COOKIE_SECURE": "1",
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
        live_data = self.root / "live-data-override"
        upload = live_data / "uploads" / "materials" / "existing.pdf"
        upload.parent.mkdir(parents=True)
        upload.write_bytes(b"must survive")
        env = os.environ.copy()
        env.update(
            {
                "BAI_WEBSITE_REPO": str(repo),
                "BAI_LIVE_WEB_DIR": str(self.root / "live-web-override"),
                "LAB_FEED_DB": str(live_data / "lab-feed.db"),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups-override"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks-override"),
                "BAI_UPLOAD_DIR": str(live_data / "uploads"),
                "LAB_FEED_SECRET": "s" * 32,
                "LAB_FEED_COOKIE_SECURE": "1",
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
    def test_next_only_web_sync_preserves_data_and_never_mutates_legacy_sources(self):
        repo = self.root / "repo-web-upload"
        for relative in ("apps/web", "scripts"):
            (repo / relative).mkdir(parents=True, exist_ok=True)
        (repo / "apps/web" / "page.tsx").write_text("new web", encoding="utf-8")

        live_web = self.root / "live-web"
        upload = live_web / "runtime-uploads" / "materials" / "existing.pdf"
        upload.parent.mkdir(parents=True)
        upload.write_bytes(b"must survive web rsync")
        (live_web / ".env.local").write_text("PRESERVE=1", encoding="utf-8")
        (live_web / "obsolete.txt").write_text("delete", encoding="utf-8")
        live_data = self.root / "live-data"
        live_data.mkdir()
        (live_data / "lab-feed.db").write_bytes(b"backup stub fixture")
        live_backend = self.root / "legacy-backend"
        live_backend.mkdir()
        (live_backend / "app.py").write_text("preserved backend", encoding="utf-8")
        live_frontend = self.root / "legacy-frontend"
        live_frontend.mkdir()
        (live_frontend / "krds.js").write_text("preserved frontend", encoding="utf-8")

        stubs = self.root / "stubs"
        stubs.mkdir()
        self._write_executable(stubs, "npm", "exit 0\n")
        self._write_executable(stubs, "launchctl", "exit 0\n")
        self._write_executable(stubs, "git", "printf 'deadbee\\n'\n")
        self._write_executable(
            stubs,
            "curl",
            """
case "$*" in
  *127.0.0.1:5067/login*) printf '200' ;;
  *127.0.0.1:5067/api/healthz*) printf '200' ;;
  *127.0.0.1:5067/api/me*) printf '401' ;;
  *127.0.0.1:5067/api/runtime-health*) printf '200' ;;
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
                "LAB_FEED_DB": str(live_data / "lab-feed.db"),
                "BAI_LIVE_BACKUP_DIR": str(self.root / "backups"),
                "BAI_ROLLBACK_DIR": str(self.root / "rollbacks"),
                "BAI_UPLOAD_DIR": str(live_web / "runtime-uploads"),
                "LAB_FEED_SECRET": "s" * 32,
                "LAB_FEED_COOKIE_SECURE": "1",
            }
        )
        subprocess.run(["bash", str(DEPLOY_SCRIPT)], env=env, check=True)

        self.assertEqual(upload.read_bytes(), b"must survive web rsync")
        self.assertEqual((live_web / ".env.local").read_text(), "PRESERVE=1")
        self.assertFalse((live_web / "obsolete.txt").exists())
        self.assertEqual((live_web / "page.tsx").read_text(), "new web")
        self.assertEqual((live_backend / "app.py").read_text(), "preserved backend")
        self.assertEqual((live_frontend / "krds.js").read_text(), "preserved frontend")

        # A later release that fails its runtime health check must restore the
        # preceding code while leaving data/config untouched.
        (repo / "apps/web" / "page.tsx").write_text("bad web", encoding="utf-8")
        self._write_executable(
            stubs,
            "curl",
            """
case "$*" in
  *127.0.0.1:5067/login*) printf '200' ;;
  *127.0.0.1:5067/api/healthz*) printf '200' ;;
  *127.0.0.1:5067/api/me*) printf '401' ;;
  *127.0.0.1:5067/api/runtime-health*) exit 22 ;;
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
        self.assertEqual((live_backend / "app.py").read_text(), "preserved backend")
        self.assertEqual((live_frontend / "krds.js").read_text(), "preserved frontend")
        self.assertEqual(upload.read_bytes(), b"must survive web rsync")
        self.assertEqual((live_web / ".env.local").read_text(), "PRESERVE=1")

    def test_backup_gate_runs_after_checks_and_before_first_live_sync(self):
        source = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        backup_call = source.index("npm run backup")
        first_build = source.index("npm ci")
        first_rsync = source.index("rsync -a --checksum --delete")
        self.assertLess(first_build, backup_call)
        self.assertLess(backup_call, first_rsync)
        self.assertIn("I_UNDERSTAND_THIS_CREATES_A_NEW_EMPTY_BAI_DATABASE", source)
        self.assertIn('"$next_origin/api/healthz"', source)
        self.assertIn('"$next_origin/api/me"', source)
        self.assertIn('"$next_origin/api/runtime-health"', source)
        self.assertIn("Deployment failed; restoring previous code", source)
        self.assertNotIn("backend_launchd_label", source)
        self.assertNotIn("BAI_API_ORIGIN", source)
        self.assertNotIn("5066", source)
        self.assertNotIn("backup_db.py", source)

    def test_deploy_script_has_no_python_or_legacy_source_sync(self):
        source = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("python_bin", source)
        self.assertNotIn("BAI_BACKUP_PYTHON", source)
        self.assertNotIn("backup_db.py", source)
        self.assertNotIn('"$repo_dir/backend/"', source)
        self.assertNotIn('"$repo_dir/frontend/"', source)
        self.assertNotIn("com.user.baifeed", source)

    def test_deploy_rejects_broad_or_source_overlapping_live_targets(self):
        source = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        self.assertIn('/|"$repo_dir"|"$repo_dir/"*)', source)
        self.assertIn('live web directory cannot be a symlink', source)
        self.assertIn('dev|dev-insecure-secret|change-me-*)', source)

    def test_migration_runs_after_live_build_and_backup_before_any_restart(self):
        source = DEPLOY_SCRIPT.read_text(encoding="utf-8")
        backup_call = source.index("npm run backup")
        live_sync = source.index("rsync -a --checksum --delete")
        cache_cleanup = source.index('rm -rf -- "$live_web_dir/.next"')
        live_build = source.index("npm run build", cache_cleanup)
        migration = source.index(
            'LAB_FEED_DB="$live_db_path" LAB_FEED_DB_READONLY=0 npm run migrate'
        )
        first_restart = source.index('launchctl kickstart -k', migration)
        self.assertLess(backup_call, migration)
        self.assertLess(live_sync, cache_cleanup)
        self.assertLess(cache_cleanup, live_build)
        self.assertLess(live_build, migration)
        self.assertLess(migration, first_restart)

    def test_automation_uses_the_same_node_runtime_as_production(self):
        expected_path_prefix = 'export PATH="/Users/hai_1/.local/bin:'
        for script in (AUTODEPLOY_SCRIPT, PR_REVIEW_SCRIPT):
            with self.subTest(script=script.name):
                self.assertIn(expected_path_prefix, script.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
