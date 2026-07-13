#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateAutoMergeAuthor } from './pr-automerge-policy.mjs';
import {
  addedLinesFromPatch,
  evaluatePullRequest,
  hasCurrentHeadPiApproval,
  scanAddedLines,
} from './pr-governance-policy.mjs';
import {
  buildAiReviewPrompt,
  latestAiStatus,
  normalizeAiReviewResult,
  shouldReviewStatus,
  statusForAiReview,
} from './pr-ai-review-policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, '.github/pr-governance-routing.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, config.policy.trusted_students_registry), 'utf8'));
const schemaPath = path.join(repoRoot, 'scripts/pr-ai-review-schema.json');
const lockPath = process.env.BAI_AI_REVIEW_LOCK ?? '/tmp/bai-pr-ai-review.lock';
const repository = process.env.BAI_GITHUB_REPOSITORY ?? 'jspark-inu/bai_website';
const [owner, repo] = repository.split('/');

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`);
}

function parseArgs(argv) {
  const result = { forceAi: false, dryRun: false, pullNumber: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force-ai') result.forceAi = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--pr') result.pullNumber = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function githubCredential() {
  const output = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const fields = Object.fromEntries(output.trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!fields.username || !fields.password) throw new Error('GitHub credential is unavailable');
  return `Basic ${Buffer.from(`${fields.username}:${fields.password}`).toString('base64')}`;
}

class GitHubClient {
  constructor(authorization) {
    this.authorization = authorization;
  }

  async request(apiPath, { method = 'GET', body, accept = 'application/vnd.github+json', allow = [] } = {}) {
    const response = await fetch(`https://api.github.com${apiPath}`, {
      method,
      headers: {
        Accept: accept,
        Authorization: this.authorization,
        'Content-Type': 'application/json',
        'User-Agent': 'BAI-local-AI-reviewer/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok && !allow.includes(response.status)) {
      throw new Error(`GitHub ${method} ${apiPath} failed with ${response.status}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!response.ok) return { status: response.status, text };
    return accept.includes('diff') ? text : JSON.parse(text || 'null');
  }

  async paginate(apiPath) {
    const rows = [];
    for (let page = 1; page <= 30; page += 1) {
      const separator = apiPath.includes('?') ? '&' : '?';
      const batch = await this.request(`${apiPath}${separator}per_page=100&page=${page}`);
      rows.push(...batch);
      if (batch.length < 100) break;
    }
    return rows;
  }
}

function apiFilesAndFindings(apiFiles) {
  const securityFindings = [];
  const files = apiFiles.map((file) => {
    if (typeof file.patch === 'string') {
      for (const finding of scanAddedLines(
        addedLinesFromPatch(file.patch),
        config.policy.added_line_secret_rules,
      )) {
        securityFindings.push({ id: finding.id, path: file.filename });
      }
    }
    return {
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patchAvailable: typeof file.patch === 'string' || file.changes === 0,
    };
  });
  return { files, securityFindings };
}

async function permissionFor(client, login) {
  const response = await client.request(
    `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
    { allow: [404] },
  );
  return response?.status === 404 ? 'read' : response.permission;
}

function aiStateFromStatuses(statuses) {
  const latest = latestAiStatus(statuses, config.policy.ai_review.status_context);
  return {
    latest,
    aiApproved: latest?.state === 'success',
    aiEscalated: latest?.state === 'failure',
  };
}

async function pullDecision(client, pr) {
  const [apiFiles, reviews, statuses, permission] = await Promise.all([
    client.paginate(`/repos/${owner}/${repo}/pulls/${pr.number}/files`),
    client.paginate(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews`),
    client.paginate(`/repos/${owner}/${repo}/commits/${pr.head.sha}/statuses`),
    permissionFor(client, pr.user.login),
  ]);
  const { files, securityFindings } = apiFilesAndFindings(apiFiles);
  const aiState = aiStateFromStatuses(statuses);
  const authorDecision = evaluateAutoMergeAuthor({
    author: pr.user.login,
    permission,
    association: pr.author_association,
    trustedStudents: registry.students,
  });
  const piApproved = hasCurrentHeadPiApproval({
    reviews,
    piReviewers: config.policy.pi_reviewers,
    headSha: pr.head.sha,
  });
  const decision = evaluatePullRequest({
    author: pr.user.login,
    authorDecision,
    files,
    piApproved,
    aiApproved: aiState.aiApproved,
    aiEscalated: aiState.aiEscalated,
    securityFindings,
    inventoryComplete: files.length === pr.changed_files,
    config,
  });
  return { decision, aiState };
}

function runCodexReview({ pr, reasons, diff }) {
  const reviewConfig = config.policy.ai_review;
  if (Buffer.byteLength(diff, 'utf8') > reviewConfig.maximum_diff_bytes) {
    return {
      verdict: 'pi_review',
      confidence: 1,
      summary: `Diff exceeds the automated review limit of ${reviewConfig.maximum_diff_bytes} bytes.`,
      riskCodes: ['ai_context_limit'],
    };
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-pr-ai-review-'));
  const outputPath = path.join(tempDir, 'result.json');
  try {
    const prompt = buildAiReviewPrompt({
      pullRequest: {
        number: pr.number,
        title: pr.title,
        author: pr.user.login,
        headSha: pr.head.sha,
      },
      governanceReasons: reasons,
      diff,
    });
    const result = spawnSync('codex', [
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--disable', 'shell_tool',
      '--disable', 'browser_use',
      '--disable', 'computer_use',
      '--disable', 'apps',
      '--disable', 'plugins',
      '--disable', 'hooks',
      '--disable', 'tool_suggest',
      '--sandbox', 'read-only',
      '--ephemeral',
      '--skip-git-repo-check',
      '--color', 'never',
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '-C', tempDir,
      '-',
    ], {
      input: prompt,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    if (result.error || result.status !== 0 || !fs.existsSync(outputPath)) {
      throw new Error(`Codex reviewer failed with status ${result.status ?? 'unknown'}`);
    }
    return normalizeAiReviewResult(
      JSON.parse(fs.readFileSync(outputPath, 'utf8')),
      reviewConfig.minimum_confidence,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function safeSummary(value) {
  return String(value)
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted-token]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[redacted-token]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[redacted-key]')
    .slice(0, 500);
}

async function publishResult(client, pr, review, dryRun) {
  const status = statusForAiReview(review);
  const marker = '<!-- bai-ai-review -->';
  const piMention = review.verdict === 'pi_review' ? `\n\n@${config.policy.pi_reviewers[0]} 검토가 필요한 구체적 위험으로 escalation했습니다.` : '';
  const body = [
    marker,
    '### BAI AI review',
    '',
    `- head: \`${pr.head.sha}\``,
    `- verdict: \`${review.verdict}\``,
    `- confidence: \`${review.confidence}\``,
    `- risks: \`${review.riskCodes.join(', ') || 'none'}\``,
    `- summary: ${safeSummary(review.summary)}`,
    piMention,
  ].join('\n');
  log('review-result', { pr: pr.number, head: pr.head.sha, verdict: review.verdict, confidence: review.confidence });
  if (dryRun) return;

  await client.request(`/repos/${owner}/${repo}/statuses/${pr.head.sha}`, {
    method: 'POST',
    body: {
      state: status.state,
      context: config.policy.ai_review.status_context,
      description: status.description.slice(0, 140),
      target_url: pr.html_url,
    },
  });

  const comments = await client.paginate(`/repos/${owner}/${repo}/issues/${pr.number}/comments`);
  const existing = comments.find((comment) => String(comment.body ?? '').includes(marker));
  if (existing) {
    await client.request(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: { body },
    });
  } else {
    await client.request(`/repos/${owner}/${repo}/issues/${pr.number}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  const label = config.policy.ai_review.trigger_label;
  await client.request(`/repos/${owner}/${repo}/issues/${pr.number}/labels/${encodeURIComponent(label)}`, {
    method: 'DELETE',
    allow: [404],
  });
  await client.request(`/repos/${owner}/${repo}/issues/${pr.number}/labels`, {
    method: 'POST',
    body: { labels: [label] },
  });
}

async function publishSystemError(client, pr, error, dryRun) {
  log('review-error', { pr: pr.number, head: pr.head.sha, message: error.message });
  if (dryRun) return;
  await client.request(`/repos/${owner}/${repo}/statuses/${pr.head.sha}`, {
    method: 'POST',
    body: {
      state: 'error',
      context: config.policy.ai_review.status_context,
      description: 'AI reviewer unavailable; automatic retry scheduled',
      target_url: pr.html_url,
    },
  });
}

async function processPull(client, pr, options) {
  const { decision, aiState } = await pullDecision(client, pr);
  log('route', { pr: pr.number, head: pr.head.sha, route: decision.route, reasons: decision.reasonCodes });
  if (decision.route !== 'ai_review' && !options.forceAi) return false;
  if (!options.forceAi && !shouldReviewStatus(aiState.latest, {
    retryAfterMinutes: config.policy.ai_review.retry_after_minutes,
  })) return false;

  if (!options.dryRun) {
    await client.request(`/repos/${owner}/${repo}/statuses/${pr.head.sha}`, {
      method: 'POST',
      body: {
        state: 'pending',
        context: config.policy.ai_review.status_context,
        description: 'Local Codex AI review in progress',
        target_url: pr.html_url,
      },
    });
  }
  try {
    const diff = await client.request(`/repos/${owner}/${repo}/pulls/${pr.number}`, {
      accept: 'application/vnd.github.v3.diff',
    });
    const review = runCodexReview({ pr, reasons: decision.reasonCodes, diff });
    await publishResult(client, pr, review, options.dryRun);
  } catch (error) {
    await publishSystemError(client, pr, error, options.dryRun);
  }
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if (error.code === 'EEXIST') {
      log('lock-busy');
      return;
    }
    throw error;
  }
  try {
    const client = new GitHubClient(githubCredential());
    if (!options.dryRun) {
      await client.request(`/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        body: {
          name: config.policy.ai_review.trigger_label,
          color: '1f6feb',
          description: 'Current head received a local BAI AI review result',
        },
        allow: [422],
      });
    }
    const pulls = options.pullNumber
      ? [await client.request(`/repos/${owner}/${repo}/pulls/${options.pullNumber}`)]
      : await client.paginate(`/repos/${owner}/${repo}/pulls?state=open&sort=created&direction=asc`);
    let processed = 0;
    for (const pr of pulls.filter((item) => !item.draft)) {
      if (processed >= config.policy.ai_review.maximum_prs_per_run) break;
      if (await processPull(client, pr, options)) processed += 1;
    }
    log('run-complete', { openPulls: pulls.length, processed });
  } finally {
    fs.rmdirSync(lockPath);
  }
}

main().catch((error) => {
  log('fatal', { message: error.message });
  process.exitCode = 1;
});
