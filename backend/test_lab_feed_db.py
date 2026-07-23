import os
import sqlite3
import tempfile
import threading
import time

import pytest
from lab_feed_db import LabFeedDB, SQLITE_BUSY_TIMEOUT_MS


@pytest.fixture
def db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    d = LabFeedDB(path)
    d.init_schema()
    yield d
    os.remove(path)


def _member(db, name="김영희"):
    return db.add_member(name=name, password_hash="h", api_key="k-" + name, role="student")


def test_add_and_get_member(db):
    mid = db.add_member(name="김영희", password_hash="h", api_key="k1", role="student")
    m = db.get_member_by_id(mid)
    assert m["name"] == "김영희"
    assert m["role"] == "student"
    assert m["api_key"] == "k1"
    assert m["status"] == "active"


def test_get_member_by_api_key(db):
    db.add_member(name="이철수", password_hash="h", api_key="abc", role="student")
    m = db.get_member_by_api_key("abc")
    assert m["name"] == "이철수"
    assert db.get_member_by_api_key("nope") is None


def test_disabled_member_cannot_authenticate_by_name_or_api_key(db):
    mid = db.add_member(name="휴학생", password_hash="h", api_key="disabled-key", role="student")
    db.update_member_account(mid, status="disabled")
    assert db.get_member_by_name("휴학생") is None
    assert db.get_member_by_api_key("disabled-key") is None
    raw = db.get_member_by_id(mid, include_disabled=True)
    assert raw["status"] == "disabled"


def test_member_account_update_and_secret_rotation(db):
    mid = db.add_member(name="김영희", password_hash="old", api_key="old-key", role="student")
    db.update_member_account(mid, name="김영희2", role="pi", status="active")
    db.update_member_password(mid, "new-hash")
    db.update_member_api_key(mid, "new-key")
    m = db.get_member_by_id(mid)
    assert m["name"] == "김영희2"
    assert m["role"] == "pi"
    assert m["password_hash"] == "new-hash"
    assert m["api_key"] == "new-key"
    assert db.get_member_by_api_key("old-key") is None
    assert db.get_member_by_api_key("new-key")["id"] == mid


def test_member_audit_log_records_admin_action(db):
    admin = db.add_member(name="교수", password_hash="h", api_key="admin", role="pi")
    target = db.add_member(name="학생", password_hash="h", api_key="student", role="student")
    db.add_audit_log(admin, "member.disabled", target, "학생 비활성화")
    rows = db.list_audit_log()
    assert rows[0]["actor_name"] == "교수"
    assert rows[0]["target_name"] == "학생"
    assert rows[0]["action"] == "member.disabled"
    assert rows[0]["detail"] == "학생 비활성화"


def test_disabled_members_are_excluded_from_public_lists_and_weekly(db):
    active = _member(db, "활동학생")
    disabled = _member(db, "비활동학생")
    db.update_member_account(disabled, status="disabled")
    db.add_post(author_id=active, did="이번주 작업", learned="", blocked="", tags="")
    db.add_post(author_id=disabled, did="예전 작업", learned="", blocked="", tags="")
    names = [m["name"] for m in db.list_members_with_stats()]
    weekly_names = [m["name"] for m in db.weekly_report_status("2000-01-01 00:00:00")]
    assert names == ["활동학생"]
    assert weekly_names == ["활동학생"]


def test_get_member_by_name(db):
    db.add_member(name="박교수", password_hash="h", api_key="k", role="pi")
    m = db.get_member_by_name("박교수")
    assert m["role"] == "pi"
    assert db.get_member_by_name("없음") is None


def test_add_and_list_posts(db):
    a = _member(db)
    db.add_post(author_id=a, did="GAN 학습", learned="배치 키움", blocked="누수 의심", tags="실험", source="skill")
    posts = db.list_posts()
    assert len(posts) == 1
    p = posts[0]
    assert p["did"] == "GAN 학습"
    assert p["author_name"] == "김영희"
    assert p["source"] == "skill"


def test_list_posts_newest_first(db):
    a = _member(db)
    p1 = db.add_post(author_id=a, did="첫", learned="", blocked="", tags="")
    p2 = db.add_post(author_id=a, did="둘", learned="", blocked="", tags="")
    posts = db.list_posts()
    assert posts[0]["id"] == p2  # 최신순
    assert posts[1]["id"] == p1


def test_get_post(db):
    a = _member(db)
    pid = db.add_post(author_id=a, did="x", learned="y", blocked="z", tags="t")
    p = db.get_post(pid)
    assert p["learned"] == "y"
    assert p["author_name"] == "김영희"
    assert db.get_post(99999) is None


def test_update_post(db):
    a = _member(db)
    pid = db.add_post(author_id=a, did="old", learned="", blocked="", tags="")
    db.update_post(pid, did="new", learned="L", blocked="B", tags="실험")
    p = db.get_post(pid)
    assert p["did"] == "new"
    assert p["tags"] == "실험"
    assert p["updated_at"] is not None


def test_post_links_roundtrip(db):
    a = _member(db)
    pid = db.add_post(author_id=a, did="x", learned="", blocked="", tags="",
                      links="https://github.com/me/proj https://demo.example.com")
    p = db.get_post(pid)
    assert "github.com/me/proj" in p["links"]
    db.update_post(pid, did="x", learned="", blocked="", tags="",
                   links="https://new.example.com")
    assert db.get_post(pid)["links"] == "https://new.example.com"


def test_search_includes_links(db):
    a = _member(db)
    db.add_post(author_id=a, did="x", learned="", blocked="", tags="",
                links="https://github.com/me/ganzoo")
    assert len(db.search_posts("ganzoo")) == 1


def test_materials_board_crud_and_filters(db):
    author = _member(db, "자료담당")
    other = _member(db, "다른학생")
    first = db.add_material(
        author_id=author,
        title="BAI 온보딩",
        body="첫 모임 전에 읽어오기",
        url="https://example.com/onboarding",
        category="온보딩",
        guild="공통",
    )
    second = db.add_material(
        author_id=other,
        title="웹길드 체크리스트",
        body="배포 전 점검",
        url="",
        category="길드",
        guild="웹",
    )

    rows = db.list_materials()
    assert [r["id"] for r in rows] == [second, first]
    assert rows[1]["author_name"] == "자료담당"
    assert rows[1]["category"] == "온보딩"
    assert db.list_materials(category="온보딩")[0]["id"] == first
    assert db.list_materials(guild="웹")[0]["id"] == second

    db.update_material(first, title="BAI 온보딩 v2", body="수정", url="", category="온보딩", guild="공통")
    assert db.get_material(first)["title"] == "BAI 온보딩 v2"
    db.delete_material(second)
    assert [r["id"] for r in db.list_materials()] == [first]


def test_migration_adds_links_column():
    """links 컬럼 없는 옛 DB를 init_schema가 마이그레이션."""
    import sqlite3
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        # 옛 스키마(링크 없음) 수동 생성
        c = sqlite3.connect(path)
        c.executescript(
            "CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT UNIQUE, "
            "password_hash TEXT, api_key TEXT UNIQUE, role TEXT, created_at TEXT);"
            "CREATE TABLE posts(id INTEGER PRIMARY KEY, author_id INTEGER, did TEXT, "
            "learned TEXT, blocked TEXT, tags TEXT, source TEXT, "
            "created_at TEXT, updated_at TEXT);"
        )
        c.commit()
        c.close()
        d = LabFeedDB(path)
        d.init_schema()   # 마이그레이션 실행
        mid = d.add_member(name="김", password_hash="h", api_key="k", role="student")
        pid = d.add_post(author_id=mid, did="x", learned="", blocked="", tags="",
                         links="https://x.com")
        assert d.get_post(pid)["links"] == "https://x.com"
    finally:
        os.remove(path)


def test_init_schema_rolls_back_the_whole_upgrade_on_failure():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        conn = sqlite3.connect(path)
        conn.execute(
            "CREATE TABLE members(id INTEGER PRIMARY KEY, name TEXT UNIQUE, "
            "password_hash TEXT, api_key TEXT UNIQUE, role TEXT, created_at TEXT)"
        )
        conn.execute(
            "INSERT INTO members(id, name, password_hash, api_key, role, created_at) "
            "VALUES (41, '기존학생', 'h', 'k', 'student', '2026-01-01')"
        )
        conn.commit()
        conn.close()

        db = LabFeedDB(path)
        original = db._ensure_column

        def fail_after_first_upgrade(conn, table, column, decl):
            original(conn, table, column, decl)
            if table == "members" and column == "status":
                raise RuntimeError("simulated migration failure")

        db._ensure_column = fail_after_first_upgrade
        with pytest.raises(RuntimeError, match="simulated migration failure"):
            db.init_schema()

        conn = sqlite3.connect(path)
        columns = [row[1] for row in conn.execute("PRAGMA table_info(members)")]
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert "status" not in columns
        assert "posts" not in tables
        assert conn.execute("SELECT id, name FROM members").fetchall() == [(41, "기존학생")]
        conn.close()
    finally:
        os.remove(path)


def test_next_first_schema_upgrade_preserves_rows_ids_and_foreign_keys():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript("""
            CREATE TABLE members(
                id INTEGER PRIMARY KEY, name TEXT UNIQUE, password_hash TEXT,
                api_key TEXT UNIQUE, role TEXT, created_at TEXT
            );
            CREATE TABLE projects(
                id INTEGER PRIMARY KEY, title TEXT, type TEXT, status TEXT,
                goal TEXT, current_stage TEXT, deadline TEXT,
                next_milestone TEXT, risk_level TEXT, pi_decision TEXT,
                created_at TEXT, updated_at TEXT
            );
            CREATE TABLE posts(
                id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES members(id),
                did TEXT, learned TEXT, blocked TEXT, tags TEXT, source TEXT,
                created_at TEXT, updated_at TEXT
            );
            CREATE TABLE materials(
                id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES members(id),
                title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '자료',
                guild TEXT NOT NULL DEFAULT '', file_url TEXT NOT NULL DEFAULT '',
                file_name TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE talent_requests(
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, problem TEXT NOT NULL,
                expected_outcome TEXT NOT NULL DEFAULT '',
                system_scope_reason TEXT NOT NULL DEFAULT '',
                requester_member_id INTEGER NOT NULL REFERENCES members(id),
                status TEXT NOT NULL DEFAULT 'submitted',
                solution_summary TEXT NOT NULL DEFAULT '',
                solution_url TEXT NOT NULL DEFAULT '',
                completion_note TEXT NOT NULL DEFAULT '', completed_at TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE talent_request_assignees(
                request_id INTEGER NOT NULL REFERENCES talent_requests(id),
                member_id INTEGER NOT NULL REFERENCES members(id),
                allocation_ratio REAL NOT NULL,
                assigned_at TEXT NOT NULL,
                PRIMARY KEY(request_id, member_id)
            );
            CREATE TABLE contribution_points(
                id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES talent_requests(id),
                member_id INTEGER NOT NULL REFERENCES members(id), points REAL NOT NULL,
                reason TEXT NOT NULL, awarded_at TEXT NOT NULL,
                UNIQUE(request_id, member_id)
            );

            INSERT INTO members VALUES(41, '기존학생', 'hash', 'key', 'student', '2026-01-01');
            INSERT INTO projects VALUES(17, '기존 프로젝트', '웹', 'active', '목표', '', '', '', 'normal', '', '2026-01-02', '2026-01-02');
            INSERT INTO posts VALUES(73, 41, '기존 기록', '', '', '실험', 'web', '2026-01-03', '2026-01-03');
            INSERT INTO materials VALUES(91, 41, '기존 자료', '본문', '', '온보딩', '공통', '/uploads/materials/old.pdf', 'old.pdf');
            INSERT INTO talent_requests VALUES(31, '기존 요청', '문제', '결과', '공통 문제', 41, 'accepted', '', '', '', NULL, '2026-01-04', '2026-01-04');
            INSERT INTO talent_request_assignees VALUES(31, 41, 1.0, '2026-01-05');
            INSERT INTO contribution_points VALUES(51, 31, 41, 10, '기존 기여', '2026-01-06');
        """)
        conn.commit()
        conn.close()

        db = LabFeedDB(path)
        db.init_schema()

        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("SELECT id, name FROM members").fetchall()[0][0] == 41
        assert conn.execute("SELECT id, did, author_id FROM posts").fetchone()[0] == 73
        material = conn.execute("SELECT * FROM materials WHERE id=91").fetchone()
        assert material["title"] == "기존 자료"
        assert material["file_url"] == "/uploads/materials/old.pdf"
        assert material["created_at"] and material["updated_at"]
        request = conn.execute("SELECT * FROM talent_requests WHERE id=31").fetchone()
        assert request["requester_member_id"] == 41
        assert request["submitted_at"] == "2026-01-04"
        assert request["review_note"] == ""
        assignee = conn.execute(
            "SELECT * FROM talent_request_assignees WHERE request_id=31"
        ).fetchone()
        assert assignee["member_id"] == 41 and assignee["role"] == ""
        assert conn.execute("SELECT id FROM contribution_points").fetchone()[0] == 51
        conn.close()

        new_material = db.add_material(41, "새 자료", body="본문")
        new_request = db.add_talent_request(41, "새 요청", "문제", "결과", "공통")
        assert db.get_material(new_material)["created_at"]
        assert db.get_talent_request(new_request)["submitted_at"]
    finally:
        os.remove(path)


def test_connections_wait_briefly_for_a_concurrent_writer(db):
    conn = db._conn()
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == SQLITE_BUSY_TIMEOUT_MS
    conn.execute("BEGIN IMMEDIATE")
    errors = []

    def write_after_lock():
        try:
            db.add_member("동시접속", "h", "concurrent-key", role="student")
        except Exception as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    worker = threading.Thread(target=write_after_lock)
    worker.start()
    time.sleep(0.05)
    conn.commit()
    conn.close()
    worker.join(timeout=2)

    assert not worker.is_alive()
    assert errors == []
    assert db.get_member_by_name("동시접속")["api_key"] == "concurrent-key"


def test_talent_request_completion_awards_ten_points_once(db):
    requester = _member(db, "요청자")
    builder = _member(db, "개발자")
    rid = db.add_talent_request(
        requester_member_id=requester,
        title="수강 안내 반복 질문 줄이기",
        problem="같은 안내 질문이 반복된다",
        expected_outcome="안내 페이지 또는 도구",
        system_scope_reason="여러 학생이 매 학기 반복해서 겪는다",
    )
    db.review_talent_request(rid, status="accepted", review_note="시스템 개선 요청")
    db.assign_talent_request(rid, [(builder, "개발", 1.0)])
    db.submit_talent_solution(rid, builder, "안내 도구를 만들었다", "https://example.com/demo")

    assert db.complete_talent_request(rid, requester) == [{"member_id": builder, "points": 10}]
    assert db.complete_talent_request(rid, requester) == []
    assert db.list_contribution_points(builder)[0]["points"] == 10


def test_list_posts_by_member_chronological(db):
    a = _member(db, "김영희")
    b = _member(db, "이철수")
    p1 = db.add_post(author_id=a, did="첫", learned="", blocked="", tags="GAN")
    db.add_post(author_id=b, did="남의글", learned="", blocked="", tags="")
    p2 = db.add_post(author_id=a, did="둘", learned="", blocked="", tags="GAN 실험")
    posts = db.list_posts_by_member(a)
    assert len(posts) == 2                 # 남의 글 제외
    assert posts[0]["id"] == p1            # 오래된→최신 (여정 순서)
    assert posts[1]["id"] == p2
    assert all(p["author_name"] == "김영희" for p in posts)


def test_member_tag_counts(db):
    a = _member(db, "김영희")
    db.add_post(author_id=a, did="x", learned="", blocked="", tags="GAN 실험")
    db.add_post(author_id=a, did="y", learned="", blocked="", tags="GAN")
    db.add_post(author_id=a, did="z", learned="", blocked="", tags="")
    counts = db.member_tag_counts(a)
    assert counts == {"GAN": 2, "실험": 1}   # 많은 순 정렬
    assert db.member_tag_counts(_member(db, "신입")) == {}


def test_list_posts_by_tag_word_match(db):
    a = _member(db, "김영희")
    p1 = db.add_post(author_id=a, did="x", learned="", blocked="", tags="GAN 실험")
    db.add_post(author_id=a, did="y", learned="", blocked="", tags="GANs")   # 안 잡혀야
    p3 = db.add_post(author_id=a, did="z", learned="", blocked="", tags="GAN")
    posts = db.list_posts_by_tag("GAN")
    ids = [p["id"] for p in posts]
    assert ids == [p3, p1]          # 최신순, GANs 제외
    assert db.list_posts_by_tag("없는태그") == []


def test_search_posts(db):
    a = _member(db, "김영희")
    db.add_post(author_id=a, did="GAN 학습", learned="배치 키움", blocked="검증셋 누수", tags="실험")
    db.add_post(author_id=a, did="무관한 글", learned="", blocked="", tags="")
    assert len(db.search_posts("누수")) == 1          # blocked 본문 검색
    assert len(db.search_posts("배치")) == 1          # learned 검색
    assert len(db.search_posts("GAN")) == 1           # did 검색
    assert len(db.search_posts("실험")) == 1          # tags 검색
    assert db.search_posts("") == []                  # 빈 검색어
    assert db.search_posts("없는단어") == []


def test_list_open_questions(db):
    a = _member(db, "김영희")
    b = _member(db, "박교수")
    q_open = db.add_post(author_id=a, did="x", learned="", blocked="질문1", tags="")
    q_answered = db.add_post(author_id=a, did="y", learned="", blocked="질문2", tags="")
    db.add_post(author_id=a, did="z", learned="", blocked="", tags="")   # blocked 없음 → 제외
    db.add_comment(post_id=q_answered, author_id=b, body="답")
    opens = db.list_open_questions()
    ids = [p["id"] for p in opens]
    assert ids == [q_answered, q_open]    # 답 달린 질문도 유지, 최근 순
    assert opens[0]["comment_count"] == 1
    assert opens[1]["comment_count"] == 0


def test_list_members_with_stats(db):
    a = _member(db, "김영희")
    _member(db, "신입")                    # 글 0개
    db.add_post(author_id=a, did="x", learned="", blocked="", tags="")
    rows = db.list_members_with_stats()
    by_name = {r["name"]: r for r in rows}
    assert by_name["김영희"]["post_count"] == 1
    assert by_name["신입"]["post_count"] == 0
    assert rows[0]["name"] == "김영희"     # 활동 있는 사람 먼저
    assert by_name["신입"]["last_post_at"] is None


def test_student_project_metadata_and_members(db):
    owner = _member(db, "길드장")
    teammate = _member(db, "팀원")
    pid = db.add_project(
        title="웹 길드 포트폴리오",
        type="웹",
        goal="길드 결과물을 한 페이지로 모은다",
        summary="학생들이 AI로 만든 웹 산출물 모음",
        slug="web-guild-portfolio",
        repo_url="https://github.com/bai/web-guild",
        site_url="https://example.com/web-guild",
        owner_member_id=owner,
    )
    db.set_project_members(pid, [(owner, "길드장"), (teammate, "프론트")])

    project = db.get_project(pid)
    assert project["slug"] == "web-guild-portfolio"
    assert project["summary"] == "학생들이 AI로 만든 웹 산출물 모음"
    assert project["repo_url"] == "https://github.com/bai/web-guild"
    assert project["site_url"] == "https://example.com/web-guild"
    assert project["owner_member_id"] == owner

    listed = db.list_projects()[0]
    assert listed["id"] == pid
    assert listed["slug"] == "web-guild-portfolio"
    assert listed["owner_name"] == "길드장"
    assert listed["member_count"] == 2
    assert db.list_project_members(pid) == [
        {"member_id": owner, "role": "길드장", "name": "길드장"},
        {"member_id": teammate, "role": "프론트", "name": "팀원"},
    ]


def test_atomic_project_create_rolls_back_metadata_if_member_insert_fails(db):
    owner = _member(db, "프로젝트장")
    with pytest.raises(sqlite3.IntegrityError):
        db.add_project_with_members(
            member_roles=[(owner, "리드"), (999999, "없는 멤버")],
            title="저장되면 안 되는 프로젝트",
            summary="멤버 연결 실패를 재현",
            owner_member_id=owner,
        )

    assert db.list_projects() == []


def test_add_and_list_comments(db):
    a = _member(db, "김영희")
    b = _member(db, "박교수")
    pid = db.add_post(author_id=a, did="x", learned="", blocked="질문", tags="")
    db.add_comment(post_id=pid, author_id=b, body="그건 split 먼저")
    comments = db.list_comments(pid)
    assert len(comments) == 1
    assert comments[0]["body"] == "그건 split 먼저"
    assert comments[0]["author_name"] == "박교수"


def test_reaction_toggle(db):
    a = _member(db, "김영희")
    b = _member(db, "박교수")
    pid = db.add_post(author_id=a, did="x", learned="", blocked="", tags="")
    assert db.toggle_reaction(pid, b, "thumbsup") is True   # 추가됨
    assert db.count_reactions(pid) == 1
    assert db.toggle_reaction(pid, b, "thumbsup") is False  # 취소됨
    assert db.count_reactions(pid) == 0


def test_reaction_idempotent_per_member(db):
    a = _member(db, "김영희")
    b = _member(db, "박교수")
    c = _member(db, "이철수")
    pid = db.add_post(author_id=a, did="x", learned="", blocked="", tags="")
    db.toggle_reaction(pid, b, "thumbsup")
    db.toggle_reaction(pid, c, "thumbsup")
    assert db.count_reactions(pid) == 2
    assert set(db.reacted_member_ids(pid)) == {b, c}


# ---- R5: 이번 주 보고 현황 ----
def test_weekly_status_splits_reported_and_missing(db):
    a = _member(db, "가나")
    _member(db, "다라")  # 글 없음 → 미보고
    db.add_post(author_id=a, did="이번주 작업", learned="", blocked="", tags="")
    # 주차 시작을 과거로 두면 a의 글은 '이번 주' 안에 듦
    rows = db.weekly_report_status("2000-01-01 00:00:00")
    by = {r["name"]: r for r in rows}
    assert by["가나"]["reported"] is True and by["가나"]["week_count"] == 1
    assert by["다라"]["reported"] is False and by["다라"]["week_count"] == 0
    # 미보고자가 먼저 나와야(눈에 먼저 띄게)
    assert rows[0]["name"] == "다라"


def test_weekly_status_future_boundary_all_missing(db):
    a = _member(db, "가나")
    db.add_post(author_id=a, did="작업", learned="", blocked="", tags="")
    rows = db.weekly_report_status("2999-01-01 00:00:00")
    assert all(r["reported"] is False for r in rows)
