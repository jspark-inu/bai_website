// BAI 진행 공유 — KRDS 리디자인 SPA (기존 feed.js 대체 진입점)
// pushState 경로 라우팅. API·페이로드·기능은 feed.js와 동일하게 보존.

const RAW_FETCH = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (resource, options) => {
  const response = await RAW_FETCH(resource, options);
  const requestUrl = new URL(typeof resource === "string" ? resource : resource.url, location.origin);
  const isAuthProbe = requestUrl.pathname === "/api/me" && !requestUrl.search;
  const isAuthAction = requestUrl.pathname === "/api/login" || requestUrl.pathname === "/api/logout";
  if (response.status === 401 && !isAuthProbe && !isAuthAction && location.pathname !== "/login") {
    clearWallPoll();
    location.replace("/login");
  }
  return response;
};

// ---------------- 공용 유틸 ----------------
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
function fmtDate(s) { return s ? esc(String(s).slice(0, 10)) : ""; }
function weekStartLabel() {
  const d = new Date();
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  }).format(d);
}
function avatar(name, sm) {
  const ch = String(name || "?").trim().charAt(0) || "?";
  return `<span class="av${sm ? " sm" : ""}" aria-hidden="true">${esc(ch)}</span>`;
}
function firstText(s) { return String(s || "").split(/\r?\n/).map(x => x.trim()).find(Boolean) || ""; }
function clipText(s, max) {
  const text = String(s || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}
function postTitle(p) {
  const text = firstText(p.blocked) || firstText(p.did) || firstText(p.learned);
  return text || (p.links ? "산출물 공유" : "진행 공유");
}

// ---------------- 마크다운 (feed.js와 동일 규칙) ----------------
function stripExecutableHtml(s) {
  return String(s == null ? "" : s)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "");
}
function inlineMarkdown(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return out;
}
function markdownHtml(s) {
  const text = stripExecutableHtml(s).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const html = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flushParagraph(); continue; }
    let m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) { flushParagraph(); const level = m[1].length; html.push(`<h${level}>${inlineMarkdown(m[2])}</h${level}>`); continue; }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      i--;
      html.push(`<blockquote>${quote.map(inlineMarkdown).join("<br>")}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      i--;
      html.push(`<ul>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      i--;
      html.push(`<ol>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return `<div class="md">${html.join("")}</div>`;
}

// ---------------- 상태 ----------------
let ME = null;
let PROJECTS = [];
let WALL_POLL = null;
function clearWallPoll() { if (WALL_POLL) clearInterval(WALL_POLL); WALL_POLL = null; }

async function getMe() {
  const r = await fetch("/api/me");
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`member lookup failed (${r.status})`);
  return r.json();
}

// ---------------- 조각 렌더러 ----------------
function tagChips(tags) {
  if (!tags) return "";
  return tags.split(/[,\s]+/).filter(Boolean)
    .map(t => `<a class="tagchip" href="/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join(" ");
}
// 행 전체가 <a>인 목록 안에서는 앵커 중첩이 안 되므로 span 칩 사용
function tagLabels(tags) {
  if (!tags) return "";
  return tags.split(/[,\s]+/).filter(Boolean).slice(0, 4)
    .map(t => `<span class="tagchip">${esc(t)}</span>`).join(" ");
}
function linkChips(links, max) {
  if (!links) return "";
  return links.split(/[\s,]+/).filter(Boolean).map(u => {
    const label = esc(u.replace(/^https?:\/\//, "").slice(0, max || 44));
    if (/^https?:\/\//i.test(u)) {
      return `<a class="linkchip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return `<span class="linkchip">${label}</span>`;
  }).join(" ");
}
function metaBadges(p) {
  let h = "";
  if (p.source === "skill") h += `<span class="badge badge-info-o">스킬</span>`;
  if (p.project_title) h += `<span class="badge badge-navy-o">${esc(p.project_title)}</span>`;
  return h;
}

// 목록 탐색 패턴 — 피드 행
function listRow(p) {
  const kind = p.blocked
    ? '<span class="badge badge-point-o">질문</span>'
    : '<span class="badge badge-gray-o">기록</span>';
  const mine = ME && p.author_id === ME.id ? '<span class="badge badge-light">내 글</span>' : "";
  return `<a class="list-row" href="/post/${p.id}">
    ${avatar(p.author_name)}
    <div class="row-main">
      <div class="row-meta"><b>${esc(p.author_name)}</b><span>${fmtDate(p.created_at)}</span>${metaBadges(p)}</div>
      <div class="row-title">${esc(postTitle(p))}</div>
      ${p.tags ? `<div class="row-tags">${tagLabels(p.tags)}</div>` : ""}
    </div>
    <div class="row-side">${kind}<span>공감 ${p.reaction_count || 0} · 댓글 ${p.comment_count || 0}</span>${mine}</div>
  </a>`;
}
function listOf(posts, emptyMsg) {
  return posts.length
    ? `<div class="list">${posts.map(listRow).join("")}</div>`
    : `<div class="empty">${esc(emptyMsg || "표시할 기록이 없습니다. 첫 기록을 남겨 주세요.")}</div>`;
}

// 본문형 카드 — 멤버 여정·검색·질문·태그 뷰
function fullCard(p) {
  let secs = "";
  if (p.did) secs += `<div class="detail-sec"><h2>한 일</h2><div class="body">${markdownHtml(p.did)}</div></div>`;
  if (p.learned) secs += `<div class="detail-sec"><h2>배운 것</h2><div class="body">${markdownHtml(p.learned)}</div></div>`;
  if (p.blocked) secs += `<div class="detail-sec question"><h2>막힌 점</h2><div class="body">${markdownHtml(p.blocked)}</div></div>`;
  const links = linkChips(p.links);
  if (links) secs += `<div class="detail-sec"><h2>산출물</h2><div class="body">${links}</div></div>`;
  return `<div class="card">
    <div class="detail-meta">${avatar(p.author_name, true)}
      <a href="/member/${p.author_id}"><b>${esc(p.author_name)}</b></a>
      <span>${fmtDate(p.created_at)}</span>${metaBadges(p)}
      ${p.tags ? tagChips(p.tags) : ""}</div>
    ${secs}
    <div class="detail-actions">
      <button class="btn sm btn-react reactBtn" data-id="${p.id}">공감 <span class="rc">${p.reaction_count || 0}</span></button>
      <a class="btn sm btn-text" href="/post/${p.id}">댓글 ${p.comment_count || 0}</a>
    </div>
  </div>`;
}

function questionCard(p) {
  const blockedLines = String(p.blocked || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const question = blockedLines[0] || postTitle(p);
  const context = clipText(blockedLines.slice(1).join(" ") || firstText(p.did) || firstText(p.learned), 160);
  return `<article class="question-card">
    <header class="question-author">${avatar(p.author_name)}
      <div><a href="/member/${p.author_id}"><b>${esc(p.author_name)}</b></a>
        <time datetime="${esc(p.created_at || "")}">${fmtDate(p.created_at)}</time></div></header>
    <h2><a href="/post/${p.id}">${esc(question)}</a></h2>
    ${context ? `<p class="question-context">${esc(context)}</p>` : ""}
    ${p.tags ? `<div class="question-tags">${tagLabels(p.tags)}</div>` : ""}
    <a class="btn btn-secondary question-answer" href="/post/${p.id}#comments">답변 작성</a>
  </article>`;
}
async function toggleReact(pid, btn) {
  const r = await fetch(`/api/post/${pid}/react`, { method: "POST" });
  if (r.ok) {
    const d = await r.json();
    btn.querySelector(".rc").textContent = d.reaction_count;
    btn.classList.toggle("reacted");
  }
}
function wireReacts(root) {
  (root || document).querySelectorAll(".reactBtn").forEach(b => b.onclick = e => {
    e.preventDefault();
    toggleReact(b.dataset.id, b);
  });
}

function projectOptions(selected) {
  const opts = (PROJECTS || []).map(p =>
    `<option value="${p.id}" ${String(selected || "") === String(p.id) ? "selected" : ""}>${esc(p.title)}</option>`).join("");
  return `<select class="select" id="project_id"><option value="">프로젝트 연결 안 함</option>${opts}</select>`;
}

// 진행 공유 입력폼 (KRDS 입력폼 패턴)
function freeRecordFormHtml() {
  return `
    <div class="field"><label for="did">한 일·결과</label>
      <textarea class="textarea" id="did" placeholder="예: 베이스라인 정확도 0.81 확보, 데이터 300건 정제"></textarea></div>
    <div class="field"><label for="learned">배운 것·메모</label>
      <textarea class="textarea" id="learned" placeholder="예: 단순 모델 기준선이 생각보다 강했습니다"></textarea></div>
    <div class="field"><label for="tags">태그</label>
      <input class="input" id="tags" placeholder="예: 논문 실험 NLP (공백 구분)"></div>
    <div class="field"><label for="links">산출물 링크</label>
      <input class="input" id="links" placeholder="GitHub·데모 주소 (공백 구분)"></div>`;
}
function questionFormHtml() {
  return `
    <div class="field"><label for="blocked">막힌 질문 <span class="req" aria-hidden="true">*</span></label>
      <textarea class="textarea" id="blocked" placeholder="예: 라벨 기준을 어떻게 잡을지 고민됩니다" aria-required="true"></textarea>
      <p class="hint">질문 첫 줄이 막힌 질문 탭의 제목으로 보입니다.</p></div>
    <div class="field"><label for="did">상황·배경</label>
      <textarea class="textarea" id="did" placeholder="예: 데이터가 클래스별로 불균형하고, 평가 기준을 정하는 중입니다"></textarea></div>
    <div class="field"><label for="learned">시도해 본 것</label>
      <textarea class="textarea" id="learned" placeholder="예: 가중치 조정과 샘플링을 비교했지만 기준을 못 정했습니다"></textarea></div>
    <div class="field"><label for="project_id">프로젝트 연결</label>${projectOptions()}</div>
    <div class="field"><label for="tags">태그</label>
      <input class="input" id="tags" placeholder="예: 실험 라벨링 질문 (공백 구분)"></div>
    <div class="field"><label for="links">참고 링크</label>
      <input class="input" id="links" placeholder="관련 노트·코드·데모 주소 (공백 구분)"></div>`;
}
function postFormHtml() {
  return `
    <div class="field"><label for="did">한 일·결과</label>
      <textarea class="textarea" id="did" placeholder="예: 베이스라인 정확도 0.81 확보, 데이터 300건 정제"></textarea></div>
    <div class="field"><label for="learned">배운 것</label>
      <textarea class="textarea" id="learned" placeholder="예: 단순 모델 기준선이 생각보다 강했습니다"></textarea></div>
    <div class="field"><label for="blocked">막힌 점·질문</label>
      <textarea class="textarea" id="blocked" placeholder="예: 라벨 기준을 어떻게 잡을지 고민됩니다"></textarea>
      <p class="hint">막힌 점을 쓰면 막힌 질문 보드에 함께 올라갑니다.</p></div>
    <div class="field"><label for="project_id">프로젝트 연결</label>${projectOptions()}</div>
    <div class="field"><label for="tags">태그</label>
      <input class="input" id="tags" placeholder="예: 논문 실험 NLP (공백 구분)"></div>
    <div class="field"><label for="links">산출물 링크</label>
      <input class="input" id="links" placeholder="GitHub·데모 주소 (공백 구분)"></div>`;
}
function readPostPayload() {
  const valueOf = id => {
    const element = document.getElementById(id);
    return element && "value" in element ? element.value.trim() : "";
  };
  return {
    did: valueOf("did"),
    learned: valueOf("learned"),
    blocked: valueOf("blocked"),
    tags: valueOf("tags"),
    links: valueOf("links"),
    project_id: valueOf("project_id"),
  };
}

// ---------------- 뷰: 홈 ----------------
function checkinHtml(w, mine) {
  const total = w && w.total ? w.total : 0;
  const reported = (w && w.reported) || [];
  const missing = (w && w.missing) || [];
  const people = [
    ...reported.map(m => ({ ...m, done: true })),
    ...missing.map(m => ({ ...m, done: false })),
  ].map(m => `<a class="ck-person ${m.done ? "done" : ""}" href="/member/${m.id}" aria-label="${esc(m.name)} ${m.done ? "기록 완료" : "기록 전"}">${esc(m.name)}</a>`).join("");
  return `<section class="checkin" aria-label="이번 주 체크인 현황">
    <div class="ck-top">
      <div class="t">이번 주 BAI 체크인<b>${reported.length}명이 기록을 남겼습니다</b></div>
      <div class="ck-num">${total ? `${reported.length}/${total}` : "-"}<small>내 기록 ${mine}건</small></div>
    </div>
    <div class="ck-people">${people || '<span class="wall-empty">아직 등록된 멤버가 없습니다.</span>'}</div>
    <div class="ck-missing">${missing.length ? `아직 ${missing.length}명이 이번 주 기록을 기다리고 있습니다.` : "<b>전원 체크인이 완료되었습니다</b>"}</div>
  </section>`;
}
function memberMapHtml(members, posts) {
  const byMember = {};
  (posts || []).forEach(p => {
    const b = byMember[p.author_id] || (byMember[p.author_id] = { tags: {}, last: "" });
    b.last = b.last && b.last > p.created_at ? b.last : p.created_at;
    (p.tags || "").split(/[,\s]+/).filter(Boolean).forEach(t => b.tags[t] = (b.tags[t] || 0) + 1);
  });
  const rows = (members || []).slice(0, 6).map(m => {
    const d = byMember[m.id] || { tags: {}, last: m.last_post_at || "" };
    const tags = Object.entries(d.tags).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => esc(t)).join(" · ");
    const last = d.last || m.last_post_at || "";
    return `<a class="map-row" href="/member/${m.id}">${avatar(m.name, true)}
      <div class="mm"><b>${esc(m.name)}${m.role === "pi" ? " · PI" : ""}</b>
      <div class="mt">${tags || "관찰 중"}</div></div>
      <div class="ms">글 ${m.post_count || 0}<br>${last ? fmtDate(last) : "기록 없음"}</div></a>`;
  }).join("");
  return `<div class="card"><h3>멤버 현황</h3>${rows || '<p class="wall-empty">아직 멤버 활동이 없습니다.</p>'}
    <div style="margin-top:12px"><a class="btn sm btn-text" href="/members">전체 멤버 보기</a></div></div>`;
}
function wallHtml() {
  return `<div class="card">
    <div class="wall-head"><h3 style="margin:0">응원 한마디</h3><span class="wall-live">실시간</span></div>
    <div class="wall-stream" id="wallStream"><div class="wall-empty">응원 한마디를 기다리고 있습니다.</div></div>
    <form class="wall-form" id="wallForm">
      <input class="input" id="wallInput" maxlength="80" autocomplete="off" placeholder="익명으로 짧게 남겨 주세요" aria-label="응원 한마디">
      <button class="btn sm btn-secondary" type="submit">남기기</button>
    </form>
    <p class="form-msg error" id="wallErr"></p>
  </div>`;
}
async function loadWall(animate) {
  const stream = document.getElementById("wallStream");
  if (!stream) return;
  const r = await fetch("/api/wall?limit=8").catch(() => null);
  if (!r || !r.ok) return;
  const data = await r.json();
  const messages = data.messages || [];
  const prevLast = Number(stream.dataset.lastId || 0);
  stream.dataset.lastId = messages.length ? messages[messages.length - 1].id : 0;
  stream.innerHTML = messages.length ? messages.map(m =>
    `<div class="chat-line ${animate && m.id > prevLast ? "new" : ""}"><span class="chat-name">익명</span><span class="chat-body">${esc(m.body)}</span></div>`
  ).join("") : '<div class="wall-empty">응원 한마디를 기다리고 있습니다.</div>';
}
function wireWall() {
  const form = document.getElementById("wallForm");
  if (!form) return;
  const input = document.getElementById("wallInput");
  const err = document.getElementById("wallErr");
  loadWall(false);
  WALL_POLL = setInterval(() => loadWall(true), 5000);
  form.onsubmit = async e => {
    e.preventDefault();
    const body = input.value.trim();
    err.textContent = "";
    if (!body) return;
    const r = await fetch("/api/wall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
    if (r.ok) { input.value = ""; await loadWall(true); }
    else {
      const data = await r.json().catch(() => null);
      let message = "남기지 못했습니다. 잠시 후 다시 시도해 주세요.";
      if (r.status === 401) message = "로그인이 필요합니다.";
      else if (data && data.error === "message too long") message = "80자 이내로 남겨 주세요.";
      else if (data && data.error === "message required") message = "응원 문장을 입력해 주세요.";
      err.textContent = message;
    }
  };
}

async function renderHome(view) {
  const ALL = await (await fetch("/api/feed")).json();
  const w = await fetch("/api/weekly").then(r => r.ok ? r.json() : null).catch(() => null);
  const freeRecords = ALL.filter(p => !p.project_id);
  const reported = (w && w.reported) || [];
  const mine = Number((reported.find(m => Number(m.id) === Number(ME.id)) || {}).week_count || 0);
  const checkedIn = reported.some(m => Number(m.id) === Number(ME.id));

  view.innerHTML = `<section class="home-hero" aria-labelledby="homeTitle">
    <div class="home-copy"><p class="date-line">${esc(weekStartLabel())}</p>
      <h1 id="homeTitle">이번 주, 무엇을 남겼나요?</h1>
      <p>한 일, 배운 것, 막힌 점 중 하나면 충분합니다.</p></div>
    <section class="my-week-card" aria-label="나의 이번 주 상태">
      <div class="my-week-status"><span>나의 이번 주</span><strong>${checkedIn ? "기록 완료" : "아직 기록 전"}</strong></div>
      <p>${checkedIn ? "이번 주 기록이 안전하게 쌓였습니다." : "짧은 메모 하나로 이번 주 흐름을 남겨 보세요."}</p>
      <button class="btn btn-secondary" id="newBtn">${checkedIn ? "기록 더 남기기" : "첫 기록 남기기"}</button>
    </section>
  </section>
  <div class="panel-form hidden" id="editor">
    <div class="form-head"><b>자유 기록 남기기</b><span>오늘 한 일과 배운 것을 편하게 남깁니다. 막힌 질문은 막힌 질문 탭에서 남겨 주세요.</span></div>
    ${freeRecordFormHtml()}
    <div class="form-actions"><button class="btn btn-primary" id="submitBtn">올리기</button>
      <button class="btn btn-tertiary" id="cancelBtn">취소</button>
      <p class="form-msg error" id="postErr" aria-live="polite"></p></div>
  </div>
  <div id="summary">${checkinHtml(w, mine)}</div>
  <div class="home-activity-grid"><section class="home-records" aria-labelledby="recentTitle">
    <div class="section-head"><div><p>최근 활동</p><h2 id="recentTitle">이번 주의 기록</h2></div><a class="btn sm btn-text" href="/feed">전체 보기</a></div>
    <div id="feedlist">${listOf(freeRecords.slice(0, 4), "아직 자유 기록이 없습니다. 첫 기록을 남겨 주세요.")}</div>
  </section><aside class="rail" id="rail">${wallHtml()}</aside></div>`;

  const editor = document.getElementById("editor");
  document.getElementById("newBtn").onclick = () => {
    editor.classList.toggle("hidden");
    if (!editor.classList.contains("hidden")) document.getElementById("did").focus();
  };
  document.getElementById("cancelBtn").onclick = () => editor.classList.add("hidden");
  document.getElementById("submitBtn").onclick = async () => {
    const payload = readPostPayload();
    const err = document.getElementById("postErr");
    err.textContent = "";
    if (!payload.did && !payload.learned) {
      err.textContent = "한 일 또는 배운 것을 입력해 주세요."; return;
    }
    const r = await fetch("/api/web/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) route(location.pathname + location.search + location.hash, false); else err.textContent = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  wireWall();
}

async function renderFeed(view) {
  view.innerHTML = `<div class="page-head"><div><h1>자유 기록</h1>
    <p class="desc">프로젝트와 별도로 남긴 일상의 배움, 진행, 막힌 질문을 함께 기록합니다.</p></div>
    <button class="btn btn-primary" id="newBtn">기록 남기기</button></div>
    <div class="panel-form hidden" id="editor">
      <div class="form-head"><b>자유 기록 남기기</b><span>일상의 배움과 진행을 남깁니다. 질문은 막힌 질문 탭의 질문하기를 이용해 주세요.</span></div>
      ${freeRecordFormHtml()}
      <div class="form-actions"><button class="btn btn-primary" id="submitBtn">올리기</button>
        <button class="btn btn-tertiary" id="cancelBtn">취소</button>
        <p class="form-msg error" id="postErr" aria-live="polite"></p></div>
    </div>
    <div class="tabs" id="filters" role="tablist">
      <button data-f="all" class="on" role="tab" aria-selected="true">전체</button>
      <button data-f="mine" role="tab" aria-selected="false">내 기록</button>
    </div><div id="feedlist"></div>`;
  const allPosts = await (await fetch("/api/feed")).json();
  const records = allPosts.filter(p => !p.project_id);
  let filter = "all";
  const draw = () => {
    const list = filter === "mine" ? records.filter(p => p.author_id === ME.id) : records;
    document.getElementById("feedlist").innerHTML = listOf(list, "조건에 맞는 자유 기록이 없습니다.");
  };
  draw();
  const editor = document.getElementById("editor");
  document.getElementById("newBtn").onclick = () => {
    editor.classList.toggle("hidden");
    if (!editor.classList.contains("hidden")) document.getElementById("did").focus();
  };
  document.getElementById("cancelBtn").onclick = () => editor.classList.add("hidden");
  document.getElementById("submitBtn").onclick = async () => {
    const payload = readPostPayload();
    const err = document.getElementById("postErr");
    err.textContent = "";
    if (!payload.did && !payload.learned) {
      err.textContent = "한 일 또는 배운 것을 입력해 주세요."; return;
    }
    const r = await fetch("/api/web/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) route("/feed", false); else err.textContent = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  document.querySelectorAll("#filters button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#filters button").forEach(x => { x.classList.remove("on"); x.setAttribute("aria-selected", "false"); });
    b.classList.add("on"); b.setAttribute("aria-selected", "true"); filter = b.dataset.f; draw();
  });
}

// ---------------- 뷰: 글 상세 ----------------
async function renderPostDetail(view, pid) {
  view.innerHTML = `<div style="max-width:820px;margin:0 auto">
    <div id="detail"></div>
    <div class="panel-form hidden" id="editor" style="margin-top:16px">
      <div class="form-head"><b>기록 수정</b></div>
      ${postFormHtml()}
      <div class="form-actions"><button class="btn btn-primary" id="saveBtn">저장</button>
      <button class="btn btn-tertiary" id="editCancelBtn">취소</button>
      <p class="form-msg error" id="editErr" aria-live="polite"></p></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>댓글</h2><div id="comments"></div>
      <div class="comment-form">
        <input class="input" id="cbody" placeholder="댓글을 남겨 주세요" aria-label="댓글">
        <button class="btn btn-secondary" id="cbtn">등록</button>
      </div></div></div>`;
  const r = await fetch(`/api/post/${pid}`);
  if (!r.ok) {
    document.getElementById("detail").innerHTML = '<div class="empty">글을 찾을 수 없습니다. 전체 피드에서 다시 선택해 주세요.<br><a class="btn sm btn-secondary" href="/">전체 피드로 이동</a></div>';
    return;
  }
  const data = await r.json();
  const POST = data.post;
  const reacted = (data.reacted_by || []).includes(ME.id);
  let secs = "";
  if (POST.did) secs += `<div class="detail-sec"><h2>한 일</h2><div class="body">${markdownHtml(POST.did)}</div></div>`;
  if (POST.learned) secs += `<div class="detail-sec"><h2>배운 것</h2><div class="body">${markdownHtml(POST.learned)}</div></div>`;
  if (POST.blocked) secs += `<div class="detail-sec question"><h2>막힌 점</h2><div class="body">${markdownHtml(POST.blocked)}</div></div>`;
  const links = linkChips(POST.links, 56);
  if (links) secs += `<div class="detail-sec"><h2>산출물</h2><div class="body">${links}</div></div>`;
  if (!secs) secs = `<div class="detail-sec"><h2>내용</h2><div class="body">아직 본문이 없습니다.</div></div>`;

  document.getElementById("detail").innerHTML = `<article class="card">
    <header class="detail-head">
      <div class="detail-meta">${avatar(POST.author_name, true)}
        <a href="/member/${POST.author_id}"><b>${esc(POST.author_name)}</b></a>
        <span>${fmtDate(POST.created_at)}</span>${metaBadges(POST)}${tagChips(POST.tags)}
        ${POST.author_id === ME.id ? '<button class="btn xs btn-tertiary" id="editBtn" style="margin-left:auto">수정</button>' : ""}
      </div>
      <h1>${esc(postTitle(POST))}</h1>
    </header>
    ${secs}
    <div class="detail-actions">
      <button class="btn sm btn-react ${reacted ? "reacted" : ""}" id="reactBtn">공감 <span class="rc">${POST.reaction_count}</span></button>
    </div>
  </article>`;
  document.getElementById("reactBtn").onclick = e => toggleReact(pid, e.currentTarget);
  document.getElementById("comments").innerHTML = data.comments.length
    ? data.comments.map(c => `<div class="comment"><span class="who">${esc(c.author_name)}</span>${esc(c.body)}</div>`).join("")
    : '<p class="wall-empty" style="padding:8px 0">아직 댓글이 없습니다. 첫 댓글을 남겨 주세요.</p>';

  const editor = document.getElementById("editor");
  if (POST.author_id === ME.id) {
    document.getElementById("editBtn").onclick = () => {
      document.getElementById("did").value = POST.did || "";
      document.getElementById("learned").value = POST.learned || "";
      document.getElementById("blocked").value = POST.blocked || "";
      document.getElementById("tags").value = POST.tags || "";
      document.getElementById("links").value = POST.links || "";
      document.getElementById("project_id").value = POST.project_id || "";
      editor.classList.remove("hidden");
      document.getElementById("did").focus();
    };
  }
  document.getElementById("editCancelBtn").onclick = () => editor.classList.add("hidden");
  document.getElementById("saveBtn").onclick = async () => {
    const err = document.getElementById("editErr");
    err.textContent = "";
    const payload = readPostPayload();
    if (!payload.did && !payload.learned && !payload.blocked) {
      err.textContent = "한 일, 배운 것, 막힌 점 중 하나는 입력해 주세요."; return;
    }
    const rr = await fetch(`/api/post/${pid}/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (rr.ok) route(location.pathname + location.search + location.hash, false); else err.textContent = "수정하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  const sendC = async () => {
    const body = document.getElementById("cbody").value.trim();
    if (!body) return;
    const rr = await fetch(`/api/post/${pid}/comment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
    if (rr.ok) route(location.pathname + location.search + location.hash, false);
  };
  document.getElementById("cbtn").onclick = sendC;
  document.getElementById("cbody").addEventListener("keydown", e => { if (e.key === "Enter") sendC(); });
}

// ---------------- 뷰: 멤버 ----------------
async function renderMemberProfile(view, mid) {
  view.innerHTML = `<div id="profile"></div><div class="section-label">진행 여정 (처음 → 최근)</div><div id="journey"></div>`;
  const r = await fetch(`/api/member/${mid}`);
  if (!r.ok) { document.getElementById("profile").innerHTML = '<div class="empty">멤버를 찾을 수 없습니다.</div>'; return; }
  const d = await r.json();
  const tags = Object.entries(d.tag_counts || {}).map(([t, n]) =>
    `<a class="tagchip" href="/tag/${encodeURIComponent(t)}">${esc(t)} ${n}</a>`).join(" ");
  const span = d.first_post_at ? `${esc(d.first_post_at.slice(0, 10))} ~ ${esc(d.last_post_at.slice(0, 10))}` : "아직 글 없음";
  document.getElementById("profile").innerHTML = `<div class="profile-head">
    <div class="ph-top">${avatar(d.member.name)}
      <div><h1>${esc(d.member.name)}${d.member.role === "pi" ? " · PI" : ""}</h1>
      <div class="meta">글 ${d.post_count}건 · ${span}</div></div></div>
    ${tags ? `<div class="ph-tags">${tags}</div>` : ""}</div>`;
  document.getElementById("journey").innerHTML = d.posts.length
    ? d.posts.map(fullCard).join('<div style="height:16px"></div>')
    : '<div class="empty">아직 올린 글이 없습니다.</div>';
  wireReacts(document.getElementById("journey"));
}

async function renderMembers(view) {
  view.innerHTML = `<div class="page-head"><div><h1>멤버</h1><p class="desc">BAI 멤버와 최근 활동을 확인합니다.</p></div></div><div class="member-grid" id="grid"></div>`;
  const rows = await (await fetch("/api/members")).json();
  document.getElementById("grid").innerHTML = rows.map(m => {
    const last = m.last_post_at ? "최근 " + m.last_post_at.slice(0, 10) : "아직 글 없음";
    return `<a class="member-card" href="/member/${m.id}">${avatar(m.name)}
      <div><div class="nm">${esc(m.name)}${m.role === "pi" ? " · PI" : ""}</div>
      <div class="st">글 ${m.post_count}건 · ${esc(last)}</div></div></a>`;
  }).join("");
}

// ---------------- 뷰: 자료실 ----------------
async function renderMaterials(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>자료실</h1><p class="desc">BAI 온보딩과 길드별 활동 자료를 모읍니다.</p></div>
      <button class="btn btn-primary" id="newMaterialBtn">자료 올리기</button>
    </div>
    <div class="panel-form hidden" id="materialEditor">
      <div class="form-head"><b id="materialFormTitle">자료 올리기</b><span>링크만 올리거나 본문과 함께 정리할 수 있습니다.</span></div>
      <input type="hidden" id="materialId">
      <div class="field"><label for="materialTitle">제목 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="materialTitle" placeholder="예: BAI 첫 참여 안내" aria-required="true"></div>
      <div class="field"><label for="materialCategory">분류</label>
        <select class="select" id="materialCategory"><option>온보딩</option><option>길드</option><option>공지</option><option>자료</option></select></div>
      <div class="field"><label for="materialGuild">길드·대상</label>
        <input class="input" id="materialGuild" placeholder="예: 공통, 웹, AI, 데이터"></div>
      <div class="field"><label for="materialUrl">링크</label>
        <input class="input" id="materialUrl" placeholder="https://..."></div>
      <div class="field"><label for="materialBody">본문</label>
        <textarea class="textarea" id="materialBody" placeholder="요약, 사용법, 준비물 등을 적어 주세요."></textarea></div>
      <div class="form-actions"><button class="btn btn-primary" id="saveMaterialBtn">저장</button>
        <button class="btn btn-tertiary" id="materialCancelBtn">취소</button>
        <p class="form-msg error" id="materialErr" aria-live="polite"></p></div>
    </div>
    <div class="tabs" id="materialFilters">
      <button data-category="" class="on">전체</button><button data-category="온보딩">온보딩</button>
      <button data-category="길드">길드</button><button data-category="공지">공지</button><button data-category="자료">자료</button>
    </div>
    <div id="materialList"></div>`;
  let category = "";
  const editor = document.getElementById("materialEditor");
  const err = document.getElementById("materialErr");
  const resetForm = () => {
    ["materialId", "materialTitle", "materialGuild", "materialUrl", "materialBody"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("materialCategory").value = "온보딩";
    err.textContent = "";
    document.getElementById("materialFormTitle").textContent = "자료 올리기";
  };
  const openForm = m => {
    resetForm();
    if (m) {
      document.getElementById("materialId").value = m.id;
      document.getElementById("materialTitle").value = m.title || "";
      document.getElementById("materialCategory").value = m.category || "자료";
      document.getElementById("materialGuild").value = m.guild || "";
      document.getElementById("materialUrl").value = m.url || "";
      document.getElementById("materialBody").value = m.body || "";
      document.getElementById("materialFormTitle").textContent = "자료 수정";
    }
    editor.classList.remove("hidden");
    document.getElementById("materialTitle").focus();
  };
  const materialCard = m => {
    const canEdit = ME.role === "pi" || m.author_id === ME.id;
    return `<div class="material-row card">
      <div class="material-kind"><strong>${esc(m.category || "자료")}</strong>${m.guild ? `<span>${esc(m.guild)}</span>` : ""}</div>
      <div class="material-main"><h2>${esc(m.title)}</h2>
        ${m.body ? `<div class="material-body">${markdownHtml(m.body)}</div>` : ""}
        ${m.url ? `<div class="material-links">${linkChips(m.url, 56)}</div>` : ""}</div>
      <div class="material-side"><time>${fmtDate(m.created_at)}</time><strong>${esc(m.author_name || "작성자 미상")}</strong>
        ${canEdit ? `<div class="material-actions"><button class="btn xs btn-tertiary" data-edit-material="${m.id}">수정</button>
        <button class="btn xs btn-tertiary" data-delete-material="${m.id}">삭제</button></div>` : ""}</div>
    </div>`;
  };
  const load = async () => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    const r = await fetch(`/api/materials${qs}`);
    const data = await r.json();
    const materials = data.materials || [];
    const list = document.getElementById("materialList");
    list.innerHTML = materials.length ? materials.map(materialCard).join("") : '<div class="empty">아직 올라온 자료가 없습니다. 첫 자료를 올려 주세요.</div>';
    list.querySelectorAll("[data-edit-material]").forEach(b =>
      b.onclick = () => openForm(materials.find(m => String(m.id) === String(b.dataset.editMaterial))));
    list.querySelectorAll("[data-delete-material]").forEach(b => b.onclick = async () => {
      if (!confirm("이 자료를 삭제하시겠습니까?")) return;
      const r = await fetch(`/api/materials/${b.dataset.deleteMaterial}`, { method: "DELETE" });
      if (r.ok) load(); else alert("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
  };
  document.getElementById("newMaterialBtn").onclick = () => openForm(null);
  document.getElementById("materialCancelBtn").onclick = () => editor.classList.add("hidden");
  document.getElementById("saveMaterialBtn").onclick = async () => {
    const payload = {
      title: document.getElementById("materialTitle").value.trim(),
      category: document.getElementById("materialCategory").value,
      guild: document.getElementById("materialGuild").value.trim(),
      url: document.getElementById("materialUrl").value.trim(),
      body: document.getElementById("materialBody").value.trim(),
    };
    err.textContent = "";
    if (!payload.title || (!payload.url && !payload.body)) { err.textContent = "제목과 링크 또는 본문을 입력해 주세요."; return; }
    const id = document.getElementById("materialId").value;
    const r = await fetch(id ? `/api/materials/${id}` : "/api/materials", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (r.ok) { editor.classList.add("hidden"); resetForm(); load(); }
    else err.textContent = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  document.querySelectorAll("#materialFilters button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#materialFilters button").forEach(x => x.classList.remove("on"));
    b.classList.add("on"); category = b.dataset.category || ""; load();
  });
  await load();
}

// ---------------- 뷰: 프로젝트 ----------------
async function renderProjects(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>프로젝트</h1><p class="desc">길드별 결과물, 외부 페이지, 저장소를 BAI 자산으로 연결합니다.</p></div>
      <button class="btn btn-primary" id="newProjectBtn">프로젝트 만들기</button>
    </div>
    <div class="panel-form hidden" id="projectEditor">
      <div class="form-head"><b>프로젝트 만들기</b><span>결과물 페이지는 링크로 연결하고, 이후 배포 위치로 옮길 수 있습니다.</span></div>
      <div class="field"><label for="projectTitle">프로젝트명 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="projectTitle" placeholder="예: 웹 길드 포트폴리오" aria-required="true"></div>
      <div class="field"><label for="projectSlug">슬러그</label>
        <input class="input" id="projectSlug" placeholder="예: web-guild-2026"></div>
      <div class="field"><label for="projectType">길드</label>
        <input class="input" id="projectType" placeholder="예: 웹, AI, 데이터"></div>
      <div class="field"><label for="projectSummary">요약</label>
        <textarea class="textarea" id="projectSummary" placeholder="프로젝트 목표와 결과물을 설명해 주세요."></textarea></div>
      <div class="field"><label for="projectRepoUrl">저장소 주소</label>
        <input class="input" id="projectRepoUrl" placeholder="https://github.com/..."></div>
      <div class="field"><label for="projectSiteUrl">사이트 주소</label>
        <input class="input" id="projectSiteUrl" placeholder="https://..."></div>
      <div class="form-actions"><button class="btn btn-primary" id="saveProjectBtn">저장</button>
        <button class="btn btn-tertiary" id="projectCancelBtn">취소</button>
        <p class="form-msg error" id="projectErr" aria-live="polite"></p></div>
    </div>
    <div class="project-grid" id="projectList"></div>`;
  const editor = document.getElementById("projectEditor");
  const draw = async () => {
    const rows = await (await fetch("/api/projects")).json();
    document.getElementById("projectList").innerHTML = rows.length ? rows.map(p => {
      const meta = [p.type, p.status, p.member_count ? `멤버 ${p.member_count}` : ""].filter(Boolean).join(" · ");
      return `<a class="project-card" href="/projects/${p.id}">
        <div class="project-meta">${esc(meta || "프로젝트")}</div>
        <h2>${esc(p.title)}</h2>
        <p>${esc(p.summary || p.goal || "프로젝트 설명을 준비하고 있습니다.")}</p>
        <div class="project-foot"><span>${esc(p.owner_name || "BAI")}</span>${p.site_url ? `<span>사이트 연결됨</span>` : ""}</div>
      </a>`;
    }).join("") : '<div class="empty">아직 등록된 프로젝트가 없습니다. 첫 프로젝트를 만들어 주세요.</div>';
  };
  document.getElementById("newProjectBtn").onclick = () => {
    editor.classList.toggle("hidden");
    if (!editor.classList.contains("hidden")) document.getElementById("projectTitle").focus();
  };
  document.getElementById("projectCancelBtn").onclick = () => editor.classList.add("hidden");
  document.getElementById("saveProjectBtn").onclick = async () => {
    const payload = {
      title: document.getElementById("projectTitle").value.trim(),
      slug: document.getElementById("projectSlug").value.trim(),
      type: document.getElementById("projectType").value.trim(),
      summary: document.getElementById("projectSummary").value.trim(),
      repo_url: document.getElementById("projectRepoUrl").value.trim(),
      site_url: document.getElementById("projectSiteUrl").value.trim(),
      members: [{ member_id: ME.id, role: "리드" }],
    };
    const err = document.getElementById("projectErr");
    err.textContent = "";
    if (!payload.title || (!payload.summary && !payload.repo_url && !payload.site_url)) {
      err.textContent = "프로젝트명과 요약 또는 링크를 입력해 주세요."; return;
    }
    const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) { const data = await r.json(); navigate(`/projects/${data.id}`); }
    else err.textContent = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  await draw();
}

async function renderProjectDetail(view, pid) {
  view.innerHTML = `<div id="projectDetail"></div><div class="section-label">연결된 활동</div><div id="projectActivity"></div>`;
  const r = await fetch(`/api/projects/${pid}`);
  if (!r.ok) { document.getElementById("projectDetail").innerHTML = '<div class="empty">프로젝트를 찾을 수 없습니다.</div>'; return; }
  const data = await r.json();
  const p = data.project;
  const links = [
    p.site_url ? `<a class="linkchip" href="${esc(p.site_url)}" target="_blank" rel="noopener noreferrer">사이트</a>` : "",
    p.repo_url ? `<a class="linkchip" href="${esc(p.repo_url)}" target="_blank" rel="noopener noreferrer">저장소</a>` : "",
  ].filter(Boolean).join(" ");
  document.getElementById("projectDetail").innerHTML = `<div class="profile-head">
    <h1>${esc(p.title)}</h1>
    <div class="meta">${esc([p.type, p.status, p.slug].filter(Boolean).join(" · "))}</div>
    ${p.summary ? `<p style="margin-top:10px;font-size:1.5rem">${esc(p.summary)}</p>` : ""}
    ${links ? `<div style="margin-top:12px">${links}</div>` : ""}
    <div class="ph-tags">${(data.members || []).map(m =>
      `<a class="tagchip" href="/member/${m.member_id}">${esc(m.name)} ${esc(m.role || "")}</a>`).join(" ")}</div>
  </div>`;
  document.getElementById("projectActivity").innerHTML = data.activity.length
    ? data.activity.map(fullCard).join('<div style="height:16px"></div>')
    : '<div class="empty">아직 연결된 활동 글이 없습니다. 기록을 남길 때 프로젝트를 연결해 주세요.</div>';
  wireReacts(document.getElementById("projectActivity"));
}

// ---------------- 뷰: 검색 ----------------
async function renderSearch(view, query) {
  view.innerHTML = `<div class="page-head"><div><h1>검색</h1><p class="desc">기록 본문과 태그에서 찾습니다.</p></div></div>
    <div class="searchbar">
      <input class="input" id="q" placeholder="검색어를 입력해 주세요 (예: 검증셋 누수, GAN)" aria-label="검색어">
      <button class="btn btn-primary" id="btn">검색</button>
    </div>
    <div class="result-count" id="title" aria-live="polite"></div><div id="feedlist"></div>`;
  const run = async () => {
    const q = document.getElementById("q").value.trim();
    if (!q) return;
    history.replaceState({}, "", "/search?q=" + encodeURIComponent(q));
    const d = await (await fetch("/api/search?q=" + encodeURIComponent(q))).json();
    document.getElementById("title").innerHTML = `"${esc(q)}" 검색 결과 총 <span class="n">${d.posts.length}</span>건`;
    document.getElementById("feedlist").innerHTML = d.posts.length
      ? d.posts.map(fullCard).join('<div style="height:16px"></div>')
      : '<div class="empty">검색 결과가 없습니다. 다른 키워드로 다시 시도해 주세요.</div>';
    wireReacts(document.getElementById("feedlist"));
  };
  document.getElementById("btn").onclick = run;
  document.getElementById("q").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  if (query) { document.getElementById("q").value = query; run(); }
  else document.getElementById("q").focus();
}

// ---------------- 뷰: 막힌 질문 ----------------
async function renderQuestions(view) {
  view.innerHTML = `<div class="page-head"><div><h1>막힌 질문</h1>
    <p class="desc">아직 답변이 없는 막힌 질문입니다. 답변이 달리면 자유 기록과 글 상세에는 남고 이 목록에서는 사라집니다.</p></div>
    <button class="btn btn-primary" id="newQuestionBtn">질문하기</button></div>
    <div class="panel-form hidden" id="questionEditor">
      <div class="form-head"><b>막힌 질문 남기기</b><span>질문을 먼저 쓰고, 상황과 시도한 내용을 덧붙이면 답변하기 쉽습니다.</span></div>
      ${questionFormHtml()}
      <div class="form-actions"><button class="btn btn-primary" id="submitQuestionBtn">질문 올리기</button>
        <button class="btn btn-tertiary" id="questionCancelBtn">취소</button>
        <p class="form-msg error" id="questionErr" aria-live="polite"></p></div>
    </div><div class="question-feed" id="feedlist"></div>`;
  const editor = document.getElementById("questionEditor");
  document.getElementById("newQuestionBtn").onclick = () => {
    editor.classList.toggle("hidden");
    if (!editor.classList.contains("hidden")) document.getElementById("blocked").focus();
  };
  document.getElementById("questionCancelBtn").onclick = () => editor.classList.add("hidden");
  document.getElementById("submitQuestionBtn").onclick = async () => {
    const payload = readPostPayload();
    const err = document.getElementById("questionErr");
    err.textContent = "";
    if (!payload.blocked) { err.textContent = "막힌 질문을 입력해 주세요."; return; }
    const r = await fetch("/api/web/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.ok) route("/questions", false); else err.textContent = "질문을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  const d = await (await fetch("/api/questions")).json();
  document.getElementById("feedlist").innerHTML = d.posts.length
    ? d.posts.map(questionCard).join("")
    : '<div class="empty">아직 막힌 질문이 없습니다. 첫 질문을 남겨 주세요.</div>';
}

// ---------------- 뷰: 문의/FAQ ----------------
async function renderAsk(view) {
  view.innerHTML = `<div class="page-head"><div><h1>운영 문의</h1>
    <p class="desc">모임 운영에 대해 궁금한 것을 남겨 주세요. 답변되면 아래 FAQ에 쌓여 모두가 볼 수 있습니다.</p></div></div>
    <div class="panel-form">
      <div class="field"><label for="iq">질문</label>
        <textarea class="textarea" id="iq" placeholder="예: 길드는 어떻게 정해지나요?"></textarea></div>
      <div class="form-actions"><button class="btn btn-primary" id="iqBtn">질문 보내기</button>
        <p class="form-msg" id="iqMsg" aria-live="polite"></p></div>
    </div>
    <div class="section-label">자주 묻는 질문 (답변됨)</div><div id="faq"></div>
    <div class="section-label">답변 대기</div><div id="openq"></div>`;
  const draw = async () => {
    const d = await (await fetch("/api/inquiries")).json();
    document.getElementById("faq").innerHTML = d.answered.length ? d.answered.map(i =>
      `<div class="card">
        <div class="detail-meta" style="margin-bottom:6px"><span>${esc(i.author_name)} · ${fmtDate(i.created_at)}</span></div>
        <div style="font-weight:700;margin-bottom:12px">${esc(i.question)}</div>
        <div class="panel-info"><b>${esc(i.answerer_name || "")} 답변</b><div style="margin-top:4px;white-space:pre-wrap;font-size:1.5rem">${esc(i.answer)}</div></div>
      </div>`).join("") : '<div class="empty">아직 답변된 질문이 없습니다.</div>';
    const isPI = ME.role === "pi";
    document.getElementById("openq").innerHTML = d.open.length ? d.open.map(i =>
      `<div class="card">
        <div class="detail-meta" style="margin-bottom:6px"><span>${esc(i.author_name)} · ${fmtDate(i.created_at)}</span><span class="badge badge-info-o">답변 대기</span></div>
        <div style="font-weight:700">${esc(i.question)}</div>
        ${isPI ? `<div class="comment-form"><input class="input" id="ans-${i.id}" placeholder="답변을 작성해 주세요" aria-label="답변">
          <button class="btn btn-secondary" data-iid="${i.id}">답변</button></div>` : ""}
      </div>`).join("") : '<div class="empty">대기 중인 질문이 없습니다.</div>';
    if (isPI) document.querySelectorAll("#openq button[data-iid]").forEach(b => b.onclick = async () => {
      const ans = document.getElementById("ans-" + b.dataset.iid).value.trim();
      if (!ans) return;
      const r = await fetch(`/api/inquiries/${b.dataset.iid}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: ans }) });
      if (r.ok) draw(); else alert("답변을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
  };
  document.getElementById("iqBtn").onclick = async () => {
    const q = document.getElementById("iq").value.trim();
    const msg = document.getElementById("iqMsg");
    msg.className = "form-msg";
    if (!q) { msg.classList.add("error"); msg.textContent = "질문을 입력해 주세요."; return; }
    const r = await fetch("/api/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
    if (r.ok) {
      document.getElementById("iq").value = "";
      msg.classList.add("ok"); msg.textContent = "질문이 접수되었습니다. 답변되면 FAQ에 올라옵니다.";
      draw();
    } else { msg.classList.add("error"); msg.textContent = "전송하지 못했습니다. 잠시 후 다시 시도해 주세요."; }
  };
  await draw();
}

// ---------------- 뷰: 태그 ----------------
async function renderTag(view, tag) {
  view.innerHTML = `<div class="page-head"><div><h1>태그: ${esc(tag)}</h1></div></div><div id="feedlist"></div>`;
  const d = await (await fetch(`/api/tag/${encodeURIComponent(tag)}`)).json();
  document.getElementById("feedlist").innerHTML = d.posts.length
    ? d.posts.map(fullCard).join('<div style="height:16px"></div>')
    : '<div class="empty">이 태그의 글이 아직 없습니다.</div>';
  wireReacts(document.getElementById("feedlist"));
}

// ---------------- 뷰: 계정 ----------------
async function renderAccount(view) {
  view.innerHTML = `<div style="max-width:560px">
    <div class="page-head"><div><h1>계정</h1><p class="desc">로그인 비밀번호를 직접 변경할 수 있습니다.</p></div></div>
    <div class="panel-form">
      <div class="form-head"><b>비밀번호 변경</b><span>현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.</span></div>
      <div class="field"><label for="currentPassword">현재 비밀번호 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="currentPassword" type="password" autocomplete="current-password" aria-required="true"></div>
      <div class="field"><label for="newPassword">새 비밀번호 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="newPassword" type="password" autocomplete="new-password" placeholder="4자 이상" aria-required="true"></div>
      <div class="field"><label for="newPassword2">새 비밀번호 확인 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="newPassword2" type="password" autocomplete="new-password" aria-required="true"></div>
      <div class="form-actions"><button class="btn btn-primary" id="changePasswordBtn">비밀번호 변경하기</button>
        <p class="form-msg" id="accountMsg" aria-live="polite"></p></div>
    </div></div>`;
  document.getElementById("changePasswordBtn").onclick = async () => {
    const msg = document.getElementById("accountMsg");
    msg.className = "form-msg"; msg.textContent = "";
    const current_password = document.getElementById("currentPassword").value;
    const new_password = document.getElementById("newPassword").value;
    if (new_password.length < 4) { msg.classList.add("error"); msg.textContent = "새 비밀번호는 4자 이상 입력해 주세요."; return; }
    if (new_password !== document.getElementById("newPassword2").value) {
      msg.classList.add("error"); msg.textContent = "새 비밀번호 확인이 일치하지 않습니다."; return;
    }
    const r = await fetch("/api/change-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password, new_password }),
    });
    if (r.ok) {
      msg.classList.add("ok");
      msg.textContent = "비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용해 주세요.";
      ["currentPassword", "newPassword", "newPassword2"].forEach(id => document.getElementById(id).value = "");
    } else { msg.classList.add("error"); msg.textContent = "현재 비밀번호를 확인해 주세요."; }
  };
}

// ---------------- 뷰: 인력사무소 ----------------
const TALENT_STATUS = {
  submitted: ["검토 대기", "badge-gray-o"],
  accepted: ["매칭 대기", "badge-navy-o"],
  assigned: ["해결 중", "badge-info-o"],
  ready_for_review: ["완료 확인 대기", "badge-warning-o"],
  changes_requested: ["보완 요청", "badge-warning-o"],
  completed: ["완료", "badge-success"],
  declined: ["반려", "badge-point-o"],
  approval_required: ["승인 필요", "badge-point-o"],
};
function talentBadge(status) {
  const [label, cls] = TALENT_STATUS[status] || [status, "badge-gray-o"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
async function renderTalentOffice(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>인력사무소</h1><p class="desc">학과의 반복되는 문제를 학생이 함께 해결합니다.</p></div>
      <button class="btn btn-primary" id="newTalentBtn">개선 요청하기</button>
    </div>
    <div class="panel-form hidden" id="talentEditor">
      <div class="form-head"><b>시스템 개선 요청</b><span>개인 문의나 시설 민원 대신, 여러 구성원이 반복해서 겪는 문제를 적어 주세요. 네 항목 모두 필수입니다.</span></div>
      <div class="field"><label for="trTitle">요청 제목 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="trTitle" placeholder="예: 수강 안내 반복 질문 줄이기" aria-required="true"></div>
      <div class="field"><label for="trProblem">현재 문제 <span class="req" aria-hidden="true">*</span></label>
        <textarea class="textarea" id="trProblem" aria-required="true"></textarea></div>
      <div class="field"><label for="trOutcome">원하는 결과 <span class="req" aria-hidden="true">*</span></label>
        <textarea class="textarea" id="trOutcome" aria-required="true"></textarea></div>
      <div class="field"><label for="trScope">왜 시스템 개선인가요? <span class="req" aria-hidden="true">*</span></label>
        <textarea class="textarea" id="trScope" placeholder="누가 얼마나 자주 겪는지 적어 주세요." aria-required="true"></textarea></div>
      <div class="form-actions"><button class="btn btn-primary" id="trSubmit">요청 등록하기</button>
        <button class="btn btn-tertiary" id="trCancel">취소</button>
        <p class="form-msg error" id="trErr" aria-live="polite"></p></div>
    </div>
    <div id="talentList"></div>`;
  const editor = document.getElementById("talentEditor");
  const r = await fetch("/api/talent-office");
  const data = await r.json();
  document.getElementById("talentList").innerHTML = (data.requests || []).length
    ? data.requests.map(item => `<a class="card" href="/talent-office/${item.id}" style="display:block;color:inherit;text-decoration:none">
        <div class="detail-meta" style="margin-bottom:6px"><b style="font-size:1.7rem">${esc(item.title)}</b>${talentBadge(item.status)}
          <span style="margin-left:auto">요청자 ${esc(item.requester_name)}</span></div>
        <div style="font-size:1.5rem;color:var(--krds-gray-70)">${esc(clipText(item.problem, 140))}</div>
      </a>`).join("")
    : '<div class="empty">아직 등록된 요청이 없습니다. 학과가 반복해서 겪는 문제를 첫 요청으로 남겨 보세요.</div>';
  document.getElementById("newTalentBtn").onclick = () => {
    editor.classList.toggle("hidden");
    if (!editor.classList.contains("hidden")) document.getElementById("trTitle").focus();
  };
  document.getElementById("trCancel").onclick = () => editor.classList.add("hidden");
  document.getElementById("trSubmit").onclick = async () => {
    const payload = {
      title: document.getElementById("trTitle").value.trim(),
      problem: document.getElementById("trProblem").value.trim(),
      expected_outcome: document.getElementById("trOutcome").value.trim(),
      system_scope_reason: document.getElementById("trScope").value.trim(),
    };
    const err = document.getElementById("trErr");
    err.textContent = "";
    if (Object.values(payload).some(v => !v)) { err.textContent = "네 항목을 모두 입력해 주세요."; return; }
    const res = await fetch("/api/talent-office", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) navigate("/talent-office");
    else err.textContent = "요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
}

async function renderTalentDetail(view, rid) {
  const r = await fetch(`/api/talent-office/${rid}`);
  if (!r.ok) {
    view.innerHTML = '<div class="empty">요청을 찾을 수 없거나 접근 권한이 없습니다.<br><a class="btn sm btn-secondary" href="/talent-office" style="margin-top:16px">인력사무소로 이동</a></div>';
    return;
  }
  const d = await r.json();
  const item = d.request;
  const mine = item.requester_member_id === ME.id;
  const operator = ["operator", "pi"].includes(ME.role);
  const assigned = (d.assignees || []).some(a => a.member_id === ME.id);
  const assigneesHtml = (d.assignees || []).length
    ? d.assignees.map(a => `${esc(a.name)} · ${esc(a.role || "담당")} · ${Math.round(a.allocation_ratio * 100)}%`).join("<br>")
    : "아직 매칭 전입니다.";
  view.innerHTML = `<div style="max-width:820px;margin:0 auto">
    <article class="card">
      <header class="detail-head">
        <div class="detail-meta">${talentBadge(item.status)}<span>요청자 ${esc(item.requester_name)}</span></div>
        <h1>${esc(item.title)}</h1>
      </header>
      <div class="detail-sec"><h2>문제</h2><div class="body">${esc(item.problem)}</div></div>
      <div class="detail-sec"><h2>기대 결과</h2><div class="body">${esc(item.expected_outcome)}</div></div>
      <div class="detail-sec"><h2>시스템 개선 근거</h2><div class="body">${esc(item.system_scope_reason)}</div></div>
      <div class="detail-sec"><h2>담당자</h2><div class="body">${assigneesHtml}</div></div>
      ${item.solution_summary || item.solution_url ? `<div class="detail-sec"><h2>결과물</h2><div class="body">${esc(item.solution_summary || "")}
        ${item.solution_url ? ` <a href="${esc(item.solution_url)}" target="_blank" rel="noopener noreferrer">결과물 열기</a>` : ""}</div></div>` : ""}
    </article>
    <div id="talentActions"></div></div>`;
  const actions = document.getElementById("talentActions");
  if (operator && item.status === "submitted") {
    actions.insertAdjacentHTML("beforeend", `<div class="panel-form" style="margin-top:16px">
      <div class="form-head"><b>운영 검토</b><span>수락하면 담당자 매칭 단계로 넘어갑니다.</span></div>
      <div class="field"><label for="reviewNote">운영 판단 메모</label><textarea class="textarea" id="reviewNote"></textarea></div>
      <div class="form-actions"><button class="btn btn-primary" id="acceptBtn">수락하기</button>
        <button class="btn btn-tertiary" id="declineBtn">반려</button></div></div>`);
  }
  if (operator && item.status === "accepted") {
    actions.insertAdjacentHTML("beforeend", `<div class="panel-form" style="margin-top:16px">
      <div class="form-head"><b>담당자 매칭</b><span>담당 학생이 합의한 배분 비중의 합은 100%여야 합니다.</span></div>
      <div class="field"><label for="assigneeRows">담당자와 배분 비중</label>
        <textarea class="textarea" id="assigneeRows" placeholder="멤버 ID, 비중(%)&#10;예: 12, 60&#10;예: 18, 40"></textarea></div>
      <div class="form-actions"><button class="btn btn-primary" id="assignBtn">담당자 배정하기</button></div></div>`);
  }
  if (assigned && item.status === "assigned") {
    actions.insertAdjacentHTML("beforeend", `<div class="panel-form" style="margin-top:16px">
      <div class="form-head"><b>해결 보고</b><span>완료 확인은 요청자가 합니다.</span></div>
      <div class="field"><label for="solutionSummary">해결 요약</label><textarea class="textarea" id="solutionSummary"></textarea></div>
      <div class="field"><label for="solutionUrl">결과물 링크</label><input class="input" id="solutionUrl"></div>
      <div class="form-actions"><button class="btn btn-primary" id="solutionBtn">완료 확인 요청하기</button></div></div>`);
  }
  if (mine && item.status === "ready_for_review") {
    actions.insertAdjacentHTML("beforeend", `<div class="panel-info" style="margin-top:16px">
      <b>결과물을 확인해 주세요.</b>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" id="completeBtn">완료 인정 · 10점 지급</button>
        <button class="btn btn-tertiary" id="changesBtn">보완 요청</button></div></div>`);
  }
  const byId = id => document.getElementById(id);
  const decide = async status => {
    const rr = await fetch(`/api/talent-office/${rid}/review`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_note: byId("reviewNote").value.trim() }) });
    if (rr.ok) route(`/talent-office/${rid}`, false);
  };
  if (byId("acceptBtn")) byId("acceptBtn").onclick = () => decide("accepted");
  if (byId("declineBtn")) byId("declineBtn").onclick = () => decide("declined");
  if (byId("assignBtn")) byId("assignBtn").onclick = async () => {
    const assignees = byId("assigneeRows").value.trim().split(/\n+/)
      .map(line => line.split(",").map(v => v.trim()))
      .map(([id, ratio]) => ({ member_id: Number(id), allocation_ratio: Number(ratio) / 100 }));
    const total = assignees.reduce((sum, a) => sum + a.allocation_ratio, 0);
    if (!assignees.length || assignees.some(a => !a.member_id || !a.allocation_ratio) || Math.abs(total - 1) > 0.000001) {
      alert("담당자 ID와 비중을 확인해 주세요. 비중의 합은 정확히 100%여야 합니다."); return;
    }
    const rr = await fetch(`/api/talent-office/${rid}/assignees`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignees }) });
    if (rr.ok) route(`/talent-office/${rid}`, false);
    else alert("배정하지 못했습니다. 멤버 ID와 비중을 확인해 주세요.");
  };
  if (byId("solutionBtn")) byId("solutionBtn").onclick = async () => {
    const rr = await fetch(`/api/talent-office/${rid}/solution`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ solution_summary: byId("solutionSummary").value.trim(), solution_url: byId("solutionUrl").value.trim() }) });
    if (rr.ok) route(`/talent-office/${rid}`, false);
  };
  if (byId("completeBtn")) byId("completeBtn").onclick = async () => {
    const rr = await fetch(`/api/talent-office/${rid}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "completed" }) });
    if (rr.ok) route(`/talent-office/${rid}`, false);
  };
  if (byId("changesBtn")) byId("changesBtn").onclick = async () => {
    await fetch(`/api/talent-office/${rid}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "changes_requested" }) });
    route(`/talent-office/${rid}`, false);
  };
}

// ---------------- 뷰: Goodbai API (개발자) ----------------
async function renderDeveloper(view) {
  view.innerHTML = `<div style="max-width:720px">
    <div class="page-head"><div><h1>Goodbai API</h1>
      <p class="desc">Codex /goodbai 또는 개인 스크립트가 BAI 피드에 글을 올릴 때 쓰는 개인 API key입니다. 단체 채팅방이나 GitHub에 올리지 마십시오.</p></div></div>
    <div class="panel-form">
      <div class="form-head"><b>내 Goodbai API key</b><span>학생 워크스페이스의 <code>python scripts\\bai_feed_config.py</code>에 한 번 저장합니다.</span></div>
      <div class="field"><label for="devName">이름</label><input class="input" id="devName" readonly></div>
      <div class="field"><label for="devKey">API key</label><input class="input mono" id="devKey" readonly></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="copyDevKeyBtn">복사하기</button>
        <button class="btn btn-tertiary" id="rotateDevKeyBtn">재발급</button>
        <p class="form-msg" id="devMsg" aria-live="polite"></p>
      </div>
    </div>
    <div class="card">
      <div class="detail-sec" style="padding-top:0"><h2>학생 설정 명령</h2><div class="body"><code>python scripts\\bai_feed_config.py</code></div></div>
      <div class="detail-sec"><h2>Codex 사용</h2><div class="body">작업 후 Codex에게 <b>/goodbai</b>를 실행하라고 말하면 진행 보고를 정리해 전송합니다.</div></div>
      <div class="detail-sec" style="border-bottom:0"><h2>API endpoint</h2><div class="body"><code>POST https://bai.haiinu.com/api/post</code><br><code>X-API-Key: 내 API key</code></div></div>
    </div>
    <div class="card"><div class="detail-sec" style="padding-top:0;border-bottom:0"><h2>curl 예시</h2>
      <pre id="devCurl" class="codeblock"></pre></div></div>
  </div>`;
  const msg = document.getElementById("devMsg");
  const load = async () => {
    const r = await fetch("/api/me?api_key=1");
    if (!r.ok) { msg.className = "form-msg error"; msg.textContent = "API key를 불러오지 못했습니다."; return; }
    const d = await r.json();
    document.getElementById("devName").value = d.name || "";
    document.getElementById("devKey").value = d.api_key || "";
    document.getElementById("devCurl").textContent = `curl -X POST https://bai.haiinu.com/api/post \\\n  -H 'Content-Type: application/json; charset=utf-8' \\\n  -H 'User-Agent: BAI-Goodbai-Codex/1.0 (+https://bai.haiinu.com)' \\\n  -H 'X-API-Key: ${d.api_key || "YOUR_API_KEY"}' \\\n  -d '{"did":"오늘 한 일","learned":"배운 것","blocked":"없음","tags":"goodbai","links":"","project_id":null}'`;
  };
  document.getElementById("copyDevKeyBtn").onclick = async () => {
    await navigator.clipboard.writeText(document.getElementById("devKey").value);
    msg.className = "form-msg ok"; msg.textContent = "복사했습니다.";
  };
  document.getElementById("rotateDevKeyBtn").onclick = async () => {
    if (!confirm("API key를 재발급하면 기존 key는 즉시 사용할 수 없습니다. 계속하시겠습니까?")) return;
    const r = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "regenerate_api_key" }) });
    if (r.ok) { await load(); msg.className = "form-msg ok"; msg.textContent = "새 API key를 발급했습니다."; }
    else { msg.className = "form-msg error"; msg.textContent = "재발급하지 못했습니다. 잠시 후 다시 시도해 주세요."; }
  };
  await load();
}

// ---------------- 뷰: 멤버 관리 (PI 전용) ----------------
async function renderAdminMembers(view) {
  view.innerHTML = `<div class="page-head"><div><h1>멤버 관리</h1>
    <p class="desc">PI 전용입니다. 학생 비밀번호 초기화, API key 재발급과 권한·상태 변경을 관리합니다.</p></div></div>
    <p class="form-msg ok" id="adminMsg" aria-live="polite"></p><div id="adminMembers"></div>`;
  const roleOptions = ["student", "admin_student", "developer", "operator", "pi"];
  const statusOptions = ["active", "disabled"];
  const wrap = document.getElementById("adminMembers");
  const load = async () => {
    const r = await fetch("/api/admin/members");
    if (!r.ok) { wrap.innerHTML = '<div class="empty">PI 계정만 접근할 수 있습니다.</div>'; return; }
    const data = await r.json();
    wrap.innerHTML = (data.members || []).map(m => `<div class="card">
      <div class="detail-meta" style="margin-bottom:12px">${avatar(m.name, true)}<b>${esc(m.name)}</b>
        <span>글 ${m.post_count || 0}건</span>
        <span class="badge ${m.status === "active" ? "badge-success" : "badge-gray-o"}">${esc(m.status)}</span>
        ${m.role !== "pi" ? `<button class="btn xs btn-tertiary" data-reset-password-member="${m.id}" style="margin-left:auto">비밀번호 1234 초기화</button>` : ""}
        <button class="btn xs btn-tertiary" data-rotate-member="${m.id}" ${m.role === "pi" ? 'style="margin-left:auto"' : ""}>API key 재발급</button></div>
      <div class="admin-controls">
        <select class="select sm" data-role-member="${m.id}" aria-label="권한">${roleOptions.map(x => `<option value="${x}" ${m.role === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <select class="select sm" data-status-member="${m.id}" aria-label="상태">${statusOptions.map(x => `<option value="${x}" ${m.status === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <button class="btn sm btn-secondary" data-save-member="${m.id}">저장</button>
      </div>
      <div class="panel-info hidden" id="newkey-${m.id}" style="margin-top:12px"><b>새 API key</b> <code></code></div>
    </div>`).join("");
    wrap.querySelectorAll("[data-rotate-member]").forEach(b => b.onclick = async () => {
      if (!confirm("이 학생의 API key를 재발급하시겠습니까? 기존 key는 무효화됩니다.")) return;
      const r = await fetch(`/api/admin/members/${b.dataset.rotateMember}/api-key/regenerate`, { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        const box = document.getElementById(`newkey-${b.dataset.rotateMember}`);
        box.classList.remove("hidden");
        box.querySelector("code").textContent = d.api_key;
      } else alert("재발급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    });
    wrap.querySelectorAll("[data-reset-password-member]").forEach(b => b.onclick = async () => {
      if (!confirm("이 학생의 비밀번호를 1234로 초기화하시겠습니까? 기존 비밀번호와 로그인 상태는 즉시 무효화됩니다.")) return;
      const r = await fetch(`/api/admin/members/${b.dataset.resetPasswordMember}/password/reset`, { method: "POST" });
      const msg = document.getElementById("adminMsg");
      if (r.ok) {
        msg.className = "form-msg ok";
        msg.textContent = "비밀번호를 1234로 초기화했습니다.";
      } else {
        msg.className = "form-msg error";
        msg.textContent = "비밀번호를 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      }
    });
    wrap.querySelectorAll("[data-save-member]").forEach(b => b.onclick = async () => {
      const id = b.dataset.saveMember;
      const payload = {
        role: wrap.querySelector(`[data-role-member="${id}"]`).value,
        status: wrap.querySelector(`[data-status-member="${id}"]`).value,
      };
      const r = await fetch(`/api/admin/members/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (r.ok) { document.getElementById("adminMsg").textContent = "저장했습니다."; load(); }
      else alert("저장하지 못했습니다. 자기 자신의 PI 권한은 낮출 수 없습니다.");
    });
  };
  await load();
}

// ---------------- 뷰: 로그인 ----------------
function renderLogin(view) {
  document.body.classList.add("login-mode");
  document.getElementById("header").hidden = true;
  document.getElementById("crumbWrap").hidden = true;
  document.getElementById("footer").hidden = true;
  view.innerHTML = `<div class="login-wrap">
    <section class="login-box" aria-label="로그인">
      <div class="login-box-head"><p>BAI</p><h1>로그인</h1>
        <span>멤버 계정으로 로그인하세요.</span></div>
      <form id="loginForm" action="/api/login" method="post" accept-charset="UTF-8">
        <div class="field"><label for="loginName">이름</label>
          <input class="input" id="loginName" name="name" autocomplete="username" required></div>
        <div class="field"><label for="loginPw">비밀번호</label>
          <input class="input" id="loginPw" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn lg btn-primary" id="loginBtn" type="submit">로그인</button>
        <p class="form-msg error" id="loginErr" aria-live="polite"></p>
      </form>
      <div class="login-note"><b>로그인이 처음인가요?</b><span>BAI 운영자에게 계정 발급을 요청해 주세요.</span></div>
    </section>
  </div>`;
  const loginError = new URL(location.href).searchParams.get("login_error");
  const messages = {
    credentials: "이름 또는 비밀번호가 올바르지 않습니다.",
    rate_limit: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    unavailable: "로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    cookie: "이 브라우저에서 로그인 정보를 저장하지 못했습니다. Safari 또는 Chrome에서 직접 열어 주세요.",
  };
  document.getElementById("loginErr").textContent = messages[loginError] || "";
  document.getElementById("loginName").focus();
}

// ---------------- 헤더/브레드크럼 ----------------
const GNB_GROUPS = [
  ["오늘", [["/", "홈", "home"], ["/feed", "자유 기록", "feed"]]],
  ["함께 만들기", [["/projects", "프로젝트", "projects"], ["/questions", "막힌 질문", "questions"], ["/talent-office", "인력사무소", "talent"]]],
  ["아카이브", [["/materials", "자료실", "materials"], ["/members", "멤버", "members"]]],
  ["도움", [["/search", "검색", "search"], ["/ask", "FAQ", "ask"]]],
];
const GNB_ITEMS = GNB_GROUPS.flatMap(([, items]) => items);
function buildHeader() {
  document.getElementById("gnb").innerHTML = GNB_GROUPS.map(([group, items]) =>
    `<div class="nav-group"><p>${group}</p>${items.map(([href, label, key]) =>
      `<a href="${href}" data-view="${key}"><span>${label}</span></a>`).join("")}</div>`).join("");
  const isPI = ME.role === "pi";
  const admin = isPI ? '<a href="/admin/members" data-view="admin">멤버 관리</a>' : "";
  const piOs = isPI ? '<a href="https://os.bai.haiinu.com/" target="_blank" rel="noopener">PI OS</a>' : "";
  document.getElementById("hdUtil").innerHTML = `
    <a class="account-profile" href="/member/${ME.id}">${avatar(ME.name, true)}<span><b>${esc(ME.name)}</b><small>내 프로필</small></span></a>
    <div class="account-links"><a href="/developer" data-view="developer">Goodbai API</a>
      <a href="/account" data-view="account">계정 설정</a>
      <button id="logoutBtn" type="button">로그아웃</button>${admin}${piOs}</div>`;
  document.getElementById("logoutBtn").onclick = async () => {
    await fetch("/api/logout", { method: "POST" });
    clearWallPoll();
    location.href = "/login";
  };
}
function setCrumb(key, extra) {
  const wrap = document.getElementById("crumbWrap");
  const names = {
    home: "홈", feed: "자유 기록", projects: "프로젝트", materials: "자료실", questions: "막힌 질문",
    ask: "FAQ", members: "멤버", search: "검색", account: "계정",
    developer: "Goodbai API", admin: "멤버 관리", talent: "인력사무소",
  };
  if (key === "home" && !extra) { wrap.hidden = true; return; }
  let h = `<a href="/">홈</a>`;
  if (names[key]) {
    const gnbHref = (GNB_ITEMS.find(i => i[2] === key) || ["/"])[0];
    h += `<span class="sep" aria-hidden="true">&gt;</span>`;
    h += extra ? `<a href="${gnbHref}">${names[key]}</a>` : `<span class="cur">${names[key]}</span>`;
  }
  if (extra) h += `<span class="sep" aria-hidden="true">&gt;</span><span class="cur">${esc(extra)}</span>`;
  document.getElementById("crumb").innerHTML = h;
  wrap.hidden = false;
}

// ---------------- 라우터 (pushState 경로 기반) ----------------
function matchRoute(path) {
  const url = new URL(path, location.origin);
  const p = url.pathname;
  const params = url.searchParams;
  if (p === "/" || p === "" || p === "/index.html" || p === "/feed.html") return ["home", v => renderHome(v), null];
  if (p === "/feed") return ["feed", v => renderFeed(v), null];
  if (p === "/questions") return ["questions", v => renderQuestions(v), null];
  if (p === "/ask") return ["ask", v => renderAsk(v), null];
  if (p === "/talent-office") return ["talent", v => renderTalentOffice(v), null];
  if (p.startsWith("/talent-office/")) { const id = +p.split("/")[2]; return ["talent", v => renderTalentDetail(v, id), "요청 상세"]; }
  if (p === "/projects") return ["projects", v => renderProjects(v), null];
  if (p.startsWith("/projects/")) { const id = +p.split("/")[2]; return ["projects", v => renderProjectDetail(v, id), "프로젝트 상세"]; }
  if (p === "/materials") return ["materials", v => renderMaterials(v), null];
  if (p === "/members") return ["members", v => renderMembers(v), null];
  if (p === "/developer" || p === "/goodbai" || (p === "/account" && params.get("goodbai") === "1"))
    return ["developer", v => renderDeveloper(v), null];
  if (p === "/admin/members") return ["admin", v => renderAdminMembers(v), null];
  if (p === "/account") return ["account", v => renderAccount(v), null];
  if (p.startsWith("/search")) return ["search", v => renderSearch(v, params.get("q") || ""), null];
  if (p.startsWith("/post/")) { const id = +p.split("/")[2]; return ["home", v => renderPostDetail(v, id), "글 상세"]; }
  if (p.startsWith("/member/")) { const id = +p.split("/")[2]; return ["members", v => renderMemberProfile(v, id), "프로필"]; }
  if (p.startsWith("/tag/")) { const t = decodeURIComponent(p.split("/")[2] || ""); return ["search", v => renderTag(v, t), "태그"]; }
  return ["home", v => renderHome(v), null];
}
async function route(path, push) {
  if (!ME) { renderLogin(document.getElementById("view")); return; }
  clearWallPoll();
  const targetUrl = new URL(path, location.origin);
  const [key, fn, detailLabel] = matchRoute(path);
  document.body.dataset.view = key;
  document.querySelectorAll("#gnb a[data-view], #hdUtil a[data-view]").forEach(a =>
    a.classList.toggle("on", a.dataset.view === key));
  setCrumb(key, detailLabel);
  if (push) history.pushState({}, "", path);
  if (!targetUrl.hash) window.scrollTo(0, 0);
  const view = document.getElementById("view");
  try {
    await fn(view);
  } catch (error) {
    console.error("BAI view render failed", error);
    view.innerHTML = `<div class="empty"><b>화면을 불러오지 못했습니다.</b><br>
      저장된 기록은 그대로 있습니다. 잠시 후 다시 시도해 주세요.<br>
      <button class="btn sm btn-secondary" id="retryViewBtn" type="button" style="margin-top:16px">다시 불러오기</button></div>`;
    document.getElementById("retryViewBtn").onclick = () => route(location.pathname + location.search + location.hash, false);
    return;
  }
  if (targetUrl.hash) document.querySelector(targetUrl.hash)?.scrollIntoView({ block: "start" });
}
function navigate(path) { route(path, true); }

// ---------------- 초기화 ----------------
const ROUTE_RE = /^\/(?:$|feed|post\/|member\/|members|projects|talent-office|materials|developer|goodbai|admin\/members|search|questions|ask|account|tag\/)/;
async function initApp() {
  const view = document.getElementById("view");
  try {
    ME = await getMe();
  } catch (error) {
    console.error("BAI session check failed", error);
    view.innerHTML = `<div class="empty"><b>BAI 서버에 연결하지 못했습니다.</b><br>
      기록은 삭제되지 않았습니다. 잠시 후 새로고침해 주세요.</div>`;
    return;
  }
  if (!ME) { renderLogin(view); return; }
  document.body.classList.remove("login-mode");
  if (location.pathname === "/login") { history.replaceState({}, "", "/"); }
  PROJECTS = await fetch("/api/projects").then(r => r.ok ? r.json() : []).catch(() => []);
  document.getElementById("header").hidden = false;
  document.getElementById("footer").hidden = false;
  buildHeader();
  if (!window.__krdsRouterWired) {
    // 내부 링크 위임 클릭 → 전체 새로고침 없이 SPA 이동
    document.addEventListener("click", e => {
      const clickedToggle = e.target.closest("#sidebarToggle");
      if (clickedToggle) {
        const open = document.body.classList.toggle("sidebar-open");
        clickedToggle.setAttribute("aria-expanded", String(open));
        return;
      }
      const a = e.target.closest("a"); if (!a) return;
      if (a.dataset.full || a.target === "_blank") return;
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("/") || !ROUTE_RE.test(href)) return;
      e.preventDefault();
      document.body.classList.remove("sidebar-open");
      document.getElementById("sidebarToggle")?.setAttribute("aria-expanded", "false");
      navigate(href);
    });
    window.addEventListener("popstate", () => route(location.pathname + location.search + location.hash, false));
    window.__krdsRouterWired = true;
  }
  route(location.pathname + location.search + location.hash, false);
}
