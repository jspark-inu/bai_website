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

- Approved KRDS CSS: `apps/web/public/static/krds.css`
- Approved KRDS behavior and page rendering: `apps/web/public/static/krds.js`
- KRDS DOM shell and route wrapper: `apps/web/src/components/LegacyShell.tsx`
- Next route entry points: `apps/web/src/app/`

`frontend/krds.css` and `frontend/krds.js` are the approved design sources. The live copies in
`apps/web/public/static/` must remain byte-identical. Do not open a frontend-only pull request:
the Next shell must also point at the KRDS assets for the change to appear on `bai.haiinu.com`.
`frontend/app.css` and `frontend/feed.js` remain legacy Paper & Ink references.

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

## 등록 학생·운영진 PR → 자동 반영

학생과 운영진의 코드 변경은 PR로만 받는다. `.github/trusted-students.json`에 등록된
학생 또는 trusted operator가 PR을 열면 `.github/workflows/operator-automerge.yml`이
squash auto-merge를 켠다. 공개 저장소의 일반 `read` 사용자는 자동 병합 대상이 아니다.
새 학생 계정 등록은 `.github/trusted-students.json`을 변경하며, 이 등록 자체는 PI의
CODEOWNER 승인을 받아야 한다.
GitHub의 필수 검증이 모두 통과한 뒤 `main`에 병합되고, Mac mini 배포기가 30초 이내에
**격리된 deploy worktree**에서 빌드·배포한다. 개발자가 쓰는 원래 checkout이
더러워도 배포가 멈추지 않는다.

일반 UI·기능 PR에는 별도 승인자가 필요 없다. PI 승인 경로는 `.github/CODEOWNERS`로
좁힌다. GitHub·CI·배포 스크립트, 백엔드, 서버 API·lib, 의존성, 전체 사이트 진입점
변경만 `@jspark-inu`의 추가 승인이 필요하다. 이 경로의 PR도 auto-merge는 예약되지만
CODEOWNER 승인과 필수 CI가 모두 끝날 때까지 병합되지 않는다.

GitHub 저장소에서 한 번 설정할 항목:

1. Settings → General → Pull Requests: **Allow auto-merge** 켜기
2. Settings → Rules → `main` ruleset: PR 필수, 일반 PR 승인 요구 없음,
   `test / pytest`와 `test / react` 상태 검사 필수, force push 금지
3. 같은 ruleset에서 **Require review from Code Owners** 켜기

화면 변경 PR은 반드시 `apps/web/**`를 포함해야 한다. `frontend/**`만 바꾸면
CI가 막는다. 운영진의 시스템 개선 요청 자체는 Git PR이 아니라 인력사무소에서
접수·검토한다.

For a minimal student workflow in Korean, see `STUDENT-GIT-GUIDE.md`.
For a standalone handoff file to send directly to Park Kyung, see `PARK_STUDENT_HANDOFF.md`.

Do not commit `.env`, DB files, backups, virtualenvs, API keys, or generated cache files.
