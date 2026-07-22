import { pbkdf2, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const MAX_PBKDF2_ITERATIONS = 2_000_000;
const MAX_SCRYPT_N = 1 << 18;
const MAX_SCRYPT_MEMORY_BYTES = 48 * 1024 * 1024;
const MAX_SCRYPT_WORK = 1 << 22;
const MAX_PASSWORD_BYTES = 4_096;
const MAX_SALT_BYTES = 256;
const MAX_STORED_HASH_BYTES = 1_024;
const PBKDF2_SHA256_BYTES = 32;
const SCRYPT_BYTES = 64;
const WERKZEUG_PBKDF2_ITERATIONS = 1_000_000;
const DUMMY_HASH = 'pbkdf2:sha256:1000000$FSVw4UciNL5tg1Sm$e087bd1acf2b14ed4ff54025901da3f9446b0415868ff7586713eca50c21141d';

function expectedBytes(hex: string, byteLength: number): Buffer | null {
  if (hex.length !== byteLength * 2 || !/^[0-9a-f]+$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function boundedText(value: string, maxBytes: number) {
  return Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function pbkdf2Async(password: string, salt: string, iterations: number, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    pbkdf2(password, salt, iterations, length, 'sha256', (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

function scryptAsync(password: string, salt: string, length: number, n: number, r: number, p: number) {
  const requiredMemory = 128 * n * r;
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, {
      N: n,
      r,
      p,
      maxmem: Math.max(64 * 1024 * 1024, requiredMemory + 16 * 1024 * 1024),
    }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export async function verifyWerkzeugPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    if (!boundedText(password, MAX_PASSWORD_BYTES)
      || !boundedText(storedHash, MAX_STORED_HASH_BYTES)) return false;
    const [method, salt, digest] = storedHash.split('$');
    if (!method || salt === undefined || digest === undefined || storedHash.split('$').length !== 3) return false;
    if (!salt || !boundedText(salt, MAX_SALT_BYTES)) return false;

    let actual: Buffer;
    const methodParts = method.split(':');
    if (methodParts[0] === 'pbkdf2') {
      if (methodParts.length !== 3 || methodParts[1] !== 'sha256') return false;
      const iterations = Number(methodParts[2]);
      if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) return false;
      const expected = expectedBytes(digest, PBKDF2_SHA256_BYTES);
      if (!expected) return false;
      actual = await pbkdf2Async(password, salt, iterations, expected.length);
      return timingSafeEqual(actual, expected);
    } else if (methodParts[0] === 'scrypt') {
      if (methodParts.length !== 4) return false;
      const [n, r, p] = methodParts.slice(1).map(Number);
      if (!Number.isSafeInteger(n) || n < 2 || n > MAX_SCRYPT_N || (n & (n - 1)) !== 0
        || !Number.isSafeInteger(r) || r < 1 || r > 32
        || !Number.isSafeInteger(p) || p < 1 || p > 16) return false;
      const requiredMemory = 128 * n * r;
      const work = n * r * p;
      if (!Number.isSafeInteger(requiredMemory) || requiredMemory > MAX_SCRYPT_MEMORY_BYTES
        || !Number.isSafeInteger(work) || work > MAX_SCRYPT_WORK) return false;
      const expected = expectedBytes(digest, SCRYPT_BYTES);
      if (!expected) return false;
      actual = await scryptAsync(password, salt, expected.length, n, r, p);
      return timingSafeEqual(actual, expected);
    } else {
      return false;
    }
  } catch {
    return false;
  }
}

export async function hashWerkzeugPassword(
  password: string,
  options: { salt?: string } = {},
): Promise<string> {
  if (!boundedText(password, MAX_PASSWORD_BYTES)) throw new RangeError('password is too long');
  const salt = options.salt ?? randomBytes(16).toString('hex');
  if (!salt || salt.includes('$') || !boundedText(salt, MAX_SALT_BYTES)) {
    throw new RangeError('invalid password salt');
  }
  const digest = await pbkdf2Async(
    password,
    salt,
    WERKZEUG_PBKDF2_ITERATIONS,
    PBKDF2_SHA256_BYTES,
  );
  return `pbkdf2:sha256:${WERKZEUG_PBKDF2_ITERATIONS}$${salt}$${digest.toString('hex')}`;
}

export async function verifyLoginPassword(password: string, storedHash: string | null): Promise<boolean> {
  const candidateHash = storedHash ?? DUMMY_HASH;
  const [candidate] = await Promise.all([
    verifyWerkzeugPassword(password, candidateHash),
    verifyWerkzeugPassword(password, DUMMY_HASH),
  ]);
  return storedHash !== null && candidate;
}
