# BAI Site

BAI 진행 공유 웹앱입니다.

## React/Next app

The live `https://bai.haiinu.com` UI is the React/Next app in `apps/web`.

```bash
cd apps/web
npm install
LAB_FEED_DB="$(cd ../../backend && pwd)/lab-feed.dev.db" \
BAI_API_ORIGIN=http://127.0.0.1:5066 npm run dev
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
LAB_FEED_SECRET=dev \
LAB_FEED_ALLOW_INSECURE_SECRET=1 \
LAB_FEED_COOKIE_SECURE=0 \
LAB_FEED_ALLOW_INSECURE_COOKIE=1 \
LAB_FEED_DB="$PWD/lab-feed.dev.db" \
LAB_FEED_ALLOW_BOOTSTRAP=1 \
venv/bin/python app.py
```

`LAB_FEED_ALLOW_BOOTSTRAP=1`은 비어 있는 개발 DB를 처음 만들 때만 사용합니다.
DB가 만들어진 다음 실행부터는 이 값을 빼세요. 운영 환경의 `LAB_FEED_DB`는 반드시
이미 존재하는 DB의 절대경로여야 하며, Flask와 Next가 같은 값을 사용해야 합니다.
로컬 HTTP 개발에서는 위 예시처럼 insecure-cookie 예외를 명시해야 합니다. 운영에서는
`LAB_FEED_SECRET`에 32자 이상의 무작위 값을 사용하고 `LAB_FEED_COOKIE_SECURE=1`을
유지하세요. 공개 기본값이나 예시 placeholder로는 백엔드가 시작되지 않습니다.

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

운영 Mac mini에는 병합 전에 다음 파일을 한 번 준비해야 합니다.

```bash
mkdir -p /Users/hai_1/AI-Workspace/code/runtime/config
cp .env.example /Users/hai_1/AI-Workspace/code/runtime/config/bai-website.env
chmod 600 /Users/hai_1/AI-Workspace/code/runtime/config/bai-website.env
```

복사한 파일의 placeholder secret과 모든 절대경로를 실제 운영값으로 바꿉니다. secret은
`python3 -c 'import secrets; print(secrets.token_hex(32))'`처럼 생성할 수 있습니다.
배포기는 기본적으로 이 파일을 읽고, 파일이 없더라도 같은 필수 값이 실행 환경에 명시되지
않으면 라이브 디렉터리를 수정하기 전에 중단됩니다. Next와 Flask를 재시작하기 직전에
동일한 DB·secret·업로드 값을 launchd 환경으로 설정하고, 재시작 후 fingerprint도 비교합니다.

## 데이터 보존 원칙

- 배포는 라이브 DB가 없거나 SQLite 무결성 검사를 통과하지 못하면 중단됩니다.
- 첫 라이브 파일 동기화 직전에 SQLite online backup을 만들고 백업본까지 검증합니다.
- `backend/uploads/`, DB 본체, journal/WAL/SHM 파일은 `rsync --delete` 대상에서 제외합니다.
- 업로드 경로가 웹 또는 백엔드 코드 디렉터리 안에 있어도 동적 제외 규칙으로 보존합니다.
- 운영 DB와 업로드 경로는 배포 코드 디렉터리 밖의 영속 경로를 권장합니다.
- 빈 운영 DB를 자동 생성하지 않습니다. 초기 설치 예외 토큰은 기존 데이터가 전혀 없는
  새 설치에서만 사용하며, 기존 업로드나 다른 SQLite 파일이 있으면 배포가 거부됩니다.
- 배포 직전 기존 코드를 `BAI_ROLLBACK_DIR`에 보관합니다. 새 빌드·서비스 재시작·DB/API
  health check가 실패하면 DB를 되돌리지 않고 이전 코드만 자동 복구합니다. 실패한 main
  커밋은 새 커밋이 올라오기 전까지 자동 재시도하지 않습니다.
- 운영 Flask는 32자 이상의 `LAB_FEED_SECRET`과 secure session cookie를 요구합니다.
  배포 후 Next와 Flask가 같은 DB·업로드 경로를 보는지도 fingerprint로 확인합니다.

배포 전에는 다음을 모두 통과시킵니다.

```bash
cd apps/web
npm run typecheck
npm test
npm run parity
npm run design:park
npm run harness:talent-office
npm run build

cd ../../backend
python -m pytest -q
```

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
