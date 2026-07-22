import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

type RateLimitOptions = {
  limit: number;
  cooldownMs: number;
  maxEntries: number;
  maxConcurrent: number;
  now?: () => number;
};

type FailureState = {
  failures: number;
  lockedUntil: number;
  expiresAt: number;
};

export type LoginAttemptTicket = { readonly id: symbol };

export class LoginRateLimiter {
  private readonly states = new Map<string, FailureState>();
  private readonly attempts = new Map<symbol, readonly string[]>();
  private readonly pendingByKey = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    if (options.limit < 1 || options.cooldownMs < 1 || options.maxEntries < 2
      || options.maxConcurrent < 1) {
      throw new RangeError('invalid login rate-limit options');
    }
    this.now = options.now ?? Date.now;
  }

  get size() {
    this.prune(this.now());
    return this.states.size;
  }

  get inFlight() {
    return this.attempts.size;
  }

  private keys(account: string, ip: string) {
    const normalized = account.trim().toLocaleLowerCase();
    const bounded = `${normalized.length}:${normalized.slice(0, 256)}`;
    const accountKey = createHash('sha256').update(bounded).digest('base64url');
    const keys = [`account:${accountKey}`];
    if (ip !== 'untrusted') keys.push(`ip:${ip}`);
    return keys;
  }

  private prune(now: number) {
    for (const [key, state] of this.states) {
      if (state.expiresAt <= now && !this.pendingByKey.has(key)) this.states.delete(key);
    }
  }

  private makeRoom(now: number, protectedKeys: ReadonlySet<string> = new Set()) {
    this.prune(now);
    if (this.states.size < this.options.maxEntries) return true;
    for (const [key, state] of this.states) {
      if (state.lockedUntil <= now && !this.pendingByKey.has(key) && !protectedKeys.has(key)) {
        this.states.delete(key);
        return true;
      }
    }
    return false;
  }

  beginAttempt(account: string, ip: string):
    | { allowed: true; ticket: LoginAttemptTicket }
    | { allowed: false; retryAfterSeconds: number } {
    const now = this.now();
    this.prune(now);
    if (this.attempts.size >= this.options.maxConcurrent) {
      return { allowed: false, retryAfterSeconds: 1 };
    }
    const keys = this.keys(account, ip);
    for (const key of keys) {
      const state = this.states.get(key);
      if (state && state.lockedUntil > now) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((state.lockedUntil - now) / 1_000)),
        };
      }
      if ((state?.failures ?? 0) + (this.pendingByKey.get(key) ?? 0) >= this.options.limit) {
        return { allowed: false, retryAfterSeconds: 1 };
      }
    }

    const added: string[] = [];
    const protectedKeys = new Set(keys);
    for (const key of keys) {
      if (this.states.has(key)) continue;
      if (!this.makeRoom(now, protectedKeys)) {
        for (const addedKey of added) this.states.delete(addedKey);
        return { allowed: false, retryAfterSeconds: 1 };
      }
      this.states.set(key, { failures: 0, lockedUntil: 0, expiresAt: now + this.options.cooldownMs });
      added.push(key);
    }

    const id = Symbol('login-attempt');
    this.attempts.set(id, keys);
    for (const key of keys) this.pendingByKey.set(key, (this.pendingByKey.get(key) ?? 0) + 1);
    return { allowed: true, ticket: { id } };
  }

  private release(ticket: LoginAttemptTicket) {
    const keys = this.attempts.get(ticket.id);
    if (!keys) return null;
    this.attempts.delete(ticket.id);
    for (const key of keys) {
      const pending = (this.pendingByKey.get(key) ?? 1) - 1;
      if (pending > 0) this.pendingByKey.set(key, pending);
      else this.pendingByKey.delete(key);
    }
    return keys;
  }

  private removeEmptyReleasedStates(keys: readonly string[]) {
    for (const key of keys) {
      const state = this.states.get(key);
      if (state?.failures === 0 && !this.pendingByKey.has(key)) this.states.delete(key);
    }
  }

  finishAttempt(ticket: LoginAttemptTicket, success: boolean) {
    const keys = this.release(ticket);
    if (!keys) return;
    const now = this.now();
    this.prune(now);
    if (success) {
      for (const key of keys) {
        if (this.pendingByKey.has(key)) {
          this.states.set(key, { failures: 0, lockedUntil: 0, expiresAt: now + this.options.cooldownMs });
        } else {
          this.states.delete(key);
        }
      }
      return;
    }
    for (const key of keys) {
      const previous = this.states.get(key);
      const failures = (previous?.failures ?? 0) + 1;
      if (!previous && !this.makeRoom(now)) continue;
      this.states.set(key, {
        failures,
        lockedUntil: failures >= this.options.limit ? now + this.options.cooldownMs : 0,
        expiresAt: now + this.options.cooldownMs,
      });
    }
  }

  cancelAttempt(ticket: LoginAttemptTicket) {
    const keys = this.release(ticket);
    if (keys) this.removeEmptyReleasedStates(keys);
  }
}

export function loginClientIp(request: Request, env: Record<string, string | undefined> = process.env) {
  if (env.BAI_TRUST_PROXY_HEADERS !== '1') return 'untrusted';
  const candidates = [
    request.headers.get('x-bai-client-ip'),
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
    request.headers.get('x-forwarded-for')?.split(',', 1)[0],
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && isIP(trimmed)) return trimmed;
  }
  return 'untrusted';
}

export const loginRateLimiter = new LoginRateLimiter({
  limit: 5,
  cooldownMs: 60_000,
  maxEntries: 10_000,
  maxConcurrent: 2,
});
