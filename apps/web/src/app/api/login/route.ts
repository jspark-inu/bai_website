import { loginPOST } from '@/lib/auth/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loginErrorLocation(status: number) {
  if (status === 429) return '/login?login_error=rate_limit';
  if (status === 503) return '/login?login_error=unavailable';
  return '/login?login_error=credentials';
}

export async function POST(request: Request) {
  const mediaType = (request.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded'
    && mediaType !== 'multipart/form-data') {
    return loginPOST(request);
  }

  const form = await request.formData();
  const rawName = form.get('name');
  const rawPassword = form.get('password');
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  const response = await loginPOST(new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: typeof rawName === 'string' ? rawName.trim() : '',
      password: typeof rawPassword === 'string' ? rawPassword : '',
    }),
  }));
  const redirectHeaders = new Headers({
    'Cache-Control': 'private, no-store',
    Location: response.ok ? '/' : loginErrorLocation(response.status),
  });
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) redirectHeaders.set('Retry-After', retryAfter);
  return new Response(null, { status: 303, headers: redirectHeaders });
}
