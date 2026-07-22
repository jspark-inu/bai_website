import json
from pathlib import Path
from tempfile import TemporaryDirectory

import auth
import app as app_module
from lab_feed_db import LabFeedDB


FIXTURES_PATH = (
    Path(__file__).resolve().parents[1]
    / "apps"
    / "web"
    / "tests"
    / "contracts"
    / "legacy-api-fixtures.json"
)
SYNTHETIC_STUDENT = {
    "name": "contract-fixture-student",
    "password": "contract-fixture-password",
    "api_key": "contract-fixture-student-key",
    "role": "student",
}
EXPECTED_FIXTURE_NAMES = {
    "health-success",
    "goodbai-invalid-api-key",
    "pi-only-forbidden",
    "post-not-found",
}


def test_shared_legacy_api_fixtures_match_flask_test_client():
    fixtures = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    assert {fixture["name"] for fixture in fixtures} == EXPECTED_FIXTURE_NAMES
    assert len(fixtures) == 4

    with TemporaryDirectory(prefix="bai-legacy-api-contract-") as temp_dir:
        db_path = Path(temp_dir) / "contract-fixtures.sqlite3"
        db = LabFeedDB(str(db_path))
        db.init_schema()
        db.add_member(
            SYNTHETIC_STUDENT["name"],
            auth.hash_password(SYNTHETIC_STUDENT["password"]),
            SYNTHETIC_STUDENT["api_key"],
            role=SYNTHETIC_STUDENT["role"],
        )

        flask_app = app_module.create_app(
            db_path=str(db_path),
            secret="contract-fixture-test-secret",
        )
        flask_app.config["TESTING"] = True

        with flask_app.test_client() as client:
            authenticated_role = None
            for fixture in fixtures:
                request = fixture["request"]
                session_role = request.get("sessionRole")
                if session_role and authenticated_role != session_role:
                    assert session_role == SYNTHETIC_STUDENT["role"]
                    login = client.post(
                        "/api/login",
                        json={
                            "name": SYNTHETIC_STUDENT["name"],
                            "password": SYNTHETIC_STUDENT["password"],
                        },
                    )
                    assert login.status_code == 200
                    authenticated_role = session_role

                response = client.open(
                    request["path"],
                    method=request["method"],
                    headers=request.get("headers"),
                    json=request.get("json"),
                )
                assert response.status_code == fixture["response"]["status"], fixture["name"]
                assert response.get_json() == fixture["response"]["json"], fixture["name"]

        assert db_path.is_file()

    assert not db_path.exists()
