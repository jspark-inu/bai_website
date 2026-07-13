# 학생 작업 절차

이 repo는 BAI 웹사이트 코드 저장소입니다.

Repo: https://github.com/jspark-inu/bai_website

## 1. 처음 한 번만 clone

```bash
git clone https://github.com/jspark-inu/bai_website.git
cd bai_website
```

## 2. 로컬 실행 준비

현재 운영 사이트의 화면은 React/Next 앱입니다.

```bash
cd apps/web
npm install
npm run dev
```

브라우저에서 확인:

```text
http://127.0.0.1:5067
```

기존 Flask 앱/API를 확인해야 할 때만 아래를 실행합니다.

```bash
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt pytest
LAB_FEED_SECRET=dev LAB_FEED_DB=lab-feed.dev.db venv/bin/python app.py
```

브라우저에서 확인:

```text
http://127.0.0.1:5066
```

## 3. 수정 작업 시작

항상 새 branch에서 작업합니다.

```bash
git checkout main
git pull
git checkout -b 이름/작업내용
```

예시:

```bash
git checkout -b park/fix-main-page
```

## 4. 수정 위치

운영 사이트(`bai.haiinu.com`)는 `apps/web` 안의 Next 앱으로 뜹니다. 디자인 수정은 아래 파일을 우선 수정합니다.

- 승인 KRDS CSS: `apps/web/public/static/krds.css`
- 승인 KRDS 화면 동작/렌더링: `apps/web/public/static/krds.js`
- Next 라우트 껍데기: `apps/web/src/app/`
- 로그인/공통 shell: `apps/web/src/components/LegacyShell.tsx`
- 백엔드/API: `backend/`
- 운영 보조 스크립트: `scripts/`

`frontend/krds.css`와 `frontend/krds.js`는 승인 디자인 원본입니다. 같은 파일을 `apps/web/public/static/`에도 바이트 단위로 동일하게 반영해야 합니다. `frontend/`만 바꾼 PR은 머지돼도 운영 사이트에 반영되지 않으므로, 디자인 PR은 반드시 `apps/web/public/static/` 또는 `apps/web/src/`도 같이 수정해야 합니다.

## 5. 테스트

수정 후 최소 한 번 실행합니다.

```bash
cd backend
venv/bin/python -m pytest -q
```

React 화면을 수정했다면 아래도 실행합니다.

```bash
cd apps/web
npm run typecheck
npm test
npm run build
```

## 6. commit / push

```bash
git status
git add apps/web backend scripts README.md STUDENT-GIT-GUIDE.md
git commit -m "작업 내용 요약"
git push -u origin 현재브랜치명
```

예시:

```bash
git push -u origin park/fix-main-page
```

## 7. Pull Request

GitHub에서 `Compare & pull request`를 눌러 PR을 만듭니다.

PR에는 아래 3가지만 적으면 됩니다.

```text
무엇을 바꿨는지:
테스트 결과:
확인 필요한 부분:
```

등록된 학생 계정의 일반 UI·기능 PR은 `pytest`와 `react` 검사가 모두 통과하면
자동으로 squash merge되고 운영 사이트에 배포됩니다. 별도의 승인 요청이나 Merge 버튼은
필요하지 않습니다. 인증·DB·API·의존성·배포·GitHub 설정처럼 고위험 경로를 바꾸면
PI 검토가 끝날 때까지 자동 병합이 대기합니다.

## 절대 commit하지 말 것

아래 파일은 절대 올리지 않습니다.

- `.env`, `.env.*`
- `backend/*.db`
- `backend/venv/`
- `backups/`
- API key, password, token
- 개인 운영 문서나 서버 설정 파일

실수로 올렸다면 바로 말해주세요. 혼자 force push로 덮지 않습니다.
