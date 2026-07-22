---
title: BAI Next 단일 런타임 전환 handoff
status: observing
updated_at: 2026-07-23T01:40:02+09:00
project: bai_website
workspace: /Users/hai_1/AI-Workspace/code/projects/dev/bai_website
branch: main
baseline_head: 3266d80
implementation_commit: 4728452
current_head: caa8fc0
source_state: local docs-only closeout commit ahead of deployed head; not pushed
current_phase: Task 9 Next-only cutover 기술 완료 / 운영 수용 관찰
canonical: true
---

# BAI Next 단일 런타임 전환 handoff

> 이 문서는 Task 9 Next-only 운영 cutover의 기술 검증 결과와 남은 실사용 수용·Flask source archival 경계를 잇는 canonical handoff다. 작업 전 반드시 live repository 상태를 다시 확인하며, 이 문서의 수치와 경로를 현재 상태보다 우선하지 않는다.

## 1. 최종 목표

Flask/Python과 Next가 함께 요청을 처리하는 현재 구조를 Next.js 단일 런타임으로 전환한다.

완료 상태는 다음을 모두 의미한다.

- UI, API, 인증, 세션, SQLite 접근, migration, uploads를 Next가 소유한다.
- 기존 공개 API URL과 Goodbai API-key 계약을 보존한다.
- 운영 요청 처리와 배포에 Flask/Python 프로세스가 필요하지 않다.
- 실제 운영 데이터 보존과 rollback 가능성이 검증된다.

정본 설계 문서:

- `docs/next-only-migration/rule.md`
- `docs/next-only-migration/architecture.md`
- `docs/next-only-migration/roadmap.md`

## 2. 현재 live handoff 기준선

2026-07-23 01:40 KST 기준:

- Branch: `main`
- Task 6–7 시작 Baseline HEAD: `3266d80`
- Task 6–7 implementation commit: `4728452`
- Task 8 implementation commit: `764a118`
- Task 9 deployed HEAD: `caa8fc09d8fce9edb20e93b2371c7256d5254de5`
- Local source: Task 9 closeout 문서 commit이 deployed HEAD보다 1개 앞서며, 관찰 후 재배포를 피하려고 push하지 않음
- Working tree: local closeout commit 후 clean
- Task 1–8: 완료
- Task 9: Next-only cutover, 47-check live smoke, 기존 API-key smoke, 30분 61/61 기술 관찰 완료; 실사용 수용 추적 중
- Live runtime: `com.user.bai-next` + Node backup job, `com.user.baifeed` unloaded·persistently disabled, port 5066 closed

### Working tree 보호 규칙

Task 6–7 구현은 `4728452`, Task 8은 `764a118`, Task 9 live release는 `caa8fc0`에 있다. Local `main`에는 push하지 않은 docs-only closeout commit 1개가 추가된다. 다음 세션은 local HEAD와 `origin/main`·deploy-state의 이 의도된 차이를 먼저 확인하고, 이 문서에 없는 예상 밖 변경은 사용자 작업으로 간주해 보존한다.

금지:

- `git reset`, `git checkout --`, `git restore`, `git clean`
- Task 6–7 implementation commit `4728452` 임의 되돌리기
- 다른 작업을 이유로 working tree 전체를 재포맷하거나 덮어쓰기
- 사용자 승인 없는 추가 commit, push, deploy
- operational acceptance나 별도 사용자 승인 없는 Flask/Python source·plist 삭제

시작 시 실행:

```bash
cd /Users/hai_1/AI-Workspace/code/projects/dev/bai_website
git status --short
git diff --check
git rev-parse --short HEAD
git branch --show-current
```

필요하면 `session_search`로 가장 최근의 Task 6 materials/talent-office 세션을 찾되, 현재 파일과 실행 결과를 우선한다.

## 3. 완료된 Task 6 인수 상태

Task 6에서 완료된 범위:

- Materials 4개 route-method를 explicit Next handler로 이전
- Talent-office 8개 route-method를 explicit Next handler로 이전
- Materials/Talent production 경로의 domain Flask proxy, fetch, request-time DDL 제거
- Repository/service/route 경계 분리
- 권한 민감 write에서 `BEGIN IMMEDIATE` 내부 actor/role/state 재검증
- Talent completion, points, audit 원자성
- 실제 worker-thread SQLite contention 기반 중복 완료 검증
- Upload pre-publication cleanup reservation
- Material mutation과 같은 transaction에 cleanup outbox intent 기록
- Cleanup lease, backoff, FIFO progress, shared-file reference 보호
- Upload orphan/traversal/symlink disclosure 차단
- Malformed Talent path의 실제 handler 및 production Next wire parity
- Parity harness의 broad synthetic 500 제거와 exact error allowlist
- 사용되지 않던 Next-only destructive operator endpoint 제거

마지막 검증 결과:

- Frontend full suite: 25 files, 302/302
- Backend full suite: 276 passed + 2 subtests
- Materials/Talent shared contracts: 81/81
- TypeScript: PASS
- Next production build: PASS
- Talent harness: 5/5
- `git diff --check`: PASS
- Fresh specification review: PASS
- Fresh security/data-integrity review: PASS
- Critical/high/important unresolved finding: 0

이 수치는 handoff 기준선이다. 새 세션은 변경 전 필요한 focused baseline을 다시 실행해야 한다.

## 4. 단계별 완료 상태

| Task | 목적 | 운영 영향 | 권장 세션 |
|---|---|---:|---|
| 7 | Next 인증·세션 전환 | `4728452`에 완료 | 완료 |
| 8 | Flask proxy·Python runtime 제거 | `764a118`에 완료 | 완료 |
| 9 | 운영 cutover·rollback 검증 | `caa8fc0` 운영 반영, 기술 acceptance 완료 | 운영 수용 관찰 |

각 task는 fresh specification review와 fresh security/quality review가 모두 통과해야 종료한다. Reviewer의 PASS는 부모 세션이 핵심 artifact와 실행 결과를 재검증한다.

---

# Task 7 — Next 인증·세션 전환

## 5. 목표

Flask를 인증 권한자로 사용하는 임시 구조를 제거하고 Next가 로그인, 세션 발급·검증·폐기, 현재 사용자 조회를 직접 소유한다.

Acceptance:

- Flask 포트 5066 없이 로그인 → `/api/me` → 보호 API → 로그아웃 lifecycle이 동작한다.
- 기존 사용자는 비밀번호 변경 없이 로그인한다.
- Production 인증 코드의 Flask `/api/me` fetch가 0이다.
- 기존 Task 3–6 route 계약이 회귀하지 않는다.

## 6. 예상 파일

Create:

- `apps/web/src/lib/auth/password.ts`
- `apps/web/src/lib/auth/session.ts`
- `apps/web/src/lib/auth/rate-limit.ts`
- `apps/web/src/lib/auth/require-member.ts`
- `apps/web/tests/integration/login-session.test.ts`

Rewrite/modify:

- `apps/web/src/lib/auth.ts`
- `apps/web/src/app/api/auth/login/route.ts`
- `apps/web/src/app/api/auth/logout/route.ts`
- `apps/web/src/app/api/auth/me/route.ts`
- compatibility routes `/api/login`, `/api/logout`, `/api/me`
- `apps/web/tests/unit/auth.test.ts`
- 필요 시 `apps/web/src/lib/db/migrations.ts`
- 필요 시 member/session repository

파일과 symbol은 추정으로 생성하지 말고 Flask predecessor와 현재 Next routes를 먼저 추적한다.

## 7. 실행 순서

### 7.1 계약과 predecessor 조사

1. Flask login/logout/me 구현, cookie 설정, status, JSON, rate limit을 읽는다.
2. 현재 `auth.ts`, `requireApiMember`, auth route, compatibility route의 정의와 모든 usage를 추적한다.
3. 기존 DB password hash 형식과 active/disabled member semantics를 확인한다.
4. Flask의 성공·실패·malformed body·disabled user·cookie lifecycle을 shared fixture로 고정한다.

### 7.2 RED contracts

다음을 실제 handler 기반 failing test로 만든다.

- 실제 Werkzeug PBKDF2 hash 성공/실패
- malformed hash와 unsupported method
- login 성공/실패와 disabled user
- falsey/truthy/non-JSON body
- session tamper, expiry, malformed cookie
- production secret 누락 fail-closed
- logout invalidation
- compatibility route parity
- safe bigint member ID
- stale role/status 재검증
- rate-limit account/IP key, expiry, bounded storage, success reset

Broad catch나 fixture 응답 합성으로 RED/GREEN을 위조하지 않는다.

### 7.3 구현

1. Node `crypto` 기반 Werkzeug hash compatibility를 구현한다.
2. clean-slate session 설계를 구현한다.
   - HMAC 또는 검증 가능한 동등 이상 설계
   - expiry
   - tamper rejection
   - logout invalidation
   - `httpOnly`, `sameSite=lax`, production `secure`, explicit `path/maxAge`
3. 현재 active member와 role을 DB에서 검증하는 `require-member`를 구현한다.
4. deterministic/injectable clock을 사용하는 bounded rate limiter를 구현한다.
5. auth/compatibility routes를 공통 service에 연결한다.
6. 모든 `requireApiMember` 소비자가 Flask 없이 동작하게 한다.
7. request path DDL을 추가하지 않는다. Session schema가 필요하면 ledgered additive migration을 사용한다.

### 7.4 Task 7 필수 검증

- Password fixture unit tests
- Session tamper/expiry/malformed/secret tests
- Rate-limit tests
- Login-session integration test
- Auth-protected route regression
- Task 3–6 contracts
- Frontend full test
- Backend Flask oracle
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Flask 5066 없는 실제 Next server smoke:
  - login
  - `/api/me`
  - protected domain request
  - logout
  - logout 후 rejection
- Production auth path의 Flask fetch 0 static scan
- OS-generated `hermes-verify-*` focused script 직접 실행 및 삭제

### 7.5 Task 7 security review

최소 공격 항목:

- session fixation, replay, tampering
- cookie scope와 secure flags
- password timing behavior
- rate-limit bypass와 unbounded memory
- proxy/header trust
- stale role/status
- unsafe bigint
- open redirect
- migration rollback/data preservation
- test harness false positives

Task 7 종료 후 이 문서의 `current_phase`, 검증 수치, open risks를 갱신한다. 이후 commit/push/deploy는 사용자 승인 전까지 금지한다.

## 7.6 Task 7 완료 상태

2026-07-22 23:26 KST 기준 Task 7 implementation과 fresh review를 종료했다.

완료 범위:

- `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`와 호환 URL `/api/login`, `/api/logout`, `/api/me`, `/api/change-password`를 explicit Next handler로 이전
- 실제 active DB에 존재하는 Werkzeug `pbkdf2:sha256:1000000`과 `scrypt:32768:8:1` 비밀번호를 변경 없이 검증
- HMAC 서명·만료·server-side revocation을 갖는 `bai_next_session`과 additive migration `005_auth_sessions` 구현
- 현재 active status와 role을 요청마다 DB에서 다시 확인하고, unsafe SQLite bigint ID를 503으로 fail-closed
- account/trusted-IP 동시 예약, 전역 crypto-work 상한, 활성 lock 보존, 포화 시 fail-closed를 갖는 bounded login limiter 구현
- 비밀번호 변경 시 현재 hash와 active status를 write transaction 안에서 다시 검증하고 Werkzeug 호환 PBKDF2 hash로 교체
- Flask와 Next가 같은 21단계 인증 lifecycle fixture를 실행하고, Next 생성 hash를 Python/Werkzeug가 검증하는 rollback oracle 추가
- Production auth scope의 Flask proxy, `BAI_API_ORIGIN`, port 5066, `/api/me` fetch를 0건으로 제거

최종 검증:

- Frontend full suite: 31 files, 343/343
- Backend Flask oracle: 280 passed + 2 subtests
- Shared auth lifecycle: Next PASS, Flask 4/4 PASS
- Task 3–6 regression contracts: full frontend/backend suites에서 PASS
- TypeScript: PASS
- Next production build: PASS (`/api/change-password` explicit route 포함)
- Talent-office harness: 5/5
- Static parity harness: 6/6
- `git diff --check`: PASS
- Auth Flask-reference/open-redirect static scan: 0/0
- Flask 5066이 없는 실제 Next server smoke: login 200 → `/api/me` 200 → protected feed 200 → password change 200 → logout 200 → replay 401 → 새 비밀번호 login 200
- OS-generated `/tmp/hermes-verify-task7-final.*.mjs`: 직접 실행 후 삭제 확인
- Fresh specification review: PASS
- Fresh security/quality review: PASS
- Critical/high/important unresolved finding: 0

Open risks와 다음 단계 경계:

- 전체 저장소의 catch-all proxy, `legacy-api-proxy.ts`, Flask/Python runtime과 port 5066 운영 의존성 제거는 Task 8 범위다. Task 7 완료를 Next-only 운영 전환 완료로 해석하지 않는다.
- `BAI_TRUST_PROXY_HEADERS=1`은 ingress가 client-IP header를 덮어쓰는 배치에서만 켠다. 기본값은 비활성이며, 그 상태에서도 account limit과 전역 crypto-work 상한이 동작한다. Task 8–9에서 실제 ingress 계약을 확인한다.
- `005_auth_sessions`는 아직 production DB에 적용하지 않았다. 실제 migration, 기존 Flask session 폐기와 1회 재로그인, 배포·cutover는 사용자 승인 뒤 Task 9에서 수행한다.
- Task 6–7 implementation은 `4728452`로 커밋했다. Push, deploy, production DB/uploads/service/launch-agent 변경은 수행하지 않았다.

---

# Task 8 — Flask proxy와 Python runtime 제거

## 8. 진입 조건

- Task 7 implementation과 fresh reviews가 PASS
- Flask 5066 없는 auth/domain smoke가 PASS
- 현재 explicit route manifest에서 Flask가 소유한 필수 API가 0임을 증명

## 9. 목표

운영 요청 처리와 배포 경로에서 Flask/Python 의존성을 제거한다. 이 task는 저장소와 배포 구조를 정리하지만 실제 live service 중단·전환은 하지 않는다.

예상 대상:

- Delete: `apps/web/src/app/api/[...path]/route.ts`
- Delete: `apps/web/src/lib/legacy-api-proxy.ts`
- Create/modify: `apps/web/tests/unit/no-legacy-runtime.test.ts`
- Modify: `.env.example`
- Modify: `scripts/deploy-react-to-live.sh`
- Modify: `scripts/autodeploy-main.sh`
- Modify: `README.md`
- Archive confirmation 후에만 `backend/`, Python `frontend/` 삭제 후보 처리

## 10. 실행 순서

1. Flask route manifest와 explicit Next route manifest를 다시 비교한다.
2. API, health, auth, uploads, Goodbai에서 proxy fallback이 0임을 contract로 증명한다.
3. Catch-all proxy를 삭제하고 모든 tests를 RED/GREEN으로 검증한다.
4. Legacy proxy module과 관련 env/config를 제거한다.
5. 배포 script에서 backend/frontend rsync, Python environment, backend restart/rollback을 제거한다.
6. Next runtime-health가 DB, migrations, uploads를 검증하도록 유지한다.
7. Flask launch agent `com.user.baifeed`의 비활성화·복구 절차를 문서화한다.
8. `backend/`와 Python `frontend/`는 archival completeness와 rollback source 보존을 확인한 후에만 삭제한다.

## 11. Task 8 필수 검증

- No legacy route/proxy/runtime static test
- Legacy Flask route manifest 대비 explicit Next coverage 100%
- Frontend full tests, typecheck, build
- Flask process 없이 Next integration/E2E
- Goodbai API-key client regression
- Upload/runtime-health/migration smoke
- 배포 script dry-run 또는 hermetic harness
- Repository에서 production Python invocation, port 5066, Flask health dependency 검색
- Fresh specification review
- Fresh deployment/security review

금지:

- Task 8에서 live launch agent를 실제 중단하지 않는다.
- Archive 확인 전 `backend/`, `frontend/`를 삭제하지 않는다.
- Task 8 완료를 Task 9 cutover 완료로 표현하지 않는다.

## 11.1 Task 8 완료 상태

2026-07-23 00:10 KST 기준 Task 8 구현과 두 차례 fresh review를 종료했다.

완료 범위:

- Flask route manifest의 모든 method/path를 실제 `route.ts` export와 비교해 explicit Next coverage 100%를 증명
- Catch-all `/api/[...path]`, `legacy-api-proxy.ts`, `BAI_API_ORIGIN`, production port 5066 의존성 제거
- 기존 Flask `/api/healthz` 응답 계약을 보존하는 explicit Next health route 추가
- `/api/runtime-health`를 Flask fetch 없이 DB quick/foreign-key check, migration ledger, uploads 읽기·쓰기 권한, 실제 경로 fingerprint 검증으로 전환
- SQLite online backup, source/destination integrity, core schema, foreign keys, fsync, atomic publication, overwrite 방지, retention을 수행하는 Node backup CLI 추가
- 배포 경로에서 backend/frontend rsync, Python backup/runtime, Flask restart/health/rollback을 제거하고 Next만 snapshot·sync·migrate·restart하도록 변경
- live web target이 `/`, source-overlap, symlink인 경우 destructive rsync 전에 fail-closed하도록 보강
- 예시 secret `change-me-*`가 길이 검사만 통과하지 못하도록 앱과 배포기 모두 fail-closed
- Flask launch agent 비활성화·복구 및 Python backup agent 재배선 경계를 README에 문서화
- `backend/`, `frontend/`는 oracle/design/Task 9 rollback source로 그대로 보존

최종 검증:

- Frontend full suite: 33 files, 350/350
- Backend Flask oracle: 281 passed + 2 subtests
- TypeScript (`next typegen && tsc --noEmit`): PASS
- Next production build: PASS, explicit `/api/healthz` 포함, catch-all API route 없음
- Static parity harness: 6/6
- Talent-office harness: 5/5, focused contracts 55/55
- Node verified-backup tests: 4/4 (open WAL, unrelated DB, foreign-key violation, existing backup overwrite 방지)
- Next-only deploy preservation/hermetic tests: 15/15; shell syntax: PASS
- Flask 없는 격리 Next HTTP smoke: health 200, unknown API 404, login/me/feed 200, Goodbai 201, upload 200, runtime-health 200, migration ledger 5/5
- Production entry/source static scan: Flask proxy/origin/port 5066/Python invocation 0
- `git diff --check`: PASS
- Fresh specification review: PASS
- Fresh deployment/security review: PASS after placeholder-secret bypass and broad/symlink deploy target findings were fixed and reverified
- Critical/high/important unresolved finding: 0

Open risks와 Task 9 경계:

- 이 상태는 repository/deploy-path 준비 완료이지 live cutover 완료가 아니다. `005_auth_sessions`를 포함한 migration, 서비스 재시작, Flask 중단, backup agent 재배선은 수행하지 않았다.
- `npm run design:park`는 Task 8 변경 전부터 남아 있던 승인 CSS 배경값·asset-version 기대치 drift로 7/9였다. Task 8 acceptance 범위와 변경 파일에서 유입된 회귀는 아니며, Task 9 UI/browser preflight 전에 별도 정합화가 필요하다.
- CI의 Python backend suite와 `backend/`, `frontend/`는 production runtime이 아니라 rollback/contract oracle로 의도적으로 남아 있다. 운영 관찰과 archive completeness 확인 뒤에만 별도 승인으로 archive 또는 삭제한다.
- 사용자 승인 없는 commit, push, deploy, production DB/uploads/service/launch-agent 변경은 계속 금지된다.

---

# Task 9 — 운영 cutover와 최종 검증

## 12. 진입 조건

다음이 모두 충족되지 않으면 Task 9를 시작하지 않는다.

- Task 7 PASS
- Task 8 PASS
- Clean Next-only production build artifact
- Deployment/rollback runbook review PASS
- 사용자의 명시적 운영 실행 승인

Task 9는 실제 운영 side effect를 포함한다. 새 세션은 승인 없이 계획, read-only inspection, rehearsal까지만 수행한다.

## 13. 목표

운영 서비스를 Next-only runtime으로 전환하고 데이터·기능·복구 가능성을 검증한다.

## 14. Preflight

1. 현재 live branch/commit/process/ports/launch agents를 재확인한다.
2. 운영 SQLite online backup을 생성하고 복구 가능성을 검사한다.
3. DB fingerprint를 수집한다.
   - table별 row counts
   - `PRAGMA quick_check`
   - `PRAGMA foreign_key_check`
   - schema migration ledger
4. Upload fingerprint를 수집한다.
   - 파일 수
   - 총 크기
   - 표본 hashes
5. Current Flask+Next smoke 기준선을 캡처한다.
6. Next-only artifact, migrations, environment key presence를 검사한다.
   - secret 값은 출력하지 않는다.
7. Rollback artifact와 명령이 실제 존재하는지 확인한다.

## 15. Cutover

사용자 승인 후에만:

1. 쓰기 정지 또는 명확한 짧은 maintenance boundary를 설정한다.
2. 최종 DB online backup과 upload snapshot/fingerprint를 만든다.
3. Additive migrations를 적용하고 ledger를 확인한다.
4. Next-only build를 배포한다.
5. Next runtime readiness를 확인한다.
6. Flask launch agent를 비활성화한다.
7. Flask port가 없어도 public service가 동작하는지 검증한다.

## 16. 운영 smoke matrix

최소 실제 사용자 경로:

- `/login`
- login → `/api/me` → logout
- feed/read APIs
- post create/edit/comment/react
- projects read/write/member linking
- admin member operations
- API key 조회/재발급
- Goodbai external API-key request
- materials list/create/upload/download/replace/delete
- talent-office list/create/assign/review/solution/complete/points
- inquiries/wall
- runtime-health
- malformed/authz/error paths

Browser 검증은 HTML status만으로 끝내지 않는다. Hydration, stylesheet, 실제 클릭, API response, DB side effect를 확인한다.

## 17. 데이터 검증과 rollback

Cutover 후 preflight fingerprint와 비교한다.

- row counts와 허용된 변화
- `quick_check`
- `foreign_key_check`
- migration ledger
- upload count/hash 표본
- session/auth behavior

Rollback trigger를 사전에 정의한다.

예:

- login/session 장애
- DB integrity 실패
- 핵심 write 부분 저장
- upload 손실/노출
- Goodbai API regression
- 반복 5xx 또는 runtime-health failure

Rollback은 코드뿐 아니라 DB migration compatibility, launch agent, port ownership, upload state까지 복원·확인한다.

## 18. Task 9 종료 조건

- Next-only live smoke 전체 PASS
- Flask process/port 없이 서비스 정상
- Data integrity PASS
- Goodbai compatibility PASS
- Rollback rehearsal 또는 승인된 rollback proof PASS
- 관찰 기간 중 blocking regression 0
- 운영 문서와 현재 architecture를 갱신
- 사용자가 Flask archival/deletion을 승인

## 18.1 Task 9 기술 완료 상태

2026-07-23 Task 9 운영 실행은 PI 승인 아래 수행했다.

- `764a118` Task 8, `53a8e8a` cutover preflight, `afbee0a` stale `.next` cache 제거,
  `baebb2b` web-only live test 경계 수정, `b7fbca9` backup 권한 강화, `caa8fc0` auth/API-key
  cache 차단이 `origin/main`에 반영됐다.
- 표준 autodeploy가 `caa8fc0`를 배포했고 source-build와 live-build 양쪽에서 350/350,
  typecheck, production build를 통과했다.
- 첫 두 배포 시도는 각각 stale generated route type과 live root-only file 가정 때문에 migration 전에
  fail-closed했고 자동 code rollback이 통과했다. 데이터 mutation은 발생하지 않았다.
- 최종 SQLite backup은
  `/Users/hai_1/AI-Workspace/code/runtime/backups/bai_website/lab-feed-task9-final-20260723-0055.db`,
  LaunchAgent와 uploads rollback bundle은
  `/Users/hai_1/AI-Workspace/code/runtime/rollbacks/bai_website/task9-20260723-0055`다.
- 운영 ledger에 `004_material_file_cleanup_queue`, `005_auth_sessions`가 추가됐다.
- `com.user.bai-next`와 `com.user.baifeed-backup`은 mode-600 runtime env를 strict shell로 source한다.
  Node backup은 exit 0, 신규 artifact mode 600, 무결성 `ok`, foreign-key error 0을 확인했다.
- `com.user.baifeed`는 unload와 persistent disable 상태이고 port 5066 listener는 없다. Flask plist와 Python sources는 rollback용으로
  보존했으며 삭제·archive하지 않았다.
- 기존 pre-cutover API key로 public `/api/post`를 호출해 status 200, `source=skill`, author 일치를 확인하고
  생성 행을 정리했다. Posts `10 → 10`, residue 0, `quick_check=ok`, foreign-key error 0이다.
- 로그인·세션·API-key 응답은 `Cache-Control: private, no-store`를 반환한다. 운영 DB·plist·backup은
  mode 600, uploads·backup directory는 mode 700이다.
- 공개 URL 47-check smoke는 실제 브라우저 login/hydration/assets, session replay rejection, 전체 read,
  post/project/admin/API-key/Goodbai/material/talent/inquiry/wall/runtime-health 흐름을 통과했다.
- 임시 smoke account, 행, 파일을 모두 정리한 뒤 domain row counts와 uploads inventory가 pre-smoke
  기준선으로 복원됐고 `quick_check=ok`, foreign-key error 0, smoke residue 0을 확인했다.
- 그 뒤 01:12 KST 관찰 중 기존 활성 회원의 정상 `source=web` 게시물 1건이 들어와 posts는 10에서 11로
  늘었다. 이는 smoke residue가 아닌 concurrent real-user activity이므로 보존했다.
- Machine-readable smoke·runtime·observation evidence는
  `docs/next-only-migration/task9-evidence.json`에 기록한다.
- 최종 HEAD 기준 2026-07-23 01:07:13–01:40:02 KST 30분 관찰은 local/public/login HTTP,
  anonymous auth cache header, DB quick/FK, ports 5067/5066, Flask persistent disable, deploy-state를
  61회 확인해 61/61 PASS, blocking regression 0이었다.

기술 cutover가 끝나도 operational acceptance는 별도다. PI가 실제 계정으로 feed, materials,
talent-office와 operator 권한을 사용해 확인하기 전에는 운영 수용 원장의 `observing` 상태를 유지한다.
Flask/Python source·plist archival 또는 삭제는 그 수용 기록과 별도 사용자 승인 뒤에만 수행한다.

---

# 19. 공통 세션 운영 규칙

각 새 세션은 다음 순서를 따른다.

1. Project rules와 정본 문서를 읽는다.
2. 이 handoff를 읽는다.
3. `git status`와 current diff를 확인한다.
4. 현재 task의 predecessor code와 tests를 추적한다.
5. 필요한 baseline을 재실행한다.
6. TDD로 RED → GREEN을 증명한다.
7. Full gates를 실행한다.
8. Fresh specification review를 실행한다.
9. Fresh security/quality review를 실행한다.
10. 발견된 문제 수정 후 관련 fresh review를 다시 실행한다.
11. 이 handoff의 current phase와 evidence를 갱신한다.
12. 사용자 승인 없이는 commit/push/deploy하지 않는다.

실패를 Flask-like response로 합성하거나 broad catch로 숨기지 않는다. Subagent 결과는 self-report이므로 부모가 실제 파일과 실행 output을 검증한다.

# 20. 다음 세션 시작 프롬프트

다음 문장을 새 세션에 전달한다.

> `/Users/hai_1/AI-Workspace/code/projects/dev/bai_website/docs/next-only-migration/handoff-current.md`를 canonical handoff로 읽고 BAI Next-only migration의 운영 수용 관찰을 이어가라. 먼저 project rules와 rule.md, architecture.md, roadmap.md를 읽고 local `main`의 docs-only closeout commit 1개와 `origin/main`·deploy-state `caa8fc0`의 의도된 차이, `com.user.bai-next`, Node backup job, `com.user.baifeed` unloaded·persistently disabled, ports 5067/5066 상태를 read-only로 검증하라. 실제 PI 계정으로 feed·materials·talent-office·operator 흐름이 성공하면 operational acceptance 절차를 수행하되, 별도 사용자 승인 없이는 Flask/Python source·plist를 archive/delete하거나 추가 deploy하지 마라.
