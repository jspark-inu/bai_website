# BAI Next 단일 런타임 전환 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Flask와 Python 프런트 중복을 제거하고 BAI의 UI, API, 인증, DB 접근, 업로드를 Next.js 단일 런타임으로 통합한다.

**Architecture:** 기존 SQLite와 공개 API 계약은 유지한다. 명시적 Next Route Handler가 도메인별 경로를 점진적으로 인수하고, 인증을 마지막에 전환한 뒤 catch-all proxy와 Flask 운영 프로세스를 제거한다.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, better-sqlite3, Vitest, Playwright, Node crypto

---

## 실행 원칙

- 내일 구현 시작 전 `rule.md`와 `architecture.md`를 다시 읽는다.
- 아래 각 task는 별도 커밋으로 끝낸다.
- 각 route는 failing contract test → 최소 구현 → parity test 순서로 이전한다.
- 운영 반영은 단계별로 하되 Flask 제거는 마지막 cutover에서만 수행한다.

### Task 1: API 계약 인벤토리 생성

**Objective:** Flask의 모든 API 경로, 메서드, 권한, 요청·응답 계약을 기계 판독 가능한 manifest로 고정한다.

**Files:**
- Create: `apps/web/tests/contracts/legacy-api-manifest.ts`
- Create: `apps/web/tests/contracts/legacy-api-contract.test.ts`
- Read: `backend/app.py`
- Read: `backend/test_app.py`

**Steps:**
1. Flask route 목록을 method/path/role/request/response/status 구조로 작성한다.
2. 누락된 route가 있으면 실패하는 manifest coverage test를 작성한다.
3. fixture DB에서 핵심 성공·401·403·404 응답을 캡처한다.
4. `npm test -- tests/contracts/legacy-api-contract.test.ts`를 실행해 기준선을 저장한다.

**Acceptance:** Flask의 `/api/*` 경로가 manifest에 100% 포함되고 공개 계약이 fixture로 고정된다.

### Task 2: DB 계층 분리와 migration runner 도입

**Objective:** 거대한 `db.ts`와 요청 중 schema mutation을 client/repository/migration 계층으로 분리한다.

**Files:**
- Create: `apps/web/src/lib/db/client.ts`
- Create: `apps/web/src/lib/db/transaction.ts`
- Create: `apps/web/src/lib/db/migrations.ts`
- Create: `apps/web/src/lib/db/repositories/members.ts`
- Modify: `apps/web/src/lib/db.ts`
- Test: `apps/web/tests/unit/db.test.ts`
- Create: `apps/web/tests/unit/migrations.test.ts`

**Steps:**
1. production absolute-path 및 readonly 실패 테스트를 먼저 작성한다.
2. transaction commit/rollback 테스트를 작성한다.
3. `schema_migrations` ledger와 idempotent migration 테스트를 작성하고, `migrations.ts`가 Python `SCHEMA`와 `init_schema`의 전체 생성·호환성·timestamp/trigger lifecycle을 canonical owner로 인수한다.
4. `ensureColumn`과 `ensureWallSchema`를 request path에서 제거한다.
5. `npm test -- tests/unit/db.test.ts tests/unit/migrations.test.ts`를 통과시킨다.

**Acceptance:** `migrations.ts`가 빈 DB와 기존 partial DB 모두에서 전체 BAI schema를 data loss 없이 구성하며, 요청 처리 중 DDL이 실행되지 않고 모든 쓰기가 동일 transaction helper를 사용할 수 있다.

### Task 3: 읽기 API 이전

**Objective:** 부작용 없는 조회 API를 명시적 Next routes로 이전한다.

**Files:**
- Create routes under `apps/web/src/app/api/{feed,inquiries,members,member,post,tag,search,questions,weekly,projects}/`
- Create repositories: `posts.ts`, `projects.ts`, `inquiries.ts`
- Create services: `posts.ts`, `projects.ts`, `inquiries.ts`
- Test: `apps/web/tests/contracts/read-api-parity.test.ts`, `backend/test_read_api_parity.py`
- Fixture: `apps/web/tests/contracts/read-api-parity-fixture.json`

**Steps:**
1. 도메인별 Flask parity test를 실패 상태로 작성한다.
2. members/member routes를 구현하고 통과시킨다.
3. feed/post/tag/search/questions/inquiries/weekly routes를 구현하고 통과시킨다.
4. projects list/detail routes를 구현하고 통과시킨다.
5. 각 route가 catch-all보다 우선 처리되는지 확인한다.

**Acceptance:** 모든 읽기 API의 도메인 데이터는 Next에서 직접 SQLite를 읽으며 Flask data proxy를 사용하지 않는다. Task 7 전까지 세션 검증은 Flask `/api/me`를 인증 권한자로 유지한다.

### Task 4: 게시물·댓글·반응·wall·문의 쓰기 이전

**Objective:** 일반 사용자 쓰기 기능을 Next service와 transaction으로 이전한다.

**Files:**
- Create/modify explicit routes under `apps/web/src/app/api/post`, `web/post`, `wall`, `inquiries`
- Create: `apps/web/src/lib/services/posts.ts`
- Create: `apps/web/src/lib/services/inquiries.ts`
- Test: `apps/web/tests/contracts/write-api-parity.test.ts`

**Steps:**
1. 권한·빈 입력·404·성공 응답 테스트를 작성한다.
2. 게시물 생성/수정 transaction을 구현한다.
3. 댓글과 반응 idempotency/권한을 구현한다.
4. wall과 inquiry 생성/답변을 구현한다.
5. Flask와 Next 결과 및 DB side effect를 비교한다.

**Acceptance:** 일반 쓰기 경로가 Next 단일 writer이며 실패 시 부분 저장이 없다.

### Task 5: 프로젝트·관리자·Goodbai API 이전

**Objective:** 프로젝트 관리, 멤버 관리, API key 클라이언트 계약을 Next로 이전한다.

**Files:**
- Create explicit routes under `apps/web/src/app/api/projects`, `admin/members`, `developer`, `account`
- Create: `apps/web/src/lib/services/admin.ts`
- Modify: `apps/web/src/lib/db/repositories/members.ts`
- Test: `apps/web/tests/contracts/admin-goodbai-parity.test.ts`

**Steps:**
1. owner/PI 권한 및 self-demotion 금지 테스트를 작성한다.
2. 프로젝트 생성·수정·멤버 연결을 transaction으로 구현한다.
3. 기존 API key 조회·재발급 계약을 구현한다.
4. `/api/post`의 `X-API-Key` 인증과 응답 URL을 보존한다.
5. 실제 기존 API key fixture로 회귀 테스트한다.

**Acceptance:** 외부 Goodbai 클라이언트 수정 없이 Next API를 사용할 수 있다.

### Task 6: materials와 talent-office 통합

**Objective:** 이미 부분 이전된 기능을 공통 repository/service 구조에 맞추고 Flask 프록시를 제거한다.

**Files:**
- Refactor: `apps/web/src/app/api/materials/**`
- Refactor: `apps/web/src/app/api/talent-office/**`
- Create: `apps/web/src/lib/db/repositories/materials.ts`
- Create: `apps/web/src/lib/db/repositories/talent-office.ts`
- Create: `apps/web/src/lib/services/talent-office.ts`
- Test: `apps/web/tests/unit/talent-office.test.ts`
- Test: `apps/web/tests/contracts/talent-office-parity.test.ts`

**Steps:**
1. 상태 전이표와 역할별 허용/거부 테스트를 작성한다.
2. assignment 비율 합계와 포인트 지급 transaction 테스트를 작성한다.
3. 모든 proxy route를 명시적 구현으로 교체한다.
4. 업로드 저장·삭제와 DB 변경의 실패 보상 테스트를 추가한다.

**Acceptance:** talent-office 완료 처리와 포인트 지급이 원자적이고 materials/talent-office에 Flask 호출이 없다.

### Task 7: Next 인증·세션 전환

**Objective:** Flask 인증 권한자를 제거하고 Next가 로그인과 세션을 직접 소유한다.

**Files:**
- Create: `apps/web/src/lib/auth/password.ts`
- Create: `apps/web/src/lib/auth/session.ts`
- Create: `apps/web/src/lib/auth/rate-limit.ts`
- Create: `apps/web/src/lib/auth/require-member.ts`
- Rewrite: `apps/web/src/app/api/auth/login/route.ts`
- Rewrite: `apps/web/src/app/api/auth/logout/route.ts`
- Rewrite: `apps/web/src/app/api/auth/me/route.ts`
- Rewrite compatibility routes: `/api/login`, `/api/logout`, `/api/me`
- Test: `apps/web/tests/unit/auth.test.ts`
- Create: `apps/web/tests/integration/login-session.test.ts`

**Steps:**
1. 실제 Werkzeug PBKDF2 hash fixture 검증 테스트를 작성한다.
2. 세션 tamper, expiry, malformed cookie, production secret 누락 테스트를 작성한다.
3. secure/httpOnly/sameSite/maxAge 쿠키 발급을 구현한다.
4. 로그인 rate limit을 구현한다.
5. 기존 사용자 fixture로 로그인 → `/api/me` → 로그아웃 E2E를 통과시킨다.
6. `auth.ts`의 Flask fetch를 제거한다.

**Acceptance:** 인증 경로가 포트 5066 없이 동작하고 기존 사용자는 비밀번호 변경 없이 로그인할 수 있다.

### Task 8: proxy와 Python 런타임 제거

**Objective:** 운영과 저장소에서 Flask 의존성을 완전히 제거한다.

**Files:**
- Delete: `apps/web/src/app/api/[...path]/route.ts`
- Delete: `apps/web/src/lib/legacy-api-proxy.ts`
- Delete after archival confirmation: `backend/`, `frontend/`
- Modify: `.env.example`
- Modify: `scripts/deploy-react-to-live.sh`
- Modify: `scripts/autodeploy-main.sh`
- Modify: `README.md`
- Test: `apps/web/tests/unit/no-legacy-runtime.test.ts`

**Steps:**
1. production source에서 `BAI_API_ORIGIN`, `5066`, `proxyLegacyApi`가 발견되면 실패하는 테스트를 작성한다.
2. catch-all proxy와 Flask health dependency를 제거한다.
3. 배포 스크립트의 backend/frontend rsync와 backend restart/rollback을 제거한다.
4. `com.user.baifeed` 비활성화 절차와 복구 절차를 문서화한다.
5. Next 단일 runtime-health에 DB, uploads, migrations 검증을 남긴다.

**Acceptance:** 운영 요청 처리와 배포에 Python/Flask 프로세스가 필요하지 않다.

### Task 9: 최종 cutover와 운영 검증

**Objective:** Next 단일 런타임을 운영에 반영하고 데이터·로그인·외부 API를 검증한다.

**Files:**
- Create: `docs/next-only-migration/cutover-checklist.md`
- Update: `docs/next-only-migration/roadmap.md`

**Steps:**
1. DB 온라인 백업과 uploads inventory를 생성한다.
2. 전체 Vitest, TypeScript, build, parity harness, Playwright를 실행한다.
3. 운영 배포 후 `/login`, `/api/healthz`, `/api/me`를 확인한다.
4. 임시 운영 계정으로 실제 로그인과 주요 CRUD를 검증하고 정리한다.
5. 기존 API key로 Goodbai smoke를 수행한다.
6. DB `quick_check`, `foreign_key_check`, row counts를 배포 전후 비교한다.
7. `com.user.baifeed`를 unload하고 포트 5066 listener가 없는지 확인한다.
8. 30분 관찰 후 롤백 스냅샷과 백업 위치를 기록한다.

**Acceptance:** Next 단일 프로세스에서 전체 기능이 정상이고 데이터 변화가 의도된 smoke 기록 외에는 없다.
