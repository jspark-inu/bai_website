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

check('all protected Next-native talent office endpoints exist', () => {
  const required = [
    app('api', 'talent-office', 'route.ts'), app('api', 'talent-office', '[rid]', 'route.ts'),
    app('api', 'talent-office', '[rid]', 'review', 'route.ts'), app('api', 'talent-office', '[rid]', 'assignees', 'route.ts'),
    app('api', 'talent-office', '[rid]', 'solution', 'route.ts'), app('api', 'talent-office', '[rid]', 'decision', 'route.ts'),
    app('api', 'talent-office', 'points', 'route.ts'), app('api', 'talent-office', 'operators', '[mid]', 'route.ts'),
  ];
  expect(required.every(existsSync), 'a required talent office API route is missing');
  for (const route of required) expect(source(route).includes('getCurrentMember'), `${path.relative(root, route)} does not enforce the Next session`);
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

check('state, allocation, and one-time point invariants pass against isolated SQLite', () => {
  execFileSync('npm', ['test', '--', 'tests/unit/talent-office.test.ts'], { cwd: root, stdio: 'inherit' });
});

for (const { name, fn } of checks) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
if (failures.length) process.exit(1);
console.log(`\n${checks.length}/${checks.length} talent-office checks passed.`);
