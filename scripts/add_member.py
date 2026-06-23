#!/usr/bin/env python3
"""HAI Lab Feed 멤버 발급 CLI.

사용법 (venv 파이썬으로 실행):
  ../backend/venv/bin/python add_member.py --name 김영희 --role student
  (비밀번호는 프롬프트로 입력, API키는 자동 생성되어 출력됨)
"""
import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from lab_feed_db import LabFeedDB  # noqa: E402
import auth  # noqa: E402

DB_PATH = os.environ.get(
    "LAB_FEED_DB",
    os.path.join(os.path.dirname(__file__), "..", "backend", "lab-feed.db"),
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--role", default="student", choices=["student", "pi"])
    args = ap.parse_args()

    db = LabFeedDB(DB_PATH)
    db.init_schema()
    if db.get_member_by_name(args.name):
        print(f"이미 존재하는 이름입니다: {args.name}")
        sys.exit(1)

    pw = getpass.getpass("비밀번호: ")
    pw2 = getpass.getpass("비밀번호 확인: ")
    if pw != pw2:
        print("비밀번호가 일치하지 않습니다.")
        sys.exit(1)

    api_key = auth.make_api_key()
    mid = db.add_member(name=args.name, password_hash=auth.hash_password(pw),
                        api_key=api_key, role=args.role)
    print(f"✅ 멤버 생성됨 (id={mid}, role={args.role})")
    print(f"   이름:   {args.name}")
    print(f"   API키:  {api_key}")
    print("   → 이 API키를 학생에게 전달하세요 (스킬 설정에 1회 저장).")


if __name__ == "__main__":
    main()
