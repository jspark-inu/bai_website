# BAI Site

BAI 진행 공유 웹앱입니다.

## Local setup

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
2. Change app code in `backend/`, `frontend/`, or `scripts/`.
3. Run tests.
4. Push the branch and open a pull request.

For a minimal student workflow in Korean, see `STUDENT-GIT-GUIDE.md`.

Do not commit `.env`, DB files, backups, virtualenvs, API keys, or generated cache files.
