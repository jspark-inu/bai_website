function stringifyJsonValue(value: unknown, inArray = false): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return inArray ? 'null' : undefined;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyJsonValue(item, true) ?? 'null').join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      const serialized = stringifyJsonValue(item);
      return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
    });
    return `{${entries.join(',')}}`;
  }
  return undefined;
}

export function exactJsonResponse(value: unknown, init?: ResponseInit): Response {
  const body = stringifyJsonValue(value);
  if (body === undefined) throw new TypeError('value is not JSON serializable');
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(body, { ...init, headers });
}
