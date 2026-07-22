import Database from 'better-sqlite3';
import path from 'node:path';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), '..', '..', 'backend', 'lab-feed.db');
const SQLITE_BUSY_TIMEOUT_MS = 15_000;

let pooledDb: Database.Database | null = null;
let pooledKey = '';

export function resolveDbPath() {
  const configured = process.env.LAB_FEED_DB;
  if (configured && process.env.NODE_ENV === 'production' && !path.isAbsolute(configured)) {
    throw new Error('LAB_FEED_DB must be an absolute path in production');
  }
  return configured ? path.resolve(configured) : DEFAULT_DB_PATH;
}

function configure(conn: Database.Database) {
  conn.pragma('foreign_keys = ON');
  conn.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  return conn;
}

export function getDb() {
  const dbPath = resolveDbPath();
  const readonly = process.env.LAB_FEED_DB_READONLY !== '0';
  const key = `${dbPath}\0${readonly ? 'readonly' : 'readwrite'}`;
  if (!pooledDb || pooledKey !== key) {
    pooledDb?.close();
    pooledDb = configure(new Database(dbPath, { readonly, timeout: SQLITE_BUSY_TIMEOUT_MS }));
    pooledKey = key;
  }
  return pooledDb;
}

export function openWriteDb() {
  if (process.env.LAB_FEED_DB_READONLY !== '0') {
    throw new Error('database writes require LAB_FEED_DB_READONLY=0');
  }
  return configure(new Database(resolveDbPath(), { readonly: false, timeout: SQLITE_BUSY_TIMEOUT_MS }));
}

export function closeDbForTests() {
  pooledDb?.close();
  pooledDb = null;
  pooledKey = '';
}
