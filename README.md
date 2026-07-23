# BAI Site

BAI 진행 공유 웹앱입니다.

## Next 단일 앱

`apps/web`이 화면, API, 인증, 세션, SQLite, migration, uploads를 모두 소유합니다. 2026-07-23
`caa8fc0`를 운영에 반영했고 Flask service를 영구 비활성화해 Next.js 단일 런타임으로 전환했습니다.

로컬 개발은 운영 DB가 아닌 별도 절대경로의 scratch DB와 uploads를 사용합니다.

```bash
cd apps/web
npm ci
export LAB_FEED_DB=/absolute/path/to/scratch/lab-feed.db
export BAI_UPLOAD_DIR=/absolute/path/to/scratch/uploads
export LAB_FEED_SECRET=local-development-secret-at-least-32-chars
export LAB_FEED_COOKIE_SECURE=0
npm run migrate
npm run dev
```

Open: http://127.0.0.1:5067

For design changes, start with the files the live site actually serves:

- Approved KRDS CSS: `apps/web/public/static/krds.css`
- Approved KRDS behavior and page rendering: `apps/web/public/static/krds.js`
- KRDS DOM shell and route wrapper: `apps/web/src/components/LegacyShell.tsx`
- Next route entry points: `apps/web/src/app/`

`frontend/krds.css` and `frontend/krds.js` remain approved design and rollback references. The
served copies in `apps/web/public/static/` must remain byte-identical. `frontend/` is not
synchronized or executed by the Next-only deploy path.

Run checks before a pull request:

```bash
cd apps/web
npm run typecheck
npm test
npm run build
```

## 멤버 비밀번호 초기화

PI는 사이트의 `멤버 관리`에서 학생 계정의 비밀번호를 `1234`로 초기화할 수 있습니다.
초기화하면 해당 학생의 기존 비밀번호와 로그인 상태가 즉시 무효화되고 감사 기록이 남습니다.
PI 계정은 이 기능의 초기화 대상에서 제외됩니다.

## Legacy 보존 경계

`backend/`와 `frontend/`는 Flask 계약 oracle, 승인 디자인 원본, rollback source로 보존합니다.
두 디렉터리는 운영 요청 처리와 배포 동기화 대상이 아닙니다. Next-only 실사용 수용이 기록된
뒤에도 별도 사용자 승인이 있어야만 archive 또는 삭제합니다.

## Work flow

1. Create a branch.
2. Change production UI/API code in `apps/web/`.
3. Run tests.
4. Push the branch and open a pull request.

After a pull request is merged into `main`, the Mac mini launchd job
`com.user.bai-website-autodeploy` pulls the repo, verifies and backs up the database with Node,
syncs only `apps/web`, runs migrations, and restarts only `com.user.bai-next`.

운영 Mac mini에는 병합 전에 다음 파일을 한 번 준비해야 합니다.

```bash
mkdir -p /Users/hai_1/AI-Workspace/code/runtime/config
cp .env.example /Users/hai_1/AI-Workspace/code/runtime/config/bai-website.env
chmod 600 /Users/hai_1/AI-Workspace/code/runtime/config/bai-website.env
```

복사한 파일의 placeholder secret과 모든 절대경로를 실제 운영값으로 바꿉니다.
배포기는 기본적으로 이 파일을 읽고, 파일이 없더라도 같은 필수 값이 실행 환경에 명시되지
않으면 라이브 디렉터리를 수정하기 전에 중단됩니다. Next를 재시작하기 직전에 DB·secret·
업로드 값을 launchd 환경으로 설정하고, 재시작 후 fingerprint도 비교합니다.

## 데이터 보존 원칙

- 배포는 라이브 DB가 없거나 SQLite 무결성 검사를 통과하지 못하면 중단됩니다.
- 첫 라이브 파일 동기화 직전에 SQLite online backup을 만들고 백업본까지 검증합니다.
- DB 본체, journal/WAL/SHM 파일과 uploads는 `rsync --delete` 대상에서 제외합니다.
- 업로드 경로가 웹 또는 백엔드 코드 디렉터리 안에 있어도 동적 제외 규칙으로 보존합니다.
- 운영 DB와 업로드 경로는 배포 코드 디렉터리 밖의 영속 경로를 권장합니다.
- 빈 운영 DB를 자동 생성하지 않습니다. 초기 설치 예외 토큰은 기존 데이터가 전혀 없는
  새 설치에서만 사용하며, 기존 업로드나 다른 SQLite 파일이 있으면 배포가 거부됩니다.
- 배포 직전 기존 코드를 `BAI_ROLLBACK_DIR`에 보관합니다. 새 빌드·서비스 재시작·DB/API
  health check가 실패하면 DB를 되돌리지 않고 이전 코드만 자동 복구합니다. 실패한 main
  커밋은 새 커밋이 올라오기 전까지 자동 재시도하지 않습니다.
- 운영 Next는 32자 이상의 `LAB_FEED_SECRET`과 secure session cookie를 요구합니다.
- `/api/runtime-health`가 DB 무결성, migration ledger, uploads 접근성, 실제 경로 fingerprint를
  한 프로세스에서 확인합니다.

배포 전에는 다음을 모두 통과시킵니다.

```bash
cd apps/web
npm run typecheck
npm test
npm run parity
npm run design:park
npm run harness:talent-office
npm run build
```

## Task 9 cutover와 rollback

Task 9 cutover는 2026-07-23 PI 승인 아래 수행했습니다.

1. DB online backup, uploads fingerprint, 코드·plist snapshot을 보존했다.
2. `caa8fc0` Next-only artifact, migration `004`·`005`, runtime health를 확인했다.
3. `com.user.baifeed-backup`을 Node `npm run backup`으로 재배선해 검증 실행 exit 0을 확인했다.
4. `com.user.baifeed`를 unload하고 `launchctl disable`로 영구 비활성화했으며 port 5066 listener가 없는 상태를 확인했다.
5. 공개 URL에서 login/session, 주요 CRUD, Goodbai, uploads, runtime health 47-check와 데이터 정리를 검증했다.
6. 기존 pre-cutover API key로 `/api/post` 호환성을 재검증하고 생성 행을 정리했다.
7. runtime env, 운영 DB, LaunchAgent plist, 백업 디렉터리와 백업 파일을 소유자 전용 권한으로 제한했다.

Rollback plist·uploads bundle은
`/Users/hai_1/AI-Workspace/code/runtime/rollbacks/bai_website/task9-20260723-0055`,
최종 DB backup은
`/Users/hai_1/AI-Workspace/code/runtime/backups/bai_website/lab-feed-task9-final-20260723-0055.db`에 있다.
Rollback은 보존한 Flask plist의 실제 경로를 사용해
`launchctl enable gui/$(id -u)/com.user.baifeed`를 먼저 실행한 뒤
`launchctl bootstrap gui/$(id -u) <plist-path>`와
`launchctl kickstart -k gui/$(id -u)/com.user.baifeed`를 수행하고, 직전 코드 snapshot을
복원한 뒤 DB와 uploads fingerprint를 다시 비교합니다. Flask/Python source와 plist는 PI의
실사용 수용 기록과 별도 archival 승인이 생길 때까지 삭제하지 않습니다.

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
