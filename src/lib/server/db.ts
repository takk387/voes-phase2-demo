import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaSql } from './schema.js';

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

  // Idempotent column additions for DBs created before a column existed.
  // ADD COLUMN is the only schema mutation allowed at runtime; we check
  // PRAGMA table_info first so reboots are no-ops.
  runMigrations(conn);

  _db = conn;
  return conn;
}

function runMigrations(conn: Database.Database) {
  const adds: Array<{ table: string; column: string; ddl: string }> = [
    { table: 'employee', column: 'notif_in_app',             ddl: 'notif_in_app INTEGER NOT NULL DEFAULT 1' },
    { table: 'employee', column: 'notif_sms',                ddl: 'notif_sms INTEGER NOT NULL DEFAULT 0' },
    { table: 'employee', column: 'notif_email',              ddl: 'notif_email INTEGER NOT NULL DEFAULT 0' },
    { table: 'employee', column: 'notif_preferences_set_at', ddl: 'notif_preferences_set_at TEXT' }
  ];
  for (const m of adds) {
    const cols = conn.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) {
      conn.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.ddl}`);
    }
  }
}

export function withTransaction<T>(fn: (d: Database.Database) => T): T {
  const d = db();
  const tx = d.transaction(fn);
  return tx(d);
}
