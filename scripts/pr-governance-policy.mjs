function normalizedLogin(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizedPath(value) {
  return String(value ?? '').replace(/^\.\//, '').replace(/^\//, '');
}

function pathMatchesOwnerPattern(filename, pattern) {
  const path = normalizedPath(filename);
  const rule = normalizedPath(pattern);
  if (!path || !rule) return false;
  return rule.endsWith('/') ? path.startsWith(rule) : path === rule;
}

function matchingSensitivePath(filename, rules) {
  const path = normalizedPath(filename);
  for (const rule of rules ?? []) {
    if (new RegExp(rule.pattern, 'i').test(path)) return rule.id;
  }
  return null;
}

export function scanAddedLines(lines, rules) {
  const findings = [];
  for (const [index, line] of lines.entries()) {
    for (const rule of rules ?? []) {
      if (new RegExp(rule.pattern).test(line)) {
        findings.push({ id: rule.id, line: index + 1 });
      }
    }
  }
  return findings;
}

export function addedLinesFromPatch(patch) {
  return String(patch ?? '')
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

export function hasCurrentHeadPiApproval({ reviews = [], piReviewers = [], headSha }) {
  const piLogins = new Set(piReviewers.map(normalizedLogin));
  const latestDecision = new Map();
  for (const review of reviews) {
    const login = normalizedLogin(review.user?.login);
    if (!piLogins.has(login) || review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    const previous = latestDecision.get(login);
    if (!previous || Number(review.id) > Number(previous.id)) latestDecision.set(login, review);
  }
  return [...latestDecision.values()].some(
    (review) => review.state === 'APPROVED' && review.commit_id === headSha,
  );
}

export function evaluatePullRequest({
  author,
  authorDecision,
  files = [],
  piApproved = false,
  securityFindings = [],
  inventoryComplete = true,
  config,
}) {
  if (!config?.policy) throw new TypeError('governance config with policy is required');

  const policy = config.policy;
  const reasonCodes = [];
  const evidence = {
    sensitivePaths: [],
    highRiskPaths: [],
    securityFindings: securityFindings.map((finding) => ({
      id: finding.id,
      path: finding.path,
    })),
    totals: { files: files.length, lines: 0 },
    authorKind: authorDecision?.kind ?? 'unknown',
    piApproved: Boolean(piApproved),
  };

  for (const file of files) {
    const filename = normalizedPath(file.filename);
    evidence.totals.lines += Number(file.changes ?? 0);
    const sensitiveRule = matchingSensitivePath(filename, policy.sensitive_path_rules);
    if (sensitiveRule) evidence.sensitivePaths.push({ path: filename, rule: sensitiveRule });
    if (policy.high_risk_paths.some((pattern) => pathMatchesOwnerPattern(filename, pattern))) {
      evidence.highRiskPaths.push(filename);
    }
  }

  if (!inventoryComplete) reasonCodes.push('incomplete_file_inventory');
  if (evidence.sensitivePaths.length) reasonCodes.push('sensitive_path');
  if (evidence.securityFindings.length) reasonCodes.push('secret_material');

  const limits = policy.change_limits;
  const scaleExceeded = evidence.totals.files > limits.files || evidence.totals.lines > limits.lines;
  const unscannableFiles = files
    .filter((file) => file.status !== 'removed' && Number(file.changes ?? 0) > 0 && file.patchAvailable === false)
    .map((file) => normalizedPath(file.filename));
  const reviewRisk = !inventoryComplete
    || evidence.sensitivePaths.length > 0
    || evidence.securityFindings.length > 0
    || evidence.highRiskPaths.length > 0
    || scaleExceeded
    || unscannableFiles.length > 0;
  const trustedAuthor = Boolean(authorDecision?.allowed);
  const piAuthor = policy.pi_reviewers.map(normalizedLogin).includes(normalizedLogin(author));
  const piAuthorized = piAuthor || Boolean(piApproved);

  if (!trustedAuthor) reasonCodes.push('external_author');
  if (evidence.highRiskPaths.length) reasonCodes.push('high_risk_path');
  if (scaleExceeded) reasonCodes.push('change_limit_exceeded');
  if (unscannableFiles.length) reasonCodes.push('unscannable_patch');

  // PI authorization is the highest policy condition. Risk evidence remains in
  // the result for notification and audit, but never vetoes a current-head PI
  // approval or a PR authored directly by the PI.
  if (piAuthorized) {
    if (piAuthor) reasonCodes.push('pi_author');
    else reasonCodes.push('pi_approved_current_head');
    return {
      route: 'auto_merge',
      reasonCodes,
      evidence: { ...evidence, unscannableFiles },
    };
  }

  if (!trustedAuthor || reviewRisk) {
    return {
      route: 'pi_review',
      reasonCodes: reasonCodes.length ? reasonCodes : ['review_required'],
      evidence: { ...evidence, unscannableFiles },
    };
  }

  reasonCodes.push('trusted_low_risk');
  return {
    route: 'auto_merge',
    reasonCodes,
    evidence: { ...evidence, unscannableFiles },
  };
}
