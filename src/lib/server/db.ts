import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Inline the schema SQL at build time. Vite's `?raw` suffix bundles the file
// content as a string, which works for both dev and adapter-node builds.
import schemaSql from './schema.sql?raw';

const here = dirname(fileURLToPath(import.meta.url));

// DATA_DIR env var lets the deploy point at a persistent volume (e.g. Railway
// volume mounted at /data). Defaults to the project's local `data/` for dev.
const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(here, '../../../data');
const DB_PATH = resolve(DATA_DIR, 'voes-demo.db');

let _db: Database.Database | null = null;

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function db(): Database.Database {
  if (_db) return _db;

  ensureDir(DB_PATH);
  const conn = new Database(DB_PATH);
  conn.pragma('foreign_keys = ON');
  conn.pragma('journal_mode = WAL');

  // Apply schema. Idempotent; CREATE TABLE IF NOT EXISTS throughout.
  conn.exec(schemaSql);

  _db = conn;
  return conn;
}

export function withTransaction<T>(fn: (d: Database.Database) => T): T {
  const d = db();
  const tx = d.transaction(fn);
  return tx(d);
}
