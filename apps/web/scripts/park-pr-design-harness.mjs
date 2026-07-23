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
  'apps/web/src/app/feed/page.tsx',
  'apps/web/src/app/developer/page.tsx',
  'apps/web/src/app/goodbai/page.tsx',
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

check('Approved KRDS source and live asset files exist', () => {
  const missing = [
    'frontend/krds.html',
    'frontend/krds.css',
    'frontend/krds.js',
    'apps/web/public/static/krds.css',
    'apps/web/public/static/krds.js',
    'apps/web/src/components/LegacyShell.tsx',
  ].filter((rel) => !relExists(rel));
  expect(!missing.length, 'Required KRDS source or live asset files are missing', missing);
});

check('Approved KRDS CSS is byte-identical to the CSS served by Next', () => {
  expect(
    sha('frontend/krds.css') === sha('apps/web/public/static/krds.css'),
    'apps/web/public/static/krds.css must be byte-identical to frontend/krds.css',
    ['frontend/krds.css', 'apps/web/public/static/krds.css'],
  );
});

check('Approved KRDS renderer is byte-identical to the JavaScript served by Next', () => {
  expect(
    sha('frontend/krds.js') === sha('apps/web/public/static/krds.js'),
    'apps/web/public/static/krds.js must be byte-identical to frontend/krds.js',
    ['frontend/krds.js', 'apps/web/public/static/krds.js'],
  );
});

check('Approved KRDS visual and accessibility tokens are present in the served CSS', () => {
  const css = read('apps/web/public/static/krds.css');
  const missing = [
    '--krds-primary-50: #256EF4',
    '--krds-gray-90: #1E2124',
    '--krds-focus: 0 0 0 4px rgba(37, 110, 244, .45)',
    '--bai-bg: #ffffff',
    '--bai-deep: #14332b',
    '--bai-sage: #7bba91',
    '--font-sans: "SUIT Variable"',
    '.skip-link',
    '.hd-main',
    '.crumb-wrap',
    '.main',
    '.list-row',
    'prefers-reduced-motion',
  ].filter((token) => !css.includes(token));
  expect(!missing.length, 'Served CSS is missing approved KRDS design tokens', missing);
});

check('Next student routes delegate to the shared approved-design shell', () => {
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
      offenders.push(`${rel}: still contains a React reinterpretation`);
    }
  }
  expect(!offenders.length, 'Student routes are not all delegated to the approved renderer', offenders);
});

check('Next shell mounts the exact DOM contract required by approved krds.js', () => {
  const shell = read('apps/web/src/components/LegacyShell.tsx');
  const required = [
    "const ASSET_VERSION = '20260723-availability4'",
    'script.id = \'bai-krds-script\'',
    'script.src = `/static/krds.js?v=${ASSET_VERSION}`',
    'script.onload = () => window.initApp?.()',
    'href={`/static/krds.css?v=${ASSET_VERSION}`}',
    'className="skip-link"',
    'className="hd" id="header"',
    'className="hd-util-in" id="hdUtil"',
    'className="gnb" id="gnb"',
    'className="crumb-wrap" id="crumbWrap"',
    'className="crumb" id="crumb"',
    'className="main" id="view"',
    'className="ft" id="footer"',
    'className="sidebar-toggle"',
  ];
  const missing = required.filter((token) => !shell.includes(token));
  expect(!missing.length, 'Next shell does not mount the approved KRDS DOM/script contract', missing);

  const stale = ['/static/app.css', '/static/feed.js', 'id="nav"', 'className="container"'];
  const found = stale.filter((token) => shell.includes(token));
  expect(!found.length, 'Next shell still mounts the previous Paper & Ink renderer', found);
});

check('Legacy global CSS is isolated from approved KRDS routes', () => {
  const rootLayout = read('apps/web/src/app/layout.tsx');
  expect(
    !rootLayout.includes("import '@/styles/globals.css'"),
    'Root layout must not inject legacy global CSS into every KRDS route',
  );

  const missing = [
    'apps/web/src/app/about/layout.tsx',
    'apps/web/src/app/cockpit/layout.tsx',
  ].filter((rel) => !relExists(rel) || !read(rel).includes("import '@/styles/globals.css'"));
  expect(!missing.length, 'Legacy React-only routes must load their own stylesheet', missing);

  const clientTransitionLeaks = [
    'apps/web/src/app/about/page.tsx',
    'apps/web/src/components/SidebarNav.tsx',
  ].filter((rel) => read(rel).includes("from 'next/link'"));
  expect(
    !clientTransitionLeaks.length,
    'Legacy-styled routes must use a document navigation when entering KRDS routes',
    clientTransitionLeaks,
  );
});

check('Approved KRDS renderer controls the visible page labels', () => {
  const js = read('apps/web/public/static/krds.js');
  const missing = [
    'BAI 진행 공유',
    '자유 기록',
    '인력사무소',
    '프로젝트',
    '자료실',
    '막힌 질문',
    '["/ask", "FAQ", "ask"]',
    '공감 <span class="rc">',
    '진행 여정 (처음 → 최근)',
    'Goodbai API',
    '멤버 관리',
  ].filter((token) => !js.includes(token));
  expect(!missing.length, 'Served KRDS renderer is missing approved page labels', missing);
});

check('Merged talent-office behavior is present in the approved renderer served by Next', () => {
  const js = read('apps/web/public/static/krds.js');
  const missing = [
    'const roleOptions = ["student", "admin_student", "developer", "operator", "pi"]',
    'function talentBadge(status)',
    '개선 요청하기',
    '요청 등록하기',
    '운영 검토',
    '완료 인정 · 10점 지급',
  ].filter((token) => !js.includes(token));
  expect(!missing.length, 'Served KRDS renderer is missing merged PR #4 behavior', missing);
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
