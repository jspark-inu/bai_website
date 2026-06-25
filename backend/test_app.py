import tempfile, os
import pytest
import app as app_module
from lab_feed_db import LabFeedDB
import auth


@pytest.fixture
def client():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = LabFeedDB(path)
    db.init_schema()
    db.add_member(name="김영희", password_hash=auth.hash_password("pw"),
                  api_key="testkey123", role="student")
    flask_app = app_module.create_app(db_path=path, secret="test-secret")
    flask_app.extensions["lab_feed_db"] = db
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c
    os.remove(path)


def _login(client, name="김영희", pw="pw"):
    return client.post("/api/login", json={"name": name, "password": pw})


# ---- 스킬 API ----
def test_api_post_creates_post(client):
    resp = client.post("/api/post",
                       headers={"X-API-Key": "testkey123"},
                       json={"did": "GAN", "learned": "L", "blocked": "B", "tags": "실험"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert "id" in data
    assert data["url"].endswith("/post/%d" % data["id"])


def test_api_post_with_links(client):
    resp = client.post("/api/post",
                       headers={"X-API-Key": "testkey123"},
                       json={"did": "GAN", "learned": "", "blocked": "", "tags": "",
                             "links": "https://github.com/me/proj"})
    assert resp.status_code == 200
    _login(client)
    pid = resp.get_json()["id"]
    post = client.get("/api/post/%d" % pid).get_json()["post"]
    assert "github.com/me/proj" in post["links"]


def test_api_post_rejects_bad_key(client):
    resp = client.post("/api/post",
                       headers={"X-API-Key": "wrong"},
                       json={"did": "x", "learned": "", "blocked": "", "tags": ""})
    assert resp.status_code == 401


def test_api_post_rejects_empty(client):
    resp = client.post("/api/post",
                       headers={"X-API-Key": "testkey123"},
                       json={"did": "", "learned": "", "blocked": "", "tags": ""})
    assert resp.status_code == 400


# ---- 로그인/세션 + 조회 ----
def test_login_success_and_me(client):
    r = _login(client)
    assert r.status_code == 200
    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.get_json()["name"] == "김영희"


def test_login_failure(client):
    r = _login(client, pw="bad")
    assert r.status_code == 401
    me = client.get("/api/me")
    assert me.status_code == 401


def test_change_password_requires_login(client):
    r = client.post("/api/change-password", json={
        "current_password": "pw",
        "new_password": "newpass1234",
    })
    assert r.status_code == 401


def test_change_password_requires_current_password(client):
    _login(client)
    r = client.post("/api/change-password", json={
        "current_password": "bad",
        "new_password": "newpass1234",
    })
    assert r.status_code == 400
    assert _login(client, pw="pw").status_code == 200


def test_change_password_updates_login_password(client):
    _login(client)
    r = client.post("/api/change-password", json={
        "current_password": "pw",
        "new_password": "newpass1234",
    })
    assert r.status_code == 200
    client.post("/api/logout")
    assert _login(client, pw="pw").status_code == 401
    assert _login(client, pw="newpass1234").status_code == 200


def test_change_password_rejects_too_short_new_password(client):
    _login(client)
    r = client.post("/api/change-password", json={
        "current_password": "pw",
        "new_password": "123",
    })
    assert r.status_code == 400
    assert _login(client, pw="pw").status_code == 200


def test_login_rate_limits_repeated_failures(client):
    for _ in range(5):
        assert _login(client, pw="bad").status_code == 401
    assert _login(client, pw="bad").status_code == 429


def test_session_cookie_defaults_are_public_launch_safe(client):
    assert client.application.config["SESSION_COOKIE_HTTPONLY"] is True
    assert client.application.config["SESSION_COOKIE_SAMESITE"] == "Lax"


def test_login_page_explains_onboarding_and_visibility(client):
    body = client.get("/login").get_data(as_text=True)
    assert "계정은 운영자가 발급합니다" in body
    assert "진행 공유는 로그인한 BAI 멤버에게 보입니다" in body
    assert "매주 한 번" in body


def test_feed_shell_contains_first_post_cta_copy(client):
    body = client.get("/static/feed.js").get_data(as_text=True)
    assert "첫 진행 공유를 남겨보세요" in body


def test_feed_shell_contains_materials_board_route(client):
    body = client.get("/static/feed.js").get_data(as_text=True)
    assert "/materials" in body
    assert "자료실" in body
    assert "/api/materials" in body


def test_feed_shell_contains_project_registry_route(client):
    body = client.get("/static/feed.js").get_data(as_text=True)
    assert "/projects" in body
    assert "프로젝트" in body
    assert "프로젝트 만들기" in body
    assert "repo_url" in body
    assert "site_url" in body
    assert "/api/projects" in body


def test_feed_shell_contains_account_password_change_route(client):
    body = client.get("/static/feed.js").get_data(as_text=True)
    assert "/account" in body
    assert "비밀번호 변경" in body
    assert "/api/change-password" in body


def test_feed_lists_posts(client):
    client.post("/api/post", headers={"X-API-Key": "testkey123"},
                json={"did": "첫 글", "learned": "", "blocked": "", "tags": "실험"})
    _login(client)
    r = client.get("/api/feed")
    assert r.status_code == 200
    feed = r.get_json()
    assert len(feed) == 1
    assert feed[0]["did"] == "첫 글"
    assert feed[0]["author_name"] == "김영희"
    assert feed[0]["reaction_count"] == 0
    assert feed[0]["comment_count"] == 0


def test_feed_requires_login(client):
    assert client.get("/api/feed").status_code == 401


def test_materials_api_requires_login(client):
    assert client.get("/api/materials").status_code == 401
    assert client.post("/api/materials", json={"title": "x", "body": "y"}).status_code == 401


def test_materials_api_create_list_update_delete(client):
    _login(client)
    create = client.post("/api/materials", json={
        "title": "BAI 온보딩",
        "body": "첫 모임 전에 읽어오기",
        "url": "https://example.com/onboarding",
        "category": "온보딩",
        "guild": "공통",
    })
    assert create.status_code == 200
    mid = create.get_json()["id"]

    rows = client.get("/api/materials").get_json()["materials"]
    assert rows[0]["id"] == mid
    assert rows[0]["title"] == "BAI 온보딩"
    assert rows[0]["author_name"] == "김영희"
    assert client.get("/api/materials?category=온보딩").get_json()["materials"][0]["id"] == mid

    updated = client.post(f"/api/materials/{mid}", json={
        "title": "BAI 온보딩 v2",
        "body": "수정됨",
        "url": "",
        "category": "온보딩",
        "guild": "공통",
    })
    assert updated.status_code == 200
    assert client.get("/api/materials").get_json()["materials"][0]["title"] == "BAI 온보딩 v2"

    deleted = client.delete(f"/api/materials/{mid}")
    assert deleted.status_code == 200
    assert client.get("/api/materials").get_json()["materials"] == []


def test_materials_api_rejects_empty_payload(client):
    _login(client)
    assert client.post("/api/materials", json={"title": "", "body": "", "url": ""}).status_code == 400


def test_get_single_post_with_comments(client):
    client.post("/api/post", headers={"X-API-Key": "testkey123"},
                json={"did": "x", "learned": "", "blocked": "질문", "tags": ""})
    _login(client)
    r = client.get("/api/post/1")
    assert r.status_code == 200
    body = r.get_json()
    assert body["post"]["blocked"] == "질문"
    assert body["comments"] == []
    assert client.get("/api/post/999").status_code == 404


# ---- 웹 작성/수정/댓글/반응 ----
def test_web_create_post_requires_login(client):
    r = client.post("/api/web/post", json={"did": "x", "learned": "", "blocked": "", "tags": ""})
    assert r.status_code == 401


def test_web_create_post(client):
    _login(client)
    r = client.post("/api/web/post",
                    json={"did": "웹글", "learned": "L", "blocked": "", "tags": "논문"})
    assert r.status_code == 200
    pid = r.get_json()["id"]
    p = client.get("/api/post/%d" % pid).get_json()["post"]
    assert p["did"] == "웹글"
    assert p["source"] == "web"


def test_edit_own_post(client):
    _login(client)
    pid = client.post("/api/web/post",
                      json={"did": "old", "learned": "", "blocked": "", "tags": ""}).get_json()["id"]
    r = client.post("/api/post/%d/edit" % pid,
                    json={"did": "new", "learned": "L2", "blocked": "", "tags": "수정"})
    assert r.status_code == 200
    p = client.get("/api/post/%d" % pid).get_json()["post"]
    assert p["did"] == "new"
    assert p["tags"] == "수정"


def test_cannot_edit_when_not_logged_in(client):
    _login(client)
    pid = client.post("/api/web/post",
                      json={"did": "mine", "learned": "", "blocked": "", "tags": ""}).get_json()["id"]
    client.post("/api/logout")
    r = client.post("/api/post/%d/edit" % pid,
                    json={"did": "hack", "learned": "", "blocked": "", "tags": ""})
    assert r.status_code == 401


def test_add_comment(client):
    _login(client)
    pid = client.post("/api/web/post",
                      json={"did": "x", "learned": "", "blocked": "질문", "tags": ""}).get_json()["id"]
    r = client.post("/api/post/%d/comment" % pid, json={"body": "답변입니다"})
    assert r.status_code == 200
    comments = client.get("/api/post/%d" % pid).get_json()["comments"]
    assert len(comments) == 1
    assert comments[0]["body"] == "답변입니다"


def test_toggle_reaction(client):
    _login(client)
    pid = client.post("/api/web/post",
                      json={"did": "x", "learned": "", "blocked": "", "tags": ""}).get_json()["id"]
    r1 = client.post("/api/post/%d/react" % pid)
    assert r1.status_code == 200
    assert r1.get_json()["reaction_count"] == 1
    r2 = client.post("/api/post/%d/react" % pid)
    assert r2.get_json()["reaction_count"] == 0


# ---- 사람별 프로필 ----
def test_member_profile_requires_login(client):
    assert client.get("/api/member/1").status_code == 401


def test_member_profile_aggregates_journey(client):
    # 스킬로 김영희(id=1) 글 2개
    client.post("/api/post", headers={"X-API-Key": "testkey123"},
                json={"did": "GAN 시작", "learned": "", "blocked": "", "tags": "GAN"})
    client.post("/api/post", headers={"X-API-Key": "testkey123"},
                json={"did": "GAN 개선", "learned": "L", "blocked": "", "tags": "GAN 실험"})
    _login(client)
    r = client.get("/api/member/1")
    assert r.status_code == 200
    body = r.get_json()
    assert body["member"]["name"] == "김영희"
    assert body["post_count"] == 2
    assert body["posts"][0]["did"] == "GAN 시작"   # 시간순(여정)
    assert body["posts"][1]["did"] == "GAN 개선"
    assert body["tag_counts"] == {"GAN": 2, "실험": 1}
    assert body["first_post_at"] is not None
    assert body["last_post_at"] is not None


def test_member_profile_not_found(client):
    _login(client)
    assert client.get("/api/member/9999").status_code == 404


# ---- R1~R4: 지식 아카이브 ----
def _seed_two_posts(client):
    client.post("/api/post", headers={"X-API-Key": "testkey123"},
                json={"did": "GAN 학습", "learned": "배치", "blocked": "검증셋 누수", "tags": "GAN 실험"})
    client.post("/api/post", headers={"X-API-Key": "testkey123"},
                json={"did": "무관한 글", "learned": "", "blocked": "", "tags": "기타"})


def test_tag_api(client):
    _seed_two_posts(client)
    assert client.get("/api/tag/GAN").status_code == 401   # 비로그인
    _login(client)
    body = client.get("/api/tag/GAN").get_json()
    assert body["tag"] == "GAN"
    assert len(body["posts"]) == 1
    assert body["posts"][0]["did"] == "GAN 학습"


def test_search_api(client):
    _seed_two_posts(client)
    assert client.get("/api/search?q=누수").status_code == 401
    _login(client)
    assert len(client.get("/api/search?q=누수").get_json()["posts"]) == 1
    assert len(client.get("/api/search?q=무관").get_json()["posts"]) == 1
    assert client.get("/api/search?q=").get_json()["posts"] == []


def test_questions_api(client):
    _seed_two_posts(client)  # 첫 글에 blocked 있고 댓글 0 → 미해결
    _login(client)
    body = client.get("/api/questions").get_json()
    assert len(body["posts"]) == 1
    assert body["posts"][0]["blocked"] == "검증셋 누수"
    # 댓글 달면 미해결에서 빠짐
    pid = body["posts"][0]["id"]
    client.post("/api/post/%d/comment" % pid, json={"body": "답"})
    assert client.get("/api/questions").get_json()["posts"] == []


def test_members_api(client):
    _seed_two_posts(client)
    assert client.get("/api/members").status_code == 401
    _login(client)
    rows = client.get("/api/members").get_json()
    kim = [r for r in rows if r["name"] == "김영희"][0]
    assert kim["post_count"] == 2
    assert kim["last_post_at"] is not None


def test_student_can_create_project_registry_entry(client):
    _login(client)
    r = client.post("/api/projects", json={
        "title": "웹 길드 포트폴리오",
        "type": "웹",
        "slug": "web-guild-portfolio",
        "summary": "학생들이 AI로 만든 결과물 모음",
        "repo_url": "https://github.com/bai/web-guild",
        "site_url": "https://example.com/web-guild",
        "members": [{"member_id": 1, "role": "길드장"}],
    })
    assert r.status_code == 200
    pid = r.get_json()["id"]
    detail = client.get(f"/api/projects/{pid}").get_json()
    assert detail["project"]["title"] == "웹 길드 포트폴리오"
    assert detail["project"]["slug"] == "web-guild-portfolio"
    assert detail["project"]["owner_member_id"] == 1
    assert detail["project"]["repo_url"] == "https://github.com/bai/web-guild"
    assert detail["members"] == [{"member_id": 1, "role": "길드장", "name": "김영희"}]


def test_project_detail_api_returns_members_and_links(client):
    db = client.application.extensions["lab_feed_db"]
    teammate = db.add_member(name="팀원", password_hash=auth.hash_password("pw2"),
                             api_key="teamkey", role="student")
    pid = db.add_project(
        title="AI 길드",
        type="AI",
        summary="모델 실험 자료",
        repo_url="https://github.com/bai/ai",
        site_url="https://ai.example.com",
        owner_member_id=1,
    )
    db.set_project_members(pid, [(1, "리드"), (teammate, "실험")])
    _login(client)
    r = client.get(f"/api/projects/{pid}")
    assert r.status_code == 200
    body = r.get_json()
    assert body["project"]["site_url"] == "https://ai.example.com"
    assert [m["name"] for m in body["members"]] == ["김영희", "팀원"]
    assert body["activity"] == []


def test_project_update_requires_owner_or_pi(client):
    db = client.application.extensions["lab_feed_db"]
    owner = 1
    other = db.add_member(name="다른학생", password_hash=auth.hash_password("pw2"),
                          api_key="otherkey", role="student")
    pi = db.add_member(name="교수", password_hash=auth.hash_password("pi"),
                       api_key="pikey", role="pi")
    pid = db.add_project(title="데이터 길드", type="데이터", summary="초안", owner_member_id=owner)
    db.set_project_members(pid, [(owner, "리드")])

    _login(client, "다른학생", "pw2")
    forbidden = client.post(f"/api/projects/{pid}", json={"title": "해킹", "summary": "x"})
    assert forbidden.status_code == 403

    client.post("/api/logout")
    _login(client, "김영희")
    owned = client.post(f"/api/projects/{pid}", json={
        "title": "데이터 길드",
        "type": "데이터",
        "summary": "정리된 산출물",
        "repo_url": "https://github.com/bai/data",
        "site_url": "",
        "members": [{"member_id": owner, "role": "리드"}, {"member_id": other, "role": "분석"}],
    })
    assert owned.status_code == 200
    assert client.get(f"/api/projects/{pid}").get_json()["project"]["summary"] == "정리된 산출물"

    client.post("/api/logout")
    _login(client, "교수", "pi")
    pi_update = client.post(f"/api/projects/{pid}", json={
        "title": "데이터 길드 PI 수정",
        "type": "데이터",
        "summary": "PI 메모",
        "repo_url": "",
        "site_url": "https://data.example.com",
        "members": [{"member_id": owner, "role": "리드"}],
    })
    assert pi_update.status_code == 200
    assert client.get(f"/api/projects/{pid}").get_json()["project"]["title"] == "데이터 길드 PI 수정"


# ---- R5: 이번 주 보고 현황 ----
def test_weekly_requires_login(client):
    assert client.get("/api/weekly").status_code == 401


def test_weekly_moves_from_missing_to_reported(client):
    _login(client)
    data = client.get("/api/weekly").get_json()
    assert data["total"] >= 1
    assert data["reported_count"] == 0
    assert any(m["name"] == "김영희" for m in data["missing"])
    # 글을 올리면 보고자로 이동
    client.post("/api/web/post", json={"did": "이번주 작업", "learned": "", "blocked": "", "tags": ""})
    data2 = client.get("/api/weekly").get_json()
    assert data2["reported_count"] == 1
    assert any(m["name"] == "김영희" for m in data2["reported"])
    assert all(m["name"] != "김영희" for m in data2["missing"])


def test_week_start_utc_is_monday_kst():
    from datetime import datetime
    # 2026-06-03(수, KST) 기준 그 주 월요일 = 2026-06-01 00:00 KST = 2026-05-31 15:00 UTC
    now = datetime(2026, 6, 3, 12, 0, tzinfo=app_module.KST)
    assert app_module.week_start_utc(now) == "2026-05-31 15:00:00"


# ---- 페이지 라우트 ----
def test_page_routes_registered(client):
    for path in ["/", "/login", "/post/1", "/member/1",
                 "/tag/GAN", "/search", "/questions", "/members",
                 "/projects", "/projects/1"]:
        r = client.get(path)
        assert r.status_code in (200, 404)


def test_project_page_routes_serve_spa_shell(client):
    assert client.get("/projects").status_code == 200
    assert client.get("/projects/1").status_code == 200
