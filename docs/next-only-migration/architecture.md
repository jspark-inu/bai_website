# BAI Next 단일 런타임 아키텍처

## 1. 현재 구조와 문제

현재 공개 UI는 Next.js/React지만 대부분의 `/api/*` 요청은 `apps/web/src/app/api/[...path]/route.ts`를 통해 Flask로 전달된다. Next와 Flask가 같은 SQLite를 열고 일부 기능은 Next가, 나머지는 Flask가 쓴다.

이 구조는 다음 운영 문제를 만든다.

- 인증·세션의 권한자가 Flask이고 UI/API 진입점은 Next라 장애 경계가 불명확하다.
- 두 런타임과 두 health check, 재시작 순서, Node/Python 환경을 함께 배포해야 한다.
- 같은 DB에 대한 쿼리·검증·migration 규칙이 Python과 TypeScript에 중복된다.
- 명시적 Next API와 catch-all Flask 프록시가 함께 있어 실제 소유 경로를 파악하기 어렵다.
- Python `frontend/`와 Next `public/static/`이 중복 소스로 유지된다.

## 2. 핵심 설계 결정

### ADR-1: Next.js가 유일한 서버 런타임이다

페이지, API, 인증, 업로드, DB 접근을 모두 `apps/web`이 소유한다. 별도 Python 서비스는 두지 않는다.

### ADR-2: SQLite는 유지한다

현재 규모와 단일 Mac 운영 조건에서는 DB 엔진 교체 이득이 없다. 이번 작업은 런타임 경계 제거가 목적이며 PostgreSQL 전환을 섞지 않는다.

### ADR-3: ORM을 추가하지 않는다

기존 SQL 계약이 명확하고 `better-sqlite3`가 이미 사용 중이다. 얇은 client/repository/service 계층과 명시적 transaction으로 통합한다.

### ADR-4: API 계약을 보존한다

프런트 코드와 Goodbai 클라이언트가 사용하는 기존 `/api/*` URL을 유지한다. 내부 구현만 Flask에서 Next Route Handler로 교체한다.

### ADR-5: 인증은 마지막에 전환한다

도메인 API를 점진적으로 이전하는 동안 기존 Flask 세션을 임시 인증 권한자로 사용한다. 모든 API가 Next 소유가 된 뒤 다음을 한 번에 전환한다.

- Werkzeug `pbkdf2:sha256` 비밀번호 해시 검증을 Node `crypto.pbkdf2` 호환 구현으로 교체
- HMAC 서명, 만료시간, `httpOnly`, `secure`, `sameSite=lax`를 갖는 Next 세션 쿠키 발급
- 로그인 rate limit 이전
- 기존 Flask 세션은 폐기하고 1회 재로그인

Flask 세션 포맷을 장기적으로 이중 지원하지 않는다.

### ADR-6: schema-on-request를 금지한다

현재 `ensureColumn`, `ensureWallSchema` 같은 요청 중 schema mutation을 제거한다. `apps/web/src/lib/db/migrations.ts`가 배포 전 한 번 실행되고 migration ledger를 기록한다.

## 3. 목표 코드 구조

```text
apps/web/src/
  app/api/
    login/route.ts
    logout/route.ts
    me/route.ts
    post/...
    projects/...
    talent-office/...
    admin/...
  lib/
    auth/
      password.ts
      session.ts
      rate-limit.ts
      require-member.ts
    db/
      client.ts
      transaction.ts
      migrations.ts
      repositories/
        members.ts
        posts.ts
        projects.ts
        inquiries.ts
        materials.ts
        talent-office.ts
    services/
      posts.ts
      projects.ts
      talent-office.ts
      admin.ts
    http/
      errors.ts
      json.ts
```

Route Handler는 HTTP parsing/validation/response만 담당한다. 권한 및 상태 전이는 service, SQL은 repository가 담당한다.

## 4. 이전 전략

### 0단계: 계약 고정

Flask 테스트 fixture DB를 사용해 기존 API의 상태 코드와 JSON을 fixture로 캡처한다. Next 구현은 같은 fixture에 대해 동일 계약을 만족해야 한다.

### 1단계: 읽기 API

`members`, `member/:id`, `feed`, `post/:id`, `tag`, `search`, `questions`, `weekly`, `projects` 읽기를 명시적 Next route로 이전한다.

### 2단계: 일반 쓰기 API

게시물 작성·수정, 댓글, 반응, wall, inquiry를 service/transaction 기반으로 이전한다.

### 3단계: 프로젝트·관리·Goodbai API

프로젝트 생성·수정, 멤버 관리, 비밀번호 변경, API 키 조회·재발급, `/api/post`를 이전한다. 기존 API 키 값은 변경하지 않는다.

### 4단계: 자료실·인력사무소 통합

이미 Next가 일부 소유한 materials 코드를 새 repository/service 구조로 옮긴다. talent-office 프록시를 명시적 route/service로 교체하고 상태 전이와 포인트 지급을 transaction으로 묶는다.

### 5단계: 인증 전환

Next 로그인·세션·로그아웃·현재 사용자·rate limit을 활성화한다. 이 시점부터 Next API가 Flask `/api/me`를 호출하지 않는다.

### 6단계: Flask 제거

catch-all proxy, `legacy-api-proxy.ts`, `backend/`, Python `frontend/`, 포트 5066 설정, Flask launch agent, Flask health check와 backend rsync를 제거한다.

## 5. 검증 전략

- 단위: repository SQL, password compatibility, session tamper/expiry, authorization, domain transitions
- 계약: Flask fixture 결과와 Next 결과 parity
- 통합: 임시 SQLite DB에서 로그인 → CRUD → 권한 → 로그아웃
- 브라우저: 실제 로그인 폼, 피드, 게시물, 프로젝트, 자료실, 인력사무소, 관리자 화면
- 운영 smoke: `/login`, `/api/healthz`, 로그인 후 `/api/me`, Goodbai API key 요청, DB fingerprint, upload fingerprint
- 데이터: 배포 전후 row counts, `quick_check`, `foreign_key_check`, 업로드 파일 수/해시 표본

## 6. 롤백

각 도메인 이전 커밋은 명시적 Next route를 추가하는 방식이므로 문제가 생기면 해당 route를 되돌려 catch-all Flask proxy로 복귀할 수 있다. 인증 전환과 Flask 제거는 마지막 단일 cutover로 묶으며, 직전 코드 스냅샷과 DB 온라인 백업을 보존한다.
