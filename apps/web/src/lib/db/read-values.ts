export type SqliteInteger = number | bigint;

export function normalizeSqliteIntegers<T>(value: T): T {
  if (typeof value === 'bigint') {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value) as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSqliteIntegers(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeSqliteIntegers(item)]),
    ) as T;
  }
  return value;
}
