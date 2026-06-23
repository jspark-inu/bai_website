import tempfile, os
import pytest
from lab_feed_db import LabFeedDB
import auth


@pytest.fixture
def db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    d = LabFeedDB(path)
    d.init_schema()
    yield d
    os.remove(path)


def test_hash_and_verify_password():
    h = auth.hash_password("secret123")
    assert h != "secret123"
    assert auth.verify_password("secret123", h) is True
    assert auth.verify_password("wrong", h) is False


def test_make_api_key_is_unique_and_long():
    k1 = auth.make_api_key()
    k2 = auth.make_api_key()
    assert k1 != k2
    assert len(k1) >= 24


def test_authenticate_web(db):
    h = auth.hash_password("pw")
    db.add_member(name="김영희", password_hash=h, api_key="k", role="student")
    m = auth.authenticate_web(db, "김영희", "pw")
    assert m["name"] == "김영희"
    assert auth.authenticate_web(db, "김영희", "bad") is None
    assert auth.authenticate_web(db, "없음", "pw") is None


def test_member_from_api_key(db):
    db.add_member(name="이철수", password_hash="h", api_key="abc123key", role="student")
    m = auth.member_from_api_key(db, "abc123key")
    assert m["name"] == "이철수"
    assert auth.member_from_api_key(db, "nope") is None
