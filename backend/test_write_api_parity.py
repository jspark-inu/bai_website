import json
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
    / "write-api-parity-fixture.json"
)
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
TABLES = ("posts", "comments", "reactions", "wall_messages", "inquiries")


def _materialize(value):
    if isinstance(value, list):
        return [_materialize(item) for item in value]
    if isinstance(value, dict):
        if set(value) == {"$integer"}:
            return int(value["$integer"])
        return {key: _materialize(item) for key, item in value.items()}
    return value


def _insert_rows(conn, table, rows):
    for row in rows:
        columns = list(row)
        placeholders = ",".join("?" for _ in columns)
        conn.execute(
            f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})",
            [_materialize(row[column]) for column in columns],
        )


def _seed(db_path, case):
    db = LabFeedDB(str(db_path))
    db.init_schema()
    with sqlite3.connect(db_path) as conn:
        for table in ("members", "projects", "posts", "inquiries", "wall_messages"):
            _insert_rows(conn, table, FIXTURE["seed"][table])
        variant_name = case.get("seedVariant")
        if variant_name:
            variant = FIXTURE["seedVariants"][variant_name]
            _insert_rows(conn, "projects", variant.get("projects", []))
            _insert_rows(conn, "reactions", variant.get("reactions", []))
            for update in variant.get("inquiryUpdates", []):
                values = {key: value for key, value in update.items() if key != "id"}
                conn.execute(
                    f"UPDATE inquiries SET {','.join(f'{key}=?' for key in values)} WHERE id=?",
                    [*values.values(), update["id"]],
                )
            for sequence in variant.get("sqliteSequences", []):
                conn.execute(
                    "UPDATE sqlite_sequence SET seq=? WHERE name=?",
                    (_materialize(sequence["seq"]), sequence["table"]),
                )


def _authenticate(client, auth):
    with client.session_transaction() as session:
        session.clear()
        if auth is not None:
            session["member_id"] = auth["id"]


def _snapshot(db_path):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        snapshot = {}
        for table in TABLES:
            columns = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
            rows = conn.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            snapshot[table] = [{column: row[column] for column in columns} for row in rows]
        return snapshot


def _request(client, case):
    kwargs = {}
    if "jsonBody" in case:
        body = dict(case["jsonBody"])
        if "bodyRepeat" in body:
            repeat = body.pop("bodyRepeat")
            body["body"] = repeat["value"] * repeat["count"]
        kwargs["json"] = body
    elif case.get("rawBody") is not None:
        kwargs["data"] = case["rawBody"]
        kwargs["content_type"] = case.get("contentType", "application/json")
    return client.open(case["path"], method=case["method"], **kwargs)


def _assert_db_projection(db_path, expected):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for projection in expected:
            actual = [dict(row) for row in conn.execute(projection["query"]).fetchall()]
            assert actual == _materialize(projection["rows"]), projection["query"]


def _validate_fixture():
    assert FIXTURE["version"] == 1
    assert len(FIXTURE["cases"]) >= 25
    names = {case["name"] for case in FIXTURE["cases"]}
    required_fragments = (
        "authenticates before parsing",
        "non-owner",
        "not found before body validation",
        "invalid project",
        "reaction inserts",
        "reaction deletes",
        "limit zero",
        "negative",
        "limit two",
        "malformed limit",
        "huge limit",
        "U+FEFF",
        "eighty emoji",
        "eighty-one emoji",
        "PI role before existence",
        "overwrites",
        "malformed typed POST path",
        "unsafe numeric JSON",
        "truthy non-object JSON",
        "empty containers",
    )
    for fragment in required_fragments:
        assert any(fragment in name for name in names), fragment
    for case in FIXTURE["cases"]:
        assert set(case) >= {"name", "auth", "method", "path", "status", "expectedDb", "noMutation"}
        assert ("jsonBody" in case) != ("rawBody" in case)
        if case["status"] >= 400:
            assert case["noMutation"] is True


_validate_fixture()


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_flask_executes_shared_write_api_fixture(case):
    with TemporaryDirectory(prefix="bai-write-api-parity-") as temp_dir:
        db_path = Path(temp_dir) / "write-api.sqlite3"
        _seed(db_path, case)
        flask_app = app_module.create_app(
            db_path=str(db_path),
            secret="write-api-parity-test-secret",
        )
        flask_app.config["TESTING"] = True
        flask_app.config["PROPAGATE_EXCEPTIONS"] = False
        with flask_app.test_client() as client:
            _authenticate(client, case["auth"])
            before = _snapshot(db_path)
            response = _request(client, case)

        assert response.status_code == case["status"]
        if "json" in case:
            assert response.get_json() == _materialize(case["json"])
        _assert_db_projection(db_path, case["expectedDb"])
        if case["noMutation"]:
            assert _snapshot(db_path) == before
