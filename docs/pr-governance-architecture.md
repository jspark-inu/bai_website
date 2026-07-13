# External PR governance

BAI의 외부 pull request는 하나의 설정 기반 판정 엔진을 거쳐 정확히 한 상태로 이동한다.

```text
PR event
  -> main 브랜치의 신뢰된 policy checkout
  -> 작성자 신뢰 + 전체 파일 목록 + 추가된 줄 + 현재 head의 AI/PI 권한
  -> auto_merge | ai_review | pi_review
  -> ai_review이면 Mac mini의 read-only Codex가 diff만 심사
  -> required checks (pytest, react)
  -> squash merge
  -> main 자동 배포
```

## 세 상태와 최소 PI 개입

| 상태 | 조건 | 자동 행동 |
|---|---|---|
| `auto_merge` | 등록 학생·운영자의 일반 변경, 현재 head의 AI 승인, 또는 PI 권한 부여 | 필수 checks 통과 후 squash merge |
| `ai_review` | 미등록 외부 작성자, DB·API·인증·dependency·server 변경, 과대 변경 | PI 알림 없이 로컬 Codex 심사 대기 |
| `pi_review` | governance 통제면, 실제 비밀 파일·키·runtime DB, 불완전 파일 목록, AI의 구체적 escalation | 위험 사유 기록 후에만 PI review 요청 |

현재 head에 대한 PI 승인 또는 PI가 직접 작성한 PR은 모든 자동 위험 판정보다 우선한다. 다만 기본 경로는 AI 자동 판단이며 PI는 필수 예외에만 호출한다. AI와 PI 결과는 모두 head commit에 묶이므로 새 커밋이 올라오면 다시 판정한다.

## 신뢰 경계

- 권한을 가진 `pull_request_target` job은 항상 `main`의 policy 코드만 checkout한다.
- PR head의 JavaScript, shell, package script는 이 job에서 실행하지 않는다.
- 일반 CI는 읽기 권한으로 PR 코드를 검사한다. governance·AI reviewer 자체는 CODEOWNERS로 PI 승인 대상으로 고정하고, product·runtime 코드는 AI reviewer가 먼저 판단한다.
- GitHub API가 반환한 전체 파일 수와 실제 목록 수가 다르면 fail closed 한다.
- 로컬 Codex는 `read-only`, `ephemeral`, 빈 임시 디렉터리에서 diff 문자열만 읽는다. PR 코드를 checkout·실행하지 않고 diff 안의 지시문도 untrusted data로 취급한다.
- 비밀정보 고신뢰 패턴은 Codex에 보내지 않고 바로 PI 검토 사유로 보고한다.

## 설정과 하네스

- 정본 계약: `.github/pr-governance-routing.json`
- 작성자 신뢰: `.github/trusted-students.json`
- 판정 엔진: `scripts/pr-governance-policy.mjs`
- AI 판정 계약: `scripts/pr-ai-review-policy.mjs`, `scripts/pr-ai-review-schema.json`
- AI worker: `scripts/pr-ai-review-worker.mjs`
- 로컬/CI 하네스: `scripts/pr-governance-harness.mjs`
- GitHub 실행기: `.github/workflows/operator-automerge.yml`
- 반복 실행기: `com.user.bai-pr-ai-review` launchd, 60초 주기

```bash
node scripts/pr-governance-harness.mjs fixtures
node scripts/pr-governance-harness.mjs verify-diff \
  --base origin/main --head HEAD \
  --author dur4290 --permission read --association NONE
```

하네스 exit code는 세 route에서 0, 실행 오류에서 2다. AI reviewer 장애는 PI에게 넘기지 않고 자동 재시도하며, AI가 구체적 위험을 판정했을 때만 `pi_review`로 전환한다.

## 운영 변경

PI 필수 통제 경로를 바꿀 때는 governance 설정과 CODEOWNERS를 같은 PR에서 수정한다. 단위 테스트가 두 목록의 불일치를 실패시킨다. AI reviewer·workflow·신뢰 목록 자체는 AI가 자기 권한을 확대할 수 없도록 PI 통제면에 남긴다.

대표적으로 등록 학생의 일반 UI 변경은 바로 `auto_merge`, 등록 학생의 DB·API 변경과 미등록 외부인의 일반 변경은 `ai_review`, 실제 secret·runtime DB와 AI가 구체적 중대 위험을 찾은 변경만 `pi_review`로 간다.

## 반복 운영 체크리스트

1. governance job이 세 상태 중 정확히 하나를 기록했는지 확인한다.
2. `ai_review`는 PI가 개입하지 않고 `bai-ai-review` head status를 기다린다.
3. `pi_review`가 된 경우에만 AI 코멘트의 구체적 위험과 현재 head를 확인한다.
4. 위험을 수용하면 현재 head를 PI가 승인한다. 승인이 모든 자동 위험 판정보다 우선한다.
5. `auto_merge`는 `pytest`와 `react` 성공 뒤 실제 main 반영과 자동 배포를 확인한다.
