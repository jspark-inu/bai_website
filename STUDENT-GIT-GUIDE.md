# 학생 작업 절차

이 repo는 BAI 웹사이트 코드 저장소입니다.

Repo: https://github.com/jspark-inu/bai_website

## 1. 처음 한 번만 clone

```bash
git clone https://github.com/jspark-inu/bai_website.git
cd bai_website
```

## 2. 로컬 실행 준비

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

주로 아래 파일을 수정합니다.

- 화면/HTML: `frontend/`
- 스타일: `frontend/app.css`
- 백엔드/API: `backend/`
- 운영 보조 스크립트: `scripts/`

## 5. 테스트

수정 후 최소 한 번 실행합니다.

```bash
cd backend
venv/bin/python -m pytest -q
```

## 6. commit / push

```bash
git status
git add frontend backend scripts README.md STUDENT-GIT-GUIDE.md
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

## 절대 commit하지 말 것

아래 파일은 절대 올리지 않습니다.

- `.env`, `.env.*`
- `backend/*.db`
- `backend/venv/`
- `backups/`
- API key, password, token
- 개인 운영 문서나 서버 설정 파일

실수로 올렸다면 바로 말해주세요. 혼자 force push로 덮지 않습니다.
