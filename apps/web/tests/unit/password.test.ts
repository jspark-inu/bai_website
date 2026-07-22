import { describe, expect, it } from 'vitest';
import { hashWerkzeugPassword, verifyWerkzeugPassword } from '@/lib/auth/password';

const PBKDF2_HASH = 'pbkdf2:sha256:1000000$FSVw4UciNL5tg1Sm$e087bd1acf2b14ed4ff54025901da3f9446b0415868ff7586713eca50c21141d';
const SCRYPT_HASH = 'scrypt:32768:8:1$JXwljJAL77bFOjHS$d68d46b69570eddcc09dd0090fd722a4436cdc1b5feace65d5e9ee91aef691f32c2e2b6d2b5c66976783e8743b482cecd7de3f24f892e3e68912cf6a391b65c5';

describe('Werkzeug password compatibility', () => {
  it.each([PBKDF2_HASH, SCRYPT_HASH])('accepts a real Werkzeug hash without changing the password', async (hash) => {
    await expect(verifyWerkzeugPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyWerkzeugPassword('wrong password', hash)).resolves.toBe(false);
  });

  it.each([
    '',
    'not-a-werkzeug-hash',
    'pbkdf2:sha256:not-a-number$salt$00',
    'pbkdf2:sha1:1000$salt$00',
    'scrypt:3:8:1$salt$00',
    'argon2id$salt$00',
  ])('fails closed for malformed or unsupported hashes', async (hash) => {
    await expect(verifyWerkzeugPassword('password', hash)).resolves.toBe(false);
  });

  it('creates a PBKDF2 hash that the compatibility verifier accepts', async () => {
    const hash = await hashWerkzeugPassword('replacement password', {
      salt: 'fixedtestsalts1x',
    });
    expect(hash).toMatch(/^pbkdf2:sha256:1000000\$fixedtestsalts1x\$/);
    await expect(verifyWerkzeugPassword('replacement password', hash)).resolves.toBe(true);
    await expect(verifyWerkzeugPassword('wrong password', hash)).resolves.toBe(false);
  });

  it.each([
    `pbkdf2:sha256:1000000$salt$${'00'.repeat(33)}`,
    `scrypt:32768:8:1$salt$${'00'.repeat(65)}`,
    `scrypt:1048576:32:16$salt$${'00'.repeat(64)}`,
    `pbkdf2:sha256:1000000$${'s'.repeat(300)}$${'00'.repeat(32)}`,
  ])('rejects hashes whose digest or aggregate resources exceed the compatibility bounds', async (hash) => {
    await expect(verifyWerkzeugPassword('password', hash)).resolves.toBe(false);
  });

  it('rejects oversized password input before deriving attacker-amplified work', async () => {
    await expect(verifyWerkzeugPassword('x'.repeat(5_000), PBKDF2_HASH)).resolves.toBe(false);
  });
});
