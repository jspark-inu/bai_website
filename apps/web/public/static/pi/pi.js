// 1C41 Professor OS — SPA. 사이드바 고정, #view만 교체(pushState). API/페이로드 원본 보존.
async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
  if (r.status === 401) { location.href = "/login"; return null; }
  if (r.status === 403) { document.body.innerHTML = "<p style='padding:40px;color:#E11D48;font-family:Pretendard,sans-serif'>PI 전용 화면입니다.</p>"; return null; }
  return r.json();
}
function esc(s) { return (s || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

function nav(active) {
  const items = [["dashboard","/pi","🏠 대시보드"],["projects","/pi/projects","📁 내 프로젝트"],["waiting","/pi/waiting","⛔ Waiting on Me"],["commitments","/pi/commitments","🤝 약속"],["ideas","/pi/ideas","💡 아이디어함"],["review","/pi/review","📝 주간 회고"]];
  return '<aside class="side"><div class="brand">🎓 Professor <span class="b">OS</span></div><div class="navsec">운영</div>' +
    items.map(([k,h,t]) => `<a href="${h}" data-view="${k}" class="${k===active?'active':''}">${t}</a>`).join("") +
    '<div class="navsec">이동</div><a href="/cockpit" data-full="1">🛰 HAI OS</a><a href="/" data-full="1">📰 피드</a></aside>';
}

// ---------------- 뷰: 대시보드 ----------------
async function renderDashboard(view) {
  view.innerHTML = `<div class="row" id="stats"></div>
    <div class="card"><h3>⛔ Waiting on Me — 내가 막고 있는 것</h3><div id="waiting"></div></div>
    <div class="card"><h3>🔥 진행 중 프로젝트</h3><div id="projects"></div></div>`;
  const s = await api("/api/pi/dashboard"); if (!s) return;
  document.getElementById("stats").innerHTML =
    `<div class="card stat"><div class="n">${s.project_count}</div><div class="muted">프로젝트</div></div>
     <div class="card stat warn"><div class="n">${s.waiting_on_me_count}</div><div class="muted">내가 병목</div></div>
     <div class="card stat"><div class="n">${s.idea_count}</div><div class="muted">아이디어</div></div>`;
  document.getElementById("waiting").innerHTML = s.waiting_on_me.length
    ? s.waiting_on_me.map(c => `<div>· <b>${esc(c.counterpart)}</b> — ${esc(c.my_role)} <span class="badge ${c.risk==='high'?'high':''}">${c.risk}</span> <span class="muted">${esc(c.next_followup)}</span></div>`).join("")
    : '<div class="muted">없음 — 병목 아님 👍</div>';
  document.getElementById("projects").innerHTML = s.active_projects.length
    ? s.active_projects.map(p => `<div>· <b>${esc(p.title)}</b> <span class="badge">${esc(p.track)}</span> <span class="muted">다음: ${esc(p.next_action)||'—'}</span></div>`).join("")
    : '<div class="muted">없음</div>';
}

// ---------------- 뷰: 내 프로젝트 ----------------
async function renderProjects(view) {
  view.innerHTML = `<div class="card"><h3>+ 새 프로젝트</h3>
    <input id="title" placeholder="프로젝트명 (예: 서비스 실패 GABM 논문)">
    <select id="track"><option>Research</option><option>Teaching</option><option>Collaboration</option><option>Student-Lab</option><option>Learning</option><option>Admin-Career</option></select>
    <input id="next_output" placeholder="다음 산출물 (예: 연구모형 1p)">
    <input id="next_action" placeholder="다음 액션">
    <input id="deadline" placeholder="마감 (YYYY-MM-DD, 선택)">
    <button class="primary" id="add">추가</button></div><div id="list"></div>`;
  const load = async () => {
    const ps = await api("/api/pi/projects"); if (!ps) return;
    document.getElementById("list").innerHTML = ps.map(p => `<div class="card"><h3>${esc(p.title)} <span class="badge">${esc(p.track)}</span></h3>
      <div class="muted">상태 ${esc(p.status)} · 중요도 ${p.importance} · 긴급도 ${p.urgency} ${p.deadline?'· 마감 '+esc(p.deadline):''}</div>
      <div>📦 ${esc(p.next_output)||'—'}　▶ ${esc(p.next_action)||'—'}</div></div>`).join("") || '<div class="muted">없음</div>';
  };
  document.getElementById("add").onclick = async () => {
    const t = document.getElementById("title").value.trim(); if (!t) return;
    await api("/api/pi/projects", { method: "POST", body: JSON.stringify({ title: t, track: track.value, next_output: next_output.value, next_action: next_action.value, deadline: deadline.value }) });
    document.getElementById("title").value = ""; load();
  };
  load();
}

// ---------------- 뷰: Waiting on Me ----------------
async function renderWaiting(view) {
  view.innerHTML = `<div class="card"><h3>⛔ 내가 막고 있는 것 (위험 높은 순)</h3><div class="muted">교수가 바쁠수록 학생·협업자가 멈춘다. 이 화면이 제일 중요할 수 있음.</div></div><div id="list"></div>`;
  const w = await api("/api/pi/waiting"); if (!w) return;
  document.getElementById("list").innerHTML = w.map(c => `<div class="card"><h3>${esc(c.counterpart)} <span class="badge ${c.risk==='high'?'high':''}">${c.risk}</span></h3>
    <div>${esc(c.project)} — ${esc(c.my_role)}</div><div class="muted">다음 확인: ${esc(c.next_followup)||'—'}</div></div>`).join("") || '<div class="muted">없음 — 병목 아님 👍</div>';
}

// ---------------- 뷰: 약속 ----------------
async function renderCommitments(view) {
  view.innerHTML = `<div class="card"><h3>+ 새 약속 (타인과 얽힌 것만)</h3>
    <input id="counterpart" placeholder="상대 (예: 김OO, 박교수, 공모전팀)">
    <input id="project" placeholder="연관 프로젝트">
    <input id="my_role" placeholder="내 역할 (예: 피드백, 3장 집필)">
    <select id="waiting_on"><option value="them">상대를 기다림</option><option value="me">내가 막고 있음</option></select>
    <select id="risk"><option value="low">low</option><option value="med">med</option><option value="high">high</option></select>
    <input id="next_followup" placeholder="다음 확인일 (YYYY-MM-DD)">
    <button class="primary" id="add">추가</button></div><div id="list"></div>`;
  const load = async () => {
    const cs = await api("/api/pi/commitments"); if (!cs) return;
    document.getElementById("list").innerHTML = cs.map(c => `<div class="card"><h3>${esc(c.counterpart)} <span class="badge ${c.risk==='high'?'high':''}">${c.risk}</span> ${c.waiting_on==='me'?'<span class="badge high">내가 병목</span>':''}</h3>
      <div>${esc(c.project)} — ${esc(c.my_role)}</div><div class="muted">${esc(c.next_followup)||'—'} · ${esc(c.status)}</div></div>`).join("") || '<div class="muted">없음</div>';
  };
  document.getElementById("add").onclick = async () => {
    const cp = counterpart.value.trim(); if (!cp) return;
    await api("/api/pi/commitments", { method: "POST", body: JSON.stringify({ counterpart: cp, project: project.value, my_role: my_role.value, waiting_on: waiting_on.value, risk: risk.value, next_followup: next_followup.value }) });
    counterpart.value = ""; load();
  };
  load();
}

// ---------------- 뷰: 아이디어함 ----------------
const STAGES = ["seed","promising","candidate","active","archive"];
async function setMaturity(id, m) { await api(`/api/pi/ideas/${id}/maturity`, { method: "POST", body: JSON.stringify({ maturity: m }) }); _reloadIdeas && _reloadIdeas(); }
let _reloadIdeas = null;
async function renderIdeas(view) {
  view.innerHTML = `<div class="card"><h3>+ 아이디어 (바로 프로젝트화 금지 — seed부터)</h3>
    <input id="title" placeholder="아이디어 한 줄"><input id="source" placeholder="출처/계기"><input id="next_step" placeholder="다음 작은 단계">
    <button class="primary" id="add">담기</button></div><div id="list"></div>`;
  const load = async () => {
    const xs = await api("/api/pi/ideas"); if (!xs) return;
    document.getElementById("list").innerHTML = xs.map(i => `<div class="card"><h3>${esc(i.title)} <span class="badge">${esc(i.maturity)}</span></h3>
      <div class="muted">${esc(i.source)} ${i.next_step?'· ▶ '+esc(i.next_step):''}</div>
      <div style="margin-top:6px">${STAGES.map(s => `<button onclick="setMaturity(${i.id},'${s}')" class="badge" style="cursor:pointer;margin-right:4px">${s}</button>`).join("")}</div></div>`).join("") || '<div class="muted">없음</div>';
  };
  _reloadIdeas = load;
  document.getElementById("add").onclick = async () => {
    const t = title.value.trim(); if (!t) return;
    await api("/api/pi/ideas", { method: "POST", body: JSON.stringify({ title: t, source: source.value, next_step: next_step.value }) });
    title.value = ""; load();
  };
  load();
}

// ---------------- 뷰: 주간 회고 ----------------
async function renderReview(view) {
  view.innerHTML = `<div class="card"><h3>+ 이번 주 회고 (⚠️ '하지 말 것'이 핵심)</h3>
    <input id="week" placeholder="주차 (예: 2026-W23)">
    <label>진전된 것</label><textarea id="progressed"></textarea>
    <label>바빴지만 진전 없던 것</label><textarea id="busy_no_progress"></textarea>
    <label>다음주 반드시</label><textarea id="must_do"></textarea>
    <label>다음주 하지 말 것</label><textarea id="should_not_do"></textarea>
    <label>위임 가능한 것</label><textarea id="delegatable"></textarea>
    <label>연구 방향에 도움된 것</label><textarea id="helped_direction"></textarea>
    <button class="primary" id="add">저장</button></div><div id="list"></div>`;
  const load = async () => {
    const rs = await api("/api/pi/reviews"); if (!rs) return;
    document.getElementById("list").innerHTML = rs.map(r => `<div class="card"><h3>${esc(r.week)}</h3>
      <div>🚫 하지 말 것: <b>${esc(r.should_not_do)||'—'}</b></div>
      <div class="muted">✅ 반드시: ${esc(r.must_do)||'—'} · 위임: ${esc(r.delegatable)||'—'}</div></div>`).join("") || '<div class="muted">없음</div>';
  };
  document.getElementById("add").onclick = async () => {
    const w = week.value.trim(); if (!w) return;
    await api("/api/pi/reviews", { method: "POST", body: JSON.stringify({ week: w, progressed: progressed.value, busy_no_progress: busy_no_progress.value, must_do: must_do.value, should_not_do: should_not_do.value, delegatable: delegatable.value, helped_direction: helped_direction.value }) });
    week.value = ""; load();
  };
  load();
}

// ---------------- 라우터 ----------------
const PI_ROUTES = { "/pi": ["dashboard", renderDashboard], "/pi/projects": ["projects", renderProjects], "/pi/waiting": ["waiting", renderWaiting], "/pi/commitments": ["commitments", renderCommitments], "/pi/ideas": ["ideas", renderIdeas], "/pi/review": ["review", renderReview] };
async function route(path, push) {
  const [key, fn] = PI_ROUTES[path] || PI_ROUTES["/pi"];
  document.querySelectorAll(".side a[data-view]").forEach(a => a.classList.toggle("active", a.dataset.view === key));
  if (push) history.pushState({}, "", path);
  await fn(document.getElementById("view"));
}
function initPI() {
  document.getElementById("nav").innerHTML = nav("dashboard");
  document.querySelector(".side").addEventListener("click", e => {
    const a = e.target.closest("a"); if (!a) return;
    if (a.dataset.full) return;
    if (a.dataset.view) { e.preventDefault(); route(new URL(a.href).pathname, true); }
  });
  window.addEventListener("popstate", () => route(location.pathname, false));
  route(location.pathname, false);
}
