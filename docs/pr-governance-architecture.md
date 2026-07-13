# External PR governance

BAI의 외부 pull request는 하나의 설정 기반 판정 엔진을 거쳐 정확히 한 상태로 이동한다.

```text
PR event
  -> main 브랜치의 신뢰된 policy checkout
  -> 작성자 신뢰 + 전체 파일 목록 + 추가된 줄 + 현재 head의 PI 승인
  -> blocked | pi_review | auto_merge
  -> required checks (pytest, react)
  -> squash merge
  -> main 자동 배포
```

## 세 상태

| 상태 | 조건 | 자동 행동 |
|---|---|---|
| `auto_merge` | 등록 학생·운영자의 일반 변경, 또는 현재 head에 PI가 권한을 부여한 변경 | 필수 checks 통과 후 squash merge |
| `pi_review` | 미등록 외부 작성자, 고위험 경로, 과대 변경, API가 patch를 제공하지 못한 변경 | 기존 auto-merge 해제, PI review 요청 |
| `blocked` | 비밀 파일·runtime DB·private key/token, 불완전 파일 목록 | 기존 auto-merge 해제, governance 실패 |

`blocked`는 PI 승인으로 우회하지 않는다. 수정 커밋으로 위험 증거를 제거해야 한다. 새 커밋이 올라오면 이전 head의 승인은 인정하지 않으며 처음부터 다시 판정한다.

## 신뢰 경계

- 권한을 가진 `pull_request_target` job은 항상 `main`의 policy 코드만 checkout한다.
- PR head의 JavaScript, shell, package script는 이 job에서 실행하지 않는다.
- 일반 CI는 읽기 권한으로 PR 코드를 검사하며, governance·workflow·dependency 변경은 CODEOWNERS가 PI 승인 대상으로 고정한다.
- GitHub API가 반환한 전체 파일 수와 실제 목록 수가 다르면 fail closed 한다.
- 비밀정보 탐지는 고신뢰 패턴만 자동 차단한다. 일반 코드의 의도까지 완전 자동 판별한다고 가정하지 않는다.

## 설정과 하네스

- 정본 계약: `.github/pr-governance-routing.json`
- 작성자 신뢰: `.github/trusted-students.json`
- 판정 엔진: `scripts/pr-governance-policy.mjs`
- 로컬/CI 하네스: `scripts/pr-governance-harness.mjs`
- GitHub 실행기: `.github/workflows/operator-automerge.yml`

```bash
node scripts/pr-governance-harness.mjs fixtures
node scripts/pr-governance-harness.mjs verify-diff \
  --base origin/main --head HEAD \
  --author dur4290 --permission read --association NONE
```

하네스 exit code는 `auto_merge`와 `pi_review`에서 0, `blocked`에서 1, 실행 오류에서 2다. 따라서 CI는 심각한 위협만 차단하고 PI 검토 대상은 정상적인 대기 상태로 남긴다.

## 운영 변경

고위험 경로를 바꿀 때는 governance 설정과 CODEOWNERS를 같은 PR에서 수정한다. 단위 테스트가 두 목록의 불일치를 실패시킨다. PI 목록, 임계값, 금지 패턴 변경도 고위험 경로인 `.github/` 아래에 있으므로 기존 PI 통제를 통과해야 한다.
