import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

import auth
import app as app_module
from lab_feed_db import LabFeedDB


FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "apps"
    / "web"
    / "tests"
    / "contracts"
    / "auth-parity-fixture.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _seed(db_path):
    LabFeedDB(str(db_path)).init_schema()
    with sqlite3.connect(db_path) as conn:
        for member in FIXTURE["members"]:
            conn.execute(
                """INSERT INTO members
                (id,name,password_hash,api_key,role,status)
                VALUES (:id,:name,:password_hash,:api_key,:role,:status)""",
                member,
            )


def _request(client, step):
    kwargs = {}
    if "jsonBody" in step:
        kwargs["json"] = step["jsonBody"]
    elif "rawBody" in step:
        kwargs["data"] = step["rawBody"]
        kwargs["content_type"] = step.get("contentType", "application/json")
    return client.open(step["path"], method=step["method"], **kwargs)


def _assert_db(db_path, expectation):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        member = conn.execute(
            "SELECT password_hash,api_key FROM members WHERE id=?",
            (expectation["memberId"],),
        ).fetchone()
        if "apiKey" in expectation:
            assert member["api_key"] == expectation["apiKey"]
        if "passwordAccepts" in expectation:
            assert auth.verify_password(
                FIXTURE["passwords"][expectation["passwordAccepts"]],
                member["password_hash"],
            )
        if "passwordRejects" in expectation:
            assert not auth.verify_password(
                FIXTURE["passwords"][expectation["passwordRejects"]],
                member["password_hash"],
            )
        if "auditActions" in expectation:
            actions = [row[0] for row in conn.execute("SELECT action FROM audit_log ORDER BY id")]
            assert actions == expectation["auditActions"]


def test_flask_executes_shared_auth_lifecycle_and_accepts_next_generated_hash(monkeypatch):
    assert FIXTURE["version"] == 1
    assert len(FIXTURE["steps"]) == 21
    assert auth.verify_password(
        FIXTURE["passwords"]["replacement"],
        FIXTURE["nextGeneratedHash"],
    )
    assert not auth.verify_password(
        FIXTURE["passwords"]["original"],
        FIXTURE["nextGeneratedHash"],
    )
    monkeypatch.setattr(app_module.auth, "make_api_key", lambda: FIXTURE["generatedApiKey"])

    with TemporaryDirectory(prefix="bai-auth-parity-") as temp_dir:
        db_path = Path(temp_dir) / "auth.sqlite3"
        _seed(db_path)
        flask_app = app_module.create_app(
            db_path=str(db_path),
            secret="shared-auth-parity-secret-at-least-32-characters",
        )
        flask_app.config.update(TESTING=True, PROPAGATE_EXCEPTIONS=False)
        with flask_app.test_client() as client:
            for step in FIXTURE["steps"]:
                response = _request(client, step)
                assert response.status_code == step["status"], step["name"]
                if "json" in step:
                    assert response.get_json() == step["json"], step["name"]
                if "db" in step:
                    _assert_db(db_path, step["db"])


@pytest.mark.parametrize("member", FIXTURE["members"], ids=lambda member: member["name"])
def test_flask_accepts_every_shared_existing_password_fixture(member):
    if member["status"] == "active":
        assert auth.verify_password(FIXTURE["passwords"]["original"], member["password_hash"])
