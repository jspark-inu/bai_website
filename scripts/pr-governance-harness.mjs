#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateAutoMergeAuthor } from './pr-automerge-policy.mjs';
import { addedLinesFromPatch, evaluatePullRequest, scanAddedLines } from './pr-governance-policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(repoRoot, '.github', 'pr-governance-routing.json');
const fixtureDir = path.join(repoRoot, 'scripts', 'fixtures', 'pr-governance');

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function configAndRegistry() {
  const config = loadJson(configPath);
  const registry = loadJson(path.join(repoRoot, config.policy.trusted_students_registry));
  return { config, registry };
}

function evaluateFixture(fixture, config, registry) {
  const input = fixture.input;
  const authorDecision = evaluateAutoMergeAuthor({
    author: input.author,
    permission: input.permission,
    association: input.association,
    trustedStudents: registry.students,
  });
  return evaluatePullRequest({ ...input, authorDecision, config });
}

function runFixtures() {
  const { config, registry } = configAndRegistry();
  const filenames = fs.readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort();
  const results = [];
  for (const filename of filenames) {
    const fixture = loadJson(path.join(fixtureDir, filename));
    const actual = evaluateFixture(fixture, config, registry);
    assert.equal(actual.route, fixture.expected.route, `${filename}: route`);
    for (const reason of fixture.expected.reasonCodes ?? []) {
      assert.ok(actual.reasonCodes.includes(reason), `${filename}: missing ${reason}`);
    }
    results.push({ fixture: filename, route: actual.route, reasonCodes: actual.reasonCodes });
  }
  return { status: 'pass', fixtures: results.length, results };
}

function parseArgs(argv) {
  const [command = 'fixtures', ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    if (key === '--pi-approved') values.piApproved = true;
    else values[key.slice(2)] = rest[++index];
  }
  return { command, values };
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function diffFiles(base, head) {
  const range = `${base}...${head}`;
  const status = new Map(
    git('diff', '--name-status', '--no-renames', range)
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [code, ...parts] = line.split('\t');
        return [parts.join('\t'), code === 'D' ? 'removed' : code === 'A' ? 'added' : 'modified'];
      }),
  );
  return git('diff', '--numstat', '--no-renames', range)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [rawAdditions, rawDeletions, ...parts] = line.split('\t');
      const filename = parts.join('\t');
      const additions = rawAdditions === '-' ? 0 : Number(rawAdditions);
      const deletions = rawDeletions === '-' ? 0 : Number(rawDeletions);
      return {
        filename,
        status: status.get(filename) ?? 'modified',
        additions,
        deletions,
        changes: additions + deletions,
        patchAvailable: true,
      };
    });
}

function verifyDiff(values) {
  if (!values.base || !values.head || !values.author) {
    throw new Error('verify-diff requires --base, --head, and --author');
  }
  const { config, registry } = configAndRegistry();
  const files = diffFiles(values.base, values.head);
  const patch = git('diff', '--unified=0', '--no-ext-diff', `${values.base}...${values.head}`);
  const securityFindings = scanAddedLines(
    addedLinesFromPatch(patch),
    config.policy.added_line_secret_rules,
  );
  const authorDecision = evaluateAutoMergeAuthor({
    author: values.author,
    permission: values.permission ?? 'read',
    association: values.association ?? 'NONE',
    trustedStudents: registry.students,
  });
  const result = evaluatePullRequest({
    author: values.author,
    authorDecision,
    files,
    piApproved: Boolean(values.piApproved),
    securityFindings,
    config,
  });
  return { status: 'pass', ...result };
}

try {
  const { command, values } = parseArgs(process.argv.slice(2));
  const report = command === 'fixtures' ? runFixtures() : command === 'verify-diff' ? verifyDiff(values) : null;
  if (!report) throw new Error(`unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'fail') process.exitCode = 1;
} catch (error) {
  process.stderr.write(`PR governance harness failed: ${error.message}\n`);
  process.exitCode = 2;
}
