#!/usr/bin/env python3
"""BAI 피드 DB 백업 — 매일 1회 cron/launchd로 실행.

sqlite3 .backup API로 라이브 DB를 안전하게 복사(잠금 중에도 OK).
최근 14벌만 보관, 그 이상은 자동 삭제.
"""
import os
import sqlite3
import glob
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("LAB_FEED_DB", os.path.join(HERE, "..", "backend", "lab-feed.db"))
BACKUP_DIR = os.environ.get("LAB_FEED_BACKUP_DIR", os.path.join(HERE, "..", "backups"))
KEEP = 14


def main():
    if not os.path.exists(DB):
        print(f"DB 없음: {DB} — 백업 스킵")
        return 0
    os.makedirs(BACKUP_DIR, exist_ok=True)
    # 타임스탬프는 인자로 받거나(테스트), 실행 시각 사용
    stamp = sys.argv[1] if len(sys.argv) > 1 else datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"lab-feed-{stamp}.db")

    src = sqlite3.connect(DB)
    try:
        bck = sqlite3.connect(dest)
        with bck:
            src.backup(bck)   # 라이브 잠금 안전
        bck.close()
    finally:
        src.close()
    print(f"✅ 백업: {dest}")

    # 오래된 백업 정리 (최근 KEEP벌만)
    backups = sorted(glob.glob(os.path.join(BACKUP_DIR, "lab-feed-*.db")))
    for old in backups[:-KEEP]:
        os.remove(old)
        print(f"   정리: {os.path.basename(old)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
