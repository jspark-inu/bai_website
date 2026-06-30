// 1C38 BAI 피드 — SPA. 사이드바 고정, #view만 교체(pushState). API/페이로드 원본 보존.
async function getMe() {
  const r = await fetch("/api/me");
  if (!r.ok) { location.href = "/login"; return null; }
  return r.json();
}
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

const AV_COLORS = ["#5E6AD2","#0EA5A4","#D97706","#DB2777","#7C3AED","#0891B2","#E11D48","#16A34A","#EA580C","#4F46E5"];
function avColor(n){let h=0;const s=String(n||"");for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return AV_COLORS[h%AV_COLORS.length];}
function avatar(name){const ch=String(name||"?").trim().charAt(0)||"?";return `<span class="av" style="background:${avColor(name)}">${esc(ch)}</span>`;}
function fmtDate(s){return s ? esc(String(s).slice(0,10)) : "";}

function feedSidebar(active, isPI) {
  const tab = (href, label, key) => `<a href="${href}" data-view="${key}" class="${active === key ? "on" : ""}">${label}</a>`;
  const admin = isPI ? `${tab("/admin/members", "🛡 멤버 관리", "admin")}` : "";
  const move = isPI ? '<div class="navsec">이동</div><a href="https://os.bai.haiinu.com/" target="_blank" rel="noopener">🛰 PI OS</a>' : "";
  return `<aside class="side"><div class="brand">📰 BAI <span class="b">Feed</span></div>
    <div class="navsec">피드</div>
    ${tab("/", "🏠 전체 피드", "home")}${tab("/projects", "🧩 프로젝트", "projects")}${tab("/materials", "📚 자료실", "materials")}${tab("/questions", "❓ 막힌 질문", "questions")}${tab("/ask", "💬 문의/FAQ", "ask")}${tab("/members", "👥 멤버", "members")}${tab("/search", "🔍 검색", "search")}
    <div class="navsec">개발</div>${tab("/account?goodbai=1", "🔑 Goodbai API", "developer")}${admin}${tab("/account", "🔐 계정", "account")}
    ${move}</aside>`;
}
function tagChips(tags) {
  if (!tags) return "";
  return tags.split(/[,\s]+/).filter(Boolean).map(t => `<a class="tag" href="/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join(" ");
}
function linkChips(links) {
  if (!links) return "";
  const items = links.split(/[\s,]+/).filter(u => /^https?:\/\//i.test(u))
    .map(u => `<a class="linkchip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(u.replace(/^https?:\/\//, "").slice(0, 40))}</a>`).join(" ");
  return items ? `<div class="sec"><div class="label">📎 산출물</div><div class="body">${items}</div></div>` : "";
}
function sectionsHtml(p) {
  let h = "";
  if (p.did)     h += `<div class="sec"><div class="label">한 일</div><div class="body">${esc(p.did)}</div></div>`;
  if (p.learned) h += `<div class="sec"><div class="label">배운 것</div><div class="body">${esc(p.learned)}</div></div>`;
  if (p.blocked) h += `<div class="sec blocked"><span class="label">❓ 막힌 점</span><span class="body">${esc(p.blocked)}</span></div>`;
  h += linkChips(p.links);
  return h;
}
function projectOptions(projects, selected) {
  const opts = (projects || []).map(p => `<option value="${p.id}" ${String(selected || "") === String(p.id) ? "selected" : ""}>${esc(p.title)}</option>`).join("");
  return `<select class="tags" id="project_id"><option value="">프로젝트 연결 안 함</option>${opts}</select>`;
}
function cardHtml(p, me) {
  const editable = me && p.author_id === me.id;
  return `<div class="card" data-id="${p.id}"><div class="head">
      ${avatar(p.author_name)}<a class="author" href="/member/${p.author_id}">${esc(p.author_name)}</a>
      <span>· ${fmtDate(p.created_at)}</span>${p.source === "skill" ? "<span>· 스킬</span>" : ""}
      ${p.project_title ? `<span class="projbadge">📁 ${esc(p.project_title)}</span>` : ""}${tagChips(p.tags)}
      <span class="spacer"></span>${editable ? `<a href="/post/${p.id}">수정</a>` : ""}</div>
      ${sectionsHtml(p)}
      <div class="actions"><button class="reactBtn" data-id="${p.id}">👍 <span class="rc">${p.reaction_count}</span></button>
      <a href="/post/${p.id}">💬 댓글 ${p.comment_count}</a></div></div>`;
}
async function toggleReact(pid, btn) {
  const r = await fetch(`/api/post/${pid}/react`, { method: "POST" });
  if (r.ok) { const d = await r.json(); btn.querySelector(".rc").textContent = d.reaction_count; btn.classList.toggle("reacted"); }
}
function wireReacts(root) { (root || document).querySelectorAll(".reactBtn").forEach(b => b.onclick = () => toggleReact(b.dataset.id, b)); }

let FEED_ME = null;
let FEED_PROJECTS = [];

// ---------------- 뷰: 홈 ----------------
async function renderHome(view) {
  view.innerHTML = `<div class="home"><div class="feed">
    <div class="bar"><div><h1>전체 피드</h1><p class="subhead">이번 주 진행, 배운 점, 막힌 질문을 한 곳에 모읍니다.</p></div><button class="writebtn" id="newBtn">글쓰기</button></div>
    <div class="summary" id="summary"></div>
    <div class="editor hidden" id="editor">
      <div class="editor-head"><b>오늘의 진행 공유</b><span>짧아도 됩니다. 막힌 점을 쓰면 질문 보드에 올라갑니다.</span></div>
      <label>한 일/결과</label><textarea id="did" placeholder="예: 베이스라인 정확도 0.81 확보, 데이터 300건 정제"></textarea><label>배운 것</label><textarea id="learned" placeholder="예: 단순 모델 기준선이 생각보다 강했다"></textarea>
      <label>막힌 점/질문</label><textarea id="blocked" placeholder="예: 라벨 기준을 어떻게 잡을지 고민됩니다"></textarea>
      ${projectOptions(FEED_PROJECTS)}<input class="tags" id="tags" placeholder="태그 (예: 논문 실험 NLP)"><input class="tags" id="links" placeholder="산출물 링크 (GitHub·데모, 공백 구분)">
      <div class="editor-actions"><p class="err" id="postErr"></p><button class="primary" id="submitBtn" style="margin-left:0">올리기</button></div></div>
    <div class="filters" id="filters"><button data-f="all" class="active">전체</button><button data-f="mine">내 글</button><button data-f="blocked">막힌 질문 ❓</button></div>
    <div id="feedlist"></div></div><div class="rail" id="rail"></div></div>`;
  const ALL = await (await fetch("/api/feed")).json();
  const q = await fetch("/api/questions").then(r => r.ok ? r.json() : null).catch(() => null);
  const w = await fetch("/api/weekly").then(r => r.ok ? r.json() : null).catch(() => null);
  const mine = ALL.filter(p => p.author_id === FEED_ME.id).length;
  document.getElementById("summary").innerHTML = `<div><span class="k">이번 주 보고</span><b>${w ? `${w.reported_count}/${w.total}` : "-"}</b></div>
    <div><span class="k">내 기록</span><b>${mine}</b></div><div><span class="k">답 기다림</span><b>${q ? q.posts.length : "-"}</b></div>`;
  if (mine === 0) {
    document.getElementById("summary").insertAdjacentHTML("afterend",
      `<button class="first-cta" id="firstPostCta">첫 진행 공유를 남겨보세요</button>`);
    document.getElementById("firstPostCta").onclick = () => {
      document.getElementById("editor").classList.remove("hidden");
      document.getElementById("did").focus();
    };
  }
  let FILTER = "all";
  const draw = () => {
    let list = ALL;
    if (FILTER === "mine") list = ALL.filter(p => p.author_id === FEED_ME.id);
    else if (FILTER === "blocked") list = ALL.filter(p => p.blocked);
    document.getElementById("feedlist").innerHTML = list.length ? list.map(p => cardHtml(p, FEED_ME)).join("") : '<div class="empty-card">조건에 맞는 글이 없습니다.</div>';
    wireReacts(document.getElementById("feedlist"));
  };
  draw();
  document.getElementById("newBtn").onclick = () => {
    document.getElementById("editor").classList.toggle("hidden");
    if (!document.getElementById("editor").classList.contains("hidden")) document.getElementById("did").focus();
  };
  document.getElementById("submitBtn").onclick = async () => {
    const payload = { did: did.value.trim(), learned: learned.value.trim(), blocked: blocked.value.trim(), tags: tags.value.trim(), links: links.value.trim(), project_id: project_id.value };
    const err = document.getElementById("postErr");
    err.textContent = "";
    if (!payload.did && !payload.learned && !payload.blocked) { err.textContent = "한 일, 배운 것, 막힌 점 중 하나는 입력해야 합니다."; return; }
    const r = await fetch("/api/web/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) navigate("/");
    else err.textContent = "저장하지 못했습니다. 잠시 후 다시 시도하세요.";
  };
  document.querySelectorAll("#filters button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#filters button").forEach(x => x.classList.remove("active")); b.classList.add("active"); FILTER = b.dataset.f; draw();
  });
  // 우측 레일
  let html = "";
  if (w && w.total) {
    const miss = w.missing.map(m => `<a class="miss" href="/member/${m.id}">${esc(m.name)}</a>`).join(" ");
    html += `<div class="w"><h3>📋 이번 주 보고</h3><div class="statbig"><span class="n">${w.reported_count}</span><span class="of">/ ${w.total}명</span></div>
      <div style="margin-top:6px">${w.missing.length ? '<span class="muted" style="font-size:.76rem">미보고</span><br>' + miss : '<span class="muted" style="font-size:.8rem">🎉 전원 보고</span>'}</div></div>`;
  }
  const qs = (q && q.posts || []).slice(0, 4);
  if (qs.length) html += `<div class="w"><h3>❓ 미해결 질문</h3>` + qs.map(p => `<div class="it"><a href="/post/${p.id}" style="text-decoration:none"><b>${esc((p.blocked || "").slice(0, 28))}</b></a><br><span class="muted">${esc(p.author_name)}</span></div>`).join("") + `</div>`;
  const counts = {};
  ALL.forEach(p => (p.tags || "").split(/[,\s]+/).filter(Boolean).forEach(t => counts[t] = (counts[t] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) html += `<div class="w"><h3>🔥 인기 태그</h3><div class="tc">` + top.map(([t]) => `<a href="/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join("") + `</div></div>`;
  document.getElementById("rail").innerHTML = html;
}

// ---------------- 뷰: 글 상세 ----------------
async function renderPostDetail(view, pid) {
  view.innerHTML = `<div class="content"><div id="detail"></div>
    <div class="editor hidden" id="editor"><label>📌 한 일/결과</label><textarea id="did"></textarea><label>💡 배운 것</label><textarea id="learned"></textarea>
    <label>❓ 막힌 점/질문</label><textarea id="blocked"></textarea>${projectOptions(FEED_PROJECTS)}<input class="tags" id="tags" placeholder="태그"><input class="tags" id="links" placeholder="산출물 링크 (공백 구분)">
    <button class="primary" id="saveBtn" style="margin-left:0">저장</button></div>
    <div class="comments" id="comments"></div><div class="comment-input"><input id="cbody" placeholder="댓글 달기..."><button class="primary" id="cbtn" style="margin-left:0">등록</button></div></div>`;
  const r = await fetch(`/api/post/${pid}`);
  if (!r.ok) { document.getElementById("detail").textContent = "글을 찾을 수 없습니다."; return; }
  const data = await r.json(); const POST = data.post;
  const reacted = (data.reacted_by || []).includes(FEED_ME.id);
  document.getElementById("detail").innerHTML = `<div class="card"><div class="head">${avatar(POST.author_name)}<a class="author" href="/member/${POST.author_id}">${esc(POST.author_name)}</a>
    <span>· ${fmtDate(POST.created_at)}</span>${POST.project_title ? `<span class="projbadge">📁 ${esc(POST.project_title)}</span>` : ""}${tagChips(POST.tags)}<span class="spacer"></span>${POST.author_id === FEED_ME.id ? '<button id="editBtn">수정</button>' : ''}</div>
    ${sectionsHtml(POST)}<div class="actions"><button class="reactBtn ${reacted ? 'reacted' : ''}" data-id="${pid}">👍 <span class="rc">${POST.reaction_count}</span></button></div></div>`;
  document.querySelector(".reactBtn").onclick = e => toggleReact(pid, e.currentTarget);
  document.getElementById("comments").innerHTML = data.comments.map(c => `<div class="comment"><span class="who">${esc(c.author_name)}</span>: ${esc(c.body)}</div>`).join("");
  if (POST.author_id === FEED_ME.id) document.getElementById("editBtn").onclick = () => {
    const e = document.getElementById("editor");
    did.value = POST.did; learned.value = POST.learned; blocked.value = POST.blocked; tags.value = POST.tags; links.value = POST.links || ""; project_id.value = POST.project_id || "";
    e.classList.remove("hidden");
  };
  document.getElementById("saveBtn").onclick = async () => {
    const rr = await fetch(`/api/post/${pid}/edit`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ did: did.value.trim(), learned: learned.value.trim(), blocked: blocked.value.trim(), tags: tags.value.trim(), links: links.value.trim(), project_id: project_id.value }) });
    if (rr.ok) route(`/post/${pid}`, false); else alert("수정 실패");
  };
  const sendC = async () => { const body = cbody.value.trim(); if (!body) return;
    const rr = await fetch(`/api/post/${pid}/comment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
    if (rr.ok) route(`/post/${pid}`, false); };
  document.getElementById("cbtn").onclick = sendC;
  document.getElementById("cbody").addEventListener("keydown", e => { if (e.key === "Enter") sendC(); });
}

// ---------------- 뷰: 멤버 프로필 ----------------
async function renderMemberProfile(view, mid) {
  view.innerHTML = `<div class="content"><div id="profile"></div><div class="journey-label">📜 진행 여정 (처음 → 최근)</div><div id="journey"></div></div>`;
  const r = await fetch(`/api/member/${mid}`);
  if (!r.ok) { document.getElementById("profile").textContent = "멤버를 찾을 수 없습니다."; return; }
  const d = await r.json();
  const tags = Object.entries(d.tag_counts || {}).map(([t, n]) => `<a class="tag" href="/tag/${encodeURIComponent(t)}">${esc(t)} ${n}</a>`).join(" ");
  const span = d.first_post_at ? `${esc(d.first_post_at.slice(0,10))} ~ ${esc(d.last_post_at.slice(0,10))}` : "아직 글 없음";
  document.getElementById("profile").innerHTML = `<div class="profile-head"><div style="display:flex;align-items:center;gap:12px">${avatar(d.member.name)}<div><h2 style="margin:0">${esc(d.member.name)}${d.member.role === "pi" ? " 🎓" : ""}</h2><div class="meta">글 ${d.post_count}개 · ${span}</div></div></div><div class="tags" style="margin-top:12px">${tags}</div></div>`;
  document.getElementById("journey").innerHTML = d.posts.length ? d.posts.map(p => cardHtml(p, FEED_ME)).join("") : '<p class="muted">아직 올린 글이 없어요.</p>';
  wireReacts(document.getElementById("journey"));
}

// ---------------- 뷰: 멤버 목록 ----------------
async function renderMembers(view) {
  view.innerHTML = `<div class="content"><h2 class="page-title">👥 멤버</h2><div class="member-grid" id="grid"></div></div>`;
  const rows = await (await fetch("/api/members")).json();
  document.getElementById("grid").innerHTML = rows.map(m => {
    const last = m.last_post_at ? ("최근 " + m.last_post_at.slice(0, 10)) : "아직 글 없음";
    return `<a class="member-card" href="/member/${m.id}"><div class="name" style="display:flex;align-items:center;gap:8px">${avatar(m.name)}${esc(m.name)}${m.role === "pi" ? " 🎓" : ""}</div><div class="stat">글 ${m.post_count}개 · ${esc(last)}</div></a>`;
  }).join("");
}

// ---------------- 뷰: 자료실 ----------------
async function renderMaterials(view) {
  view.innerHTML = `<div class="content">
    <div class="bar"><div><h1>자료실</h1><p class="subhead">BAI 온보딩과 길드별 활동 자료를 모읍니다.</p></div><button class="writebtn" id="newMaterialBtn">자료 올리기</button></div>
    <div class="editor hidden" id="materialEditor">
      <div class="editor-head"><b id="materialFormTitle">자료 올리기</b><span>링크만 올리거나 본문과 함께 정리할 수 있습니다.</span></div>
      <input type="hidden" id="materialId">
      <label>제목</label><input class="tags" id="materialTitle" placeholder="예: BAI 첫 참여 안내">
      <label>분류</label><select class="tags" id="materialCategory"><option>온보딩</option><option>길드</option><option>공지</option><option>자료</option></select>
      <label>길드/대상</label><input class="tags" id="materialGuild" placeholder="예: 공통, 웹, AI, 데이터">
      <label>링크</label><input class="tags" id="materialUrl" placeholder="https://...">
      <label>본문</label><textarea id="materialBody" placeholder="요약, 사용법, 준비물 등을 적어주세요."></textarea>
      <div class="editor-actions"><p class="err" id="materialErr"></p><button class="primary" id="saveMaterialBtn" style="margin-left:0">저장</button></div>
    </div>
    <div class="filters" id="materialFilters"><button data-category="" class="active">전체</button><button data-category="온보딩">온보딩</button><button data-category="길드">길드</button><button data-category="공지">공지</button><button data-category="자료">자료</button></div>
    <div id="materialList"></div>
  </div>`;
  let category = "";
  const resetForm = () => {
    materialId.value = ""; materialTitle.value = ""; materialCategory.value = "온보딩";
    materialGuild.value = ""; materialUrl.value = ""; materialBody.value = ""; materialErr.textContent = "";
    materialFormTitle.textContent = "자료 올리기";
  };
  const openForm = material => {
    resetForm();
    if (material) {
      materialId.value = material.id;
      materialTitle.value = material.title || "";
      materialCategory.value = material.category || "자료";
      materialGuild.value = material.guild || "";
      materialUrl.value = material.url || "";
      materialBody.value = material.body || "";
      materialFormTitle.textContent = "자료 수정";
    }
    materialEditor.classList.remove("hidden");
    materialTitle.focus();
  };
  const materialCard = m => {
    const canEdit = FEED_ME.role === "pi" || m.author_id === FEED_ME.id;
    const meta = [m.category, m.guild, m.author_name, fmtDate(m.created_at)].filter(Boolean).join(" · ");
    return `<div class="card material-card" data-material="${m.id}">
      <div class="head">${avatar(m.author_name)}<span class="author">${esc(m.title)}</span><span>· ${esc(meta)}</span><span class="spacer"></span>${canEdit ? `<button data-edit-material="${m.id}">수정</button><button data-delete-material="${m.id}">삭제</button>` : ""}</div>
      ${m.url ? `<div class="sec"><div class="label">링크</div><div class="body"><a class="linkchip" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(m.url)}</a></div></div>` : ""}
      ${m.body ? `<div class="sec"><div class="label">본문</div><div class="body">${esc(m.body)}</div></div>` : ""}
    </div>`;
  };
  const load = async () => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    const r = await fetch(`/api/materials${qs}`);
    const data = await r.json();
    const materials = data.materials || [];
    materialList.innerHTML = materials.length ? materials.map(materialCard).join("") : '<div class="empty-card">아직 올라온 자료가 없습니다.</div>';
    materialList.querySelectorAll("[data-edit-material]").forEach(b => b.onclick = () => openForm(materials.find(m => String(m.id) === String(b.dataset.editMaterial))));
    materialList.querySelectorAll("[data-delete-material]").forEach(b => b.onclick = async () => {
      if (!confirm("이 자료를 삭제할까요?")) return;
      const r = await fetch(`/api/materials/${b.dataset.deleteMaterial}`, { method: "DELETE" });
      if (r.ok) load(); else alert("삭제 실패");
    });
  };
  newMaterialBtn.onclick = () => openForm(null);
  saveMaterialBtn.onclick = async () => {
    const payload = {
      title: materialTitle.value.trim(),
      category: materialCategory.value,
      guild: materialGuild.value.trim(),
      url: materialUrl.value.trim(),
      body: materialBody.value.trim(),
    };
    materialErr.textContent = "";
    if (!payload.title || (!payload.url && !payload.body)) { materialErr.textContent = "제목과 링크 또는 본문을 입력해야 합니다."; return; }
    const id = materialId.value;
    const r = await fetch(id ? `/api/materials/${id}` : "/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) { materialEditor.classList.add("hidden"); resetForm(); load(); }
    else materialErr.textContent = "저장 실패. 잠시 후 다시 시도하세요.";
  };
  document.querySelectorAll("#materialFilters button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#materialFilters button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); category = b.dataset.category || ""; load();
  });
  await load();
}

// ---------------- 뷰: 프로젝트 ----------------
async function renderProjects(view) {
  view.innerHTML = `<div class="content">
    <div class="bar"><div><h1>프로젝트</h1><p class="subhead">길드별 결과물, 외부 페이지, repo를 BAI 자산으로 연결합니다.</p></div><button class="writebtn" id="newProjectBtn">프로젝트 만들기</button></div>
    <div class="editor hidden" id="projectEditor">
      <div class="editor-head"><b>프로젝트 만들기</b><span>학생들이 만든 페이지는 링크로 연결하고, 나중에 macmini2 배포로 옮길 수 있습니다.</span></div>
      <label>프로젝트명</label><input class="tags" id="projectTitle" placeholder="예: 웹 길드 포트폴리오">
      <label>슬러그</label><input class="tags" id="projectSlug" placeholder="예: web-guild-2026">
      <label>길드</label><input class="tags" id="projectType" placeholder="예: 웹, AI, 데이터">
      <label>요약</label><textarea id="projectSummary" placeholder="프로젝트 목표와 결과물을 설명해 주세요."></textarea>
      <label>Repo URL</label><input class="tags" id="projectRepoUrl" placeholder="https://github.com/...">
      <label>Site URL</label><input class="tags" id="projectSiteUrl" placeholder="https://...">
      <div class="editor-actions"><p class="err" id="projectErr"></p><button class="primary" id="saveProjectBtn" style="margin-left:0">저장</button></div>
    </div>
    <div id="projectList"></div>
  </div>`;
  const draw = async () => {
    const rows = await (await fetch("/api/projects")).json();
    projectList.innerHTML = rows.length ? rows.map(p => {
      const meta = [p.type, p.status, p.member_count ? `멤버 ${p.member_count}` : ""].filter(Boolean).join(" · ");
      return `<a class="card project-card" href="/projects/${p.id}" style="display:block;text-decoration:none;color:inherit">
        <div class="head"><span class="author">${esc(p.title)}</span><span>· ${esc(meta)}</span></div>
        ${p.summary || p.goal ? `<div class="sec"><div class="label">요약</div><div class="body">${esc(p.summary || p.goal)}</div></div>` : ""}
        ${p.site_url ? `<div class="sec"><div class="label">사이트</div><div class="body">${esc(p.site_url)}</div></div>` : ""}
      </a>`;
    }).join("") : '<div class="empty-card">아직 등록된 프로젝트가 없습니다.</div>';
  };
  newProjectBtn.onclick = () => { projectEditor.classList.toggle("hidden"); projectTitle.focus(); };
  saveProjectBtn.onclick = async () => {
    const payload = {
      title: projectTitle.value.trim(),
      slug: projectSlug.value.trim(),
      type: projectType.value.trim(),
      summary: projectSummary.value.trim(),
      repo_url: projectRepoUrl.value.trim(),
      site_url: projectSiteUrl.value.trim(),
      members: [{ member_id: FEED_ME.id, role: "리드" }],
    };
    projectErr.textContent = "";
    if (!payload.title || (!payload.summary && !payload.repo_url && !payload.site_url)) {
      projectErr.textContent = "프로젝트명과 요약 또는 링크를 입력해야 합니다.";
      return;
    }
    const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) {
      const data = await r.json();
      navigate(`/projects/${data.id}`);
    } else projectErr.textContent = "저장 실패. 잠시 후 다시 시도하세요.";
  };
  await draw();
}

async function renderProjectDetail(view, pid) {
  view.innerHTML = `<div class="content"><div id="projectDetail"></div><div class="journey-label">📜 연결된 활동</div><div id="projectActivity"></div></div>`;
  const r = await fetch(`/api/projects/${pid}`);
  if (!r.ok) { projectDetail.innerHTML = '<div class="empty-card">프로젝트를 찾을 수 없습니다.</div>'; return; }
  const data = await r.json();
  const p = data.project;
  const links = [
    p.site_url ? `<a class="linkchip" href="${esc(p.site_url)}" target="_blank" rel="noopener noreferrer">사이트</a>` : "",
    p.repo_url ? `<a class="linkchip" href="${esc(p.repo_url)}" target="_blank" rel="noopener noreferrer">repo_url</a>` : "",
  ].filter(Boolean).join(" ");
  projectDetail.innerHTML = `<div class="profile-head">
    <h2>${esc(p.title)}</h2>
    <div class="meta">${esc([p.type, p.status, p.slug].filter(Boolean).join(" · "))}</div>
    ${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
    <div style="margin-top:10px">${links}</div>
    <div class="tags" style="margin-top:12px">${(data.members || []).map(m => `<a class="tag" href="/member/${m.member_id}">${esc(m.name)} ${esc(m.role || "")}</a>`).join(" ")}</div>
  </div>`;
  projectActivity.innerHTML = data.activity.length ? data.activity.map(post => cardHtml(post, FEED_ME)).join("") : '<p class="muted">아직 연결된 활동 글이 없습니다.</p>';
  wireReacts(projectActivity);
}

// ---------------- 뷰: 검색 ----------------
async function renderSearch(view) {
  view.innerHTML = `<div class="content"><div class="searchbar"><input id="q" placeholder="검색어 (예: 검증셋 누수, GAN)"><button class="primary" id="btn" style="margin-left:0">검색</button></div><h2 class="page-title muted" id="title"></h2><div id="feedlist"></div></div>`;
  const run = async () => {
    const q = document.getElementById("q").value.trim(); if (!q) return;
    history.replaceState({}, "", "/search?q=" + encodeURIComponent(q));
    const d = await (await fetch("/api/search?q=" + encodeURIComponent(q))).json();
    document.getElementById("title").textContent = `"${q}" 결과 ${d.posts.length}건`;
    document.getElementById("feedlist").innerHTML = d.posts.length ? d.posts.map(p => cardHtml(p, FEED_ME)).join("") : '<p class="muted">결과가 없어요.</p>';
    wireReacts(document.getElementById("feedlist"));
  };
  document.getElementById("btn").onclick = run;
  document.getElementById("q").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  const q0 = new URLSearchParams(location.search).get("q");
  if (q0) { document.getElementById("q").value = q0; run(); }
}

// ---------------- 뷰: 미해결 질문 ----------------
async function renderQuestions(view) {
  view.innerHTML = `<div class="content"><h2 class="page-title">❓ 아직 답 없는 질문</h2><p class="muted" style="margin-top:-8px">막혔는데 아직 댓글이 없는 글이에요. 아는 게 있으면 답을 달아주세요.</p><div id="feedlist"></div></div>`;
  const d = await (await fetch("/api/questions")).json();
  document.getElementById("feedlist").innerHTML = d.posts.length ? d.posts.map(p => cardHtml(p, FEED_ME)).join("") : '<p class="muted">🎉 미해결 질문이 없어요!</p>';
  wireReacts(document.getElementById("feedlist"));
}

// ---------------- 뷰: 문의/FAQ ----------------
async function renderAsk(view) {
  view.innerHTML = `<div class="content">
    <h2 class="page-title">💬 운영 문의</h2>
    <p class="muted" style="margin-top:-8px">모임 운영에 대해 궁금한 걸 물어보세요. 답변되면 아래 FAQ에 쌓여서 모두가 볼 수 있어요.</p>
    <div class="editor"><label>❓ 질문</label><textarea id="iq" placeholder="예: 길드는 어떻게 정해지나요?"></textarea>
      <button class="primary" id="iqBtn" style="margin-left:0">질문 보내기</button><span class="muted" id="iqMsg" style="margin-left:10px"></span></div>
    <div class="journey-label">📌 자주 묻는 질문 (답변됨)</div><div id="faq"></div>
    <div class="journey-label">⏳ 답변 대기</div><div id="openq"></div></div>`;
  const draw = async () => {
    const d = await (await fetch("/api/inquiries")).json();
    document.getElementById("faq").innerHTML = d.answered.length ? d.answered.map(i =>
      `<div class="card"><div class="sec"><div class="label">❓ ${esc(i.author_name)} · ${fmtDate(i.created_at)}</div><div class="body"><b>${esc(i.question)}</b></div></div>
       <div class="sec"><div class="label">💬 ${esc(i.answerer_name || "")} 답변</div><div class="body">${esc(i.answer)}</div></div></div>`).join("")
      : '<p class="muted">아직 답변된 질문이 없어요.</p>';
    const isPI = FEED_ME.role === "pi";
    document.getElementById("openq").innerHTML = d.open.length ? d.open.map(i =>
      `<div class="card"><div class="sec"><div class="label">❓ ${esc(i.author_name)} · ${fmtDate(i.created_at)}</div><div class="body"><b>${esc(i.question)}</b></div></div>
       ${isPI ? `<div class="comment-input"><input id="ans-${i.id}" placeholder="답변 작성..."><button class="primary" data-iid="${i.id}" style="margin-left:0">답변</button></div>` : ""}</div>`).join("")
      : '<p class="muted">🎉 대기 중인 질문이 없어요.</p>';
    if (isPI) document.querySelectorAll("#openq button[data-iid]").forEach(b => b.onclick = async () => {
      const ans = document.getElementById("ans-" + b.dataset.iid).value.trim();
      if (!ans) return;
      const r = await fetch(`/api/inquiries/${b.dataset.iid}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: ans }) });
      if (r.ok) draw(); else alert("답변 저장 실패");
    });
  };
  document.getElementById("iqBtn").onclick = async () => {
    const q = document.getElementById("iq").value.trim();
    const msg = document.getElementById("iqMsg");
    if (!q) { msg.textContent = "질문을 입력해 주세요."; return; }
    const r = await fetch("/api/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
    if (r.ok) { document.getElementById("iq").value = ""; msg.textContent = "접수됐어요! 답변되면 FAQ에 올라와요."; draw(); }
    else msg.textContent = "전송 실패. 잠시 후 다시 시도해 주세요.";
  };
  await draw();
}

// ---------------- 뷰: 태그 ----------------
async function renderTag(view, tag) {
  view.innerHTML = `<div class="content"><h2 class="page-title">#${esc(tag)}</h2><div id="feedlist"></div></div>`;
  const d = await (await fetch(`/api/tag/${encodeURIComponent(tag)}`)).json();
  document.getElementById("feedlist").innerHTML = d.posts.length ? d.posts.map(p => cardHtml(p, FEED_ME)).join("") : '<p class="muted">이 태그의 글이 아직 없어요.</p>';
  wireReacts(document.getElementById("feedlist"));
}

// ---------------- 뷰: 개발자 API ----------------
async function renderDeveloper(view) {
  view.innerHTML = `<div class="content">
    <h2 class="page-title">🔑 개발자 API</h2>
    <p class="muted" style="margin-top:-8px">Codex /goodbai 또는 개인 스크립트가 BAI 피드에 글을 올릴 때 쓰는 개인 API key입니다. 단체 채팅방이나 GitHub에 올리지 마세요.</p>
    <div class="editor">
      <div class="editor-head"><b>내 Goodbai API key</b><span>학생 워크스페이스의 <code>python scripts\\bai_feed_config.py</code>에 한 번 저장합니다.</span></div>
      <label>이름</label><input class="tags" id="devName" readonly>
      <label>API key</label><input class="tags" id="devKey" readonly>
      <div class="editor-actions"><p class="err" id="devMsg"></p><button class="primary" id="copyDevKeyBtn" style="margin-left:0">복사</button><button id="rotateDevKeyBtn">재발급</button></div>
    </div>
    <div class="card">
      <div class="sec"><div class="label">학생 설정 명령</div><div class="body"><code>python scripts\\bai_feed_config.py</code></div></div>
      <div class="sec"><div class="label">Codex 사용</div><div class="body">작업 후 Codex에게 <b>/goodbai</b>를 실행하라고 말하면 진행 보고를 정리해 전송합니다.</div></div>
      <div class="sec"><div class="label">API endpoint</div><div class="body"><code>POST https://bai.haiinu.com/api/post</code><br><code>X-API-Key: 내 API key</code></div></div>
    </div>
    <div class="card"><div class="sec"><div class="label">curl 예시</div><pre id="devCurl" style="white-space:pre-wrap;overflow:auto"></pre></div></div>
  </div>`;
  const load = async () => {
    const r = await fetch("/api/me?api_key=1");
    if (!r.ok) { devMsg.textContent = "API key를 불러오지 못했습니다."; return; }
    const d = await r.json();
    devName.value = d.name || "";
    devKey.value = d.api_key || "";
    devCurl.textContent = `curl -X POST https://bai.haiinu.com/api/post \\\n  -H 'Content-Type: application/json; charset=utf-8' \\\n  -H 'User-Agent: BAI-Goodbai-Codex/1.0 (+https://bai.haiinu.com)' \\\n  -H 'X-API-Key: ${d.api_key || "YOUR_API_KEY"}' \\\n  -d '{"did":"오늘 한 일","learned":"배운 것","blocked":"없음","tags":"goodbai","links":"","project_id":null}'`;
  };
  copyDevKeyBtn.onclick = async () => {
    await navigator.clipboard.writeText(devKey.value);
    devMsg.classList.remove("err"); devMsg.classList.add("muted"); devMsg.textContent = "복사했습니다.";
  };
  rotateDevKeyBtn.onclick = async () => {
    if (!confirm("API key를 재발급하면 기존 key는 즉시 사용할 수 없습니다. 계속할까요?")) return;
    const r = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "regenerate_api_key" }) });
    if (r.ok) { await load(); devMsg.classList.remove("err"); devMsg.classList.add("muted"); devMsg.textContent = "새 API key를 발급했습니다."; }
    else { devMsg.classList.add("err"); devMsg.textContent = "재발급 실패"; }
  };
  await load();
}

async function renderAdminMembers(view) {
  view.innerHTML = `<div class="content">
    <h2 class="page-title">🛡 멤버 관리</h2>
    <p class="muted" style="margin-top:-8px">PI 전용입니다. 학생 API key 재발급과 role/status 변경을 관리합니다.</p>
    <div id="adminMsg" class="muted"></div><div id="adminMembers"></div>
  </div>`;
  const roleOptions = ["student", "admin_student", "developer", "pi"];
  const statusOptions = ["active", "disabled"];
  const load = async () => {
    const r = await fetch("/api/admin/members");
    if (!r.ok) { adminMembers.innerHTML = '<div class="empty-card">PI 계정만 접근할 수 있습니다.</div>'; return; }
    const data = await r.json();
    adminMembers.innerHTML = (data.members || []).map(m => `<div class="card" data-member="${m.id}">
      <div class="head">${avatar(m.name)}<span class="author">${esc(m.name)}</span><span>· 글 ${m.post_count || 0}개 · ${esc(m.status)}</span><span class="spacer"></span><button data-rotate-member="${m.id}">API key 재발급</button></div>
      <div class="sec"><div class="label">권한</div><div class="body">
        <select class="tags" data-role-member="${m.id}">${roleOptions.map(x => `<option value="${x}" ${m.role === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <select class="tags" data-status-member="${m.id}">${statusOptions.map(x => `<option value="${x}" ${m.status === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <button data-save-member="${m.id}">저장</button>
      </div></div>
      <div class="sec hidden" id="newkey-${m.id}"><div class="label">새 API key</div><div class="body"><code></code></div></div>
    </div>`).join("");
    adminMembers.querySelectorAll("[data-rotate-member]").forEach(b => b.onclick = async () => {
      if (!confirm("이 학생의 API key를 재발급할까요? 기존 key는 무효화됩니다.")) return;
      const r = await fetch(`/api/admin/members/${b.dataset.rotateMember}/api-key/regenerate`, { method: "POST" });
      if (r.ok) { const d = await r.json(); const box = document.getElementById(`newkey-${b.dataset.rotateMember}`); box.classList.remove("hidden"); box.querySelector("code").textContent = d.api_key; }
      else alert("재발급 실패");
    });
    adminMembers.querySelectorAll("[data-save-member]").forEach(b => b.onclick = async () => {
      const id = b.dataset.saveMember;
      const payload = { role: document.querySelector(`[data-role-member="${id}"]`).value, status: document.querySelector(`[data-status-member="${id}"]`).value };
      const r = await fetch(`/api/admin/members/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (r.ok) { adminMsg.textContent = "저장했습니다."; load(); }
      else alert("저장 실패: 자기 자신의 PI 권한은 낮출 수 없습니다.");
    });
  };
  await load();
}

// ---------------- 뷰: 계정 ----------------
async function renderAccount(view) {
  view.innerHTML = `<div class="content">
    <h2 class="page-title">🔐 계정</h2>
    <p class="muted" style="margin-top:-8px">로그인 비밀번호를 직접 변경할 수 있습니다.</p>
    <div class="editor">
      <div class="editor-head"><b>비밀번호 변경</b><span>현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.</span></div>
      <label>현재 비밀번호</label><input class="tags" id="currentPassword" type="password" autocomplete="current-password">
      <label>새 비밀번호</label><input class="tags" id="newPassword" type="password" autocomplete="new-password" placeholder="4자 이상">
      <label>새 비밀번호 확인</label><input class="tags" id="newPassword2" type="password" autocomplete="new-password">
      <div class="editor-actions"><p class="err" id="accountMsg"></p><button class="primary" id="changePasswordBtn" style="margin-left:0">비밀번호 변경</button></div>
    </div>
  </div>`;
  changePasswordBtn.onclick = async () => {
    accountMsg.textContent = "";
    const current_password = currentPassword.value;
    const new_password = newPassword.value;
    if (new_password.length < 4) { accountMsg.textContent = "새 비밀번호는 4자 이상이어야 합니다."; return; }
    if (new_password !== newPassword2.value) { accountMsg.textContent = "새 비밀번호 확인이 일치하지 않습니다."; return; }
    const r = await fetch("/api/change-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password, new_password })
    });
    if (r.ok) {
      accountMsg.classList.remove("err");
      accountMsg.classList.add("muted");
      accountMsg.textContent = "비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.";
      currentPassword.value = ""; newPassword.value = ""; newPassword2.value = "";
    } else {
      accountMsg.classList.add("err");
      accountMsg.textContent = "현재 비밀번호를 확인해 주세요.";
    }
  };
}

// ---------------- 라우터 ----------------
function matchRoute(path) {
  const url = new URL(path, location.origin);
  const pathname = url.pathname;
  if (pathname === "/" || pathname === "") return ["home", renderHome];
  if (pathname === "/questions") return ["questions", renderQuestions];
  if (pathname === "/ask") return ["ask", renderAsk];
  if (pathname === "/projects") return ["projects", renderProjects];
  if (pathname.startsWith("/projects/")) { const id = +pathname.split("/")[2]; return ["projects", v => renderProjectDetail(v, id)]; }
  if (pathname === "/materials") return ["materials", renderMaterials];
  if (pathname === "/members") return ["members", renderMembers];
  if (pathname === "/developer" || pathname === "/goodbai" || (pathname === "/account" && url.searchParams.get("goodbai") === "1")) return ["developer", renderDeveloper];
  if (pathname === "/admin/members") return ["admin", renderAdminMembers];
  if (pathname === "/account") return ["account", renderAccount];
  if (pathname.startsWith("/search")) return ["search", renderSearch];
  if (pathname.startsWith("/post/")) { const id = +pathname.split("/")[2]; return ["", v => renderPostDetail(v, id)]; }
  if (pathname.startsWith("/member/")) { const id = +pathname.split("/")[2]; return ["", v => renderMemberProfile(v, id)]; }
  if (pathname.startsWith("/tag/")) { const t = decodeURIComponent(pathname.split("/")[2] || ""); return ["", v => renderTag(v, t)]; }
  return ["home", renderHome];
}
async function route(path, push) {
  const [key, fn] = matchRoute(path);
  document.querySelectorAll(".side a[data-view]").forEach(a => a.classList.toggle("on", a.dataset.view === key));
  if (push) history.pushState({}, "", path);
  window.scrollTo(0, 0);
  await fn(document.getElementById("view"), FEED_ME);
}
function navigate(path) { route(path, true); }

const FEED_ROUTE_RE = /^\/(?:$|post\/|member\/|members|projects|materials|developer|goodbai|admin\/members|search|questions|ask|account|tag\/)/;
async function initFeed() {
  FEED_ME = await getMe();
  if (!FEED_ME) return;
  FEED_PROJECTS = await fetch("/api/projects").then(r => r.ok ? r.json() : []).catch(() => []);
  document.getElementById("nav").innerHTML = feedSidebar("home", FEED_ME.role === "pi");
  document.querySelector(".side").insertAdjacentHTML("beforeend",
    `<div class="who">👤 ${esc(FEED_ME.name)}</div><button class="logout" id="logoutBtn">로그아웃</button>`);
  document.getElementById("logoutBtn").onclick = async () => { await fetch("/api/logout", { method: "POST" }); location.href = "/login"; };
  // 내부 링크 위임 클릭 → 전체 새로고침 없이 SPA 이동
  document.addEventListener("click", e => {
    const a = e.target.closest("a"); if (!a) return;
    if (a.dataset.full || a.target === "_blank") return;
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("/") || !FEED_ROUTE_RE.test(href)) return;
    e.preventDefault(); navigate(href);
  });
  window.addEventListener("popstate", () => route(location.pathname + location.search, false));
  route(location.pathname + location.search, false);
}
