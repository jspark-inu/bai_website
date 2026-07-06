#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(webRoot, '..', '..');
const frontendDir = path.join(repoRoot, 'frontend');
const srcAppDir = path.join(webRoot, 'src', 'app');
const publicDir = path.join(webRoot, 'public');

const legacyOrigin = process.env.LEGACY_ORIGIN || process.env.PARITY_LEGACY_ORIGIN || '';
const nextOrigin = process.env.NEXT_ORIGIN || process.env.PARITY_NEXT_ORIGIN || '';
const doLive = Boolean(legacyOrigin && nextOrigin);

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}
function fail(message, details = undefined) {
  const error = new Error(message);
  error.details = details;
  throw error;
}
function read(p) {
  return readFileSync(p, 'utf8');
}
function sha(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function assertExists(p, label = p) {
  if (!existsSync(p)) fail(`${label} is missing`, p);
}
function stripVersion(s) {
  return s.replace(/\?v=[A-Za-z0-9_.-]+/g, '').replace(/&v=[A-Za-z0-9_.-]+/g, '');
}
function extractBody(html) {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}
function visibleText(html) {
  return stripVersion(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function attrs(html, attr) {
  const out = [];
  const names = attr === 'class' ? ['class', 'className'] : [attr];
  for (const name of names) {
    const re = new RegExp(`${name}=["']([^"']+)["']`, 'gi');
    let m;
    while ((m = re.exec(stripVersion(html)))) out.push(m[1]);
  }
  return [...new Set(out)].sort();
}
function requiredTextTokens(html) {
  const text = visibleText(html);
  return [...new Set(text.split(' ').filter((t) => t.length >= 2 && /[가-힣A-Za-z0-9]/.test(t)))];
}
function pageContract(html) {
  const body = extractBody(html);
  return {
    ids: attrs(body, 'id'),
    classes: attrs(body, 'class').flatMap((v) => v.split(/\s+/)).filter(Boolean).sort(),
    hrefs: attrs(html, 'href').filter((v) => !v.startsWith('http')).map(stripVersion).sort(),
    srcs: attrs(html, 'src').filter((v) => !v.startsWith('http')).map(stripVersion).sort(),
    text: requiredTextTokens(body),
  };
}
function assertContractContained(route, legacyHtml, nextHtml) {
  const legacy = pageContract(legacyHtml);
  const next = pageContract(nextHtml);
  for (const field of ['ids', 'classes', 'hrefs', 'srcs']) {
    const missing = legacy[field].filter((v) => !next[field].includes(v));
    if (missing.length) fail(`${route}: Next page is missing legacy ${field}`, missing);
  }
  const nextText = visibleText(nextHtml);
  const missingText = legacy.text.filter((token) => !nextText.includes(token));
  if (missingText.length) fail(`${route}: Next page is missing legacy visible text`, missingText.slice(0, 20));
}
function appRouteExists(route) {
  const clean = route.replace(/\?.*$/, '');
  const candidates = [];
  if (clean === '/') candidates.push(path.join(srcAppDir, 'page.tsx'));
  else {
    const parts = clean.split('/').filter(Boolean);
    candidates.push(path.join(srcAppDir, ...parts, 'page.tsx'));
    const dynParts = parts.map((p) => (/^\d+$/.test(p) ? '[id]' : p));
    candidates.push(path.join(srcAppDir, ...dynParts, 'page.tsx'));
    if (parts[0] === 'post') candidates.push(path.join(srcAppDir, 'post', '[pid]', 'page.tsx'));
    if (parts[0] === 'member') candidates.push(path.join(srcAppDir, 'member', '[mid]', 'page.tsx'));
    if (parts[0] === 'projects' && parts.length === 2) candidates.push(path.join(srcAppDir, 'projects', '[pid]', 'page.tsx'));
    if (parts[0] === 'materials' && parts.length === 2) candidates.push(path.join(srcAppDir, 'materials', '[id]', 'page.tsx'));
    if (parts[0] === 'tag') candidates.push(path.join(srcAppDir, 'tag', '[tag]', 'page.tsx'));
  }
  return candidates.some(existsSync);
}
function assetPathForLegacy(rel) {
  if (rel.startsWith('pi/')) return path.join(publicDir, rel);
  return path.join(publicDir, 'static', rel);
}
function listHtmlFiles(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, name.name);
    const abs = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...listHtmlFiles(abs, rel));
    else if (name.isFile() && name.name.endsWith('.html')) out.push(rel.replaceAll(path.sep, '/'));
  }
  return out.sort();
}
async function fetchText(origin, route) {
  const url = new URL(route, origin).toString();
  const res = await fetch(url, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, url, headers: Object.fromEntries(res.headers.entries()) };
}

const shellContracts = [
  { route: '/', file: 'feed.html' },
  { route: '/post/1', file: 'feed.html' },
  { route: '/member/1', file: 'feed.html' },
  { route: '/tag/AI', file: 'feed.html' },
  { route: '/search', file: 'feed.html' },
  { route: '/questions', file: 'feed.html' },
  { route: '/ask', file: 'feed.html' },
  { route: '/members', file: 'feed.html' },
  { route: '/account', file: 'feed.html' },
  { route: '/admin/members', file: 'feed.html' },
  { route: '/materials', file: 'feed.html' },
  { route: '/projects', file: 'feed.html' },
  { route: '/projects/1', file: 'feed.html' },
  { route: '/login', file: 'login.html' },
  { route: '/cockpit', file: 'cockpit.html' },
  { route: '/cockpit/people', file: 'cockpit.html' },
  { route: '/cockpit/projects', file: 'cockpit.html' },
];

const intentionallyDisabledRoutes = [
  // These source artifacts exist in frontend/ but are not routed by the current Flask app.
  // Current bai.haiinu.com parity means Next must not accidentally re-enable them.
  '/materials/1',
  '/pi',
  '/pi/projects',
  '/pi/commitments',
  '/pi/waiting',
  '/pi/ideas',
  '/pi/review',
  '/pi/static/pi.css',
  '/pi/static/pi.js',
];

const deliberatelyNotServedHtml = [
  // Historical/pre-refactor page variants that are not Flask route targets.
  // If any becomes reachable on bai.haiinu.com, move it into shellContracts with a route.
  'bai-philosophy-operating-plan.html',
  'bai-project-guide.html',
  'cockpit_load.html',
  'cockpit_people.html',
  'cockpit_projects.html',
  'index.html',
  'member.html',
  'members.html',
  'pi/commitments.html',
  'pi/dashboard.html',
  'pi/ideas.html',
  'pi/pi.html',
  'pi/projects.html',
  'pi/review.html',
  'pi/waiting.html',
  'post.html',
  'questions.html',
  'search.html',
  'tag.html',
];

const exactStaticAssets = [
  ['app.css', 'static/app.css'],
  ['feed.js', 'static/feed.js'],
  ['cockpit.css', 'static/cockpit.css'],
  ['cockpit.js', 'static/cockpit.js'],
];

check('all legacy HTML pages are classified as served routes or deliberate non-route artifacts', () => {
  const htmlFiles = listHtmlFiles(frontendDir).filter((f) => !f.startsWith('downloads/'));
  const classified = new Set([...shellContracts.map((x) => x.file), ...deliberatelyNotServedHtml]);
  const missing = htmlFiles.filter((f) => !classified.has(f));
  if (missing.length) fail('Legacy HTML files not classified by parity harness', missing);
});

check('all required Next page routes exist in source tree', () => {
  const missing = shellContracts.map((x) => x.route).filter((route) => !route.endsWith('.html') && !appRouteExists(route));
  if (missing.length) fail('Next source routes are missing', missing);
});

check('legacy static JS/CSS assets are copied byte-for-byte', () => {
  const mismatches = [];
  for (const [legacyRel, nextRel] of exactStaticAssets) {
    const legacyAbs = path.join(frontendDir, legacyRel);
    const nextAbs = path.join(publicDir, nextRel);
    assertExists(legacyAbs, `legacy asset ${legacyRel}`);
    assertExists(nextAbs, `next asset ${nextRel}`);
    if (sha(legacyAbs) !== sha(nextAbs)) mismatches.push({ legacy: legacyRel, next: nextRel });
  }
  if (mismatches.length) fail('Copied assets are not byte-identical', mismatches);
});

check('Next source routes no longer render legacy wrapper components', () => {
  const appDir = path.join(webRoot, 'src', 'app');
  const files = execFileSync('find', [appDir, '-name', '*.tsx', '-print'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const offenders = files.filter((file) => /Legacy(Feed|Login|Cockpit|PI)Page|LegacyPages/.test(read(file)));
  if (offenders.length) fail('Next routes still import legacy wrapper components', offenders);
});

check('deliberate non-route HTML artifacts are still recorded in source inventory', () => {
  const missing = deliberatelyNotServedHtml.filter((file) => !existsSync(path.join(frontendDir, file)));
  if (missing.length) fail('Declared non-route HTML files no longer exist; update parity classification', missing);
});

if (doLive) {
  check('live routes respond and preserve legacy shell/page contracts', async () => {
    const failures = [];
    for (const { route, file } of shellContracts) {
      const [legacy, next] = await Promise.all([fetchText(legacyOrigin, route), fetchText(nextOrigin, route)]);
      if (legacy.status !== next.status) {
        failures.push({ route, legacy: legacy.status, next: next.status, reason: 'status mismatch' });
        continue;
      }
      if (next.status >= 400) {
        failures.push({ route, status: next.status, reason: 'route not healthy' });
        continue;
      }
      try {
        assertContractContained(route, read(path.join(frontendDir, file)), next.text);
      } catch (e) {
        failures.push({ route, reason: e.message, details: e.details });
      }
    }
    if (failures.length) fail('Live Next pages are not legacy-identical enough to ship', failures);
  });

  check('live static assets match legacy responses byte-for-byte after cache-busting', async () => {
    const routes = ['/static/app.css', '/static/feed.js', '/static/cockpit.css', '/static/cockpit.js'];
    const failures = [];
    for (const route of routes) {
      const busted = `${route}?parity=${Date.now()}`;
      const [legacy, next] = await Promise.all([fetchText(legacyOrigin, busted), fetchText(nextOrigin, busted)]);
      if (legacy.status !== next.status || legacy.text !== next.text) failures.push({ route, legacy: legacy.status, next: next.status });
    }
    if (failures.length) fail('Live static assets differ', failures);
  });

  check('live disabled legacy artifacts stay disabled on Next', async () => {
    const failures = [];
    for (const route of intentionallyDisabledRoutes) {
      const [legacy, next] = await Promise.all([fetchText(legacyOrigin, route), fetchText(nextOrigin, route)]);
      if (legacy.status !== next.status) failures.push({ route, legacy: legacy.status, next: next.status });
    }
    if (failures.length) fail('Next is serving routes/assets that the legacy site does not serve', failures);
  });

  check('live API proxy preserves auth boundary for representative endpoints', async () => {
    const routes = ['/api/me', '/api/feed', '/api/materials', '/api/pi/dashboard'];
    const failures = [];
    for (const route of routes) {
      const [legacy, next] = await Promise.all([fetchText(legacyOrigin, route), fetchText(nextOrigin, route)]);
      if (legacy.status !== next.status) failures.push({ route, legacy: legacy.status, next: next.status });
    }
    if (failures.length) fail('API auth/status parity failed', failures);
  });
} else {
  check('live parity origins are optional for React replacement mode', () => {
    console.log('SKIP live legacy parity; set LEGACY_ORIGIN and NEXT_ORIGIN when comparing old/new responses explicitly.');
  });
}

let passed = 0;
const failed = [];
for (const { name, fn } of checks) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed.push({ name, message: error.message, details: error.details });
    console.log(`FAIL ${name}`);
    console.log(`  ${error.message}`);
    if (error.details) console.log(`  ${JSON.stringify(error.details, null, 2)}`);
  }
}
console.log(`\nBAI Next parity harness: ${passed}/${checks.length} checks passed`);
if (failed.length) {
  console.log('\nCompletion is BLOCKED until every failed check is fixed.');
  process.exit(1);
}
console.log('Completion gate passed: route coverage and React replacement checks are satisfied.');
