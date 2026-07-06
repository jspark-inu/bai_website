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
  'apps/web/src/app/questions/page.tsx',
  'apps/web/src/app/search/page.tsx',
  'apps/web/src/app/tag/[tag]/page.tsx',
];

check('Park PR design source files exist', () => {
  const missing = [
    'frontend/app.css',
    'frontend/feed.js',
    'apps/web/public/static/app.css',
    'apps/web/public/static/feed.js',
    'apps/web/src/components/LegacyShell.tsx',
  ].filter((rel) => !relExists(rel));
  expect(!missing.length, 'Required design source files are missing', missing);
});

check('Park PR CSS is the exact CSS served by Next', () => {
  expect(
    sha('frontend/app.css') === sha('apps/web/public/static/app.css'),
    'apps/web/public/static/app.css must be byte-identical to frontend/app.css',
    ['frontend/app.css', 'apps/web/public/static/app.css'],
  );
});

check('Park PR page renderer is the exact JS served by Next', () => {
  expect(
    sha('frontend/feed.js') === sha('apps/web/public/static/feed.js'),
    'apps/web/public/static/feed.js must be byte-identical to frontend/feed.js',
    ['frontend/feed.js', 'apps/web/public/static/feed.js'],
  );
});

check('Park PR Paper & Ink tokens are present in the served CSS', () => {
  const css = read('apps/web/public/static/app.css');
  const missing = [
    'Paper & Ink',
    '--midnight:#122c4f',
    '--ocean:#5b88b2',
    'box-shadow:4px 4px 0 var(--ink)',
    '.card .sec{display:grid;grid-template-columns:68px 1fr',
  ].filter((token) => !css.includes(token));
  expect(!missing.length, 'Served CSS is missing Park PR design tokens', missing);
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

check('LegacyShell mounts the exact DOM contract expected by Park PR feed.js', () => {
  const shell = read('apps/web/src/components/LegacyShell.tsx');
  const missing = [
    'href="/static/app.css',
    'id="nav"',
    'className="container"',
    'id="view"',
    'src="/static/feed.js',
    'initFeed();',
  ].filter((token) => !shell.includes(token));
  expect(!missing.length, 'LegacyShell does not mount the original feed DOM/script contract', missing);
});

check('Park PR feed renderer controls page-level design labels', () => {
  const js = read('apps/web/public/static/feed.js');
  const missing = [
    'BAI <span class="b">Feed</span>',
    '전체 피드',
    '프로젝트',
    '자료실',
    '막힌 질문',
    '문의/FAQ',
    '공감 <span class="rc">',
    '진행 여정 (처음 → 최근)',
  ].filter((token) => !js.includes(token));
  expect(!missing.length, 'Served feed renderer is missing Park PR page design strings', missing);
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
