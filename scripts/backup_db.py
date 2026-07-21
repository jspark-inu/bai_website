#!/usr/bin/env python3
"""BAI 피드 DB 검증 백업 — cron/launchd 및 배포 사전 점검용.

원본 quick_check 후 sqlite3 online backup API로 복사하고, 복사본의
integrity_check가 성공한 경우에만 최종 파일명으로 원자적으로 확정한다.
"""
import argparse
import os
import sqlite3
import glob
import sys
import datetime
import re
import tempfile
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(HERE, "..", "backend", "lab-feed.db")
DEFAULT_BACKUP_DIR = os.path.join(HERE, "..", "backups")
DEFAULT_KEEP = 14
SAFE_STAMP = re.compile(r"^[0-9A-Za-z._-]+$")
REQUIRED_SCHEMA = {
    "members": {"id", "name"},
    "posts": {"id", "author_id"},
}


class BackupError(RuntimeError):
    pass


def _readonly_connection(db_path):
    uri = Path(db_path).resolve().as_uri() + "?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=30)


def _check_database(db_path, pragma):
    try:
        conn = _readonly_connection(db_path)
        try:
            rows = conn.execute(f"PRAGMA {pragma}").fetchall()
        finally:
            conn.close()
    except sqlite3.Error as exc:
        raise BackupError(f"{pragma} 실행 실패: {db_path}: {exc}") from exc
    if not rows or any(row[0] != "ok" for row in rows):
        detail = "; ".join(str(row[0]) for row in rows[:10]) or "결과 없음"
        raise BackupError(f"{pragma} 실패: {db_path}: {detail}")


def _validate_bai_database(db_path):
    """Reject a healthy-but-unrelated database or one with broken relations."""
    try:
        conn = _readonly_connection(db_path)
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            missing_tables = sorted(set(REQUIRED_SCHEMA) - tables)
            if missing_tables:
                raise BackupError(
                    "BAI 핵심 테이블 누락: %s: %s"
                    % (db_path, ", ".join(missing_tables))
                )
            for table, required_columns in REQUIRED_SCHEMA.items():
                columns = {
                    row[1]
                    for row in conn.execute("PRAGMA table_info(%s)" % table).fetchall()
                }
                missing_columns = sorted(required_columns - columns)
                if missing_columns:
                    raise BackupError(
                        "BAI 핵심 컬럼 누락: %s.%s: %s"
                        % (db_path, table, ", ".join(missing_columns))
                    )
            foreign_key_errors = conn.execute("PRAGMA foreign_key_check").fetchmany(10)
            if foreign_key_errors:
                detail = "; ".join(
                    "%s rowid=%s parent=%s" % (row[0], row[1], row[2])
                    for row in foreign_key_errors
                )
                raise BackupError(f"foreign_key_check 실패: {db_path}: {detail}")
        finally:
            conn.close()
    except BackupError:
        raise
    except sqlite3.Error as exc:
        raise BackupError(f"BAI 스키마 검증 실패: {db_path}: {exc}") from exc


def _fsync_file(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_directory(path):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def create_verified_backup(db_path, backup_dir, stamp=None, keep=DEFAULT_KEEP):
    db_path = os.path.abspath(db_path)
    backup_dir = os.path.abspath(backup_dir)
    if not os.path.isfile(db_path):
        raise BackupError(f"라이브 DB가 없거나 일반 파일이 아님: {db_path}")
    if keep < 1:
        raise BackupError("백업 보관 개수는 1 이상이어야 함")

    stamp = stamp or datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    if not SAFE_STAMP.fullmatch(stamp):
        raise BackupError(f"안전하지 않은 백업 타임스탬프: {stamp!r}")

    # Never create a destination or prune an older backup unless the source is
    # already a readable, internally consistent SQLite database.
    _check_database(db_path, "quick_check")
    _validate_bai_database(db_path)
    os.makedirs(backup_dir, exist_ok=True)
    dest = os.path.join(backup_dir, f"lab-feed-{stamp}.db")
    if os.path.exists(dest):
        raise BackupError(f"기존 백업을 덮어쓰지 않음: {dest}")

    fd, temp_path = tempfile.mkstemp(
        prefix=".lab-feed-backup-", suffix=".db.tmp", dir=backup_dir
    )
    os.close(fd)
    try:
        src = _readonly_connection(db_path)
        try:
            bck = sqlite3.connect(temp_path, timeout=30)
            try:
                src.backup(bck)
            finally:
                bck.close()
        finally:
            src.close()

        # A failed or interrupted copy remains hidden under the temporary name.
        # Only a fully verified file becomes a retained backup.
        _check_database(temp_path, "integrity_check")
        _validate_bai_database(temp_path)
        _fsync_file(temp_path)
        os.replace(temp_path, dest)
        temp_path = None
        _fsync_directory(backup_dir)
    except sqlite3.Error as exc:
        raise BackupError(f"SQLite online backup 실패: {exc}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

    backups = sorted(glob.glob(os.path.join(backup_dir, "lab-feed-*.db")))
    for old in backups[:-keep]:
        os.remove(old)
        print(f"   정리: {os.path.basename(old)}")
    return dest


def main(argv=None):
    parser = argparse.ArgumentParser(description="BAI SQLite 검증 온라인 백업")
    parser.add_argument("stamp", nargs="?", help="선택적 백업 식별자")
    parser.add_argument("--db", default=os.environ.get("LAB_FEED_DB", DEFAULT_DB))
    parser.add_argument(
        "--backup-dir",
        default=os.environ.get("LAB_FEED_BACKUP_DIR", DEFAULT_BACKUP_DIR),
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=int(os.environ.get("LAB_FEED_BACKUP_KEEP", str(DEFAULT_KEEP))),
    )
    args = parser.parse_args(argv)
    try:
        dest = create_verified_backup(
            args.db, args.backup_dir, stamp=args.stamp, keep=args.keep
        )
    except (BackupError, OSError, ValueError) as exc:
        print(f"백업 실패: {exc}", file=sys.stderr)
        return 1
    print(f"✅ 검증 백업: {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
