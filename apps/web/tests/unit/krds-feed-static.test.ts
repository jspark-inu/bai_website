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

function loadKrdsHelpers(
  fetchImpl: typeof fetch = async () => new Response('{}', { status: 200 }),
  documentImpl: Record<string, unknown> | null = null,
) {
  const context = vm.createContext({
    document: documentImpl ?? { createElement: () => ({ textContent: '', get innerHTML() { return escapeHtml(this.textContent); } }) },
    encodeURIComponent,
    String,
    RegExp,
    URL,
    fetch: fetchImpl,
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
    materialFileLink: (material: Record<string, unknown>) => string;
    availabilityGridHtml: (data: Record<string, unknown>) => string;
    renderAvailability: (view: Record<string, unknown>, weekStart?: string) => Promise<void>;
    availabilityRectangleKeys: (
      start: { day: number; hour: number },
      end: { day: number; hour: number },
    ) => string[];
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
    expect(krdsJs).toContain('이 브라우저에서 로그인 정보를 저장하지 못했습니다.');
    expect(krdsJs).not.toContain('fetch("/api/login"');
    expect(krdsJs).not.toContain('fetch("/api/auth/login"');
    expect(krdsJs).not.toContain('document.getElementById("loginForm").onsubmit');
    expect(krdsJs).not.toContain('함께 만든 과정이');
    expect(krdsJs).not.toContain('class="login-intro"');
  });

  it('busts the cached login script when the mobile session flow changes', () => {
    expect(legacyShell).toContain("const ASSET_VERSION = '20260730-availability-history1';");
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

  it('renders managed material attachments as safe download links', () => {
    const { materialFileLink } = loadKrdsHelpers();
    const html = materialFileLink({
      file_url: '/uploads/materials/fixture-file.pdf',
      file_name: 'BAI 안내서 <최종>.pdf',
    });

    expect(html).toContain('href="/uploads/materials/fixture-file.pdf" download');
    expect(html).toContain('첨부파일 다운로드: BAI 안내서 &lt;최종&gt;.pdf');
    expect(materialFileLink({ file_url: 'javascript:alert(1)', file_name: '위험한 파일' })).toBe('');
    expect(krdsJs).toContain('const links = [materialFileLink(m), m.url ? linkChips(m.url, 56) : ""]');
  });

  it('offers the PI a confirmed member password reset to 1234', () => {
    expect(krdsJs).toContain('data-reset-password-member');
    expect(krdsJs).toContain('m.role !== "pi"');
    expect(krdsJs).toContain('비밀번호를 1234로 초기화');
    expect(krdsJs).toContain('/password/reset`');
    expect(krdsJs).toContain('비밀번호를 1234로 초기화했습니다.');
  });

  it('renders the signed-in member weekday schedule from 10:00 as 70 one-hour buttons without a name field', () => {
    const { availabilityGridHtml } = loadKrdsHelpers();
    const html = availabilityGridHtml({
      member: { id: 1, name: '김학생', role: 'student' },
      week: {
        start: '2026-07-27', end: '2026-07-31',
        days: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'],
      },
      responded: false,
      unavailable: false,
      slots: [{ day: 0, hour: 10 }],
      summary: null,
    });

    expect(html).toContain('김학생님의 다음 주 가능 시간을 선택합니다.');
    expect(html.match(/class="availability-cell/g)).toHaveLength(70);
    expect(html).toContain('data-day="0" data-hour="10" aria-pressed="true"');
    expect(html).toContain('월<span>7/27</span>');
    expect(html).toContain('다음 주 가능 시간');
    expect(html).toContain('id="availabilityUnavailable"');
    expect(html).toContain('다음 주는 어렵습니다');
    expect(html).not.toContain('매주 반복');
    expect(html).not.toContain('data-hour="9"');
    expect(html).not.toContain('data-day="5"');
    expect(html).not.toContain('>토<');
    expect(html).not.toContain('>일<');
    expect(html).not.toContain('name="name"');
  });

  it('renders selectable week tabs and keeps a prior week read-only', () => {
    const { availabilityGridHtml } = loadKrdsHelpers();
    const html = availabilityGridHtml({
      member: { id: 2, name: '박교수', role: 'pi' },
      week: {
        start: '2026-07-27', end: '2026-07-31',
        days: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'],
      },
      weeks: [
        {
          start: '2026-08-03', end: '2026-08-07', current: true,
          days: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'],
        },
        {
          start: '2026-07-27', end: '2026-07-31', current: false,
          days: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'],
        },
      ],
      editable: false,
      responded: true,
      unavailable: false,
      slots: [{ day: 0, hour: 10 }],
      summary: {
        memberCount: 3, respondedCount: 2, unavailableCount: 0, unavailableNames: [],
        slots: [{ day: 0, hour: 10, count: 2, names: ['김학생', '이학생'] }],
      },
    });

    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-availability-week="2026-08-03"');
    expect(html).toContain('8월 1째 주');
    expect(html).toContain('data-availability-week="2026-07-27"');
    expect(html).toContain('7월 4째 주');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('지난 투표 결과');
    expect(html).not.toContain('id="saveAvailabilityBtn"');
    expect(html).not.toContain('id="availabilityUnavailable"');
    expect(html).toContain('data-day="0" data-hour="10" aria-pressed="true" aria-disabled="true" disabled');
  });

  it('does not let a slower prior week request replace the latest selected week', async () => {
    const pending = new Map<string, (response: Response) => void>();
    const { renderAvailability } = loadKrdsHelpers((resource) => new Promise((resolve) => {
      pending.set(String(resource), resolve);
    }));
    const writes: string[] = [];
    const view = {
      set innerHTML(value: string) { writes.push(value); },
      querySelectorAll: () => [],
    };
    const payload = (start: string, name: string) => ({
      member: { id: 1, name, role: 'student' },
      week: { start, end: start, days: [start, start, start, start, start] },
      weeks: [{ start, end: start, days: [start, start, start, start, start], current: false }],
      editable: false, responded: true, unavailable: false, slots: [], summary: null,
    });

    const older = renderAvailability(view, '2026-07-20');
    const latest = renderAvailability(view, '2026-07-27');
    pending.get('/api/availability?week=2026-07-27')?.(new Response(
      JSON.stringify(payload('2026-07-27', '최신 선택')),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    await latest;
    pending.get('/api/availability?week=2026-07-20')?.(new Response(
      JSON.stringify(payload('2026-07-20', '늦은 이전 응답')),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    await older;

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('최신 선택');
    expect(writes[0]).not.toContain('늦은 이전 응답');
  });

  it('keeps a historical week selected when an earlier current-week save finishes late', async () => {
    let finishSave: ((response: Response) => void) | undefined;
    const current = {
      member: { id: 1, name: '현재 사용자', role: 'student' },
      week: { start: '2026-08-03', end: '2026-08-07', days: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'] },
      weeks: [
        { start: '2026-08-03', end: '2026-08-07', days: [], current: true },
        { start: '2026-07-27', end: '2026-07-31', days: [], current: false },
      ],
      editable: true, responded: true, unavailable: false, slots: [], summary: null,
    };
    const history = {
      ...current,
      member: { id: 1, name: '과거 선택 유지', role: 'student' },
      week: { start: '2026-07-27', end: '2026-07-31', days: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'] },
      editable: false,
    };
    const cellList: unknown[] = [];
    const grid = {
      classList: { toggle() {} },
      querySelectorAll: () => cellList,
      addEventListener() {},
    };
    const unavailable = { checked: false, addEventListener() {} };
    const message = { textContent: '', className: '' };
    const saveButton: { onclick?: () => Promise<void> } = {};
    const elements: Record<string, unknown> = {
      availabilityGrid: grid,
      availabilityUnavailable: unavailable,
      availabilityCount: { textContent: '' },
      availabilityMsg: message,
      clearAvailabilityBtn: {},
      saveAvailabilityBtn: saveButton,
    };
    const documentImpl = {
      createElement: () => ({ textContent: '', get innerHTML() { return escapeHtml(this.textContent); } }),
      getElementById: (id: string) => elements[id],
      addEventListener() {},
    };
    const fetchImpl = ((resource: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') return new Promise<Response>((resolve) => { finishSave = resolve; });
      const selectedHistory = String(resource).includes('week=2026-07-27');
      return Promise.resolve(new Response(JSON.stringify(selectedHistory ? history : current), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }) as typeof fetch;
    const { renderAvailability } = loadKrdsHelpers(fetchImpl, documentImpl);
    const writes: string[] = [];
    const view = {
      set innerHTML(value: string) { writes.push(value); },
      querySelectorAll: () => [],
    };

    await renderAvailability(view);
    const saving = saveButton.onclick?.();
    await renderAvailability(view, '2026-07-27');
    finishSave?.(new Response('{}', { status: 200 }));
    await saving;

    expect(writes).toHaveLength(2);
    expect(writes.at(-1)).toContain('과거 선택 유지');
  });

  it('fills every hour inside a weekday drag rectangle in either direction', () => {
    const { availabilityRectangleKeys } = loadKrdsHelpers();

    const expected = ['1-10', '1-11', '2-10', '2-11'];
    expect(availabilityRectangleKeys({ day: 1, hour: 9 }, { day: 2, hour: 11 })).toEqual(expected);
    expect(availabilityRectangleKeys({ day: 2, hour: 11 }, { day: 1, hour: 9 })).toEqual(expected);
  });

  it('uses a fresh mint palette and elevated cards for the availability view', () => {
    expect(krdsCss).toContain('body[data-view="availability"] {');
    expect(krdsCss).toContain('--availability-mint: #2f9f7b;');
    expect(krdsCss).toContain('linear-gradient(135deg, #2f9f7b, #59c5a1)');
    expect(krdsCss).toContain('box-shadow: 0 12px 32px rgba(25, 88, 72, .08);');
  });

  it('adds a session-time route, save action, and PI-only overlap summary', () => {
    const { availabilityGridHtml } = loadKrdsHelpers();
    const html = availabilityGridHtml({
      member: { id: 2, name: '박교수', role: 'pi' },
      week: {
        start: '2026-07-27', end: '2026-07-31',
        days: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'],
      },
      responded: true,
      unavailable: false,
      slots: [],
      summary: {
        memberCount: 3,
        respondedCount: 2,
        unavailableCount: 1,
        unavailableNames: ['최학생'],
        slots: [{ day: 0, hour: 10, count: 2, names: ['김학생', '이학생'] }],
      },
    });

    expect(krdsJs).toContain('["/availability", "세션 시간", "availability"]');
    expect(krdsJs).toContain('function renderAvailability(view, weekStart = "")');
    expect(krdsJs).toContain('fetch(`/api/availability${query}`)');
    expect(krdsJs).toContain('method: "PUT"');
    expect(krdsJs).toContain('JSON.stringify({ weekStart: data.week.start, slots: unavailable ? [] : slots, unavailable })');
    expect(krdsJs).toContain('if (save.status === 409)');
    expect(krdsJs).toContain('unavailableInput.addEventListener("change", syncUnavailable)');
    expect(krdsJs).toContain('await renderAvailability(view);');
    expect(krdsJs).toContain('availabilityRectangleKeys(dragStart, end)');
    expect(krdsJs).toContain('let pointerHandledKey = "";');
    expect(krdsJs).not.toContain('setTimeout(() => { suppressClick');
    expect(html).toContain('응답 2/3명');
    expect(html).toContain('김학생, 이학생');
    expect(html).toContain('참여 어려움 1명');
    expect(html).toContain('최학생');
    expect(html).toContain('좌우로 밀어 다른 평일');
    expect(krdsCss).toContain('.availability-grid');
    expect(krdsCss).toContain('.availability-hour { position: sticky; left: 0;');
    expect(krdsCss).toContain('.availability-layout { display: grid; grid-template-columns: 1fr;');
    expect(krdsCss).toContain('.availability-unavailable');
    expect(krdsCss).not.toContain('var(--krds-primary-30)');
  });
});
