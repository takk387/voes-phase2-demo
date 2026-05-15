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

export function runMigrations(conn: Database.Database) {
  // Idempotent column additions. SQLite's ALTER TABLE ADD COLUMN supports
  // CHECK constraints, defaults, and NOT NULL when a default is supplied.
  // Foreign-key clauses in ADD COLUMN are tolerated but not enforced for
  // pre-existing rows; that's fine for our additive migrations.
  //
  // NOTE on classification: the existing employee.classification column is
  // NOT NULL DEFAULT 'production' and is being repurposed in this Step. The
  // ST integration plan's literal text said "production employees leave NULL"
  // but the column predates the plan. We retain the existing semantic —
  // production employees keep 'production', ST employees get a specific
  // trade name (Electrician, Millwright, ToolMaker, PipeFitter, etc.).
  const adds: Array<{ table: string; column: string; ddl: string }> = [
    // --- existing notification preferences migration (kept) ---
    { table: 'employee', column: 'notif_in_app',             ddl: 'notif_in_app INTEGER NOT NULL DEFAULT 1' },
    { table: 'employee', column: 'notif_sms',                ddl: 'notif_sms INTEGER NOT NULL DEFAULT 0' },
    { table: 'employee', column: 'notif_email',              ddl: 'notif_email INTEGER NOT NULL DEFAULT 0' },
    { table: 'employee', column: 'notif_preferences_set_at', ddl: 'notif_preferences_set_at TEXT' },

    // --- Skilled Trades integration: area columns ---
    // type=production keeps every existing area as-is. ST areas use
    // 'skilled_trades' and drive rotation/charge/notification differently.
    { table: 'area', column: 'type',
      ddl: `type TEXT NOT NULL DEFAULT 'production' CHECK(type IN ('production','skilled_trades'))` },
    { table: 'area', column: 'zero_out_month',
      ddl: 'zero_out_month TEXT' },
    { table: 'area', column: 'challenge_window_days',
      ddl: 'challenge_window_days INTEGER' },
    { table: 'area', column: 'no_show_penalty_hours',
      ddl: 'no_show_penalty_hours REAL NOT NULL DEFAULT 0' },
    { table: 'area', column: 'notification_policy',
      ddl: `notification_policy TEXT NOT NULL DEFAULT 'in_app_default' CHECK(notification_policy IN ('in_app_default','in_app_only_no_home_except_emergency'))` },
    { table: 'area', column: 'allow_inter_shop_canvass',
      ddl: 'allow_inter_shop_canvass INTEGER NOT NULL DEFAULT 0' },

    // --- Skilled Trades integration: employee columns ---
    { table: 'employee', column: 'is_apprentice',
      ddl: 'is_apprentice INTEGER NOT NULL DEFAULT 0' },
    { table: 'employee', column: 'area_of_expertise',
      ddl: `area_of_expertise TEXT CHECK(area_of_expertise IS NULL OR area_of_expertise IN ('Electrical','Mechanical'))` },
    { table: 'employee', column: 'shift_pattern_id',
      ddl: 'shift_pattern_id INTEGER REFERENCES shift_pattern(id)' },
    { table: 'employee', column: 'crew_position',
      ddl: 'crew_position INTEGER CHECK(crew_position IS NULL OR crew_position BETWEEN 1 AND 4)' },
    { table: 'employee', column: 'cycle_anchor_date',
      ddl: 'cycle_anchor_date TEXT' },

    // --- Skilled Trades integration: posting columns ---
    { table: 'posting', column: 'pay_multiplier',
      ddl: 'pay_multiplier REAL NOT NULL DEFAULT 1.0 CHECK(pay_multiplier IN (1.0, 1.5, 2.0))' },
    { table: 'posting', column: 'required_classification',
      ddl: 'required_classification TEXT' },
    { table: 'posting', column: 'pending_sv_approval',
      ddl: 'pending_sv_approval INTEGER NOT NULL DEFAULT 0' },

    // --- Skilled Trades integration: charge columns ---
    { table: 'charge', column: 'charge_multiplier',
      ddl: 'charge_multiplier REAL NOT NULL DEFAULT 1.0' }
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
