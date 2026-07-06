import Link from 'next/link';

const navItems = [
  ['자료실', '/materials'],
  ['프로젝트', '/projects'],
  ['질문', '/questions'],
  ['멤버', '/members'],
];

export function ModernTopNav() {
  return (
    <header className="modern-nav" data-ui-version="react-modern-v1">
      <Link className="brand" href="/">
        <span className="brand-mark">BAI</span>
        <span>
          <strong>BAI Board</strong>
          <small>AI 연구길드 운영 포털</small>
        </span>
      </Link>
      <nav aria-label="BAI 주요 메뉴">
        {navItems.map(([label, href]) => (
          <Link key={href} href={href}>{label}</Link>
        ))}
      </nav>
      <Link className="nav-cta" href="/login">로그인</Link>
    </header>
  );
}

export function ModernLoginPage() {
  return (
    <main className="modern-page modern-login" data-ui-version="react-modern-v1">
      <ModernTopNav />
      <section className="login-layout" aria-labelledby="login-title">
        <div className="login-copy">
          <span className="eyebrow">Members only</span>
          <h1 id="login-title">BAI 멤버의 진행 공유 공간</h1>
          <p>
            매주 한 번, 한 일·배운 것·막힌 점 중 하나만 남기면 됩니다.
            자료와 질문은 다음 학생이 다시 사용할 수 있는 운영 지식으로 쌓입니다.
          </p>
          <div className="note-card">
            <strong>계정은 운영자가 발급합니다.</strong>
            <span>기존 BAI 계정으로 로그인하면 됩니다.</span>
          </div>
        </div>
        <div className="login-panel">
          <h2>로그인</h2>
          <p className="panel-muted">BAI Board staging · Next.js</p>
          <form className="modern-form" action="/api/auth/login" method="post">
            <label htmlFor="name">이름</label>
            <input id="name" name="name" placeholder="이름" autoComplete="username" />
            <label htmlFor="pw">비밀번호</label>
            <input id="pw" name="password" type="password" placeholder="비밀번호" autoComplete="current-password" />
            <button className="primary-action full" type="submit">로그인</button>
          </form>
          <p id="err" className="err" />
        </div>
      </section>
      <script dangerouslySetInnerHTML={{ __html: `
        const form = document.querySelector('.modern-form');
        form?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const err = document.getElementById('err');
          err.textContent = '';
          const name = document.getElementById('name').value.trim();
          const password = document.getElementById('pw').value;
          const r = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password })
          });
          if (r.ok) {
            const me = await r.json();
            location.href = (me.role === 'pi' || me.role === 'professor') ? '/cockpit' : '/';
          } else if (r.status === 429) {
            err.textContent = '로그인 시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.';
          } else {
            err.textContent = '이름 또는 비밀번호가 틀렸습니다.';
          }
        });
      ` }} />
    </main>
  );
}
