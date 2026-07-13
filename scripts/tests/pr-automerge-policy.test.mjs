import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAutoMergeAuthor } from '../pr-automerge-policy.mjs';

test('registered read-only student is eligible', () => {
  assert.deepEqual(
    evaluateAutoMergeAuthor({
      author: 'dur4290',
      permission: 'read',
      association: 'NONE',
      trustedStudents: ['dur4290'],
    }),
    { allowed: true, kind: 'student', reason: 'registered student' },
  );
});

test('public read-only outsider is not eligible', () => {
  assert.deepEqual(
    evaluateAutoMergeAuthor({
      author: 'unregistered-user',
      permission: 'read',
      association: 'NONE',
      trustedStudents: ['dur4290'],
    }),
    {
      allowed: false,
      kind: 'external',
      reason: 'public read access is not trusted student membership',
    },
  );
});

test('owner and collaborator remain eligible', () => {
  assert.equal(evaluateAutoMergeAuthor({ author: 'owner', permission: 'admin' }).allowed, true);
  assert.equal(
    evaluateAutoMergeAuthor({ author: 'helper', permission: 'read', association: 'COLLABORATOR' }).allowed,
    true,
  );
});

test('student registry matching is case-insensitive', () => {
  const result = evaluateAutoMergeAuthor({
    author: 'DUR4290',
    permission: 'read',
    association: 'NONE',
    trustedStudents: ['dur4290'],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.kind, 'student');
});
