import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/lib/db/migrations';
import { decideTalentRequestInTransaction } from '@/lib/services/talent-office';

const roots: string[] = [];
const connections: Database.Database[] = [];

function setupFileDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bai-talent-office-unit-'));
  roots.push(root);
  const dbPath = path.join(root, 'talent.sqlite3');
  process.env.LAB_FEED_DB = dbPath;
  process.env.LAB_FEED_DB_READONLY = '0';
  const first = new Database(dbPath);
  first.pragma('foreign_keys = ON');
  first.exec(`
    CREATE TABLE members (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'student',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE projects (id INTEGER PRIMARY KEY);
    CREATE TABLE materials (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, title TEXT NOT NULL);
  `);
  runMigrations(first);
  first.exec(`
    INSERT INTO members (id,name,role,status) VALUES
      (1,'Requester','student','active'),(2,'Builder A','student','active'),(3,'Builder B','student','active');
    INSERT INTO talent_requests (
      id,requester_member_id,title,problem,expected_outcome,system_scope_reason,status,
      solution_summary,solution_url,submitted_at,created_at,updated_at
    ) VALUES (
      1,1,'Concurrent completion','Problem','Outcome','Scope','ready_for_review',
      'Evidence','',datetime('now'),datetime('now'),datetime('now')
    );
    INSERT INTO talent_request_assignees (request_id,member_id,role,allocation_ratio,assigned_at)
      VALUES (1,2,'builder',0.6,datetime('now')),(1,3,'builder',0.4,datetime('now'));
  `);
  const second = new Database(dbPath);
  second.pragma('foreign_keys = ON');
  connections.push(first, second);
  return { dbPath, first, second };
}

afterEach(() => {
  connections.splice(0).forEach((connection) => connection.close());
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  delete process.env.LAB_FEED_DB;
  delete process.env.LAB_FEED_DB_READONLY;
});

describe('talent-office transactional domain', () => {
  it('revalidates the active actor inside the write transaction', () => {
    const { first } = setupFileDatabase();
    first.prepare("UPDATE members SET status='disabled' WHERE id=1").run();

    const result = first.transaction(() => decideTalentRequestInTransaction(
      first,
      { id: 1, name: 'Requester', role: 'student' },
      1,
      'completed',
    )).immediate();

    expect(result).toEqual({ ok: false, status: 401, error: 'login required' });
    expect(first.prepare('SELECT status FROM talent_requests WHERE id=1').get()).toEqual({ status: 'ready_for_review' });
    expect(first.prepare('SELECT COUNT(*) AS count FROM contribution_points').get()).toEqual({ count: 0 });
  });

  it('serializes simultaneous completion workers with one award set and one empty result', async () => {
    const { first, second } = setupFileDatabase();
    const serviceUrl = pathToFileURL(path.resolve('src/lib/services/talent-office.ts')).href;
    const source = `
      import { parentPort } from 'node:worker_threads';
      import { decideTalentRequest } from ${JSON.stringify(serviceUrl)};
      parentPort.postMessage({ ready: true });
      parentPort.once('message', () => {
        try {
          parentPort.postMessage({ result: decideTalentRequest(
            { id: 1, name: 'Requester', role: 'student' }, 1, { decision: 'completed' }
          ) });
        } catch (error) {
          parentPort.postMessage({ error: error instanceof Error ? error.stack : String(error) });
        }
      });
    `;
    const workerUrl = new URL(`data:text/javascript,${encodeURIComponent(source)}`);
    const workers = [new Worker(workerUrl), new Worker(workerUrl)];
    const ready = (worker: Worker) => new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', () => resolve());
    });
    await Promise.all(workers.map(ready));

    first.exec('BEGIN IMMEDIATE');
    const resultPromises = workers.map((worker) => new Promise<unknown>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', (message: { result?: unknown; error?: string }) => {
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      });
      worker.postMessage('go');
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    first.exec('COMMIT');
    const results = await Promise.all(resultPromises);
    await Promise.all(workers.map((worker) => worker.terminate()));

    expect(results).toContainEqual({
      ok: true,
      value: { ok: true, awards: [{ member_id: 2, points: 6 }, { member_id: 3, points: 4 }] },
    });
    expect(results).toContainEqual({ ok: true, value: { ok: true, awards: [] } });
    expect(second.prepare('SELECT SUM(points) AS total FROM contribution_points WHERE request_id=1').get())
      .toEqual({ total: 10 });
    expect(second.prepare('SELECT COUNT(*) AS count FROM contribution_points WHERE request_id=1').get())
      .toEqual({ count: 2 });
    expect(second.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='talent_request_complete'").get())
      .toEqual({ count: 2 });
  });
});
