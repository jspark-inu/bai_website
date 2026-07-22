import fs from 'node:fs';

import { getDb } from './db.ts';
import { MIGRATION_IDS } from './db/migrations.ts';
import { uploadRoot } from './uploads.ts';

export function assertDatabaseHealth() {
  const db = getDb();
  const quickCheck = db.pragma('quick_check(1)', { simple: true });
  const foreignKeyErrors = db.pragma('foreign_key_check') as unknown[];
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  if (quickCheck !== 'ok' || foreignKeyErrors.length || !tables.has('members') || !tables.has('posts')) {
    throw new Error('database health check failed');
  }
}

export function assertMigrationHealth() {
  const applied = new Set(
    (getDb().prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>)
      .map(({ id }) => id),
  );
  if (MIGRATION_IDS.some((id) => !applied.has(id))) {
    throw new Error('migration health check failed');
  }
}

export function assertUploadHealth() {
  const root = uploadRoot();
  if (!fs.statSync(root).isDirectory()) throw new Error('upload health check failed');
  fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
}
