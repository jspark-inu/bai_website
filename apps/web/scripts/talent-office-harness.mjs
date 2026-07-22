#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const app = (...parts) => path.join(root, 'src', 'app', ...parts);
const lib = (...parts) => path.join(root, 'src', 'lib', ...parts);
const checks = [];
const failures = [];

function check(name, fn) { checks.push({ name, fn }); }
function source(file) { return readFileSync(file, 'utf8'); }
function expect(condition, message) { if (!condition) throw new Error(message); }

check('standard talent office endpoints delegate to the Flask contract', () => {
  const proxied = [
    app('api', 'talent-office', 'route.ts'), app('api', 'talent-office', '[rid]', 'route.ts'),
    app('api', 'talent-office', '[rid]', 'review', 'route.ts'), app('api', 'talent-office', '[rid]', 'assignees', 'route.ts'),
    app('api', 'talent-office', '[rid]', 'solution', 'route.ts'), app('api', 'talent-office', '[rid]', 'decision', 'route.ts'),
    app('api', 'talent-office', 'points', 'route.ts'),
  ];
  expect(proxied.every(existsSync), 'a required talent office API route is missing');
  for (const route of proxied) {
    const body = source(route);
    expect(body.includes('proxyLegacyApi'), `${path.relative(root, route)} does not delegate to Flask`);
    expect(!body.includes('getCurrentMember') && !body.includes("from '@/lib/talent-office'"), `${path.relative(root, route)} still owns the standard talent contract`);
  }
});

check('PI-only operator management remains a protected Next endpoint', () => {
  const operatorRoute = app('api', 'talent-office', 'operators', '[mid]', 'route.ts');
  expect(existsSync(operatorRoute), 'the PI-only operator route is missing');
  const body = source(operatorRoute);
  expect(body.includes('requireApiMember') && body.includes("member.role !== 'pi'"), 'operator management is not PI protected');
  expect(body.includes('setTalentOperator') && !body.includes('proxyLegacyApi'), 'operator management should remain Next-owned');
});

check('auth aliases and catch-all reuse the same Flask proxy', () => {
  const helper = lib('legacy-api-proxy.ts');
  const auth = source(lib('auth.ts'));
  const routes = [
    app('api', '[...path]', 'route.ts'), app('api', 'auth', 'login', 'route.ts'),
    app('api', 'auth', 'logout', 'route.ts'), app('api', 'auth', 'me', 'route.ts'), app('api', 'me', 'route.ts'),
  ];
  expect(existsSync(helper) && routes.every(existsSync), 'legacy API proxy coverage is incomplete');
  for (const route of routes) expect(source(route).includes('proxyLegacyApi'), `${path.relative(root, route)} bypasses the shared Flask proxy`);
  expect(source(app('api', 'auth', 'login', 'route.ts')).includes('clearSessionCookie'), 'login does not remove stale Next sessions');
  expect(source(app('api', 'auth', 'logout', 'route.ts')).includes('clearSessionCookie'), 'logout does not clear the Next session');
  expect(!auth.includes('setSessionCookie') && !auth.includes('decodeSession'), 'a second Next session authority is still present');
});

check('fixed 10-point and state-machine rules are encoded in the domain layer', () => {
  const domain = source(lib('talent-office.ts'));
  for (const token of ["const transitions", "'ready_for_review'", '10 * a.ratio', "10 - assigned", 'points have already been awarded']) {
    expect(domain.includes(token), `missing domain invariant: ${token}`);
  }
});

check('public about page does not mount private Feed or talent office data', () => {
  const about = source(app('about', 'page.tsx'));
  expect(!about.includes('LegacyFeedShell') && !about.includes('/api/talent-office') && !about.includes('/api/posts'), 'public about page leaks a private Feed surface');
});

check('proxy mapping and retained domain invariants pass', () => {
  execFileSync('npm', ['test', '--',
    'tests/unit/auth.test.ts',
    'tests/unit/auth-protected-routes.test.ts',
    'tests/unit/legacy-api-proxy.test.ts',
    'tests/unit/legacy-api-routes.test.ts',
    'tests/unit/talent-office.test.ts',
  ], { cwd: root, stdio: 'inherit' });
});

for (const { name, fn } of checks) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
if (failures.length) process.exit(1);
console.log(`\n${checks.length}/${checks.length} talent-office checks passed.`);
