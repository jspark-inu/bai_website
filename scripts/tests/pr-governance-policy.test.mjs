import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateAutoMergeAuthor } from '../pr-automerge-policy.mjs';
import {
  addedLinesFromPatch,
  evaluatePullRequest,
  hasCurrentHeadPiApproval,
  scanAddedLines,
} from '../pr-governance-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(root, '.github/pr-governance-routing.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(root, '.github/trusted-students.json'), 'utf8'));

function evaluate(input) {
  return evaluatePullRequest({
    ...input,
    authorDecision: evaluateAutoMergeAuthor({
      author: input.author,
      permission: input.permission,
      association: input.association,
      trustedStudents: registry.students,
    }),
    config,
  });
}

test('the routing contract exposes exactly the three operational routes', () => {
  assert.deepEqual(Object.keys(config.terminal_routes).sort(), ['ai_review', 'auto_merge', 'pi_review']);
  assert.equal(config.policy.authority_order[0], 'pi_author_or_current_head_approval');
});

test('CODEOWNERS and mandatory PI control paths stay aligned', () => {
  const codeowners = fs
    .readFileSync(path.join(root, '.github/CODEOWNERS'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0]);
  assert.deepEqual(codeowners, config.policy.pi_only_paths);
});

test('PI approval overrides a sensitive path while retaining risk evidence', () => {
  const result = evaluate({
    author: 'dur4290',
    permission: 'read',
    association: 'NONE',
    piApproved: true,
    files: [{ filename: '.env.production', status: 'added', changes: 2, patchAvailable: true }],
  });
  assert.equal(result.route, 'auto_merge');
  assert.ok(result.reasonCodes.includes('sensitive_path'));
  assert.ok(result.reasonCodes.includes('pi_approved_current_head'));
});

test('a sensitive path without PI approval is reported for review', () => {
  const result = evaluate({
    author: 'dur4290',
    permission: 'read',
    association: 'NONE',
    files: [{ filename: '.env.production', status: 'added', changes: 2, patchAvailable: true }],
  });
  assert.equal(result.route, 'pi_review');
  assert.ok(result.reasonCodes.includes('sensitive_path'));
});

test('a trusted student ordinary change arms auto-merge', () => {
  const result = evaluate({
    author: 'dur4290',
    permission: 'read',
    association: 'NONE',
    files: [{ filename: 'apps/web/src/components/Card.tsx', changes: 5, patchAvailable: true }],
  });
  assert.equal(result.route, 'auto_merge');
});

test('a database change goes to AI and AI approval authorizes merge', () => {
  const input = {
    author: 'dur4290',
    permission: 'read',
    association: 'NONE',
    files: [{ filename: 'backend/auth.py', changes: 5, patchAvailable: true }],
  };
  assert.equal(evaluate(input).route, 'ai_review');
  assert.equal(evaluate({ ...input, aiApproved: true }).route, 'auto_merge');
  assert.equal(evaluate({ ...input, piApproved: true }).route, 'auto_merge');
});

test('AI escalation sends a database change to PI review', () => {
  const result = evaluate({
    author: 'dur4290',
    permission: 'read',
    association: 'NONE',
    aiEscalated: true,
    files: [{ filename: 'backend/lab_feed_db.py', changes: 20, patchAvailable: true }],
  });
  assert.equal(result.route, 'pi_review');
  assert.ok(result.reasonCodes.includes('ai_escalated'));
});

test('AI approval cannot override mandatory PI-sensitive evidence', () => {
  const result = evaluate({
    author: 'dur4290',
    permission: 'read',
    association: 'NONE',
    aiApproved: true,
    files: [{ filename: '.env.production', changes: 2, patchAvailable: true }],
  });
  assert.equal(result.route, 'pi_review');
});

test('a PI approval from an earlier head is stale', () => {
  const reviews = [
    { id: 10, state: 'APPROVED', commit_id: 'old-head', user: { login: 'jspark-inu' } },
  ];
  assert.equal(
    hasCurrentHeadPiApproval({
      reviews,
      piReviewers: config.policy.pi_reviewers,
      headSha: 'new-head',
    }),
    false,
  );
  assert.equal(
    hasCurrentHeadPiApproval({
      reviews: [...reviews, { id: 11, state: 'APPROVED', commit_id: 'new-head', user: { login: 'jspark-inu' } }],
      piReviewers: config.policy.pi_reviewers,
      headSha: 'new-head',
    }),
    true,
  );
});

test('secret scanner inspects added lines without logging their values', () => {
  const marker = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const patch = `--- a/example.txt\n+++ b/example.txt\n@@ -0,0 +1 @@\n+${marker}\n`;
  const findings = scanAddedLines(addedLinesFromPatch(patch), config.policy.added_line_secret_rules);
  assert.deepEqual(findings, [{ id: 'private_key_material', line: 1 }]);
  assert.equal(JSON.stringify(findings).includes(marker), false);
});
