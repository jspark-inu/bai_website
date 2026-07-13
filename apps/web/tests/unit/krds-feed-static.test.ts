import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const krdsJs = fs.readFileSync(path.join(process.cwd(), 'public/static/krds.js'), 'utf8');

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
});
