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

const routes = [
  app('api', 'talent-office', 'route.ts'),
  app('api', 'talent-office', '[rid]', 'route.ts'),
  app('api', 'talent-office', '[rid]', 'review', 'route.ts'),
  app('api', 'talent-office', '[rid]', 'assignees', 'route.ts'),
  app('api', 'talent-office', '[rid]', 'solution', 'route.ts'),
  app('api', 'talent-office', '[rid]', 'decision', 'route.ts'),
  app('api', 'talent-office', 'points', 'route.ts'),
];

check('all seven standard route files use explicit direct handlers', () => {
  expect(routes.every(existsSync), 'a standard talent-office route file is missing');
  for (const route of routes) {
    const body = source(route);
    expect(!body.includes('proxyLegacyApi') && !body.includes('fetch('), `${path.relative(root, route)} still proxies or fetches`);
    expect(body.includes('talentOffice'), `${path.relative(root, route)} is not wired to the direct domain boundary`);
  }
});

check('shared fixture declares exactly eight Flask route-method contracts', () => {
  const fixture = JSON.parse(source(path.join(root, 'tests', 'contracts', 'talent-office-parity-fixture.json')));
  const expected = new Set([
    'GET /api/talent-office', 'POST /api/talent-office', 'GET /api/talent-office/:rid',
    'POST /api/talent-office/:rid/review', 'POST /api/talent-office/:rid/assignees',
    'POST /api/talent-office/:rid/solution', 'POST /api/talent-office/:rid/decision',
    'GET /api/talent-office/points',
  ]);
  expect(fixture.routeMethods.length === 8, 'fixture must contain exactly eight route-methods');
  expect(fixture.routeMethods.every((item) => expected.has(item)) && [...expected].every((item) => fixture.routeMethods.includes(item)),
    'fixture route-method set drifted');
  expect(fixture.cases.length === 53, 'fixture must retain all 53 parity cases');
});

check('transactional domain and repository have no proxy or request-time DDL', () => {
  const files = [lib('talent-office-api.ts'), lib('services', 'talent-office.ts'), lib('db', 'repositories', 'talent-office.ts')];
  expect(files.every(existsSync), 'direct talent-office domain files are incomplete');
  const body = files.map(source).join('\n');
  expect(!body.includes('proxyLegacyApi') && !body.includes('fetch('), 'talent domain contains a proxy/network call');
  expect(!/CREATE\s+(TABLE|TRIGGER)/i.test(body), 'talent domain performs request-time DDL');
  expect(source(lib('services', 'talent-office.ts')).includes('withWriteTransaction'), 'writes do not use immediate write transactions');
  expect(source(lib('db', 'transaction.ts')).includes('.immediate()'), 'write transactions are not BEGIN IMMEDIATE');
});

check('retired Next-only operator route is absent', () => {
  expect(!existsSync(app('api', 'talent-office', 'operators', '[mid]', 'route.ts')), 'retired operators/:mid route still exists');
});

check('actual Next parity and focused transactional tests pass', () => {
  execFileSync('npx', ['vitest', 'run',
    'tests/contracts/talent-office-parity.test.ts',
    'tests/unit/talent-office.test.ts',
    '--reporter=dot',
  ], { cwd: root, stdio: 'inherit' });
});

for (const { name, fn } of checks) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
if (failures.length) process.exit(1);
console.log(`\n${checks.length}/${checks.length} direct talent-office checks passed.`);
