import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const krdsJs = fs.readFileSync(path.join(process.cwd(), 'public/static/krds.js'), 'utf8');
const krdsCss = fs.readFileSync(path.join(process.cwd(), 'public/static/krds.css'), 'utf8');
const globalsCss = fs.readFileSync(path.join(process.cwd(), 'src/styles/globals.css'), 'utf8');
const legacyShell = fs.readFileSync(path.join(process.cwd(), 'src/components/LegacyShell.tsx'), 'utf8');

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));
}

function loadKrdsHelpers() {
  const context = vm.createContext({
    document: { createElement: () => ({ textContent: '', get innerHTML() { return escapeHtml(this.textContent); } }) },
    encodeURIComponent,
    String,
    RegExp,
    URL,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    location: { href: '', origin: 'http://localhost', pathname: '/', search: '' },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener() {}, scrollTo() {} },
    navigator: { clipboard: { writeText: async () => undefined } },
    confirm: () => true,
    alert: () => undefined,
  });
  vm.runInContext(krdsJs, context);
  return context as typeof context & {
    markdownHtml: (body: string) => string;
    fullCard: (post: Record<string, unknown>) => string;
    postTitle: (post: Record<string, unknown>) => string;
    talentBadge: (status: string) => string;
  };
}

describe('KRDS feed renderer static behavior', () => {
  it('renders markdown structure in post bodies instead of plain escaped text', () => {
    const { markdownHtml } = loadKrdsHelpers();
    const html = markdownHtml('## 실험 결과\n\n- 정확도 **0.91**\n- [데모](https://example.com)\n\n> 기준선 비교가 필요함\n\n`CUDA` 오류 확인');

    expect(html).toContain('<h2>실험 결과</h2>');
    expect(html).toContain('<li>정확도 <strong>0.91</strong></li>');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<code>CUDA</code>');
  });

  it('strips executable html from markdown bodies', () => {
    const { markdownHtml } = loadKrdsHelpers();
    const html = markdownHtml('# 미션\n\n1. 준비\n\n<script>alert(1)</script>');

    expect(html).toContain('<h1>미션</h1>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>준비</li>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('uses markdown sections and KRDS badges in the full post card', () => {
    const { fullCard } = loadKrdsHelpers();
    const html = fullCard({
      id: 1, author_id: 2, author_name: '김서연', created_at: '2026-07-13 00:00:00',
      did: '**베이스라인** 확보', learned: '', blocked: '라벨 기준 고민',
      tags: '실험', links: '', reaction_count: 0, comment_count: 0,
    });

    expect(html).toContain('<strong>베이스라인</strong>');
    expect(html).toContain('막힌 점');
    expect(html).toContain('공감 <span class="rc">');
  });

  it('keeps the site canvas white', () => {
    expect(globalsCss.match(/--bg: #ffffff;/g)).toHaveLength(2);
    expect(krdsCss).toContain('--bai-bg: #ffffff;');
  });

  it('shows the complete feed title without truncating long text', () => {
    const { postTitle } = loadKrdsHelpers();
    const longTitle = '긴 피드 제목도 사용자가 작성한 전체 내용을 생략 없이 확인할 수 있어야 합니다. '.repeat(4).trim();

    expect(postTitle({ did: longTitle })).toBe(longTitle);
  });

  it('maps talent office statuses to KRDS semantic badges with text labels', () => {
    const { talentBadge } = loadKrdsHelpers();
    expect(talentBadge('submitted')).toContain('검토 대기');
    expect(talentBadge('assigned')).toContain('badge-info-o');
    expect(talentBadge('completed')).toContain('badge-success');
    expect(talentBadge('declined')).toContain('badge-point-o');
  });

  it('serves Park PR KRDS renderer strings without Next-only reinterpretation edits', () => {
    expect(krdsJs).toContain('인력사무소');
    expect(krdsJs).toContain('공감 <span class="rc">');
    expect(krdsJs).toContain('진행 여정 (처음 → 최근)');
    expect(krdsJs).toContain('이번 주 BAI 체크인');
  });

  it('keeps free records separate from project activity and blocked questions', () => {
    expect(krdsJs).toContain('function renderFeed(view)');
    expect(krdsJs).toContain('function freeRecordFormHtml()');
    expect(krdsJs).toContain('${freeRecordFormHtml()}');
    expect(krdsJs).toContain('한 일 또는 배운 것을 입력해 주세요.');
    expect(krdsJs).toContain('const records = allPosts.filter(p => !p.project_id);');
    expect(krdsJs).toContain('const freeRecords = ALL.filter(p => !p.project_id);');
    expect(krdsJs).toContain('["/feed", "자유 기록", "feed"]');
  });

  it('lets the blocked question tab create and show unanswered blocked questions', () => {
    expect(krdsJs).toContain('function questionFormHtml()');
    expect(krdsJs).toContain('id="newQuestionBtn">질문하기');
    expect(krdsJs).toContain('if (!payload.blocked) { err.textContent = "막힌 질문을 입력해 주세요."; return; }');
    expect(krdsJs).toContain('답변이 달리면 자유 기록과 글 상세에는 남고 이 목록에서는 사라집니다.');
  });

  it('uses the weekly API count and preserves deep-link hashes during route refreshes', () => {
    expect(krdsJs).toContain('week_count || 0');
    expect(krdsJs).toContain('route(location.pathname + location.search + location.hash, false)');
    expect(krdsJs).toContain('window.addEventListener("popstate", () => route(location.pathname + location.search + location.hash, false))');
    expect(krdsJs).not.toContain('if (rr.ok) route();');
  });

  it('recovers expired sessions and renderer failures without implying that records were deleted', () => {
    expect(krdsJs).toContain('response.status === 401');
    expect(krdsJs).toContain('location.replace("/login")');
    expect(krdsJs).toContain('저장된 기록은 그대로 있습니다.');
    expect(krdsJs).toContain('id="retryViewBtn"');
  });

  it('uses a top-level login form so mobile browsers commit the session cookie before navigation', () => {
    expect(krdsJs).toContain('<form id="loginForm" action="/api/login" method="post"');
    expect(krdsJs).toContain('login_error');
    expect(krdsJs).not.toContain('fetch("/api/login"');
    expect(krdsJs).not.toContain('fetch("/api/auth/login"');
    expect(krdsJs).not.toContain('document.getElementById("loginForm").onsubmit');
    expect(krdsJs).not.toContain('함께 만든 과정이');
    expect(krdsJs).not.toContain('class="login-intro"');
  });

  it('busts the cached login script when the mobile session flow changes', () => {
    expect(legacyShell).toContain("const ASSET_VERSION = '20260723-mobile-login1';");
  });

  it('includes the redesigned project, material, question, and member surfaces', () => {
    expect(krdsJs).toContain('class="project-grid"');
    expect(krdsJs).toContain('class="material-side"');
    expect(krdsJs).toContain('class="question-feed"');
    expect(krdsJs).toContain('class="question-card"');
    expect(krdsJs).toContain('["/ask", "FAQ", "ask"]');
    expect(krdsJs).toContain('class="account-profile"');
    expect(krdsJs).toContain('class="account-links"');
    expect(krdsJs).toContain('class="member-grid"');
  });
});
