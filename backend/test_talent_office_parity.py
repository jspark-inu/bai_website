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
    / "apps" / "web" / "tests" / "contracts"
    / "talent-office-parity-fixture.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
TABLES = ("talent_requests", "talent_request_assignees", "contribution_points", "audit_log")
EXPECTED_ROUTE_METHODS = {
    "GET /api/talent-office",
    "POST /api/talent-office",
    "GET /api/talent-office/:rid",
    "POST /api/talent-office/:rid/review",
    "POST /api/talent-office/:rid/assignees",
    "POST /api/talent-office/:rid/solution",
    "POST /api/talent-office/:rid/decision",
    "GET /api/talent-office/points",
}


def _insert_rows(conn, table, rows):
    for row in rows:
        columns = list(row)
        conn.execute(
            f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            [row[column] for column in columns],
        )


def _seed(db_path, case):
    # The Flask oracle always starts from its real schema initializer in a disposable DB.
    LabFeedDB(str(db_path)).init_schema()
    with sqlite3.connect(db_path) as conn:
        for table in ("members", "talent_requests", "talent_request_assignees", "contribution_points"):
            _insert_rows(conn, table, FIXTURE["seed"][table])
        variant = FIXTURE["seedVariants"].get(case.get("seedVariant"), {})
        if variant.get("failAssigneeInsert"):
            conn.execute("""
                CREATE TRIGGER fixture_fail_assignee
                BEFORE INSERT ON talent_request_assignees
                BEGIN SELECT RAISE(ABORT, 'fixture assignee failure'); END
            """)
        if variant.get("failPointInsert"):
            conn.execute("""
                CREATE TRIGGER fixture_fail_point
                BEFORE INSERT ON contribution_points
                BEGIN SELECT RAISE(ABORT, 'fixture point failure'); END
            """)


def _authenticate(client, identity):
    with client.session_transaction() as session:
        session.clear()
        if identity is not None:
            session["member_id"] = identity["id"]


def _snapshot(db_path):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        return {
            table: [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
            for table in TABLES
        }


def _request(client, case):
    kwargs = {}
    if "jsonBody" in case:
        kwargs["json"] = case["jsonBody"]
    elif case["rawBody"] is not None:
        kwargs["data"] = case["rawBody"]
        kwargs["content_type"] = case.get("requestContentType", "application/json")
    return client.open(case["path"], method=case["method"], **kwargs)


def _assert_db_projection(db_path, projections):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for projection in projections:
            actual = [dict(row) for row in conn.execute(projection["query"])]
            assert actual == projection["rows"], projection["query"]


def _route_method(case):
    path = case["path"].split("?", 1)[0]
    if path == "/api/talent-office/points":
        pass
    elif re.fullmatch(r"/api/talent-office/\d+", path):
        path = "/api/talent-office/:rid"
    else:
        match = re.fullmatch(r"/api/talent-office/\d+/(review|assignees|solution|decision)", path)
        if match:
            path = f"/api/talent-office/:rid/{match.group(1)}"
    return f"{case['method']} {path}"


def _validate_fixture():
    assert FIXTURE["version"] == 1
    assert len(FIXTURE["routeMethods"]) == 8
    assert set(FIXTURE["routeMethods"]) == EXPECTED_ROUTE_METHODS
    assert set(FIXTURE["seedVariants"]) == {"failAssigneeInsert", "failPointInsert"}
    assert len(FIXTURE["cases"]) >= 45
    names = [case["name"] for case in FIXTURE["cases"]]
    for fragment in (
        "authentication", "operator", "visibility", "before", "loose state",
        "tolerance", "duplicate", "disabled", "delegates", "changes_requested",
        "completion", "idempotent", "audit", "falsey", "truthy", "malformed",
        "unsafe", "rollback injection",
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
        assert case["contentType"] == "application/json" or "body" in case
        assert isinstance(case["expectedDb"], list) and len(case["expectedDb"]) == 4
        assert isinstance(case["noMutation"], bool)
        method = _route_method(case)
        if method in EXPECTED_ROUTE_METHODS:
            covered.add(method)
    assert covered == EXPECTED_ROUTE_METHODS


_validate_fixture()


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_flask_executes_shared_talent_office_fixture(case):
    with TemporaryDirectory(prefix="bai-talent-office-parity-") as temp_dir:
        db_path = Path(temp_dir) / "fixture.sqlite3"
        assert db_path.is_relative_to(Path(temp_dir))
        _seed(db_path, case)
        flask_app = app_module.create_app(
            db_path=str(db_path),
            secret="talent-office-parity-test-secret",
        )
        flask_app.config.update(TESTING=True, PROPAGATE_EXCEPTIONS=False)
        with flask_app.test_client() as client:
            _authenticate(client, case["auth"])
            before = _snapshot(db_path)
            response = _request(client, case)

        assert response.status_code == case["status"]
        assert response.content_type == case["contentType"]
        if "json" in case:
            assert response.get_json() == case["json"]
        if "body" in case:
            assert response.get_data(as_text=True) == case["body"]
        _assert_db_projection(db_path, case["expectedDb"])
        if case["noMutation"]:
            assert _snapshot(db_path) == before
