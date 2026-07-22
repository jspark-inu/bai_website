import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

import app as app_module
from lab_feed_db import LabFeedDB


FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "apps"
    / "web"
    / "tests"
    / "contracts"
    / "read-api-parity-fixture.json"
)
EXPECTED_SUCCESS_NAMES = {
    "feed", "feed-project-filter", "feed-invalid-project-filter", "post-detail",
    "member-detail", "tag-exact-decoded", "tag-percent-sequence-preserved",
    "search-links-case-insensitive",
    "search-empty", "questions", "inquiries", "members", "projects",
    "project-detail", "weekly",
}
EXPECTED_UNAUTHORIZED_NAMES = {
    "feed-unauthorized", "post-unauthorized", "member-unauthorized",
    "tag-unauthorized", "search-unauthorized", "questions-unauthorized",
    "inquiries-unauthorized", "members-unauthorized", "projects-unauthorized",
    "project-detail-unauthorized", "weekly-unauthorized",
}
EXPECTED_NOT_FOUND_NAMES = {
    "post-not-found", "member-not-found", "project-not-found",
}


def _seed(db, seed):
    conn = db._conn()
    try:
        for table in (
            "members", "projects", "project_members", "posts", "comments",
            "reactions", "inquiries",
        ):
            rows = seed[table]
            if not rows:
                continue
            columns = tuple(rows[0])
            placeholders = ",".join("?" for _ in columns)
            conn.executemany(
                f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})",
                [[row[column] for column in columns] for row in rows],
            )
        conn.commit()
    finally:
        conn.close()


def test_shared_read_api_fixture_matches_flask_with_only_temporary_sqlite(monkeypatch):
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    cases = fixture["requests"]
    names = {case["name"] for case in cases}
    assert {case["name"] for case in cases if case["response"]["status"] == 200} == EXPECTED_SUCCESS_NAMES
    assert {case["name"] for case in cases if case["response"]["status"] == 401} == EXPECTED_UNAUTHORIZED_NAMES
    assert {case["name"] for case in cases if case["response"]["status"] == 404} == EXPECTED_NOT_FOUND_NAMES
    assert len(names) == len(cases) == 29

    with TemporaryDirectory(prefix="bai-read-api-parity-") as temp_dir:
        db_path = Path(temp_dir) / "read-api.sqlite3"
        redirected_path = Path(temp_dir) / "environment-redirect.sqlite3"
        monkeypatch.setenv("LAB_FEED_DB", str(redirected_path))
        db = LabFeedDB(str(db_path))
        db.init_schema()
        _seed(db, fixture["seed"])
        monkeypatch.setattr(app_module, "week_start_utc", lambda: "2026-07-19 15:00:00")

        flask_app = app_module.create_app(
            db_path=str(db_path),
            secret="read-api-parity-test-secret",
        )
        flask_app.config["TESTING"] = True
        with flask_app.test_client() as client:
            for case in cases:
                with client.session_transaction() as session:
                    session.clear()
                    if case["authenticated"]:
                        session["member_id"] = 1
                response = client.get(case["path"])
                assert response.status_code == case["response"]["status"], case["name"]
                assert response.get_json() == case["response"]["json"], case["name"]

            with client.session_transaction() as session:
                session.clear()
                session["member_id"] = 1
            unfiltered = client.get("/api/feed")
            feff_filtered = client.get("/api/feed?project_id=%EF%BB%BF10%EF%BB%BF")
            assert feff_filtered.status_code == unfiltered.status_code == 200
            assert feff_filtered.get_json() == unfiltered.get_json()

            for path in ("/api/post/100.0", "/api/member/1.0", "/api/projects/10.0"):
                response = client.get(path)
                assert response.status_code == 404
                assert response.content_type == "application/json"
                assert response.get_json() == {"error": "not found"}

            response = client.get("/api/post/%F0%9E%97%B1")
            assert response.status_code == 404
            assert response.get_json() == {"error": "not found"}

            response = client.get("/api/search?q=%1CNEEDLE%1C")
            assert [post["id"] for post in response.get_json()["posts"]] == [103, 101]
            response = client.get("/api/search?q=%EF%BB%BFNEEDLE%EF%BB%BF")
            assert response.get_json()["posts"] == []

            with sqlite3.connect(db_path) as conn:
                conn.execute("UPDATE posts SET tags=? WHERE id=103", ("alpha\u001cquestion",))
            response = client.get("/api/tag/question")
            assert [post["id"] for post in response.get_json()["posts"]] == [104, 103]
            with sqlite3.connect(db_path) as conn:
                conn.execute("UPDATE posts SET tags=? WHERE id=103", ("alpha\ufeffquestion",))
            response = client.get("/api/tag/question")
            assert [post["id"] for post in response.get_json()["posts"]] == [104]

            large_id = 9007199254740993
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "INSERT INTO posts "
                    "(id,author_id,did,learned,blocked,tags,links,source,project_id,created_at,updated_at) "
                    "VALUES (?,1,'Large post','','','','','web',NULL,'2020-01-01 00:00:00','2020-01-01 00:00:00')",
                    (large_id,),
                )
                conn.execute(
                    "INSERT INTO members "
                    "(id,name,password_hash,api_key,role,status,created_at) "
                    "VALUES (?,'Large member','hash','large-key','student','active','2020-01-01 00:00:00')",
                    (large_id,),
                )
                conn.execute(
                    "INSERT INTO projects "
                    "(id,title,type,slug,summary,repo_url,site_url,status,owner_member_id,deadline,created_at,updated_at) "
                    "VALUES (?,'Large project','research','large-project','','','','active',1,'','2020-01-01 00:00:00','2020-01-01 00:00:00')",
                    (large_id,),
                )

            for path in (
                "/api/post/9007199254740993",
                "/api/member/9007199254740993",
                "/api/projects/9007199254740993",
            ):
                with client.session_transaction() as session:
                    session.clear()
                response = client.get(path)
                assert response.status_code == 401
                assert response.get_json() == {"error": "login required"}
                with client.session_transaction() as session:
                    session["member_id"] = 1
                response = client.get(path)
                assert response.status_code == 200
                assert '"id":9007199254740993' in response.get_data(as_text=True)

        assert db_path.is_file()
        assert not redirected_path.exists()

    assert not db_path.exists()
