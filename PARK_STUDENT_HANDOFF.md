# 박경 학생용 BAI 웹사이트 작업 안내

이 파일만 보고 그대로 진행하면 됩니다.

## 목적

BAI 웹사이트의 화면, 문구, 스타일, 간단한 기능을 수정하기 위한 작업 절차입니다.

운영 사이트:

```text
https://bai.haiinu.com
```

GitHub 저장소:

```text
https://github.com/jspark-inu/bai_website
```

이 저장소는 public repo입니다. 누구나 코드를 볼 수 있으므로 비밀번호, API key, DB 파일, 개인정보는 절대 올리면 안 됩니다.

---

# 1. 처음 한 번만 준비

터미널에서 작업할 폴더로 이동한 뒤 clone합니다.

```bash
git clone https://github.com/jspark-inu/bai_website.git
cd bai_website
```

Python 가상환경을 준비합니다.

```bash
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt pytest
cd ..
```

---

# 2. 로컬에서 사이트 실행해보기

```bash
cd backend
LAB_FEED_SECRET=dev LAB_FEED_DB=lab-feed.dev.db venv/bin/python app.py
```

브라우저에서 아래 주소를 엽니다.

```text
http://127.0.0.1:5066
```

서버를 끄려면 터미널에서 `Ctrl + C`를 누릅니다.

---

# 3. 작업 시작 전 항상 최신 main 받기

작업할 때마다 먼저 아래 명령을 실행합니다.

```bash
cd bai_website
git checkout main
git pull origin main
```

---

# 4. 절대 main에서 바로 수정하지 말기

작업마다 branch를 새로 만듭니다.

```bash
git checkout -b park/작업이름
```

예시:

```bash
git checkout -b park/fix-main-title
git checkout -b park/update-member-page
git checkout -b park/add-activity-section
```

branch 이름 규칙:

```text
park/짧은-작업설명
```

---

# 5. 주로 수정할 파일

## 메인 화면

```text
frontend/index.html
```

## 전체 스타일

```text
frontend/app.css
```

## 각 페이지 화면

```text
frontend/*.html
```

예:

```text
frontend/members.html
frontend/member.html
frontend/feed.html
frontend/questions.html
frontend/search.html
frontend/post.html
```

## 프론트엔드 동작

```text
frontend/feed.js
```

## 백엔드 / API

```text
backend/app.py
backend/auth.py
backend/lab_feed_db.py
```

## 운영 보조 스크립트

```text
scripts/
```

처음에는 가능하면 `frontend/` 위주로 수정하는 것을 권장합니다.

---

# 6. 수정 후 테스트

repo 루트에서:

```bash
cd backend
venv/bin/python -m pytest -q
cd ..
```

정상이라면 대략 이런 식으로 나옵니다.

```text
79 passed
```

HTML/CSS 문구만 바꾼 경우에도 가능하면 테스트를 한 번 실행합니다.

---

# 7. 변경 내용 확인

```bash
git status
git diff
```

`git status`에서 내가 수정한 파일만 나오는지 확인합니다.

---

# 8. commit 하기

수정한 파일을 add합니다.

예시:

```bash
git add frontend/index.html frontend/app.css
```

여러 파일을 수정했다면:

```bash
git add frontend backend scripts README.md STUDENT-GIT-GUIDE.md PARK_STUDENT_HANDOFF.md
```

commit합니다.

```bash
git commit -m "메인 화면 문구 수정"
```

commit 메시지는 짧고 구체적으로 씁니다.

좋은 예:

```text
메인 화면 문구 수정
회원 페이지 레이아웃 개선
활동 소개 섹션 추가
질문 페이지 버튼 스타일 수정
```

나쁜 예:

```text
수정
작업
asdf
final
```

---

# 9. GitHub에 branch 올리기

현재 branch 이름을 확인합니다.

```bash
git branch --show-current
```

push합니다.

```bash
git push -u origin 현재브랜치명
```

예시:

```bash
git push -u origin park/fix-main-title
```

---

# 10. Pull Request 만들기

GitHub 저장소로 갑니다.

```text
https://github.com/jspark-inu/bai_website
```

방금 push한 branch에 대해 `Compare & pull request` 버튼이 뜨면 클릭합니다.

PR 내용은 아래 형식으로 작성합니다.

```text
무엇을 바꿨는지:
- 

테스트 결과:
- 

확인 필요한 부분:
- 
```

예시:

```text
무엇을 바꿨는지:
- 메인 화면 제목 문구를 수정했습니다.
- 활동 소개 문단을 추가했습니다.

테스트 결과:
- backend pytest 통과했습니다.
- 로컬에서 메인 화면 확인했습니다.

확인 필요한 부분:
- 문구 톤이 적절한지 확인 부탁드립니다.
```

---

# 11. 절대 올리면 안 되는 것

아래 파일은 절대 commit/push하지 않습니다.

```text
.env
.env.*
backend/*.db
backend/*.sqlite
backend/venv/
.venv/
backups/
*.log
API key
password
token
개인정보
운영 서버 설정 파일
```

특히 아래 파일이 `git status`에 보이면 commit하지 말고 먼저 질문하세요.

```text
backend/lab-feed.db
.env
```

---

# 12. 실수했을 때

## 아직 commit 전이면

```bash
git status
git diff
```

상태를 확인하고 질문합니다.

## 잘못된 파일을 add했으면

```bash
git restore --staged 파일명
```

예:

```bash
git restore --staged backend/lab-feed.db
```

## commit까지 했는데 push 전이면

혼자 복잡하게 고치려고 하지 말고 질문합니다.

## push까지 했으면

혼자 force push하지 말고 질문합니다.

---

# 13. 운영 사이트 반영은 직접 하지 않기

박경 학생의 역할은 여기까지입니다.

```text
수정 → 테스트 → branch push → Pull Request 생성
```

운영 사이트 `https://bai.haiinu.com`에 실제 반영하는 작업은 교수님/운영자가 합니다.

운영 서버에서 직접 main을 수정하거나 바로 배포하지 않습니다.

---

# 14. 가장 짧은 요약

매번 작업할 때 아래 순서를 지키면 됩니다.

```bash
cd bai_website
git checkout main
git pull origin main
git checkout -b park/작업이름

# 파일 수정

cd backend
venv/bin/python -m pytest -q
cd ..

git status
git diff
git add 수정한파일들
git commit -m "작업 내용 요약"
git push -u origin park/작업이름
```

그 다음 GitHub에서 Pull Request를 만듭니다.

---

# 15. 질문할 때 같이 보내면 좋은 정보

문제가 생기면 아래 명령 결과를 같이 보내면 좋습니다.

```bash
git status
git branch --show-current
git log --oneline -5
```

테스트 실패면 실패 메시지도 같이 보냅니다.

```bash
cd backend
venv/bin/python -m pytest -q
```
