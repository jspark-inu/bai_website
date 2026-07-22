import os
import sqlite3
import tempfile

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


def test_explicit_missing_database_fails_closed_without_bootstrap(monkeypatch, tmp_path):
    path = tmp_path / "missing-live.db"
    monkeypatch.setenv("LAB_FEED_DB", str(path))
    monkeypatch.delenv("LAB_FEED_ALLOW_BOOTSTRAP", raising=False)

    with pytest.raises(RuntimeError, match="does not point to an existing database"):
        app_module.create_app(secret="test-secret")
    assert not path.exists()


def test_explicit_database_without_core_tables_fails_closed(monkeypatch, tmp_path):
    path = tmp_path / "wrong-live.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE unrelated(id INTEGER PRIMARY KEY)")
    conn.close()
    monkeypatch.setenv("LAB_FEED_DB", str(path))
    monkeypatch.delenv("LAB_FEED_ALLOW_BOOTSTRAP", raising=False)

    with pytest.raises(RuntimeError, match="missing core tables"):
        app_module.create_app(secret="test-secret")


@pytest.mark.parametrize("allow_bootstrap", [False, True])
def test_explicit_database_path_must_be_absolute_even_for_bootstrap(
        monkeypatch, tmp_path, allow_bootstrap):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LAB_FEED_DB", "relative-live.db")
    if allow_bootstrap:
        monkeypatch.setenv("LAB_FEED_ALLOW_BOOTSTRAP", "1")
    else:
        monkeypatch.delenv("LAB_FEED_ALLOW_BOOTSTRAP", raising=False)

    with pytest.raises(RuntimeError, match="must be an absolute path"):
        app_module.create_app(secret="test-secret")
    assert not (tmp_path / "relative-live.db").exists()


def test_explicit_bootstrap_override_allows_intentional_new_database(monkeypatch, tmp_path):
    path = tmp_path / "intentional-new.db"
    monkeypatch.setenv("LAB_FEED_DB", str(path))
    monkeypatch.setenv("LAB_FEED_ALLOW_BOOTSTRAP", "1")

    flask_app = app_module.create_app(secret="test-secret")
    assert flask_app.extensions["lab_feed_db"].db_path == str(path)
    conn = sqlite3.connect(path)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    conn.close()
    assert {"members", "posts"}.issubset(tables)


def test_environment_session_secret_is_required(monkeypatch, tmp_path):
    monkeypatch.delenv("LAB_FEED_SECRET", raising=False)
    monkeypatch.delenv("LAB_FEED_ALLOW_INSECURE_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="LAB_FEED_SECRET"):
        app_module.create_app(db_path=str(tmp_path / "unused.db"))


@pytest.mark.parametrize(
    "value", ["dev", "dev-insecure-secret", "change-me-generate-with-python-secrets"]
)
def test_public_or_placeholder_session_secrets_are_rejected(monkeypatch, tmp_path, value):
    monkeypatch.setenv("LAB_FEED_SECRET", value)
    monkeypatch.delenv("LAB_FEED_ALLOW_INSECURE_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="non-placeholder secret"):
        app_module.create_app(db_path=str(tmp_path / "unused.db"))


def test_configured_live_database_defaults_to_secure_cookie(monkeypatch, tmp_path):
    path = tmp_path / "live.db"
    LabFeedDB(str(path)).init_schema()
    monkeypatch.setenv("LAB_FEED_DB", str(path))
    monkeypatch.setenv("LAB_FEED_SECRET", "a" * 32)
    monkeypatch.delenv("LAB_FEED_ALLOW_BOOTSTRAP", raising=False)
    monkeypatch.delenv("LAB_FEED_COOKIE_SECURE", raising=False)

    flask_app = app_module.create_app()
    assert flask_app.config["SESSION_COOKIE_SECURE"] is True


def test_live_cookie_downgrade_requires_explicit_local_override(monkeypatch, tmp_path):
    path = tmp_path / "live.db"
    LabFeedDB(str(path)).init_schema()
    monkeypatch.setenv("LAB_FEED_DB", str(path))
    monkeypatch.setenv("LAB_FEED_SECRET", "b" * 32)
    monkeypatch.setenv("LAB_FEED_COOKIE_SECURE", "0")
    monkeypatch.delenv("LAB_FEED_ALLOW_INSECURE_COOKIE", raising=False)

    with pytest.raises(RuntimeError, match="secure session cookies"):
        app_module.create_app()

    monkeypatch.setenv("LAB_FEED_ALLOW_INSECURE_COOKIE", "1")
    flask_app = app_module.create_app()
    assert flask_app.config["SESSION_COOKIE_SECURE"] is False


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


def test_login_rate_limit_expires_after_a_finite_cooldown(client, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(app_module.time, "monotonic", lambda: now[0])

    for _ in range(app_module.LOGIN_FAILURE_LIMIT):
        assert _login(client, pw="bad").status_code == 401
    locked = _login(client, pw="pw")
    assert locked.status_code == 429
    assert int(locked.headers["Retry-After"]) > 0

    now[0] += app_module.LOGIN_FAILURE_COOLDOWN_SECONDS + 0.1
    assert _login(client, pw="pw").status_code == 200


def test_login_rate_limit_isolated_by_validated_proxy_client_ip(client):
    attacker_headers = {"X-BAI-Client-IP": "203.0.113.9"}
    member_headers = {"X-BAI-Client-IP": "198.51.100.17"}
    for _ in range(app_module.LOGIN_FAILURE_LIMIT):
        assert client.post(
            "/api/login",
            json={"name": "김영희", "password": "bad"},
            headers=attacker_headers,
        ).status_code == 401
    assert client.post(
        "/api/login",
        json={"name": "김영희", "password": "pw"},
        headers=attacker_headers,
    ).status_code == 429
    assert client.post(
        "/api/login",
        json={"name": "김영희", "password": "pw"},
        headers=member_headers,
    ).status_code == 200


def test_session_cookie_defaults_are_public_launch_safe(client):
    assert client.application.config["SESSION_COOKIE_HTTPONLY"] is True
    assert client.application.config["SESSION_COOKIE_SAMESITE"] == "Lax"


def test_healthz_checks_the_database_and_is_available_through_api_alias(client):
    response = client.get("/api/healthz")
    assert response.status_code == 200
    assert response.get_json() == {
        "ok": True,
        "service": "bai-site",
        "database": "ok",
    }


def test_login_page_keeps_the_approved_compact_account_guidance(client):
    # 로그인은 KRDS SPA 셸 안에서 로그인 박스만 간결하게 렌더링한다.
    shell = client.get("/login").get_data(as_text=True)
    assert "krds.js" in shell
    body = client.get("/static/krds.js").get_data(as_text=True)
    assert "멤버 계정으로 로그인하세요." in body
    assert "BAI 운영자에게 계정 발급을 요청해 주세요." in body
    assert "함께 만든 과정이" not in body
    assert 'location.href = "/"' in body
    assert "/cockpit" not in body


def test_feed_shell_contains_first_post_cta_copy(client):
    body = client.get("/static/krds.js").get_data(as_text=True)
    assert "첫 기록 남기기" in body
    assert "아직 자유 기록이 없습니다. 첫 기록을 남겨 주세요." in body
    assert "checkinHtml" in body
    assert "이번 주 BAI 체크인" in body


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


def test_project_create_rejects_invalid_members_without_leaving_a_row(client):
    db = client.application.extensions["lab_feed_db"]
    _login(client)
    before = [project["id"] for project in db.list_projects()]

    response = client.post("/api/projects", json={
        "title": "남으면 안 되는 프로젝트",
        "summary": "유효하지 않은 멤버 요청",
        "members": [{"member_id": 999999, "role": "팀원"}],
    })

    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid member_id"
    assert [project["id"] for project in db.list_projects()] == before


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


# ---- 개발자/관리자 콘솔 ----
def test_developer_api_key_requires_login(client):
    assert client.get("/api/developer/key").status_code == 401


def test_developer_can_view_and_regenerate_own_api_key(client):
    _login(client)
    r = client.get("/api/developer/key")
    assert r.status_code == 200
    assert r.get_json()["api_key"] == "testkey123"

    rotated = client.post("/api/developer/key/regenerate")
    assert rotated.status_code == 200
    new_key = rotated.get_json()["api_key"]
    assert new_key and new_key != "testkey123"
    assert client.post("/api/post", headers={"X-API-Key": "testkey123"},
                       json={"did": "old", "learned": "", "blocked": "", "tags": ""}).status_code == 401
    assert client.post("/api/post", headers={"X-API-Key": new_key},
                       json={"did": "new", "learned": "", "blocked": "", "tags": ""}).status_code == 200


def test_admin_members_requires_pi(client):
    _login(client)
    assert client.get("/api/admin/members").status_code == 403
    assert client.post("/api/admin/members/1/api-key/regenerate").status_code == 403
    assert client.post("/api/admin/members/1", json={"role": "admin_student"}).status_code == 403


def test_pi_can_list_members_rotate_key_and_change_role(client):
    db = client.application.extensions["lab_feed_db"]
    pi_id = db.add_member(name="교수", password_hash=auth.hash_password("pi"),
                          api_key="pikey", role="pi")
    _login(client, "교수", "pi")

    rows = client.get("/api/admin/members")
    assert rows.status_code == 200
    assert any(m["name"] == "김영희" and "api_key" not in m for m in rows.get_json()["members"])

    rotated = client.post("/api/admin/members/1/api-key/regenerate")
    assert rotated.status_code == 200
    new_key = rotated.get_json()["api_key"]
    assert new_key and new_key != "testkey123"

    changed = client.post("/api/admin/members/1", json={"role": "admin_student", "status": "active"})
    assert changed.status_code == 200
    member = db.get_member_by_id(1)
    assert member["role"] == "admin_student"

    self_demote = client.post(f"/api/admin/members/{pi_id}", json={"role": "student"})
    assert self_demote.status_code == 400


def test_feed_shell_contains_developer_and_admin_routes(client):
    body = client.get("/static/feed.js").get_data(as_text=True)
    assert "/account?goodbai=1" in body
    assert "/api/me?api_key=1" in body
    assert "regenerate_api_key" in body
    assert "/admin/members" in body
    assert "/api/admin/members" in body


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


def test_wall_chat_requires_login(client):
    assert client.get("/api/wall").status_code == 401
    assert client.post("/api/wall", json={"body": "화이팅"}).status_code == 401


def test_wall_chat_create_list_is_anonymous(client):
    _login(client)
    created = client.post("/api/wall", json={"body": "오늘 데모 좋았다"})
    assert created.status_code == 200
    body = client.get("/api/wall").get_json()
    assert body["messages"][0]["body"] == "오늘 데모 좋았다"
    assert "author_name" not in body["messages"][0]
    assert "author_id" not in body["messages"][0]


def test_wall_chat_rejects_long_message(client):
    _login(client)
    assert client.post("/api/wall", json={"body": "x" * 81}).status_code == 400


def test_week_start_utc_is_monday_kst():
    from datetime import datetime
    # 2026-06-03(수, KST) 기준 그 주 월요일 = 2026-06-01 00:00 KST = 2026-05-31 15:00 UTC
    now = datetime(2026, 6, 3, 12, 0, tzinfo=app_module.KST)
    assert app_module.week_start_utc(now) == "2026-05-31 15:00:00"


# ---- 페이지 라우트 ----
def test_page_routes_registered(client):
    for path in ["/", "/login", "/post/1", "/member/1",
                 "/tag/GAN", "/search", "/questions", "/members",
                 "/goodbai", "/developer", "/admin/members",
                 "/projects", "/projects/1"]:
        r = client.get(path)
        assert r.status_code in (200, 404)


def test_project_page_routes_serve_spa_shell(client):
    assert client.get("/projects").status_code == 200
    assert client.get("/projects/1").status_code == 200
