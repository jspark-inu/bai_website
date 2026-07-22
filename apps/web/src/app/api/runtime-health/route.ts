import crypto from 'node:crypto';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getDb, resolveDbPath } from '@/lib/db';
import { uploadRoot } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fingerprint(value: string) {
  return crypto.createHash('sha256').update(path.resolve(value)).digest('hex');
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const quickCheck = db.pragma('quick_check(1)', { simple: true });
    const foreignKeyErrors = db.pragma('foreign_key_check') as unknown[];
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    if (quickCheck !== 'ok' || foreignKeyErrors.length || !tables.has('members') || !tables.has('posts')) {
      return Response.json({ ok: false, error: 'database health check failed' }, { status: 503 });
    }

    const expectedDb = req.nextUrl.searchParams.get('db');
    const expectedUploads = req.nextUrl.searchParams.get('uploads');
    if (expectedDb && expectedDb !== fingerprint(resolveDbPath())) {
      return Response.json({ ok: false, error: 'database path mismatch' }, { status: 503 });
    }
    if (expectedUploads && expectedUploads !== fingerprint(uploadRoot())) {
      return Response.json({ ok: false, error: 'upload path mismatch' }, { status: 503 });
    }

    const origin = process.env.BAI_API_ORIGIN || 'http://127.0.0.1:5066';
    const upstream = await fetch(new URL('/api/healthz', origin), { cache: 'no-store' });
    if (!upstream.ok) {
      return Response.json({ ok: false, error: 'backend health check failed' }, { status: 503 });
    }
    return Response.json(
      { ok: true, service: 'bai-next', database: 'ok', uploads: 'configured', backend: 'ok' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { ok: false, error: 'runtime health check failed' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
