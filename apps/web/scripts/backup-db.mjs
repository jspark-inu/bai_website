#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SAFE_STAMP = /^[0-9A-Za-z._-]+$/;
const REQUIRED_SCHEMA = {
  members: ['id', 'name'],
  posts: ['id', 'author_id'],
};

function fail(message) {
  throw new Error(message);
}

function validateDatabase(db, pragma) {
  const check = db.pragma(pragma, { simple: true });
  if (check !== 'ok') fail(`${pragma} failed: ${String(check)}`);

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => name),
  );
  for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
    if (!tables.has(table)) fail(`BAI core table is missing: ${table}`);
    const columns = new Set(db.pragma(`table_info(${table})`).map(({ name }) => name));
    for (const column of requiredColumns) {
      if (!columns.has(column)) fail(`BAI core column is missing: ${table}.${column}`);
    }
  }

  const foreignKeyErrors = db.pragma('foreign_key_check');
  if (foreignKeyErrors.length) fail(`foreign_key_check failed: ${JSON.stringify(foreignKeyErrors.slice(0, 10))}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ]/g, '').replace('.', '-');
}

function fsyncFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export async function createVerifiedBackup({ dbPath, backupDir, stamp = timestamp(), keep = 14 }) {
  const sourcePath = path.resolve(dbPath);
  const destinationDir = path.resolve(backupDir);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) fail(`live DB is not a regular file: ${sourcePath}`);
  if (!Number.isSafeInteger(keep) || keep < 1) fail('backup retention must be a positive integer');
  if (!SAFE_STAMP.test(stamp)) fail(`unsafe backup stamp: ${stamp}`);

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    validateDatabase(source, 'quick_check(1)');
    fs.mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, `lab-feed-${stamp}.db`);
    if (fs.existsSync(destination)) fail(`refusing to overwrite existing backup: ${destination}`);

    const temporary = path.join(destinationDir, `.lab-feed-backup-${crypto.randomUUID()}.db.tmp`);
    try {
      await source.backup(temporary);
      const backup = new Database(temporary, { fileMustExist: true });
      try {
        backup.pragma('journal_mode = DELETE');
        validateDatabase(backup, 'integrity_check(1)');
      } finally {
        backup.close();
      }
      fsyncFile(temporary);
      fs.renameSync(temporary, destination);
      fsyncDirectory(destinationDir);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }

    const retained = fs.readdirSync(destinationDir)
      .filter((name) => /^lab-feed-.+\.db$/.test(name))
      .sort();
    for (const old of retained.slice(0, Math.max(0, retained.length - keep))) {
      fs.rmSync(path.join(destinationDir, old));
    }
    return destination;
  } finally {
    source.close();
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) fail(`invalid argument: ${key ?? ''}`);
    values[key.slice(2)] = value;
  }
  if (!values.db || !values['backup-dir']) fail('--db and --backup-dir are required');
  return {
    dbPath: values.db,
    backupDir: values['backup-dir'],
    stamp: values.stamp,
    keep: values.keep === undefined ? 14 : Number(values.keep),
  };
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const destination = await createVerifiedBackup(parseArgs(process.argv.slice(2)));
    console.log(`Verified backup: ${destination}`);
  } catch (error) {
    console.error(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
