#!/usr/bin/env python3
"""PI를 role=pi 멤버로 1C38 멤버 테이블에 시드.
role='pi'는 1C40 코크핏·1C41 Professor OS 양쪽이 모두 인정하는 canonical PI 역할.
usage: backend/venv/bin/python scripts/add_pi.py --name 박준성
출력된 비밀번호로 /login 후 /pi 진입."""
import argparse, os, secrets, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "backend"))
from lab_feed_db import LabFeedDB  # noqa: E402
import auth  # noqa: E402

DB = os.environ.get("LAB_FEED_DB", os.path.join(HERE, "..", "backend", "lab-feed.db"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--password", default=None)
    args = ap.parse_args()
    db = LabFeedDB(DB)
    db.init_schema()
    if db.get_member_by_name(args.name):
        print("이미 존재: %s" % args.name); return
    pw = args.password or secrets.token_urlsafe(9)
    api_key = auth.make_api_key()
    mid = db.add_member(name=args.name, password_hash=auth.hash_password(pw),
                        api_key=api_key, role="pi")
    print("PI 생성 id=%d name=%s" % (mid, args.name))
    print("비밀번호: %s" % pw)
    print("→ /login 으로 로그인 후 /pi 진입")


if __name__ == "__main__":
    main()
