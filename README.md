# BAI Site

BAI 진행 공유 웹앱입니다.

## React/Next app

The live `https://bai.haiinu.com` UI is the React/Next app in `apps/web`.

```bash
cd apps/web
npm install
npm run dev
```

Open: http://127.0.0.1:5067

For design changes, start with the files the live site actually serves:

- Exact CSS: `apps/web/public/static/app.css`
- Feed behavior and page rendering: `apps/web/public/static/feed.js`
- Login shell and route wrapper: `apps/web/src/components/LegacyShell.tsx`
- Next route entry points: `apps/web/src/app/`

`frontend/` is kept as the legacy reference. Do not open a frontend-only pull request for a design change; it will not affect `bai.haiinu.com`. If you touch `frontend/app.css`, keep the same CSS in `apps/web/public/static/app.css`.

Run checks before a pull request:

```bash
cd apps/web
npm run typecheck
npm test
npm run build
```

## Legacy Flask app

```bash
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt
LAB_FEED_SECRET=dev LAB_FEED_DB=lab-feed.dev.db venv/bin/python app.py
```

Open: http://127.0.0.1:5066

## Test

```bash
cd backend
venv/bin/python -m pytest -q
```

## Work flow

1. Create a branch.
2. Change live UI code in `apps/web/`, or `backend/` for API work.
3. Run tests.
4. Push the branch and open a pull request.

After a pull request is merged into `main`, the Mac mini launchd job `com.user.bai-website-autodeploy` pulls the repo, runs the React checks/build, syncs `apps/web` to the live service, and restarts `com.user.bai-next`.

For a minimal student workflow in Korean, see `STUDENT-GIT-GUIDE.md`.
For a standalone handoff file to send directly to Park Kyung, see `PARK_STUDENT_HANDOFF.md`.

Do not commit `.env`, DB files, backups, virtualenvs, API keys, or generated cache files.
