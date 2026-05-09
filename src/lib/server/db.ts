import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(here, '../../../data/voes-demo.db');
const SCHEMA_PATH = resolve(here, './schema.sql');

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
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  conn.exec(schema);

  _db = conn;
  return conn;
}

export function withTransaction<T>(fn: (d: Database.Database) => T): T {
  const d = db();
  const tx = d.transaction(fn);
  return tx(d);
}
