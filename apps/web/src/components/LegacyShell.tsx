"use client";

import { useEffect } from 'react';

declare global {
  interface Window { initApp?: () => void }
}

const ASSET_VERSION = '20260713krds2';

// frontend/krds.html의 DOM 계약을 마운트하고 승인 렌더러의 byte-identical
// 미러를 로드한다. 로그인 뷰도 krds.js가 같은 셸 안에서 렌더한다.
function ApprovedKrdsShell() {
  useEffect(() => {
    const existing = document.getElementById('bai-krds-script') as HTMLScriptElement | null;
    if (existing) {
      window.initApp?.();
      return;
    }

    const script = document.createElement('script');
    script.id = 'bai-krds-script';
    script.src = `/static/krds.js?v=${ASSET_VERSION}`;
    script.onload = () => window.initApp?.();
    document.body.appendChild(script);
  }, []);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
      />
      <link rel="stylesheet" href={`/static/krds.css?v=${ASSET_VERSION}`} />

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
          <p>
            매주 한 번, 한 일·배운 것·막힌 점 중 하나만 짧게 남기면 됩니다.<br />
            계정은 운영자가 발급하며, 기록은 로그인한 BAI 멤버에게만 보입니다.
          </p>
        </div>
      </footer>
    </>
  );
}

export function LegacyFeedShell() {
  return <ApprovedKrdsShell />;
}

export function LegacyLoginShell() {
  return <ApprovedKrdsShell />;
}
