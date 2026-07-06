// 1C40 코크핏 — SPA 셸. 사이드바 고정, 내용(#view)만 교체(pushState). 전체 새로고침 없음.

async function requirePI() {
  let me;
  try {
    me = await apiJson("/api/me");
  } catch (_) {
    location.href = "/login";
    return null;
  }
  if (me.role !== "pi") {
    document.body.innerHTML =
      '<div style="max-width:480px;margin:80px auto;text-align:center;font-family:Pretendard,sans-serif">' +
      '<h2>HAI OS는 PI 전용입니다</h2><p><a href="/" style="color:#4F46E5">피드로 돌아가기</a></p></div>';
    return null;
  }
  return me;
}

async function apiJson(url, opts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`${url} ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
      clearTimeout(timer);
    }
  }
}

function esc(s) {
  return (s == null ? "" : String(s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LOAD_LABEL = { light: "여유", ok: "보통", heavy: "빡빡", overload: "과부하", unknown: "미파악" };
function loadBadge(s) { return `<span class="loadbadge load-${esc(s)}">${LOAD_LABEL[s] || esc(s)}</span>`; }

const AVATAR_COLORS = ["#5E6AD2","#0EA5A4","#D97706","#DB2777","#7C3AED","#0891B2","#E11D48","#16A34A","#EA580C","#4F46E5"];
function avatarColor(name) { let h = 0; const s = String(name || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }
function avatar(name, cls) { const ch = String(name || "?").trim().charAt(0) || "?"; return `<span class="avatar ${cls || ""}" style="background:${avatarColor(name)}">${esc(ch)}</span>`; }

function deadlineInfo(d) {
  if (!d) return { cls: "none", txt: "마감 미정" };
  const days = Math.ceil((new Date(d + "T00:00:00") - new Date()) / 86400000);
  if (isNaN(days)) return { cls: "far", txt: esc(d) };
  if (days < 0)   return { cls: "over", txt: `D+${-days} 지남` };
  if (days === 0) return { cls: "soon", txt: "오늘 마감" };
  if (days <= 7)  return { cls: "soon", txt: `D-${days}` };
  if (days <= 21) return { cls: "mid",  txt: `D-${days}` };
  return { cls: "far", txt: `D-${days}` };
}
function daysAgo(ts) {
  if (!ts) return "활동 없음";
  const d = Math.floor((Date.now() - new Date(ts.replace(" ", "T") + "Z")) / 86400000);
  return d <= 0 ? "오늘 활동" : `${d}일 전 활동`;
}

function cockpitNav(active) {
  const tab = (view, label, key) => `<a href="/cockpit${view}" data-view="${key}" class="${active === key ? "navon" : ""}">${label}</a>`;
  return `<aside class="side">
    <div class="brand">🛰 HAI <span class="b">OS</span></div>
    <div class="navsec">운영</div>
    ${tab("", "🎛 Load Review", "load")}
    ${tab("/people", "👥 People", "people")}
    ${tab("/projects", "📁 Projects", "projects")}
    <div class="navsec">이동</div>
    <a href="/" data-full="1">📰 피드</a>
    <a href="http://100.96.96.101:8003/" target="_blank" rel="noopener">🎓 Professor OS</a>
  </aside>`;
}

// ---------------- 뷰: Load Review ----------------
async function renderLoad(view) {
  const rows = (await apiJson("/api/cockpit/load")).filter(r => r.role !== "pi");
  const over = rows.filter(r => r.load_status === "overload").length;
  const heavy = rows.filter(r => r.load_status === "heavy").length;
  const blocked = rows.filter(r => r.latest_blocked).length;
  const tone = over ? "fire" : (heavy ? "warn" : "");
  const pill = over ? "주의 필요" : (heavy ? "주시" : "안정");
  const GROUPS = [
    { keys: ["overload"], label: "과부하 — 즉시 개입", color: "var(--negative)" },
    { keys: ["heavy"], label: "빡빡 — 주시", color: "var(--warning)" },
    { keys: ["ok", "light"], label: "여유·보통", color: "var(--positive)" },
    { keys: ["unknown"], label: "로드 미파악", color: "var(--text-3)" },
  ];
  const rowHtml = r => {
    const projs = (r.projects || []).map(p => esc(p.title)).join(", ");
    const dl = deadlineInfo(r.nearest_deadline);
    return `<div class="lr-row">
      <div class="lr-who">${avatar(r.name)}<div><div class="nm">${esc(r.name)}</div><div class="gr">${esc(r.grade) || "—"}</div></div></div>
      <div>${loadBadge(r.load_status)}</div>
      <div><div class="lr-proj">${projs || "참여 프로젝트 없음"}</div><div class="lr-blocked ${r.latest_blocked ? "" : "none"}">${r.latest_blocked ? "❓ " + esc(r.latest_blocked) : "막힌 점 없음"}</div></div>
      <div class="lr-deadline"><span class="dline ${dl.cls}">${dl.txt}</span><div class="lr-meta">${daysAgo(r.last_post_at)}</div></div>
      <div>${r.next_action ? `<span class="lr-next">▶ ${esc(r.next_action)}</span>` : `<span class="lr-next none">—</span>`}</div>
    </div>`;
  };
  const byKey = {}; rows.forEach(r => (byKey[r.load_status] = byKey[r.load_status] || []).push(r));
  let groups = "";
  for (const g of GROUPS) {
    const m = g.keys.flatMap(k => byKey[k] || []); if (!m.length) continue;
    groups += `<div class="lr-group"><div class="lr-group-head"><span class="gdot" style="background:${g.color}"></span>${g.label}<span class="cnt">${m.length}명</span></div>${m.map(rowHtml).join("")}</div>`;
  }
  view.innerHTML = `
    <div class="mood ${tone}"><span class="mood-pill"><span class="dot"></span>이번 주 · ${pill}</span>
      <div class="mood-line">과부하 <b class="bad">${over}명</b> · 빡빡 <b class="warn">${heavy}명</b> · 막힌 학생 <b class="${blocked?'warn':'ok'}">${blocked}명</b> / 총 ${rows.length}명</div></div>
    <h1>🎛 이번 주 Load Review</h1>
    <p class="hint">학생별 로드·막힌 점·다음 액션. 자동 판정 아니라 PI 판단 보조.</p>
    ${groups || '<div class="empty">학생이 없습니다.</div>'}`;
}

// ---------------- 뷰: People ----------------
let PEOPLE = [];
async function renderPeople(view) {
  PEOPLE = await apiJson("/api/cockpit/load");
  const list = PEOPLE.filter(p => p.role !== "pi");
  const card = p => {
    const chips = (p.projects || []).map(pr => `<span class="chip">📁 ${esc(pr.title)}</span>`).join("");
    return `<div class="pcard">
      <div class="pcard-head">${avatar(p.name)}<div class="who"><div class="nm">${esc(p.name)}</div><div class="sub">${esc(p.grade) || "학년 미정"} · ${esc(p.participation) || "참여유형 미정"}</div></div><div class="right">${loadBadge(p.load_status)}</div></div>
      <p class="goal">🎯 ${esc(p.semester_goal) || "목표 미정"}</p>
      ${chips ? `<div class="row">${chips}</div>` : ""}
      ${p.latest_blocked ? `<p class="blocked">❓ ${esc(p.latest_blocked)}</p>` : ""}
      ${p.next_action ? `<p class="nextaction">▶ ${esc(p.next_action)}</p>` : ""}
      ${p.advisor_memo ? `<p>📝 ${esc(p.advisor_memo)}</p>` : ""}
      <button class="editbtn" data-pe="${p.id}">편집</button></div>`;
  };
  view.innerHTML = `<h1>👥 People</h1><p class="hint">학생 카드. 클릭하면 프로필·로드·PI 메모·다음 액션을 편집.</p>
    <div class="card-grid">${list.length ? list.map(card).join("") : '<div class="empty">학생이 없습니다.</div>'}</div>`;
  view.querySelectorAll(".editbtn[data-pe]").forEach(b => b.onclick = () => openPersonEdit(+b.dataset.pe));
}
function openPersonEdit(mid) {
  const p = PEOPLE.find(x => x.id === mid); if (!p) return;
  f_mid.value = p.id; editname.textContent = p.name + " 프로필";
  f_grade.value = p.grade; f_participation.value = p.participation; f_interests.value = p.interests;
  f_goal.value = p.semester_goal; f_load.value = p.load_status; f_memo.value = p.advisor_memo; f_next.value = p.next_action;
  editdlg.showModal();
}

// ---------------- 뷰: Projects ----------------
let MEMBERS = [], PROJ_MEMBERS = {};
async function renderProjects(view) {
  const [projs, people, members] = await Promise.all([
    apiJson("/api/cockpit/projects"),
    apiJson("/api/cockpit/load"),
    apiJson("/api/cockpit/people"),
  ]);
  MEMBERS = members; PROJ_MEMBERS = {};
  people.forEach(pe => (pe.projects || []).forEach(pr => (PROJ_MEMBERS[pr.id] = PROJ_MEMBERS[pr.id] || []).push(pe.name)));
  const STATUS = { active: ["진행","badge-accent"], paused: ["보류","badge-neutral"], done: ["완료","badge-positive"], dropped: ["중단","badge-neutral"] };
  const RISK = { risk: ["위험","badge-negative"], watch: ["주의","badge-warning"], normal: ["",""] };
  const card = p => {
    const [sl, sc] = STATUS[p.status] || [p.status, "badge-neutral"];
    const [rl, rc] = RISK[p.risk_level] || ["",""];
    const dl = deadlineInfo(p.deadline);
    const chips = (PROJ_MEMBERS[p.id] || []).slice(0, 5).map(n => avatar(n, "sm")).join("");
    return `<div class="pcard proj">
      <div class="pmeta"><span class="badge ${sc}">${sl}</span>${rl ? `<span class="badge ${rc}">${rl}</span>` : ""}<span class="deadline-tag"><span class="dline ${dl.cls}">${dl.txt}</span></span></div>
      <div class="ptitle">${esc(p.title)}</div>
      <p>${esc(p.type) || "유형 미정"} · 🎯 ${esc(p.goal) || "목표 미정"}</p>
      ${p.current_stage ? `<p>현재: ${esc(p.current_stage)}${p.next_milestone ? " → " + esc(p.next_milestone) : ""}</p>` : ""}
      ${p.pi_decision ? `<p class="blocked">⚖ ${esc(p.pi_decision)}</p>` : ""}
      <div class="footer"><div class="member-chips">${chips || '<span style="color:var(--text-3)">멤버 없음</span>'}</div><span style="margin-left:auto">📝 활동 ${p.activity_count}</span><button class="editbtn" data-pr="${p.id}" style="width:auto;margin-top:0;padding:5px 12px">편집</button></div>
    </div>`;
  };
  view.innerHTML = `<div class="head-row"><h1>📁 Projects</h1><button class="btn newbtn" id="newprojbtn">+ 새 프로젝트</button></div>
    <p class="hint">살았나 / 죽어가나 / 밀까 / 접을까. 위험·마감 순.</p>
    <div class="card-grid">${projs.length ? projs.map(card).join("") : '<div class="empty">프로젝트가 없습니다.</div>'}</div>`;
  view.querySelector("#newprojbtn").onclick = () => openProjectEdit(null);
  view.querySelectorAll(".editbtn[data-pr]").forEach(b => b.onclick = () => openProjectEdit(+b.dataset.pr));
}

function memberCheckboxes(selected) {
  const sel = new Map((selected || []).map(m => [m.member_id, m.role]));
  return MEMBERS.filter(m => m.role !== "pi").map(m => `<label style="display:flex;align-items:center;gap:8px;font-size:.84rem;margin:5px 0">
    <input type="checkbox" class="memchk" value="${m.id}" ${sel.has(m.id) ? "checked" : ""}/>${esc(m.name)}
    <input class="memrole" data-id="${m.id}" placeholder="역할" value="${esc(sel.get(m.id) || "")}" style="width:90px;margin-left:auto;padding:4px 8px"/></label>`).join("");
}
async function openProjectEdit(pid) {
  let proj = { status: "active", risk_level: "normal" }, members = [];
  if (pid) { const d = await apiJson(`/api/cockpit/project/${pid}`); proj = d.project; members = d.members; }
  p_id.value = pid || ""; projtitle.textContent = pid ? "프로젝트 편집" : "새 프로젝트";
  p_title.value = proj.title || ""; p_type.value = proj.type || ""; p_status.value = proj.status || "active";
  p_goal.value = proj.goal || ""; p_stage.value = proj.current_stage || ""; p_deadline.value = proj.deadline || "";
  p_milestone.value = proj.next_milestone || ""; p_risk.value = proj.risk_level || "normal"; p_decision.value = proj.pi_decision || "";
  document.getElementById("p_members").innerHTML = memberCheckboxes(members);
  projdlg.showModal();
}

// ---------------- Router ----------------
const ROUTES = {
  "/cockpit": ["load", renderLoad],
  "/cockpit/people": ["people", renderPeople],
  "/cockpit/projects": ["projects", renderProjects],
};
async function route(path, push) {
  const [key, fn] = ROUTES[path] || ROUTES["/cockpit"];
  document.querySelectorAll(".side a[data-view]").forEach(a => a.classList.toggle("navon", a.dataset.view === key));
  if (push) history.pushState({}, "", path);
  try {
    await fn(document.getElementById("view"));
  } catch (err) {
    document.getElementById("view").innerHTML = `<div class="empty">데이터를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.</div>`;
  }
}

async function initCockpit() {
  const me = await requirePI();
  if (!me) return;
  document.getElementById("nav").innerHTML = cockpitNav("load");
  // 사이드바 클릭 → 전체 새로고침 없이 뷰 교체
  document.querySelector(".side").addEventListener("click", e => {
    const a = e.target.closest("a"); if (!a) return;
    if (a.dataset.full) return;        // 피드는 전체 이동 허용
    if (a.dataset.view) { e.preventDefault(); route(new URL(a.href).pathname, true); }
  });
  window.addEventListener("popstate", () => route(location.pathname, false));
  // 다이얼로그 핸들러
  document.getElementById("cancelbtn").onclick = () => editdlg.close();
  document.getElementById("editform").addEventListener("submit", async () => {
    const r = await fetch(`/api/cockpit/people/${+f_mid.value}/profile`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade: f_grade.value, participation: f_participation.value, interests: f_interests.value,
        semester_goal: f_goal.value, load_status: f_load.value, advisor_memo: f_memo.value, next_action: f_next.value }) });
    if (r.ok) route(location.pathname, false); else alert("저장 실패");
  });
  document.getElementById("pcancel").onclick = () => projdlg.close();
  document.getElementById("projform").addEventListener("submit", async () => {
    const mem = [...document.querySelectorAll(".memchk:checked")].map(c => ({ member_id: +c.value, role: document.querySelector(`.memrole[data-id="${c.value}"]`).value }));
    const body = { title: p_title.value, type: p_type.value, status: p_status.value, goal: p_goal.value, current_stage: p_stage.value,
      deadline: p_deadline.value, next_milestone: p_milestone.value, risk_level: p_risk.value, pi_decision: p_decision.value, members: mem };
    const id = p_id.value;
    const r = await fetch(id ? `/api/cockpit/project/${id}` : "/api/cockpit/project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { alert("저장 실패 (제목 확인)"); return; }
    if (!id && mem.length) { const nid = (await r.json()).id; await fetch(`/api/cockpit/project/${nid}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    route(location.pathname, false);
  });
  route(location.pathname, false);
}
