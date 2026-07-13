#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(webRoot, '..', '..');

const checks = [];
const failures = [];

function check(name, fn) {
  checks.push({ name, fn });
}

function read(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

function sha(rel) {
  return createHash('sha256').update(readFileSync(path.join(repoRoot, rel))).digest('hex');
}

function expect(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function relExists(rel) {
  return existsSync(path.join(repoRoot, rel));
}

const routePages = [
  'apps/web/src/app/page.tsx',
  'apps/web/src/app/materials/page.tsx',
  'apps/web/src/app/account/page.tsx',
  'apps/web/src/app/admin/members/page.tsx',
  'apps/web/src/app/ask/page.tsx',
  'apps/web/src/app/member/[mid]/page.tsx',
  'apps/web/src/app/members/page.tsx',
  'apps/web/src/app/post/[pid]/page.tsx',
  'apps/web/src/app/projects/page.tsx',
  'apps/web/src/app/projects/[pid]/page.tsx',
  'apps/web/src/app/talent-office/page.tsx',
  'apps/web/src/app/talent-office/[rid]/page.tsx',
  'apps/web/src/app/questions/page.tsx',
  'apps/web/src/app/search/page.tsx',
  'apps/web/src/app/tag/[tag]/page.tsx',
];

check('Park PR design source files exist', () => {
  const missing = [
    'frontend/krds.css',
    'frontend/krds.js',
    'apps/web/public/static/krds.css',
    'apps/web/public/static/krds.js',
    'apps/web/src/components/LegacyShell.tsx',
  ].filter((rel) => !relExists(rel));
  expect(!missing.length, 'Required design source files are missing', missing);
});

check('Park PR CSS is the exact CSS served by Next', () => {
  expect(
    sha('frontend/krds.css') === sha('apps/web/public/static/krds.css'),
    'apps/web/public/static/krds.css must be byte-identical to frontend/krds.css',
    ['frontend/krds.css', 'apps/web/public/static/krds.css'],
  );
});

check('Park PR page renderer is the exact JS served by Next', () => {
  expect(
    sha('frontend/krds.js') === sha('apps/web/public/static/krds.js'),
    'apps/web/public/static/krds.js must be byte-identical to frontend/krds.js',
    ['frontend/krds.js', 'apps/web/public/static/krds.js'],
  );
});

check('Park PR KRDS tokens are present in the served CSS', () => {
  const css = read('apps/web/public/static/krds.css');
  const missing = [
    'KRDS',
    '--krds-primary-50: #256EF4',
    '--krds-gray-90: #1E2124',
    '--krds-focus: 0 0 0 4px rgba(37, 110, 244, .45)',
    '.gnb a.on',
    '.hd-main',
    'prefers-reduced-motion',
  ].filter((token) => !css.includes(token));
  expect(!missing.length, 'Served CSS is missing Park PR KRDS design tokens', missing);
});

check('Next student routes use the legacy feed shell, not React page reinterpretations', () => {
  const offenders = [];
  for (const rel of routePages) {
    const source = read(rel);
    if (!source.includes("import { LegacyFeedShell } from '@/components/LegacyShell';")) {
      offenders.push(`${rel}: missing LegacyFeedShell import`);
    }
    if (!source.includes('return <LegacyFeedShell />;')) {
      offenders.push(`${rel}: does not return LegacyFeedShell`);
    }
    if (source.includes('AppShell') || source.includes('resource-card') || source.includes('feed-card')) {
      offenders.push(`${rel}: still contains React reinterpretation markup`);
    }
  }
  expect(!offenders.length, 'Student routes are not all delegated to the original feed renderer', offenders);
});

check('LegacyShell mounts the exact DOM contract expected by Park PR krds.js', () => {
  const shell = read('apps/web/src/components/LegacyShell.tsx');
  const missing = [
    'href="/static/krds.css?v=20260713krds1',
    'id="header"',
    'id="gnb"',
    'id="crumbWrap"',
    'id="view"',
    'id="footer"',
    "script.src = '/static/krds.js?v=20260713krds1'",
    'script.onload = () => window.initApp?.()',
  ].filter((token) => !shell.includes(token));
  expect(!missing.length, 'LegacyShell does not mount the KRDS shell DOM/script contract', missing);
  expect(!shell.includes('20260713to4') && !shell.includes('20260713to5'), 'LegacyShell still references a stale legacy asset URL');
});

check('Park PR feed renderer controls page-level design labels', () => {
  const js = read('apps/web/public/static/krds.js');
  const missing = [
    '전체 피드',
    '인력사무소',
    '프로젝트',
    '자료실',
    '막힌 질문',
    '문의·FAQ',
    '공감 <span class="rc">',
    '진행 여정 (처음 → 최근)',
    'Goodbai API',
    '멤버 관리',
  ].filter((token) => !js.includes(token));
  expect(!missing.length, 'Served feed renderer is missing Park PR page design strings', missing);
});

check('Merged talent-office design is present in the JavaScript served by Next', () => {
  const js = read('apps/web/public/static/krds.js');
  const missing = [
    'const roleOptions = ["student", "admin_student", "developer", "operator", "pi"]',
    'function talentBadge(status)',
    '개선 요청하기',
    '요청 등록하기',
    '운영 검토',
    '완료 인정 · 10점 지급',
  ].filter((token) => !js.includes(token));
  expect(!missing.length, 'Served feed renderer is missing merged PR #4 behavior', missing);
});

for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message, details: error.details });
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    if (error.details) console.error(`  ${JSON.stringify(error.details)}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`\n${checks.length}/${checks.length} checks passed.`);
