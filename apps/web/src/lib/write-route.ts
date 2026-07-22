import { exactJsonResponse } from './exact-json-response.ts';
import type { WriteResult } from './services/posts.ts';

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const mediaType = (request.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json'
    && !(mediaType.startsWith('application/') && mediaType.endsWith('+json'))) return {};

  let parsed: unknown;
  try {
    const parseWithSource = JSON.parse as (
      text: string,
      reviver: (key: string, value: unknown, context?: { source: string }) => unknown,
    ) => unknown;
    parsed = parseWithSource(await request.text(), (_key, value, context) => {
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)
        && context && /^-?\d+$/.test(context.source)) return BigInt(context.source);
      return value;
    });
  } catch {
    return {};
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  const pythonFalsey = parsed === null || parsed === false || parsed === 0 || parsed === ''
    || (Array.isArray(parsed) && parsed.length === 0);
  if (pythonFalsey) return {};
  throw new TypeError('JSON object required');
}

export function writeResultResponse<T>(result: WriteResult<T>): Response {
  return result.ok
    ? exactJsonResponse(result.value)
    : Response.json({ error: result.error }, { status: result.status });
}
