import tempfile, os
import pytest
import app as app_module
from lab_feed_db import LabFeedDB
import auth


# ---- DB 계층 ----

@pytest.fixture
def db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    d = LabFeedDB(path)
    d.init_schema()
    yield d
    os.remove(path)


def test_add_and_list_inquiry(db):
    sid = db.add_member("학생", "h", "k1", role="student")
    iid = db.add_inquiry(sid, "모임은 매주 언제 하나요?")
    data = db.list_inquiries()
    assert len(data["open"]) == 1 and data["answered"] == []
    q = data["open"][0]
    assert q["id"] == iid
    assert q["question"] == "모임은 매주 언제 하나요?"
    assert q["author_name"] == "학생"
    assert q["status"] == "open"


def test_answer_moves_to_faq(db):
    sid = db.add_member("학생", "h", "k1", role="student")
    pid = db.add_member("교수", "h", "k2", role="pi")
    iid = db.add_inquiry(sid, "길드는 어떻게 정해요?")
    db.answer_inquiry(iid, "intake form 응답을 보고 비슷한 quest끼리 묶어요.", pid)
    data = db.list_inquiries()
    assert data["open"] == []
    a = data["answered"][0]
    assert a["answer"].startswith("intake form")
    assert a["answerer_name"] == "교수"
    assert a["answered_at"]


def test_open_oldest_first_answered_recent_first(db):
    sid = db.add_member("학생", "h", "k1", role="student")
    pid = db.add_member("교수", "h", "k2", role="pi")
    i1 = db.add_inquiry(sid, "첫 질문")
    i2 = db.add_inquiry(sid, "둘째 질문")
    i3 = db.add_inquiry(sid, "셋째 질문")
    # 접수 대기: 오래된 순 (오래 방치된 질문 먼저)
    data = db.list_inquiries()
    assert [q["id"] for q in data["open"]] == [i1, i2, i3]
    # 답변되면 FAQ로 이동
    db.answer_inquiry(i2, "답2", pid)
    data = db.list_inquiries()
    assert [q["id"] for q in data["open"]] == [i1, i3]
    assert [q["id"] for q in data["answered"]] == [i2]


# ---- API ----

@pytest.fixture
def ctx():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db = LabFeedDB(path)
    db.init_schema()
    db.add_member("학생", auth.hash_password("pw"), "key-student", role="student")
    db.add_member("교수", auth.hash_password("pw"), "key-pi", role="pi")
    flask_app = app_module.create_app(db_path=path, secret="test-secret")
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c, db
    os.remove(path)


def _login(client, name, pw="pw"):
    return client.post("/api/login", json={"name": name, "password": pw})


def test_inquiries_require_login(ctx):
    client, _ = ctx
    assert client.get("/api/inquiries").status_code == 401
    assert client.post("/api/inquiries", json={"question": "q"}).status_code == 401


def test_student_submits_question(ctx):
    client, _ = ctx
    _login(client, "학생")
    r = client.post("/api/inquiries", json={"question": "공모전 참가는 필수인가요?"})
    assert r.status_code == 200 and "id" in r.get_json()
    data = client.get("/api/inquiries").get_json()
    assert data["open"][0]["question"] == "공모전 참가는 필수인가요?"


def test_empty_question_rejected(ctx):
    client, _ = ctx
    _login(client, "학생")
    assert client.post("/api/inquiries", json={"question": "  "}).status_code == 400
    assert client.post("/api/inquiries", json={}).status_code == 400


def test_only_pi_can_answer(ctx):
    client, _ = ctx
    _login(client, "학생")
    iid = client.post("/api/inquiries", json={"question": "회비 있나요?"}).get_json()["id"]
    # 학생은 답변 불가
    assert client.post(f"/api/inquiries/{iid}/answer", json={"answer": "x"}).status_code == 403
    # PI는 가능
    _login(client, "교수")
    r = client.post(f"/api/inquiries/{iid}/answer", json={"answer": "없어요. 활동비로 운영해요."})
    assert r.status_code == 200
    data = client.get("/api/inquiries").get_json()
    assert data["answered"][0]["answer"].startswith("없어요")
    assert data["answered"][0]["answerer_name"] == "교수"


def test_answer_validation(ctx):
    client, _ = ctx
    _login(client, "교수")
    assert client.post("/api/inquiries/999/answer", json={"answer": "x"}).status_code == 404
    _login(client, "학생")
    iid = client.post("/api/inquiries", json={"question": "q"}).get_json()["id"]
    _login(client, "교수")
    assert client.post(f"/api/inquiries/{iid}/answer", json={"answer": ""}).status_code == 400


def test_ask_page_served(ctx):
    client, _ = ctx
    r = client.get("/ask")
    assert r.status_code == 200
