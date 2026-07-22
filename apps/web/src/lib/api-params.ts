// Matches the Unicode 15.1 database used by the production Flask Python 3.13 runtime.
// Each block has ten decimal digits except mathematical digits, which contain five styles.
const PYTHON_DECIMAL_BLOCKS = [
  0x30, 0x660, 0x6F0, 0x7C0, 0x966, 0x9E6, 0xA66, 0xAE6,
  0xB66, 0xBE6, 0xC66, 0xCE6, 0xD66, 0xDE6, 0xE50, 0xED0,
  0xF20, 0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80,
  0x1A90, 0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620, 0xA8D0, 0xA900,
  0xA9D0, 0xA9F0, 0xAA50, 0xABF0, 0xFF10, 0x104A0, 0x10D30, 0x11066,
  0x110F0, 0x11136, 0x111D0, 0x112F0, 0x11450, 0x114D0, 0x11650, 0x116C0,
  0x11730, 0x118E0, 0x11950, 0x11C50, 0x11D50, 0x11DA0, 0x11F50, 0x16A60,
  0x16AC0, 0x16B50, 0x1D7CE, 0x1E140, 0x1E2F0, 0x1E4F0, 0x1E950, 0x1FBF0,
] as const;

const PYTHON_WHITESPACE_RUN = /[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028-\u2029\u202F\u205F\u3000]+/u;
const PYTHON_WHITESPACE_EDGES = /^[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028-\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028-\u2029\u202F\u205F\u3000]+$/gu;

export function trimPythonWhitespace(value: string): string {
  return value.replace(PYTHON_WHITESPACE_EDGES, '');
}

export function splitPythonWhitespace(value: string): string[] {
  const trimmed = trimPythonWhitespace(value);
  return trimmed ? trimmed.split(PYTHON_WHITESPACE_RUN) : [];
}

function decimalDigit(value: string): number | null {
  const codePoint = value.codePointAt(0)!;
  for (const blockStart of PYTHON_DECIMAL_BLOCKS) {
    const blockEnd = blockStart === 0x1D7CE ? 0x1D7FF : blockStart + 9;
    if (codePoint >= blockStart && codePoint <= blockEnd) {
      return (codePoint - blockStart) % 10;
    }
  }
  return null;
}

function normalizeDecimalDigits(value: string, allowUnderscores: boolean): string | null {
  const segments = allowUnderscores ? value.split('_') : [value];
  if (segments.some((segment) => !segment)) return null;
  let normalized = '';
  for (const segment of segments) {
    for (const character of segment) {
      const digit = decimalDigit(character);
      if (digit === null) return null;
      normalized += String(digit);
    }
  }
  return normalized || null;
}

export type FlaskInt = number | bigint;

export function parseFlaskPathInt(value: string): FlaskInt | null {
  const digits = normalizeDecimalDigits(value, false);
  if (digits === null) return null;
  const parsed = BigInt(digits);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : parsed;
}

export function parsePythonIntQuery(value: string | null): number | bigint | undefined {
  if (value === null) return undefined;
  let normalized = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
  let sign = 1n;
  if (normalized.startsWith('+') || normalized.startsWith('-')) {
    if (normalized[0] === '-') sign = -1n;
    normalized = normalized.slice(1);
  }
  const digits = normalizeDecimalDigits(normalized, true);
  if (digits === null) return undefined;
  const parsed = sign * BigInt(digits);
  if (parsed >= BigInt(Number.MIN_SAFE_INTEGER) && parsed <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(parsed);
  }
  return parsed;
}
