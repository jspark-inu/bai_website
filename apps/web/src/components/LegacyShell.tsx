export function LegacyFeedShell() {
  return (
    <>
      <link rel="stylesheet" href="/static/app.css?v=20260706pi6" />
      <div id="nav" />
      <div className="container" id="view" />
      <script src="/static/feed.js?v=20260706pi6" />
      <script dangerouslySetInnerHTML={{ __html: 'initFeed();' }} />
    </>
  );
}

export function LegacyLoginShell() {
  return (
    <>
      <link rel="stylesheet" href="/static/app.css?v=20260706pi6" />
      <div className="login-box">
        <h1>BAI 피드</h1>
        <div className="login-note">
          <b>계정은 운영자가 발급합니다.</b>
          <span>진행 공유는 로그인한 BAI 멤버에게 보입니다.</span>
          <span>매주 한 번, 한 일·배운 것·막힌 점 중 하나만 짧게 남기면 됩니다.</span>
        </div>
        <input id="name" placeholder="이름" autoComplete="username" />
        <input id="pw" type="password" placeholder="비밀번호" autoComplete="current-password" />
        <button className="primary" id="loginBtn">로그인</button>
        <p id="err" className="err" />
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        document.body.style.display = 'block';
        document.getElementById("loginBtn").onclick = async () => {
          const name = document.getElementById("name").value.trim();
          const password = document.getElementById("pw").value;
          const r = await fetch("/api/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, password })
          });
          if (r.ok) {
            const me = await r.json();
            location.href = (me.role === "pi" || me.role === "professor") ? "/cockpit" : "/";
          } else {
            document.getElementById("err").textContent = "이름 또는 비밀번호가 틀렸습니다.";
          }
        };
        document.getElementById("pw").addEventListener("keydown", e => {
          if (e.key === "Enter") document.getElementById("loginBtn").click();
        });
      ` }} />
    </>
  );
}
