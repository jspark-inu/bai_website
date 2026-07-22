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
    / "apps" / "web" / "tests" / "contracts" / "materials-parity-fixture.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
EXPECTED_ROUTE_METHODS = {
    "GET /api/materials",
    "POST /api/materials",
    "POST /api/materials/:mid",
    "DELETE /api/materials/:mid",
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
        _insert_rows(conn, "members", FIXTURE["seed"]["members"])
        _insert_rows(conn, "materials", FIXTURE["seed"]["materials"])
        variant_name = case.get("seedVariant")
        if variant_name:
            variant = FIXTURE["seedVariants"][variant_name]
            _insert_rows(conn, "materials", variant.get("materials", []))


def _authenticate(client, identity):
    with client.session_transaction() as flask_session:
        flask_session.clear()
        if identity is not None:
            flask_session["member_id"] = identity["id"]


def _snapshot(db_path):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        columns = [row[1] for row in conn.execute("PRAGMA table_info(materials)")]
        return [
            {column: row[column] for column in columns}
            for row in conn.execute("SELECT * FROM materials ORDER BY rowid")
        ]


def _request(client, case):
    kwargs = {}
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
    pathname = case["path"].split("?", 1)[0]
    if re.fullmatch(r"/api/materials/\d+", pathname):
        pathname = "/api/materials/:mid"
    return f"{case['method']} {pathname}"


def _validate_fixture():
    assert FIXTURE["version"] == 1
    assert set(FIXTURE["routeMethods"]) == EXPECTED_ROUTE_METHODS
    assert len(FIXTURE["routeMethods"]) == 4
    assert len(FIXTURE["legacyCases"]) >= 18
    assert len(FIXTURE["uploadCases"]) >= 7

    names = [case["name"] for case in FIXTURE["legacyCases"]]
    for fragment in (
        "authenticates before", "orders descending", "both filters", "Python whitespace",
        "falsey payload", "truthy non-string", "Content-Type", "non-owner", "owner update",
        "PI may update", "PI may delete", "malformed material POST path", "unsafe ID",
        "preserves managed file metadata", "ignores client supplied file metadata",
    ):
        assert any(fragment in name for name in names), fragment

    upload_names = [case["name"] for case in FIXTURE["uploadCases"]]
    for fragment in (
        "stages then publishes", "create SQL failure", "replacement publishes",
        "replacement SQL failure", "delete commits", "delete SQL failure", "unsafe external",
    ):
        assert any(fragment in name for name in upload_names), fragment

    covered = set()
    for case in FIXTURE["legacyCases"]:
        assert set(case) >= {
            "name", "auth", "method", "path", "status", "contentType",
            "expectedDb", "noMutation",
        }
        assert case["method"] in {"GET", "POST", "DELETE"}
        assert ("jsonBody" in case) != ("rawBody" in case)
        assert isinstance(case["expectedDb"], list) and case["expectedDb"]
        assert isinstance(case["noMutation"], bool)
        if case["status"] >= 400:
            assert case["noMutation"] is True
        if case["contentType"] == "application/json":
            assert "json" in case
        else:
            assert "body" in case
        owned = _route_method(case)
        if owned in EXPECTED_ROUTE_METHODS:
            covered.add(owned)
    assert covered == EXPECTED_ROUTE_METHODS

    for case in FIXTURE["uploadCases"]:
        assert set(case) >= {
            "name", "auth", "method", "path", "status", "contentType", "expectedDb",
            "expectedFiles", "cleanupJournal", "noMutation",
        }
        assert isinstance(case["cleanupJournal"], list)
        if "file" in case:
            assert case["method"] == "POST"
            assert set(case["file"]) == {"name", "type", "text"}


_validate_fixture()


@pytest.mark.parametrize("case", FIXTURE["legacyCases"], ids=lambda case: case["name"])
def test_flask_executes_shared_materials_legacy_fixture(case):
    with TemporaryDirectory(prefix="bai-materials-parity-") as temp_dir:
        temp_root = Path(temp_dir).resolve()
        db_path = temp_root / "fixture.sqlite3"
        _seed(db_path, case)
        assert db_path.resolve().is_relative_to(temp_root)

        flask_app = app_module.create_app(
            db_path=str(db_path),
            secret="materials-parity-test-secret",
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
