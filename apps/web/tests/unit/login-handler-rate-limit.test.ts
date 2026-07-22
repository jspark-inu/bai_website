import { describe, expect, it, vi } from 'vitest';
import { handleLogin } from '@/lib/auth/handlers';
import { LoginRateLimiter } from '@/lib/auth/rate-limit';

function request(name: string) {
  return new Request('http://next.test/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password: 'wrong' }),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('login handler crypto-work admission', () => {
  it('admits only the configured concurrent limit for one account before hashing starts', async () => {
    const limiter = new LoginRateLimiter({
      limit: 2, cooldownMs: 60_000, maxEntries: 20, maxConcurrent: 2, now: () => 1_000,
    });
    const gate = deferred<boolean>();
    const verifier = vi.fn(() => gate.promise);
    const dependencies = { limiter, verifyPassword: verifier, findMember: () => null };

    const attempts = Array.from({ length: 4 }, () => handleLogin(request('victim'), dependencies));
    await vi.waitFor(() => expect(verifier).toHaveBeenCalledTimes(2));
    await expect(attempts[2]).resolves.toMatchObject({ status: 429 });
    await expect(attempts[3]).resolves.toMatchObject({ status: 429 });
    gate.resolve(false);
    await expect(attempts[0]).resolves.toMatchObject({ status: 401 });
    await expect(attempts[1]).resolves.toMatchObject({ status: 401 });
  });

  it('bounds global crypto work for unique unknown names without a trusted IP', async () => {
    const limiter = new LoginRateLimiter({
      limit: 5, cooldownMs: 60_000, maxEntries: 20, maxConcurrent: 2, now: () => 1_000,
    });
    const gate = deferred<boolean>();
    const verifier = vi.fn(() => gate.promise);
    const dependencies = { limiter, verifyPassword: verifier, findMember: () => null };

    const attempts = Array.from({ length: 4 }, (_, index) => handleLogin(request(`unknown-${index}`), dependencies));
    await vi.waitFor(() => expect(verifier).toHaveBeenCalledTimes(2));
    await expect(attempts[2]).resolves.toMatchObject({ status: 429 });
    await expect(attempts[3]).resolves.toMatchObject({ status: 429 });
    gate.resolve(false);
    await Promise.all(attempts.slice(0, 2));
  });

  it('releases a reservation when the password verifier throws', async () => {
    const limiter = new LoginRateLimiter({
      limit: 2, cooldownMs: 60_000, maxEntries: 20, maxConcurrent: 1, now: () => 1_000,
    });
    const verifier = vi.fn()
      .mockRejectedValueOnce(new Error('crypto unavailable'))
      .mockResolvedValueOnce(false);
    const dependencies = { limiter, verifyPassword: verifier, findMember: () => null };

    await expect(handleLogin(request('victim'), dependencies)).rejects.toThrow('crypto unavailable');
    await expect(handleLogin(request('victim'), dependencies)).resolves.toMatchObject({ status: 401 });
    expect(limiter.inFlight).toBe(0);
  });
});
