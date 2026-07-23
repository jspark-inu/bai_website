import { loginPOST } from '@/lib/auth/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loginErrorLocation(status: number) {
  if (status === 429) return '/login?login_error=rate_limit';
  if (status === 503) return '/login?login_error=unavailable';
  return '/login?login_error=credentials';
}

function loginBridgeResponse() {
  return new Response(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BAI 로그인 확인</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: system-ui, sans-serif; background: #f5f7fa; color: #172b4d; }
    main { width: min(28rem, calc(100% - 2rem)); padding: 2rem; text-align: center;
      border: 1px solid #d8dee8; border-radius: 1rem; background: white; }
    a { color: #005ea8; }
  </style>
</head>
<body>
  <main>
    <h1>로그인 확인 중</h1>
    <p>로그인 정보를 안전하게 저장하고 있습니다.</p>
    <p><a href="/">계속하기</a></p>
  </main>
  <script>
    (async () => {
      for (const delay of [100, 300, 800]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        try {
          const response = await fetch("/api/me", {
            cache: "no-store",
            credentials: "same-origin"
          });
          if (response.ok) {
            location.replace("/");
            return;
          }
        } catch {}
      }
      location.replace("/login?login_error=cookie");
    })();
  </script>
</body>
</html>`, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
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
  if (response.ok) return loginBridgeResponse();
  const redirectHeaders = new Headers({
    'Cache-Control': 'private, no-store',
    Location: loginErrorLocation(response.status),
  });
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) redirectHeaders.set('Retry-After', retryAfter);
  return new Response(null, { status: 303, headers: redirectHeaders });
}
