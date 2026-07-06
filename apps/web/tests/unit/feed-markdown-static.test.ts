import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const feedJs = fs.readFileSync(path.join(process.cwd(), 'public/static/feed.js'), 'utf8');

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));
}

function loadFeedHelpers() {
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
  vm.runInContext(feedJs, context);
  return context as typeof context & {
    sectionsHtml: (post: Record<string, unknown>) => string;
    materialMarkdownHtml: (body: string) => string;
  };
}

describe('legacy feed markdown rendering', () => {
  it('renders markdown structure in full feed post sections instead of plain escaped text', () => {
    const { sectionsHtml } = loadFeedHelpers();
    const html = sectionsHtml({
      did: '## 실험 결과\n\n- 정확도 **0.91**\n- [데모](https://example.com)',
      learned: '> 기준선 비교가 필요함',
      blocked: '`CUDA` 오류 확인',
    });

    expect(html).toContain('<h2>실험 결과</h2>');
    expect(html).toContain('<li>정확도 <strong>0.91</strong></li>');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<code>CUDA</code>');
  });

  it('renders material bodies as safe markdown and strips executable html', () => {
    const { materialMarkdownHtml } = loadFeedHelpers();
    const html = materialMarkdownHtml('# 미션\n\n1. 준비\n\n<script>alert(1)</script>');

    expect(html).toContain('<h1>미션</h1>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>준비</li>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('contains the material file upload controls in the Next-served legacy shell', () => {
    expect(feedJs).toContain('id="materialFile" type="file"');
    expect(feedJs).toContain('new FormData()');
    expect(feedJs).toContain('payload.append("file", selectedFile)');
    expect(feedJs).toContain('m.file_url');
  });
});
