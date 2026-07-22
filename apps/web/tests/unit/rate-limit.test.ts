import { describe, expect, it } from 'vitest';
import { LoginRateLimiter, loginClientIp } from '@/lib/auth/rate-limit';

describe('bounded login rate limiting', () => {
  it('limits both normalized account and validated IP keys, expires, and resets after success', () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter({
      limit: 2, cooldownMs: 5_000, maxEntries: 10, maxConcurrent: 4, now: () => now,
    });

    const first = limiter.beginAttempt(' Member ', '203.0.113.7');
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error('expected admitted attempt');
    limiter.finishAttempt(first.ticket, false);
    const second = limiter.beginAttempt('member', '203.0.113.7');
    expect(second.allowed).toBe(true);
    if (!second.allowed) throw new Error('expected admitted attempt');
    limiter.finishAttempt(second.ticket, false);
    expect(limiter.beginAttempt('MEMBER', '198.51.100.8')).toEqual({ allowed: false, retryAfterSeconds: 5 });
    expect(limiter.beginAttempt('other', '203.0.113.7')).toEqual({ allowed: false, retryAfterSeconds: 5 });

    now += 5_001;
    const retry = limiter.beginAttempt('member', '203.0.113.7');
    expect(retry.allowed).toBe(true);
    if (!retry.allowed) throw new Error('expected admitted attempt');
    limiter.finishAttempt(retry.ticket, true);
    expect(limiter.beginAttempt('member', '203.0.113.7').allowed).toBe(true);
  });

  it('keeps storage bounded under attacker-controlled account and IP values', () => {
    const limiter = new LoginRateLimiter({
      limit: 5, cooldownMs: 60_000, maxEntries: 4, maxConcurrent: 2, now: () => 1_000,
    });
    for (let index = 0; index < 20; index += 1) {
      const attempt = limiter.beginAttempt(`member-${index}`, `203.0.113.${index + 1}`);
      expect(attempt.allowed).toBe(true);
      if (!attempt.allowed) throw new Error('expected admitted attempt');
      limiter.finishAttempt(attempt.ticket, false);
    }
    expect(limiter.size).toBeLessThanOrEqual(4);
  });

  it('does not turn an unavailable trusted IP signal into a global login lock', () => {
    const limiter = new LoginRateLimiter({
      limit: 2, cooldownMs: 60_000, maxEntries: 10, maxConcurrent: 4, now: () => 1_000,
    });
    for (let index = 0; index < 2; index += 1) {
      const attempt = limiter.beginAttempt('target', 'untrusted');
      expect(attempt.allowed).toBe(true);
      if (!attempt.allowed) throw new Error('expected admitted attempt');
      limiter.finishAttempt(attempt.ticket, false);
    }
    expect(limiter.beginAttempt('target', 'untrusted').allowed).toBe(false);
    expect(limiter.beginAttempt('different-account', 'untrusted').allowed).toBe(true);
  });

  it('reserves capacity before asynchronous password work and bounds unique-account floods', () => {
    const limiter = new LoginRateLimiter({
      limit: 2, cooldownMs: 60_000, maxEntries: 10, maxConcurrent: 2, now: () => 1_000,
    });
    const first = limiter.beginAttempt('target', 'untrusted');
    const second = limiter.beginAttempt('target', 'untrusted');
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(limiter.beginAttempt('target', 'untrusted')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.beginAttempt('different-account', 'untrusted')).toEqual({ allowed: false, retryAfterSeconds: 1 });

    if (!first.allowed || !second.allowed) throw new Error('expected admitted attempts');
    limiter.finishAttempt(first.ticket, true);
    limiter.finishAttempt(second.ticket, false);
    expect(limiter.inFlight).toBe(0);
  });

  it('preserves an active victim lock while pruning attacker-controlled keys', () => {
    const limiter = new LoginRateLimiter({
      limit: 1, cooldownMs: 60_000, maxEntries: 2, maxConcurrent: 2, now: () => 1_000,
    });
    const victim = limiter.beginAttempt('victim', 'untrusted');
    expect(victim.allowed).toBe(true);
    if (!victim.allowed) throw new Error('expected admitted attempt');
    limiter.finishAttempt(victim.ticket, false);

    for (let index = 0; index < 20; index += 1) {
      const attempt = limiter.beginAttempt(`attacker-controlled-name-${index}-${'x'.repeat(1_000)}`, 'untrusted');
      if (attempt.allowed) limiter.finishAttempt(attempt.ticket, false);
    }
    expect(limiter.beginAttempt('victim', 'untrusted').allowed).toBe(false);
    expect(limiter.size).toBeLessThanOrEqual(2);
  });

  it('fails closed instead of admitting untracked attempts when every bounded slot is locked', () => {
    const limiter = new LoginRateLimiter({
      limit: 1, cooldownMs: 60_000, maxEntries: 2, maxConcurrent: 2, now: () => 1_000,
    });
    for (const account of ['filler-a', 'filler-b']) {
      const attempt = limiter.beginAttempt(account, 'untrusted');
      expect(attempt.allowed).toBe(true);
      if (!attempt.allowed) throw new Error('expected admitted attempt');
      limiter.finishAttempt(attempt.ticket, false);
    }

    expect(limiter.beginAttempt('untracked-victim', 'untrusted'))
      .toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.size).toBe(2);
  });

  it('keeps the account reservation atomic while rotating trusted IPs near capacity', () => {
    const limiter = new LoginRateLimiter({
      limit: 2, cooldownMs: 60_000, maxEntries: 3, maxConcurrent: 2, now: () => 1_000,
    });
    for (let index = 0; index < 2; index += 1) {
      const filler = limiter.beginAttempt('locked-filler', 'untrusted');
      expect(filler.allowed).toBe(true);
      if (!filler.allowed) throw new Error('expected admitted filler');
      limiter.finishAttempt(filler.ticket, false);
    }
    for (const ip of ['203.0.113.1', '203.0.113.2']) {
      const victim = limiter.beginAttempt('victim', ip);
      expect(victim.allowed).toBe(true);
      if (!victim.allowed) throw new Error('expected admitted victim');
      limiter.finishAttempt(victim.ticket, false);
    }

    expect(limiter.beginAttempt('victim', '203.0.113.3'))
      .toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it('only trusts proxy client headers behind an explicit boundary', () => {
    const request = new Request('http://next.test/api/login', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'x-real-ip': '198.51.100.8',
        'x-forwarded-for': '192.0.2.7, 127.0.0.1',
      },
    });
    expect(loginClientIp(request, {})).toBe('untrusted');
    expect(loginClientIp(request, { BAI_TRUST_PROXY_HEADERS: '1' })).toBe('203.0.113.9');
    expect(loginClientIp(new Request('http://next.test', {
      headers: { 'cf-connecting-ip': 'not-an-ip' },
    }), { BAI_TRUST_PROXY_HEADERS: '1' })).toBe('untrusted');
  });
});
