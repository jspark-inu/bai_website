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

For design changes, start with:

- Page routes: `apps/web/src/app/`
- Shared components: `apps/web/src/components/`
- Global styles: `apps/web/src/styles/globals.css`
- Static legacy assets: `apps/web/public/static/`

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
2. Change app code in `apps/web/` for the React UI, or `backend/`, `frontend/`, `scripts/` for legacy/API work.
3. Run tests.
4. Push the branch and open a pull request.

For a minimal student workflow in Korean, see `STUDENT-GIT-GUIDE.md`.
For a standalone handoff file to send directly to Park Kyung, see `PARK_STUDENT_HANDOFF.md`.

Do not commit `.env`, DB files, backups, virtualenvs, API keys, or generated cache files.
