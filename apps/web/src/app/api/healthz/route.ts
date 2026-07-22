import { assertDatabaseHealth } from '@/lib/runtime-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    assertDatabaseHealth();
    return Response.json({ ok: true, service: 'bai-site', database: 'ok' });
  } catch {
    return Response.json({ ok: false, service: 'bai-site' }, { status: 503 });
  }
}
