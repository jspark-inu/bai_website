import os
import re
from datetime import datetime, timezone, timedelta
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


def create_app(db_path=None, secret=None):
    app = Flask(__name__, static_folder=None)
    app.secret_key = secret or os.environ.get("LAB_FEED_SECRET", "dev-insecure-secret")
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )
    db = LabFeedDB(db_path or DEFAULT_DB)
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
        return "%s:%s" % (request.remote_addr or "local", name.strip().lower())

    def _enrich(post):
        if "reaction_count" not in post:
            post["reaction_count"] = db.count_reactions(post["id"])
        if "comment_count" not in post:
            post["comment_count"] = len(db.list_comments(post["id"]))
        return post


    @app.route("/healthz")
    def healthz():
        return jsonify({"ok": True, "service": "bai-site"})

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
        if login_failures.get(key, 0) >= 5:
            return jsonify({"error": "too many login failures"}), 429
        member = auth.authenticate_web(db, name, data.get("password", ""))
        if not member:
            login_failures[key] = login_failures.get(key, 0) + 1
            return jsonify({"error": "invalid credentials"}), 401
        login_failures.pop(key, None)
        session["member_id"] = member["id"]
        return jsonify({"id": member["id"], "name": member["name"], "role": member["role"]})

    @app.route("/api/logout", methods=["POST"])
    def api_logout():
        session.clear()
        return jsonify({"ok": True})

    @app.route("/api/me")
    def api_me():
        m = current_member()
        if not m:
            return jsonify({"error": "not logged in"}), 401
        return jsonify({"id": m["id"], "name": m["name"], "role": m["role"]})

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

    # ---- R3: 미해결 질문 ----
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
        pid = db.add_project(
            title=p["title"],
            type=p["type"],
            goal=p["summary"],
            summary=p["summary"],
            repo_url=p["repo_url"],
            site_url=p["site_url"],
            owner_member_id=member["id"],
        )
        slug = _slugify_project(p["slug"] or p["title"], pid)
        db.update_project(
            pid,
            title=p["title"],
            type=p["type"],
            status="active",
            goal=p["summary"],
            current_stage="",
            deadline="",
            next_milestone="",
            risk_level="normal",
            pi_decision="",
            summary=p["summary"],
            slug=slug,
            repo_url=p["repo_url"],
            site_url=p["site_url"],
            owner_member_id=member["id"],
        )
        try:
            member_roles = _member_roles_from_payload(p["members"], member["id"])
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        db.set_project_members(pid, member_roles)
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
        db.update_project(
            pid,
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
        db.set_project_members(pid, member_roles)
        return jsonify({"id": pid})

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
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/login")
    def page_login():
        return send_from_directory(FRONTEND_DIR, "login.html")

    # SPA: 피드 경로 모두 단일 셸(feed.html) — 사이드바 고정, JS 라우터가 뷰 교체
    @app.route("/post/<int:pid>")
    def page_post(pid):
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/member/<int:mid>")
    def page_member(mid):
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/tag/<tag>")
    def page_tag(tag):
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/search")
    def page_search():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/questions")
    def page_questions():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/ask")
    def page_ask():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/members")
    def page_members():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/account")
    def page_account():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/materials")
    def page_materials():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/projects")
    def page_projects():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/projects/<int:pid>")
    def page_project_detail(pid):
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/static/<path:fname>")
    def static_files(fname):
        return send_from_directory(FRONTEND_DIR, fname)

    @app.route("/index.html")
    @app.route("/feed.html")
    def page_legacy_index():
        return send_from_directory(FRONTEND_DIR, "feed.html")

    @app.route("/<path:path>")
    def page_spa_fallback(path):
        if path.startswith("api/"):
            return jsonify({"error": "not found"}), 404
        return send_from_directory(FRONTEND_DIR, "feed.html")

    return app


if __name__ == "__main__":
    port = int(os.environ.get("LAB_FEED_PORT", "5066"))
    create_app().run(host="0.0.0.0", port=port)
