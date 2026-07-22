import json
import re
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

import app as app_module
from lab_feed_db import LabFeedDB


FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "apps"
    / "web"
    / "tests"
    / "contracts"
    / "admin-goodbai-parity-fixture.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
TABLES = ("members", "projects", "project_members", "posts", "audit_log")
EXPECTED_ROUTE_METHODS = {
    "POST /api/projects",
    "POST /api/projects/:pid",
    "GET /api/members/api-key",
    "POST /api/members/api-key/regenerate",
    "GET /api/account/api-key",
    "POST /api/account/api-key/regenerate",
    "GET /api/developer/key",
    "POST /api/developer/key/regenerate",
    "GET /api/admin/members",
    "POST /api/admin/members/:mid/api-key/regenerate",
    "POST /api/admin/members/:mid",
    "POST /api/post",
}


def _materialize(value):
    if isinstance(value, list):
        return [_materialize(item) for item in value]
    if isinstance(value, dict):
        if set(value) == {"$integer"} and isinstance(value["$integer"], str):
            return int(value["$integer"])
        return {key: _materialize(item) for key, item in value.items()}
    return value


def _insert_rows(conn, table, rows):
    for raw_row in rows:
        row = _materialize(raw_row)
        columns = list(row)
        conn.execute(
            f"INSERT INTO {table} ({','.join(columns)}) "
            f"VALUES ({','.join('?' for _ in columns)})",
            [row[column] for column in columns],
        )


def _seed(db_path, case):
    LabFeedDB(str(db_path)).init_schema()
    with sqlite3.connect(db_path) as conn:
        for table in ("members", "projects", "project_members", "posts"):
            _insert_rows(conn, table, FIXTURE["seed"][table])
        variant_name = case.get("seedVariant")
        if not variant_name:
            return
        variant = FIXTURE["seedVariants"].get(variant_name)
        if variant is None:
            raise AssertionError(f"unknown seed variant: {variant_name}")
        _insert_rows(conn, "members", variant.get("members", []))
        _insert_rows(conn, "projects", variant.get("projects", []))
        for sequence in variant.get("sqliteSequences", []):
            conn.execute(
                "UPDATE sqlite_sequence SET seq=? WHERE name=?",
                (_materialize(sequence["seq"]), sequence["table"]),
            )
        if variant.get("failProjectMemberInsert"):
            conn.execute(
                """
                CREATE TRIGGER fixture_fail_project_member_insert
                BEFORE INSERT ON project_members
                WHEN NEW.project_id > 10
                BEGIN
                  SELECT RAISE(ABORT, 'fixture project member failure');
                END
                """
            )


def _authenticate(client, identity):
    with client.session_transaction() as flask_session:
        flask_session.clear()
        if identity is not None:
            flask_session["member_id"] = identity["id"]


def _snapshot(db_path):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        result = {}
        for table in TABLES:
            columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
            rows = conn.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            result[table] = [
                {column: row[column] for column in columns}
                for row in rows
            ]
        return result


def _request(client, case):
    kwargs = {"headers": case.get("headers", {})}
    if "jsonBody" in case:
        kwargs["json"] = _materialize(case["jsonBody"])
    elif case["rawBody"] is not None:
        kwargs["data"] = case["rawBody"]
        kwargs["content_type"] = case.get("requestContentType", "application/json")
    return client.open(case["path"], method=case["method"], **kwargs)


def _assert_db_projection(db_path, projections):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for projection in projections:
            actual = [dict(row) for row in conn.execute(projection["query"]).fetchall()]
            assert actual == _materialize(projection["rows"]), projection["query"]


def _route_method(case):
    path = case["path"].split("?", 1)[0]
    if re.fullmatch(r"/api/projects/\d+", path):
        path = "/api/projects/:pid"
    elif re.fullmatch(r"/api/admin/members/\d+/api-key/regenerate", path):
        path = "/api/admin/members/:mid/api-key/regenerate"
    elif re.fullmatch(r"/api/admin/members/\d+", path):
        path = "/api/admin/members/:mid"
    return f"{case['method']} {path}"


def _validate_fixture():
    assert FIXTURE["version"] == 1
    assert set(FIXTURE["routeMethods"]) == EXPECTED_ROUTE_METHODS
    assert len(FIXTURE["routeMethods"]) == 12
    assert isinstance(FIXTURE["generatedApiKey"], str) and FIXTURE["generatedApiKey"]
    assert isinstance(FIXTURE["seed"], dict)
    assert isinstance(FIXTURE["seedVariants"], dict)
    assert isinstance(FIXTURE["cases"], list) and len(FIXTURE["cases"]) >= 30

    names = [case["name"] for case in FIXTURE["cases"]]
    for fragment in (
        "owner update", "PI may update", "non-owner", "self demotion",
        "aliases duplicate members", "rolls back", "disabled member",
        "active first disabled last", "writes audit", "malformed JSON",
        "text plain", "malformed project POST path", "malformed admin member POST path",
        "Python whitespace", "underscore coercion", "boolean project id",
        "unsafe numeric member id", "unsafe numeric project",
    ):
        assert any(fragment in name for name in names), fragment

    covered = set()
    for case in FIXTURE["cases"]:
        assert set(case) >= {
            "name", "auth", "method", "path", "status", "contentType",
            "expectedDb", "noMutation",
        }
        assert case["method"] in {"GET", "POST"}
        assert ("jsonBody" in case) != ("rawBody" in case)
        assert isinstance(case["expectedDb"], list) and case["expectedDb"]
        assert isinstance(case["noMutation"], bool)
        if case["status"] >= 400:
            assert case["noMutation"] is True
        if case["contentType"] == "application/json":
            assert "json" in case
        else:
            assert "body" in case
        route_method = _route_method(case)
        # Deliberately malformed typed paths are routing probes, not owned routes.
        if route_method in EXPECTED_ROUTE_METHODS:
            covered.add(route_method)
    assert covered == EXPECTED_ROUTE_METHODS


_validate_fixture()


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_flask_executes_shared_admin_goodbai_fixture(case, monkeypatch):
    monkeypatch.setattr(
        app_module.auth,
        "make_api_key",
        lambda: FIXTURE["generatedApiKey"],
    )
    with TemporaryDirectory(prefix="bai-admin-goodbai-parity-") as temp_dir:
        db_path = Path(temp_dir) / "fixture.sqlite3"
        _seed(db_path, case)
        flask_app = app_module.create_app(
            db_path=str(db_path),
            secret="admin-goodbai-parity-test-secret",
        )
        flask_app.config.update(TESTING=True, PROPAGATE_EXCEPTIONS=False)
        with flask_app.test_client() as client:
            _authenticate(client, case["auth"])
            before = _snapshot(db_path)
            response = _request(client, case)

        assert response.status_code == case["status"]
        assert response.content_type == case["contentType"]
        if "json" in case:
            assert response.get_json() == _materialize(case["json"])
        if "body" in case:
            assert response.get_data(as_text=True) == case["body"]
        _assert_db_projection(db_path, case["expectedDb"])
        if case["noMutation"]:
            assert _snapshot(db_path) == before
