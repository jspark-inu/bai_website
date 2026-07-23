import os
import re
import math
import sqlite3
import time
import ipaddress
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from flask import Flask, request, jsonify, session, send_from_directory

from lab_feed_db import LabFeedDB
import auth

KST = timezone(timedelta(hours=9))


def week_start_utc(now_kst=None):
    """이번 주 월요일 00:00(KST)을 UTC 'YYYY-MM-DD HH:MM:SS' 문자열로. now_kst 주입 가능(테스트)."""
    now_kst = now_kst or datetime.now(KST)
    monday = (now_kst - timedelta(days=now_kst.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return monday.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
DEFAULT_DB = os.environ.get(
    "LAB_FEED_DB", os.path.join(os.path.dirname(__file__), "lab-feed.db")
)
CORE_DB_TABLES = {"members", "posts"}
LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_COOLDOWN_SECONDS = 60.0
KNOWN_INSECURE_SECRETS = {
    "dev",
    "dev-insecure-secret",
    "change-me-generate-with-python-secrets",
}


def _env_enabled(name):
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _session_secret(explicit_secret=None):
    """Return an intentional session secret; never use a public fallback."""
    if explicit_secret is not None:
        if not explicit_secret:
            raise RuntimeError("session secret must not be empty")
        return explicit_secret
    configured = os.environ.get("LAB_FEED_SECRET", "").strip()
    insecure = not configured or configured in KNOWN_INSECURE_SECRETS or len(configured) < 32
    if insecure and not _env_enabled("LAB_FEED_ALLOW_INSECURE_SECRET"):
        raise RuntimeError(
            "LAB_FEED_SECRET must be a non-placeholder secret of at least 32 characters"
        )
    return configured or "dev-insecure-secret"


def _require_existing_configured_db(db_path):
    """Fail closed when an explicitly configured live DB is missing or wrong.

    Creating a new database remains available for provisioning, but it must be
    an explicit action via LAB_FEED_ALLOW_BOOTSTRAP=1. Tests may continue to
    inject a temporary path through create_app(db_path=...).
    """
    if not db_path or not os.path.isfile(db_path):
        raise RuntimeError(
            "LAB_FEED_DB does not point to an existing database; "
            "set LAB_FEED_ALLOW_BOOTSTRAP=1 only for intentional provisioning"
        )
    uri = "file:%s?mode=ro" % quote(os.path.abspath(db_path), safe="/")
    try:
        conn = sqlite3.connect(uri, uri=True)
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            missing = sorted(CORE_DB_TABLES - tables)
            if missing:
                raise RuntimeError(
                    "LAB_FEED_DB is missing core tables: %s" % ", ".join(missing)
                )
            quick_check = conn.execute("PRAGMA quick_check(1)").fetchone()[0]
            if quick_check != "ok":
                raise RuntimeError("LAB_FEED_DB failed SQLite quick_check")
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        raise RuntimeError("LAB_FEED_DB is not a readable SQLite database") from exc


def create_app(db_path=None, secret=None):
    configured_db_path = os.environ.get("LAB_FEED_DB")
    resolved_db_path = db_path or configured_db_path or DEFAULT_DB
    bootstrap_enabled = _env_enabled("LAB_FEED_ALLOW_BOOTSTRAP")
    if db_path is None and configured_db_path is not None:
        if not configured_db_path:
            raise RuntimeError("LAB_FEED_DB must not be empty")
        if not os.path.isabs(configured_db_path):
            raise RuntimeError("LAB_FEED_DB must be an absolute path")
        if not bootstrap_enabled:
            _require_existing_configured_db(configured_db_path)

    # A configured existing DB is treated as a live-style deployment. Secure
    # cookies are the default there; local HTTP development must opt out
    # explicitly so a production environment cannot silently downgrade them.
    live_style = db_path is None and configured_db_path is not None and not bootstrap_enabled
    secure_cookie_setting = os.environ.get("LAB_FEED_COOKIE_SECURE")
    if secure_cookie_setting is None:
        secure_cookie = live_style
    else:
        secure_cookie = _env_enabled("LAB_FEED_COOKIE_SECURE")
    if live_style and not secure_cookie and not _env_enabled("LAB_FEED_ALLOW_INSECURE_COOKIE"):
        raise RuntimeError(
            "live LAB_FEED_DB requires secure session cookies; "
            "use LAB_FEED_ALLOW_INSECURE_COOKIE=1 only for local HTTP development"
        )

    app = Flask(__name__, static_folder=None)
    app.secret_key = _session_secret(secret)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=secure_cookie,
        LOGIN_FAILURE_LIMIT=LOGIN_FAILURE_LIMIT,
        LOGIN_FAILURE_COOLDOWN_SECONDS=LOGIN_FAILURE_COOLDOWN_SECONDS,
    )
    db = LabFeedDB(resolved_db_path)
    db.init_schema()
    app.extensions["lab_feed_db"] = db
    login_failures = {}

    def current_member():
        mid = session.get("member_id")
        return db.get_member_by_id(mid) if mid else None

    def require_pi():
        """(member, None) 통과 / (None, (resp, code)) 거부. 코크핏 전용."""
        m = current_member()
        if not m:
            return None, (jsonify({"error": "login required"}), 401)
        if m["role"] != "pi":
            return None, (jsonify({"error": "pi only"}), 403)
        return m, None

    def is_operator(member):
        return bool(member and member["role"] in {"operator", "pi"})

    def require_operator():
        m = current_member()
        if not m:
            return None, (jsonify({"error": "login required"}), 401)
        if not is_operator(m):
            return None, (jsonify({"error": "operator only"}), 403)
        return m, None

    def _post_payload():
        data = request.get_json(silent=True) or {}
        pid = data.get("project_id")
        try:
            pid = int(pid) if pid not in (None, "", "null") else None
        except (TypeError, ValueError):
            pid = None
        return (
            (data.get("did") or "").strip(),
            (data.get("learned") or "").strip(),
            (data.get("blocked") or "").strip(),
            (data.get("tags") or "").strip(),
            (data.get("links") or "").strip(),
            pid,
        )

    def _material_payload():
        data = request.get_json(silent=True) or {}
        return {
            "title": (data.get("title") or "").strip(),
            "body": (data.get("body") or "").strip(),
            "url": (data.get("url") or "").strip(),
            "category": (data.get("category") or "자료").strip() or "자료",
            "guild": (data.get("guild") or "").strip(),
        }

    def _slugify_project(title, pid=None):
        slug = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")
        return slug or ("project-%s" % pid if pid else "")

    def _project_registry_payload():
        data = request.get_json(silent=True) or {}
        members = data.get("members") or []
        return {
            "title": (data.get("title") or "").strip(),
            "type": (data.get("type") or data.get("guild") or "").strip(),
            "slug": (data.get("slug") or "").strip(),
            "summary": (data.get("summary") or "").strip(),
            "repo_url": (data.get("repo_url") or "").strip(),
            "site_url": (data.get("site_url") or "").strip(),
            "members": members,
        }

    def _talent_request_payload():
        data = request.get_json(silent=True) or {}
        return {
            "title": (data.get("title") or "").strip(),
            "problem": (data.get("problem") or "").strip(),
            "expected_outcome": (data.get("expected_outcome") or "").strip(),
            "system_scope_reason": (data.get("system_scope_reason") or "").strip(),
        }

    def _talent_assignees_payload():
        rows = (request.get_json(silent=True) or {}).get("assignees") or []
        parsed, seen = [], set()
        for row in rows:
            try:
                member_id = int(row.get("member_id"))
                ratio = float(row.get("allocation_ratio"))
            except (AttributeError, TypeError, ValueError):
                raise ValueError("invalid assignee")
            if member_id in seen or not db.get_member_by_id(member_id) or ratio <= 0:
                raise ValueError("invalid assignee")
            seen.add(member_id)
            parsed.append((member_id, (row.get("role") or "").strip(), ratio))
        return parsed

    def _member_roles_from_payload(member_rows, owner_id):
        seen = {}
        for row in member_rows:
            try:
                mid = int(row.get("member_id"))
            except (AttributeError, TypeError, ValueError):
                raise ValueError("invalid members payload")
            if not db.get_member_by_id(mid):
                raise ValueError("invalid member_id")
            seen[mid] = (row.get("role") or "").strip()
        if owner_id not in seen:
            seen[owner_id] = "리드"
        return list(seen.items())

    def _login_key(name):
        client_ip = request.remote_addr or "local"
        if client_ip in {"127.0.0.1", "::1"}:
            forwarded = (request.headers.get("X-BAI-Client-IP") or "").strip()
            try:
                if forwarded:
                    client_ip = str(ipaddress.ip_address(forwarded))
            except ValueError:
                pass
        return "%s:%s" % (client_ip, name.strip().lower())

    def _enrich(post):
        if "reaction_count" not in post:
            post["reaction_count"] = db.count_reactions(post["id"])
        if "comment_count" not in post:
            post["comment_count"] = len(db.list_comments(post["id"]))
        return post


    @app.route("/healthz")
    @app.route("/api/healthz")
    def healthz():
        try:
            db.health_check()
        except (sqlite3.Error, RuntimeError):
            app.logger.exception("BAI database health check failed")
            return jsonify({"ok": False, "service": "bai-site"}), 503
        return jsonify({"ok": True, "service": "bai-site", "database": "ok"})

    # ---- 스킬용 JSON API (API키 인증) ----
    @app.route("/api/post", methods=["POST"])
    def api_post():
        member = auth.member_from_api_key(db, request.headers.get("X-API-Key"))
        if not member:
            return jsonify({"error": "invalid api key"}), 401
        did, learned, blocked, tags, links, project_id = _post_payload()
        if not (did or learned or blocked):
            return jsonify({"error": "empty post"}), 400
        if project_id is not None and not db.get_project(project_id):
            return jsonify({"error": "invalid project_id"}), 400
        pid = db.add_post(author_id=member["id"], did=did, learned=learned,
                          blocked=blocked, tags=tags, source="skill", links=links,
                          project_id=project_id)
        return jsonify({"id": pid, "url": "/post/%d" % pid})

    # ---- 웹 로그인/세션 ----
    @app.route("/api/login", methods=["POST"])
    def api_login():
        data = request.get_json(silent=True) or {}
        name = data.get("name", "")
        key = _login_key(name)
        now = time.monotonic()
        expired = [
            failure_key for failure_key, state in login_failures.items()
            if state["expires_at"] <= now
        ]
        for failure_key in expired:
            login_failures.pop(failure_key, None)
        state = login_failures.get(key)
        if state and state["locked_until"] > now:
            response = jsonify({"error": "too many login failures"})
            response.headers["Retry-After"] = str(
                max(1, math.ceil(state["locked_until"] - now))
            )
            return response, 429
        member = auth.authenticate_web(db, name, data.get("password", ""))
        if not member:
            failures = (state["failures"] if state else 0) + 1
            cooldown = float(app.config["LOGIN_FAILURE_COOLDOWN_SECONDS"])
            login_failures[key] = {
                "failures": failures,
                "locked_until": now + cooldown
                if failures >= int(app.config["LOGIN_FAILURE_LIMIT"]) else 0,
                "expires_at": now + cooldown,
            }
            return jsonify({"error": "invalid credentials"}), 401
        login_failures.pop(key, None)
        session["member_id"] = member["id"]
        return jsonify({"id": member["id"], "name": member["name"], "role": member["role"]})

    @app.route("/api/logout", methods=["POST"])
    def api_logout():
        session.clear()
        return jsonify({"ok": True})

    @app.route("/api/me", methods=["GET", "POST"])
    def api_me():
        m = current_member()
        if not m:
            return jsonify({"error": "not logged in"}), 401
        if request.method == "POST":
            data = request.get_json(silent=True) or {}
            if data.get("action") != "regenerate_api_key":
                return jsonify({"error": "unknown action"}), 400
            api_key = auth.make_api_key()
            db.update_member_api_key(m["id"], api_key)
            db.add_audit_log(m["id"], "self_regenerate_api_key", target_member_id=m["id"])
            return jsonify({"api_key": api_key, "member_id": m["id"], "name": m["name"], "role": m["role"]})
        payload = {"id": m["id"], "name": m["name"], "role": m["role"]}
        if request.args.get("api_key") == "1":
            payload.update({
                "api_key": m["api_key"],
                "member_id": m["id"],
                "usage": {"endpoint": "/api/post", "method": "POST", "header": "X-API-Key"},
            })
        return jsonify(payload)

    @app.route("/api/change-password", methods=["POST"])
    def api_change_password():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        data = request.get_json(silent=True) or {}
        current_password = data.get("current_password", "")
        new_password = data.get("new_password", "")
        if not auth.verify_password(current_password, member["password_hash"]):
            return jsonify({"error": "current password is incorrect"}), 400
        if len(new_password) < 4:
            return jsonify({"error": "new password must be at least 4 characters"}), 400
        db.update_member_password(member["id"], auth.hash_password(new_password))
        return jsonify({"ok": True})

    # ---- 피드/글 조회 (읽기는 로그인 필요) ----
    @app.route("/api/feed")
    def api_feed():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        pid = request.args.get("project_id", type=int)
        return jsonify([_enrich(p) for p in db.list_posts_filtered(pid)])

    @app.route("/api/post/<int:pid>")
    def api_get_post(pid):
        if not current_member():
            return jsonify({"error": "login required"}), 401
        post = db.get_post(pid)
        if not post:
            return jsonify({"error": "not found"}), 404
        return jsonify({
            "post": _enrich(post),
            "comments": db.list_comments(pid),
            "reacted_by": db.reacted_member_ids(pid),
        })

    @app.route("/api/member/<int:mid>")
    def api_member_profile(mid):
        if not current_member():
            return jsonify({"error": "login required"}), 401
        member = db.get_member_by_id(mid)
        if not member:
            return jsonify({"error": "not found"}), 404
        posts = [_enrich(p) for p in db.list_posts_by_member(mid)]
        return jsonify({
            "member": {"id": member["id"], "name": member["name"], "role": member["role"]},
            "posts": posts,
            "post_count": len(posts),
            "tag_counts": db.member_tag_counts(mid),
            "first_post_at": posts[0]["created_at"] if posts else None,
            "last_post_at": posts[-1]["created_at"] if posts else None,
        })

    # ---- R1: 태그별 ----
    @app.route("/api/tag/<tag>")
    def api_tag(tag):
        if not current_member():
            return jsonify({"error": "login required"}), 401
        posts = [_enrich(p) for p in db.list_posts_by_tag(tag)]
        return jsonify({"tag": tag, "posts": posts})

    # ---- R2: 검색 ----
    @app.route("/api/search")
    def api_search():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        q = request.args.get("q", "")
        posts = [_enrich(p) for p in db.search_posts(q)]
        return jsonify({"q": q, "posts": posts})

    # ---- R3: 미답변 막힌 질문 ----
    @app.route("/api/questions")
    def api_questions():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        return jsonify({"posts": [_enrich(p) for p in db.list_open_questions()]})

    # ---- 운영 문의 (질문 접수 → PI 답변 → FAQ) ----
    @app.route("/api/inquiries", methods=["GET"])
    def api_inquiries():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        return jsonify(db.list_inquiries())

    @app.route("/api/inquiries", methods=["POST"])
    def api_inquiry_create():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        data = request.get_json(silent=True) or {}
        question = (data.get("question") or "").strip()
        if not question:
            return jsonify({"error": "question required"}), 400
        iid = db.add_inquiry(member["id"], question)
        return jsonify({"id": iid})

    @app.route("/api/inquiries/<int:iid>/answer", methods=["POST"])
    def api_inquiry_answer(iid):
        member, err = require_pi()
        if err:
            return err
        if not db.get_inquiry(iid):
            return jsonify({"error": "not found"}), 404
        data = request.get_json(silent=True) or {}
        answer = (data.get("answer") or "").strip()
        if not answer:
            return jsonify({"error": "answer required"}), 400
        db.answer_inquiry(iid, answer, member["id"])
        return jsonify({"ok": True})

    # ---- R4: 멤버 명단 ----
    @app.route("/api/members")
    def api_members():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        return jsonify(db.list_members_with_stats())

    @app.route("/api/projects")
    def api_projects():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        rows = db.list_projects()
        return jsonify([p for p in rows if p["status"] == "active"])

    @app.route("/api/projects", methods=["POST"])
    def api_project_create():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        p = _project_registry_payload()
        if not p["title"] or not (p["summary"] or p["repo_url"] or p["site_url"]):
            return jsonify({"error": "title and summary or link required"}), 400
        try:
            member_roles = _member_roles_from_payload(p["members"], member["id"])
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        pid = db.add_project_with_members(
            member_roles=member_roles,
            title=p["title"],
            type=p["type"],
            goal=p["summary"],
            summary=p["summary"],
            slug=_slugify_project(p["slug"] or p["title"]),
            repo_url=p["repo_url"],
            site_url=p["site_url"],
            owner_member_id=member["id"],
        )
        return jsonify({"id": pid})

    @app.route("/api/projects/<int:pid>")
    def api_project_detail(pid):
        if not current_member():
            return jsonify({"error": "login required"}), 401
        project = db.get_project(pid)
        if not project:
            return jsonify({"error": "not found"}), 404
        return jsonify({
            "project": project,
            "members": db.list_project_members(pid),
            "activity": db.list_posts_by_project(pid),
        })

    @app.route("/api/projects/<int:pid>", methods=["POST"])
    def api_project_update(pid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        project = db.get_project(pid)
        if not project:
            return jsonify({"error": "not found"}), 404
        if member["role"] != "pi" and project["owner_member_id"] != member["id"]:
            return jsonify({"error": "forbidden"}), 403
        p = _project_registry_payload()
        if not p["title"] or not (p["summary"] or p["repo_url"] or p["site_url"]):
            return jsonify({"error": "title and summary or link required"}), 400
        try:
            member_roles = _member_roles_from_payload(p["members"], project["owner_member_id"] or member["id"])
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        db.update_project_with_members(
            pid,
            member_roles=member_roles,
            title=p["title"],
            type=p["type"],
            status=project["status"],
            goal=p["summary"],
            current_stage=project["current_stage"],
            deadline=project["deadline"],
            next_milestone=project["next_milestone"],
            risk_level=project["risk_level"],
            pi_decision=project["pi_decision"],
            summary=p["summary"],
            slug=project["slug"] or _slugify_project(p["title"], pid),
            repo_url=p["repo_url"],
            site_url=p["site_url"],
            owner_member_id=project["owner_member_id"] or member["id"],
        )
        return jsonify({"id": pid})

    # ---- BAI 인력사무소 ----
    @app.route("/api/talent-office")
    def api_talent_requests():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        return jsonify({"requests": db.list_talent_requests(member["id"], operator=is_operator(member))})

    @app.route("/api/talent-office", methods=["POST"])
    def api_talent_request_create():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        payload = _talent_request_payload()
        if not all(payload.values()):
            return jsonify({"error": "title, problem, expected_outcome, and system_scope_reason are required"}), 400
        rid = db.add_talent_request(member["id"], **payload)
        db.add_audit_log(member["id"], "talent_request_create", detail="request_id=%s" % rid)
        return jsonify({"id": rid}), 201

    @app.route("/api/talent-office/<int:rid>")
    def api_talent_request_detail(rid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        item = db.get_talent_request(rid)
        if not item:
            return jsonify({"error": "not found"}), 404
        assignees = db.list_talent_assignees(rid)
        allowed = is_operator(member) or item["requester_member_id"] == member["id"] or any(a["member_id"] == member["id"] for a in assignees)
        if not allowed:
            return jsonify({"error": "forbidden"}), 403
        return jsonify({"request": item, "assignees": assignees})

    @app.route("/api/talent-office/<int:rid>/review", methods=["POST"])
    def api_talent_request_review(rid):
        member, denied = require_operator()
        if denied:
            return denied
        if not db.get_talent_request(rid):
            return jsonify({"error": "not found"}), 404
        data = request.get_json(silent=True) or {}
        try:
            db.review_talent_request(rid, (data.get("status") or "").strip(),
                                     (data.get("review_note") or "").strip(),
                                     (data.get("approval_reason") or "").strip())
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        db.add_audit_log(member["id"], "talent_request_review", detail="request_id=%s" % rid)
        return jsonify({"ok": True})

    @app.route("/api/talent-office/<int:rid>/assignees", methods=["POST"])
    def api_talent_request_assign(rid):
        member, denied = require_operator()
        if denied:
            return denied
        try:
            db.assign_talent_request(rid, _talent_assignees_payload())
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        db.add_audit_log(member["id"], "talent_request_assign", detail="request_id=%s" % rid)
        return jsonify({"ok": True})

    @app.route("/api/talent-office/<int:rid>/solution", methods=["POST"])
    def api_talent_request_solution(rid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        data = request.get_json(silent=True) or {}
        summary = (data.get("solution_summary") or "").strip()
        solution_url = (data.get("solution_url") or "").strip()
        if not (summary or solution_url):
            return jsonify({"error": "solution summary or URL is required"}), 400
        if not is_operator(member):
            try:
                db.submit_talent_solution(rid, member["id"], summary, solution_url)
            except ValueError as e:
                return jsonify({"error": str(e)}), 400
        else:
            item = db.get_talent_request(rid)
            if not item:
                return jsonify({"error": "not found"}), 404
            assignees = db.list_talent_assignees(rid)
            if not assignees:
                return jsonify({"error": "at least one assignee is required"}), 400
            db.submit_talent_solution(rid, assignees[0]["member_id"], summary, solution_url)
        db.add_audit_log(member["id"], "talent_request_solution", detail="request_id=%s" % rid)
        return jsonify({"ok": True})

    @app.route("/api/talent-office/<int:rid>/decision", methods=["POST"])
    def api_talent_request_decision(rid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        item = db.get_talent_request(rid)
        if not item:
            return jsonify({"error": "not found"}), 404
        if member["id"] != item["requester_member_id"] and member["role"] != "pi":
            return jsonify({"error": "requester only"}), 403
        data = request.get_json(silent=True) or {}
        decision = (data.get("decision") or "").strip()
        try:
            if decision == "completed":
                awards = db.complete_talent_request(rid, item["requester_member_id"])
                db.add_audit_log(member["id"], "talent_request_complete", detail="request_id=%s" % rid)
                return jsonify({"ok": True, "awards": awards})
            if decision == "changes_requested":
                db.request_talent_changes(rid, item["requester_member_id"], (data.get("review_note") or "").strip())
                db.add_audit_log(member["id"], "talent_request_changes_requested", detail="request_id=%s" % rid)
                return jsonify({"ok": True})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"error": "invalid decision"}), 400

    @app.route("/api/talent-office/points")
    def api_talent_points():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        rows = db.list_contribution_points(member["id"])
        return jsonify({"points": rows, "total": sum(row["points"] for row in rows)})

    # ---- 개발자/관리자 콘솔 ----
    @app.route("/api/members/api-key")
    @app.route("/api/account/api-key")
    @app.route("/api/developer/key")
    def api_developer_key():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        return jsonify({
            "member_id": member["id"],
            "name": member["name"],
            "role": member["role"],
            "api_key": member["api_key"],
            "usage": {
                "endpoint": "/api/post",
                "header": "X-API-Key",
                "method": "POST",
            },
        })

    @app.route("/api/members/api-key/regenerate", methods=["POST"])
    @app.route("/api/account/api-key/regenerate", methods=["POST"])
    @app.route("/api/developer/key/regenerate", methods=["POST"])
    def api_developer_key_regenerate():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        api_key = auth.make_api_key()
        db.update_member_api_key(member["id"], api_key)
        db.add_audit_log(member["id"], "regenerate_own_api_key", target_member_id=member["id"])
        return jsonify({"api_key": api_key})

    @app.route("/api/admin/members")
    def api_admin_members():
        member, denied = require_pi()
        if denied:
            return denied
        rows = db.list_members_admin()
        for row in rows:
            row.pop("api_key", None)
        return jsonify({"members": rows})

    @app.route("/api/admin/members/<int:mid>/api-key/regenerate", methods=["POST"])
    def api_admin_member_key_regenerate(mid):
        member, denied = require_pi()
        if denied:
            return denied
        target = db.get_member_by_id(mid, include_disabled=True)
        if not target:
            return jsonify({"error": "not found"}), 404
        api_key = auth.make_api_key()
        db.update_member_api_key(mid, api_key)
        db.add_audit_log(member["id"], "admin_regenerate_api_key", target_member_id=mid)
        return jsonify({"member_id": mid, "api_key": api_key})

    @app.route("/api/admin/members/<int:mid>", methods=["POST"])
    def api_admin_member_update(mid):
        member, denied = require_pi()
        if denied:
            return denied
        target = db.get_member_by_id(mid, include_disabled=True)
        if not target:
            return jsonify({"error": "not found"}), 404
        data = request.get_json(silent=True) or {}
        role = data.get("role")
        status = data.get("status")
        allowed_roles = {"student", "admin_student", "developer", "operator", "pi"}
        allowed_status = {"active", "disabled"}
        if role is not None and role not in allowed_roles:
            return jsonify({"error": "invalid role"}), 400
        if status is not None and status not in allowed_status:
            return jsonify({"error": "invalid status"}), 400
        if mid == member["id"] and role is not None and role != "pi":
            return jsonify({"error": "cannot demote yourself"}), 400
        db.update_member_account(mid, role=role, status=status)
        db.add_audit_log(member["id"], "admin_update_member", target_member_id=mid,
                         detail="role=%s status=%s" % (role or "", status or ""))
        return jsonify({"ok": True})

    # ---- R5: 이번 주 보고 현황 ----
    @app.route("/api/weekly")
    def api_weekly():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        members = db.weekly_report_status(week_start_utc())
        reported = [m for m in members if m["reported"]]
        missing = [m for m in members if not m["reported"]]
        return jsonify({
            "total": len(members),
            "reported_count": len(reported),
            "missing": missing,
            "reported": reported,
        })

    @app.route("/api/wall", methods=["GET"])
    def api_wall_list():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        limit = request.args.get("limit", 12, type=int)
        return jsonify({"messages": db.list_wall_messages(limit)})

    @app.route("/api/wall", methods=["POST"])
    def api_wall_create():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        data = request.get_json(silent=True) or {}
        body = re.sub(r"\s+", " ", (data.get("body") or "")).strip()
        if not body:
            return jsonify({"error": "message required"}), 400
        if len(body) > 80:
            return jsonify({"error": "message too long"}), 400
        mid = db.add_wall_message(member["id"], body)
        return jsonify({"id": mid})

    # ---- 자료실/게시판: 온보딩 + 길드 자료 ----
    @app.route("/api/materials", methods=["GET"])
    def api_materials():
        if not current_member():
            return jsonify({"error": "login required"}), 401
        category = (request.args.get("category") or "").strip() or None
        guild = (request.args.get("guild") or "").strip() or None
        return jsonify({"materials": db.list_materials(category=category, guild=guild)})

    @app.route("/api/materials", methods=["POST"])
    def api_material_create():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        p = _material_payload()
        if not p["title"] or not (p["body"] or p["url"]):
            return jsonify({"error": "title and body or url required"}), 400
        mid = db.add_material(
            author_id=member["id"],
            title=p["title"],
            body=p["body"],
            url=p["url"],
            category=p["category"],
            guild=p["guild"],
        )
        return jsonify({"id": mid})

    @app.route("/api/materials/<int:mid>", methods=["POST"])
    def api_material_update(mid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        material = db.get_material(mid)
        if not material:
            return jsonify({"error": "not found"}), 404
        if member["role"] != "pi" and material["author_id"] != member["id"]:
            return jsonify({"error": "forbidden"}), 403
        p = _material_payload()
        if not p["title"] or not (p["body"] or p["url"]):
            return jsonify({"error": "title and body or url required"}), 400
        db.update_material(mid, title=p["title"], body=p["body"], url=p["url"],
                           category=p["category"], guild=p["guild"])
        return jsonify({"id": mid})

    @app.route("/api/materials/<int:mid>", methods=["DELETE"])
    def api_material_delete(mid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        material = db.get_material(mid)
        if not material:
            return jsonify({"error": "not found"}), 404
        if member["role"] != "pi" and material["author_id"] != member["id"]:
            return jsonify({"error": "forbidden"}), 403
        db.delete_material(mid)
        return jsonify({"ok": True})

    # ---- 웹 작성/수정/댓글/반응 (세션 로그인 필요) ----
    @app.route("/api/web/post", methods=["POST"])
    def api_web_post():
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        did, learned, blocked, tags, links, project_id = _post_payload()
        if not (did or learned or blocked):
            return jsonify({"error": "empty post"}), 400
        if project_id is not None and not db.get_project(project_id):
            return jsonify({"error": "invalid project_id"}), 400
        pid = db.add_post(author_id=member["id"], did=did, learned=learned,
                          blocked=blocked, tags=tags, source="web", links=links,
                          project_id=project_id)
        return jsonify({"id": pid, "url": "/post/%d" % pid})

    @app.route("/api/post/<int:pid>/edit", methods=["POST"])
    def api_edit_post(pid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        post = db.get_post(pid)
        if not post:
            return jsonify({"error": "not found"}), 404
        if post["author_id"] != member["id"]:
            return jsonify({"error": "forbidden"}), 403
        did, learned, blocked, tags, links, project_id = _post_payload()
        if not (did or learned or blocked):
            return jsonify({"error": "empty post"}), 400
        if project_id is not None and not db.get_project(project_id):
            return jsonify({"error": "invalid project_id"}), 400
        db.update_post(pid, did=did, learned=learned, blocked=blocked, tags=tags,
                       links=links, project_id=project_id)
        return jsonify({"id": pid})

    @app.route("/api/post/<int:pid>/comment", methods=["POST"])
    def api_comment(pid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        if not db.get_post(pid):
            return jsonify({"error": "not found"}), 404
        body = ((request.get_json(silent=True) or {}).get("body") or "").strip()
        if not body:
            return jsonify({"error": "empty comment"}), 400
        cid = db.add_comment(post_id=pid, author_id=member["id"], body=body)
        return jsonify({"id": cid})

    @app.route("/api/post/<int:pid>/react", methods=["POST"])
    def api_react(pid):
        member = current_member()
        if not member:
            return jsonify({"error": "login required"}), 401
        if not db.get_post(pid):
            return jsonify({"error": "not found"}), 404
        db.toggle_reaction(pid, member["id"], "thumbsup")
        return jsonify({"reaction_count": db.count_reactions(pid)})

    # ---- 페이지(HTML) 서빙 ----
    @app.route("/")
    def page_index():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/login")
    def page_login():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    # SPA: 피드 경로 모두 단일 셸(krds.html) — KRDS 리디자인, JS 라우터가 뷰 교체
    @app.route("/post/<int:pid>")
    def page_post(pid):
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/member/<int:mid>")
    def page_member(mid):
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/tag/<tag>")
    def page_tag(tag):
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/search")
    def page_search():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/questions")
    def page_questions():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/ask")
    def page_ask():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/members")
    def page_members():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/account")
    def page_account():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/goodbai")
    @app.route("/developer")
    def page_developer():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/admin/members")
    def page_admin_members():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/materials")
    def page_materials():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/projects")
    def page_projects():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/projects/<int:pid>")
    def page_project_detail(pid):
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/static/<path:fname>")
    def static_files(fname):
        return send_from_directory(FRONTEND_DIR, fname)

    @app.route("/index.html")
    @app.route("/feed.html")
    def page_legacy_index():
        return send_from_directory(FRONTEND_DIR, "krds.html")

    @app.route("/<path:path>")
    def page_spa_fallback(path):
        if path.startswith("api/"):
            return jsonify({"error": "not found"}), 404
        return send_from_directory(FRONTEND_DIR, "krds.html")

    return app


if __name__ == "__main__":
    port = int(os.environ.get("LAB_FEED_PORT", "5066"))
    create_app().run(host="0.0.0.0", port=port)
