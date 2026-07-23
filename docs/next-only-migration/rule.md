# BAI Next 단일 런타임 전환 작업 규칙

## 목표

BAI 운영 사이트를 React 19 + Next.js 16의 단일 애플리케이션으로 통합한다. 최종 운영 상태에서는 Flask 프로세스, 포트 5066, Flask API 프록시, Python 백엔드 배포 경로가 존재하지 않는다.

## 현재 운영 경계

- 2026-07-23 `caa8fc0`에서 Next-only cutover의 기술 검증을 완료했다.
- Flask service와 port 5066은 영구 비활성화했다. Legacy plist는 active LaunchAgents에서 제거하고 mode-600 rollback bundle에 보존한다.
- PI 실계정 운영 수용을 완료했다. Python `backend/`와 `frontend/`는 production runtime이 아니라 계약 oracle·승인 디자인 원본으로 source tree에 유지한다.

## 불변 조건

1. 기존 SQLite 운영 DB와 업로드 파일을 그대로 보존한다. 새 DB로 복제·교체하지 않는다.
2. 기존 공개 API URL, 메서드, 요청 필드, 응답 필드, HTTP 상태 코드를 계약 테스트로 고정한다.
3. Goodbai API 키 클라이언트의 `/api/post` 및 키 재발급 계약을 보존한다.
4. 도메인별 이전 중 같은 기능을 Flask와 Next가 동시에 쓰지 않는다. 명시적 Next Route Handler가 소유권을 넘겨받으면 해당 경로의 프록시 의존성을 제거한다.
5. 요청 처리 중 스키마를 생성·변경하지 않는다. 스키마 변경은 배포 전 명시적 migration 단계에서만 수행한다.
6. DB 접근은 `better-sqlite3` 단일 계층으로 통합하고 쓰기는 transaction helper를 사용한다.
7. Flask 세션을 Node에서 영구 호환하지 않는다. 최종 인증 전환 시 새 Next 세션으로 바꾸고 1회 재로그인을 허용한다.
8. 인증 전환 전까지 이전된 Next API는 기존 Flask `/api/me`를 통한 인증을 임시 사용한다. 인증은 모든 도메인 API가 이전된 뒤 마지막에 전환한다.
9. 매 기능 이전은 RED → GREEN → REFACTOR 순서로 수행한다. Flask 응답과 Next 응답의 parity 검증 없이 프록시 경로를 제거하지 않는다.
10. 운영 배포는 DB 온라인 백업, integrity check, 업로드 보존, 코드 롤백 스냅샷을 유지한다.

## 목표 아키텍처

```text
Browser / Goodbai clients
          |
          v
Next.js 16 (React 19, port 5067)
  - pages and static assets
  - route handlers
  - authentication/session
  - domain services
  - repositories/migrations
          |
          v
SQLite + uploads
```

## 완료 정의

- `apps/web`만 운영 요청을 처리한다.
- `apps/web/src/app/api/[...path]/route.ts`와 `legacy-api-proxy.ts`가 삭제된다.
- `apps/web/src/lib/auth.ts`가 Flask 호출 없이 세션을 검증한다.
- production 코드에서 `BAI_API_ORIGIN`과 `5066` 의존성이 0건이다.
- `com.user.baifeed` launch agent가 제거·비활성화된다.
- 배포 스크립트가 Next 코드, migration, DB 백업, 업로드, 단일 health check만 관리한다.
- 계약 테스트, 단위 테스트, 빌드, 로컬 E2E, 운영 로그인 및 Goodbai API smoke가 모두 통과한다.
