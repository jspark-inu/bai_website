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

function matchingBlockedPath(filename, rules) {
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
    blockedPaths: [],
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
    const blockedRule = matchingBlockedPath(filename, policy.blocked_path_rules);
    if (blockedRule) evidence.blockedPaths.push({ path: filename, rule: blockedRule });
    if (policy.high_risk_paths.some((pattern) => pathMatchesOwnerPattern(filename, pattern))) {
      evidence.highRiskPaths.push(filename);
    }
  }

  if (!inventoryComplete) reasonCodes.push('incomplete_file_inventory');
  if (evidence.blockedPaths.length) reasonCodes.push('blocked_path');
  if (evidence.securityFindings.length) reasonCodes.push('secret_material');
  if (reasonCodes.length) {
    return { route: 'blocked', reasonCodes, evidence };
  }

  const limits = policy.change_limits;
  const scaleExceeded = evidence.totals.files > limits.files || evidence.totals.lines > limits.lines;
  const unscannableFiles = files
    .filter((file) => file.status !== 'removed' && Number(file.changes ?? 0) > 0 && file.patchAvailable === false)
    .map((file) => normalizedPath(file.filename));
  const reviewRisk = evidence.highRiskPaths.length > 0 || scaleExceeded || unscannableFiles.length > 0;
  const trustedAuthor = Boolean(authorDecision?.allowed);
  const piAuthor = policy.pi_reviewers.map(normalizedLogin).includes(normalizedLogin(author));
  const piAuthorized = piAuthor || Boolean(piApproved);

  if (!trustedAuthor) reasonCodes.push('external_author');
  if (evidence.highRiskPaths.length) reasonCodes.push('high_risk_path');
  if (scaleExceeded) reasonCodes.push('change_limit_exceeded');
  if (unscannableFiles.length) reasonCodes.push('unscannable_patch');

  if ((!trustedAuthor || reviewRisk) && !piAuthorized) {
    return {
      route: 'pi_review',
      reasonCodes: reasonCodes.length ? reasonCodes : ['review_required'],
      evidence: { ...evidence, unscannableFiles },
    };
  }

  if (piAuthor) reasonCodes.push('pi_author');
  else if (piApproved) reasonCodes.push('pi_approved_current_head');
  else reasonCodes.push('trusted_low_risk');
  return {
    route: 'auto_merge',
    reasonCodes,
    evidence: { ...evidence, unscannableFiles },
  };
}
