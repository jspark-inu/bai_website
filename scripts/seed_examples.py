"""BAI 피드 예시 데이터 시드.

학생들이 사용법을 보고 따라할 수 있게 모든 보드(피드·미해결질문·멤버·태그·
프로필·이번 주 보고현황)가 채워지도록 예시를 만든다. 데모용 약한 비번 대신
멤버마다 강한 랜덤 비번을 발급하고, PI 계정 비번만 표준출력으로 알린다.

사용: backend/venv/bin/python scripts/seed_examples.py --db <경로> [--force]
빈 DB(멤버 0)일 때만 시드. 이미 데이터 있으면 --force 없이는 거부.
"""
import argparse
import os
import secrets
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "backend")
sys.path.insert(0, BACKEND)

from lab_feed_db import LabFeedDB  # noqa: E402
import auth  # noqa: E402


def make_pw():
    return secrets.token_urlsafe(12)


def seed(db_path, force=False):
    db = LabFeedDB(db_path)
    db.init_schema()
    existing = db.list_members_with_stats()
    if existing and not force:
        print("이미 멤버가 있는 DB — --force 없이는 시드 안 함", file=sys.stderr)
        return 1

    creds = {}

    def member(name, role="student"):
        pw = make_pw()
        creds[name] = pw
        mid = db.add_member(
            name=name,
            password_hash=auth.hash_password(pw),
            api_key="seed-" + secrets.token_urlsafe(16),
            role=role,
        )
        return mid

    pi = member("박준성", role="pi")
    seoyeon = member("김서연")
    junho = member("이준호")
    minji = member("정민지")
    member("한지우")  # 일부러 글 없음 → '이번 주 미보고자' 예시

    # --- 학생 예시 글들 (피드/태그/질문/프로필용) ---
    p1 = db.add_post(
        author_id=seoyeon,
        did="CycleGAN 논문(Zhu et al., 2017) 리뷰 정리. 쌍 없는 데이터로 도메인 변환하는 구조 파악.",
        learned="핵심은 cycle-consistency loss — '바꿨다가 되돌리면 원본과 같아야 한다'는 제약이 짝 없는 학습을 가능하게 함.",
        blocked="",
        tags="논문 GAN 컴퓨터비전",
        source="web",
    )
    p2 = db.add_post(
        author_id=junho,
        did="Steam 게임 리뷰 12만 건 크롤링 + 한글 전처리 파이프라인 구축.",
        learned="API rate limit은 지수 백오프로. 한글 리뷰는 정규화 먼저 안 하면 토큰화가 깨진다.",
        blocked="감성 라벨이 없는데, 약지도(weak supervision)로 만들어볼지 아니면 일부만 수기 라벨링할지 고민됩니다. 조언 구해요.",
        tags="데이터수집 NLP 실험",
        links="https://github.com/example/steam-reviews",
        source="skill",
    )
    p3 = db.add_post(
        author_id=minji,
        did="첫 주차 환경 셋업 — 파이썬/우분투/주피터 + 깃 기본 명령 익힘.",
        learned="가상환경 안 쓰면 의존성 충돌 지옥. venv 습관화하기로.",
        blocked="논문을 어디서부터 읽어야 할지 막막합니다. 입문 추천 받을 수 있을까요?",
        tags="온보딩 질문",
        source="web",
    )
    p4 = db.add_post(
        author_id=seoyeon,
        did="CycleGAN을 우리 데이터(스케치→사진)에 적용. 1차 결과 데모 링크 첨부.",
        learned="배치 사이즈를 키우니 mode collapse가 줄었다. lr 워밍업도 초반 안정에 도움.",
        blocked="검증셋에서만 색 번짐이 생깁니다 — 학습/검증 분리가 새는 데이터 누수 의심 중.",
        tags="실험 GAN",
        links="https://github.com/example/sketch2photo https://demo.example.com/run42",
        source="skill",
    )
    p5 = db.add_post(
        author_id=junho,
        did="감성분석 베이스라인(TF-IDF + 로지스틱 회귀) 정확도 0.81 확보.",
        learned="단순 베이스라인이 생각보다 강하다. 딥러닝 가기 전에 기준선부터 잡는 게 맞다.",
        blocked="",
        tags="NLP 실험 베이스라인",
        source="web",
    )
    # PI 환영/사용법 글 — 마지막 삽입 → 피드 맨 위
    p6 = db.add_post(
        author_id=pi,
        did="🎉 BAI 피드 오픈! 이제 주 1회 대면보고 대신 진행상황을 여기에 올립니다.",
        learned="쓰는 법은 3칸: ① 한 일/결과 ② 배운 것/인사이트 ③ 막힌 점/질문. "
                "스킬 `/진행보고`로 자동으로 올리거나, 웹에서 [+ 새 글쓰기]로 직접 써도 됩니다. "
                "막힌 점/질문을 적으면 위 ❓미해결 보드에 모여서 서로 답을 달 수 있어요.",
        blocked="",
        tags="공지 사용법",
        source="web",
    )

    # --- 댓글: p3(온보딩 질문)에 PI가 답 → '답변된 질문' 흐름 예시 ---
    db.add_comment(
        post_id=p3,
        author_id=pi,
        body="본인 관심 도메인의 서베이(survey) 논문 1편부터 시작하세요. "
             "김서연 학생의 CycleGAN 리뷰 글 형식을 참고하면 좋아요.",
    )
    db.add_comment(
        post_id=p1,
        author_id=junho,
        body="cycle-consistency 설명 깔끔하네요. 저도 데이터 증강에 응용해볼게요 👍",
    )

    # --- 반응(👍): 글마다 분포 ---
    for mid in (pi, junho):
        db.toggle_reaction(p1, mid)
    for mid in (seoyeon, minji, pi):
        db.toggle_reaction(p5, mid)
    for mid in (seoyeon, junho, minji):
        db.toggle_reaction(p6, mid)

    print("시드 완료 — 멤버 5명, 글 6개, 댓글 2개, 반응 분포 적용")
    print("  · 미해결질문 보드: p2(이준호), p4(김서연)  ← blocked 있고 댓글 0")
    print("  · 답변된 질문: p3(정민지)  ← PI 댓글 달림")
    print("  · 프로필 여정 예시: 김서연(글 2개)")
    print("  · 이번 주 미보고자 예시: 한지우(글 0개)")
    print("\n=== 계정 비밀번호 (PI만 확인, 외부 유출 금지) ===")
    for name, pw in creds.items():
        print(f"  {name}: {pw}")
    print("\n실제 학생 계정은 scripts/add_member.py로 별도 발급하세요.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    return seed(args.db, force=args.force)


if __name__ == "__main__":
    sys.exit(main())
