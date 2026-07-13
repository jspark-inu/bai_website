"use client";

import { useEffect } from 'react';

declare global {
  interface Window { initApp?: () => void }
}

// KRDS 셸 — frontend/krds.html의 body DOM 계약을 그대로 마운트하고,
// 원본 렌더러(frontend/krds.js의 byte-identical 미러)를 로드해 initApp을 호출한다.
// 로그인 뷰도 krds.js가 SPA 내부에서 렌더하므로 피드/로그인 셸이 동일하다.
function KrdsShell() {
  useEffect(() => {
    const existing = document.getElementById('bai-krds-script') as HTMLScriptElement | null;
    if (existing) {
      if (window.initApp) window.initApp();
      return;
    }
    const script = document.createElement('script');
    script.id = 'bai-krds-script';
    script.src = '/static/krds.js?v=20260713krds1';
    script.onload = () => window.initApp?.();
    document.body.appendChild(script);
  }, []);

  return (
    <>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
      <link rel="stylesheet" href="/static/krds.css?v=20260713krds1" />
      <a className="skip-link" href="#view">본문 바로가기</a>
      <header className="hd" id="header" hidden>
        <div className="hd-util">
          <div className="hd-util-in" id="hdUtil" />
        </div>
        <div className="hd-main">
          <div className="brand">
            <a href="/">BAI 진행 공유</a>
            <span className="svc">주간 기록·질문·프로젝트</span>
          </div>
          <nav className="gnb" id="gnb" aria-label="주 메뉴" />
        </div>
      </header>
      <nav className="crumb-wrap" id="crumbWrap" hidden aria-label="현재 위치">
        <div className="crumb" id="crumb" />
      </nav>
      <main className="main" id="view" tabIndex={-1} />
      <footer className="ft" id="footer" hidden>
        <div className="ft-in">
          <div className="ft-brand">BAI 진행 공유</div>
          <p>매주 한 번, 한 일·배운 것·막힌 점 중 하나만 짧게 남기면 됩니다.<br />
            계정은 운영자가 발급하며, 기록은 로그인한 BAI 멤버에게만 보입니다.</p>
        </div>
      </footer>
    </>
  );
}

export function LegacyFeedShell() {
  return <KrdsShell />;
}

// /login 전용 셸 — krds.js가 미로그인 상태(/api/me 401)에서 로그인 뷰를 렌더한다.
export function LegacyLoginShell() {
  return <KrdsShell />;
}
