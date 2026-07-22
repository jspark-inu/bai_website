import crypto from 'node:crypto';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { resolveDbPath } from '@/lib/db';
import { assertDatabaseHealth, assertMigrationHealth, assertUploadHealth } from '@/lib/runtime-health';
import { uploadRoot } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fingerprint(value: string) {
  return crypto.createHash('sha256').update(path.resolve(value)).digest('hex');
}

export async function GET(req: NextRequest) {
  try {
    assertDatabaseHealth();
  } catch {
    return Response.json({ ok: false, error: 'database health check failed' }, { status: 503 });
  }

  try {
    assertMigrationHealth();
  } catch {
    return Response.json({ ok: false, error: 'migration health check failed' }, { status: 503 });
  }

  try {
    assertUploadHealth();
  } catch {
    return Response.json({ ok: false, error: 'upload health check failed' }, { status: 503 });
  }

  try {
    const expectedDb = req.nextUrl.searchParams.get('db');
    const expectedUploads = req.nextUrl.searchParams.get('uploads');
    if (expectedDb && expectedDb !== fingerprint(resolveDbPath())) {
      return Response.json({ ok: false, error: 'database path mismatch' }, { status: 503 });
    }
    if (expectedUploads && expectedUploads !== fingerprint(uploadRoot())) {
      return Response.json({ ok: false, error: 'upload path mismatch' }, { status: 503 });
    }

    return Response.json(
      { ok: true, service: 'bai-next', database: 'ok', migrations: 'ok', uploads: 'ok' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { ok: false, error: 'runtime health check failed' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
