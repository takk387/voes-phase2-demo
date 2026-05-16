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
    // PLAN-DEVIATION (Step 3): Step 1 spec listed required_classification but
    // not required_expertise. Rotation logic needs both — an ST posting can
    // target "any Mechanical" without naming a specific classification, per
    // the round-2 union meeting note "ST postings can target a classification
    // specifically OR target the broader expertise group when classification
    // is not material." Adding here so the rotation candidate filter has
    // something to match against.
    { table: 'posting', column: 'required_expertise',
      ddl: `required_expertise TEXT CHECK(required_expertise IS NULL OR required_expertise IN ('Electrical','Mechanical'))` },
    { table: 'posting', column: 'pending_sv_approval',
      ddl: 'pending_sv_approval INTEGER NOT NULL DEFAULT 0' },

    // --- Skilled Trades integration: charge columns ---
    { table: 'charge', column: 'charge_multiplier',
      ddl: 'charge_multiplier REAL NOT NULL DEFAULT 1.0' },

    // --- Skilled Trades integration: offer.eligibility_at_offer (Step 4) ---
    // Captured at offer creation so the SKT-04A no-show penalty logic can
    // tell whether the worker was on RDO (eligible to volunteer for weekend/
    // holiday OT) vs on their normal shift. Production offers leave NULL.
    { table: 'offer', column: 'eligibility_at_offer',
      ddl: 'eligibility_at_offer TEXT' },

    // --- Step 7: charge.is_penalty ---
    // Marks the SKT-04A no-show penalty rows so compliance check 11 (charge
    // multiplier matches posting rate) can exclude them. Penalty charges are
    // intentionally flat at 1.0×, regardless of posting.pay_multiplier.
    { table: 'charge', column: 'is_penalty',
      ddl: 'is_penalty INTEGER NOT NULL DEFAULT 0' }
  ];
  for (const m of adds) {
    const cols = conn.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) {
      conn.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.ddl}`);
    }
  }

  // --- Step 4: CHECK constraint rebuilds ---
  // SQLite does not support ALTER TABLE for CHECK constraints in place, so
  // we rebuild the affected tables when the existing CHECK doesn't already
  // include the new value. Detection: read sqlite_master.sql for the
  // table and look for the new value as a substring. Fresh DBs come up
  // from schemaSql (which already has both values) and skip the rebuild.
  rebuildResponseTableIfNeeded(conn);
  rebuildOfferTableIfNeeded(conn);
  rebuildPostingTableIfNeeded(conn);
}

// SQLite table-rebuild for CHECK constraint changes follows the docs'
// recommended "new-name" pattern:
//   1. CREATE the new table with a temporary name
//   2. Copy data from old to new
//   3. DROP the old table
//   4. RENAME new to the original name
// This avoids the trap where ALTER TABLE RENAME auto-updates foreign keys
// in *other* tables to point at the temp name (legacy_alter_table=OFF since
// SQLite 3.25, which better-sqlite3 inherits). With this pattern, FKs in
// response/charge/bypass_remedy keep referencing 'offer' through the swap.

function rebuildResponseTableIfNeeded(conn: Database.Database) {
  const row = conn
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='response'`)
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'no_show'")) return;

  conn.pragma('foreign_keys = OFF');
  try {
    conn.exec(`
      CREATE TABLE response_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id        TEXT NOT NULL REFERENCES offer(id),
        response_type   TEXT NOT NULL CHECK(response_type IN (
                          'yes','no','no_show','passed_over_unqualified','on_leave',
                          'on_the_job','no_contact','supervisor_override'
                        )),
        recorded_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        recorded_by_user TEXT NOT NULL,
        recorded_via    TEXT NOT NULL DEFAULT 'team_member'
                        CHECK(recorded_via IN ('team_member','supervisor_on_behalf','manual_entry')),
        reason          TEXT,
        supersedes_response_id INTEGER REFERENCES response(id)
      )
    `);
    conn.exec(`
      INSERT INTO response_new
        (id, offer_id, response_type, recorded_at, recorded_by_user,
         recorded_via, reason, supersedes_response_id)
      SELECT id, offer_id, response_type, recorded_at, recorded_by_user,
             recorded_via, reason, supersedes_response_id
        FROM response
    `);
    conn.exec(`DROP TABLE response`);
    conn.exec(`ALTER TABLE response_new RENAME TO response`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_response_offer ON response(offer_id)`);
  } finally {
    conn.pragma('foreign_keys = ON');
  }
}

function rebuildPostingTableIfNeeded(conn: Database.Database) {
  // Step 7 adds 'rejected_by_sv' to the posting.status CHECK so the ST SV
  // approval queue can mark a posting terminally rejected (vs cancelled,
  // which is an originator-side action, or abandoned, which is a pool-
  // exhaustion outcome). Fresh DBs come up from schemaSql with the new value
  // already; this rebuild only runs on existing volumes.
  const row = conn
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='posting'`)
    .get() as { sql: string } | undefined;
  if (!row) return;
  // Skip if the table is a minimal stub (e.g. earlier-step test fixtures that
  // model posting only as a FK target and don't carry the status CHECK at
  // all). Real DBs always carry CHECK(status IN ...) — that's the trigger.
  if (!row.sql.includes('CHECK(status IN')) return;
  if (row.sql.includes("'rejected_by_sv'")) return;

  conn.pragma('foreign_keys = OFF');
  try {
    conn.exec(`
      CREATE TABLE posting_new (
        id                  TEXT PRIMARY KEY,
        area_id             TEXT NOT NULL REFERENCES area(id),
        ot_type             TEXT NOT NULL DEFAULT 'voluntary_daily'
                            CHECK(ot_type IN (
                              'voluntary_daily','voluntary_weekend','voluntary_holiday',
                              'mandatory_flex','late_add'
                            )),
        criticality         TEXT NOT NULL DEFAULT 'critical'
                            CHECK(criticality IN ('critical','non_essential')),
        work_date           TEXT NOT NULL,
        start_time          TEXT NOT NULL,
        duration_hours      REAL NOT NULL,
        volunteers_needed   INTEGER NOT NULL,
        notes               TEXT,
        posted_by_user      TEXT NOT NULL,
        posted_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        is_late_add         INTEGER NOT NULL DEFAULT 0,
        status              TEXT NOT NULL DEFAULT 'open'
                            CHECK(status IN ('open','satisfied','cancelled','abandoned','rejected_by_sv')),
        cancelled_at        TEXT,
        cancelled_reason    TEXT,
        pay_multiplier      REAL NOT NULL DEFAULT 1.0
                            CHECK(pay_multiplier IN (1.0, 1.5, 2.0)),
        required_classification TEXT,
        required_expertise  TEXT
                            CHECK(required_expertise IS NULL OR required_expertise IN ('Electrical','Mechanical')),
        pending_sv_approval INTEGER NOT NULL DEFAULT 0
      )
    `);
    const oldCols = conn
      .prepare(`PRAGMA table_info(posting)`)
      .all() as { name: string }[];
    const colNames = oldCols.map((c) => c.name);
    const sharedCols = [
      'id', 'area_id', 'ot_type', 'criticality', 'work_date', 'start_time',
      'duration_hours', 'volunteers_needed', 'notes', 'posted_by_user',
      'posted_at', 'is_late_add', 'status', 'cancelled_at', 'cancelled_reason',
      'pay_multiplier', 'required_classification', 'required_expertise',
      'pending_sv_approval'
    ].filter((c) => colNames.includes(c));
    const colList = sharedCols.join(', ');
    conn.exec(`INSERT INTO posting_new (${colList}) SELECT ${colList} FROM posting`);
    conn.exec(`DROP TABLE posting`);
    conn.exec(`ALTER TABLE posting_new RENAME TO posting`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_posting_area_status ON posting(area_id, status)`);
  } finally {
    conn.pragma('foreign_keys = ON');
  }
}

function rebuildOfferTableIfNeeded(conn: Database.Database) {
  const row = conn
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='offer'`)
    .get() as { sql: string } | undefined;
  // Step 6 adds 'proposed' to the offer.status CHECK. The rebuild runs when
  // EITHER the Step 4 'released' value OR the Step 6 'proposed' value is
  // missing from the current sql definition. Fresh DBs come up with both
  // already in schemaSql, so this is a no-op in that case.
  if (!row) return;
  if (row.sql.includes("'released'") && row.sql.includes("'proposed'")) return;

  conn.pragma('foreign_keys = OFF');
  try {
    conn.exec(`
      CREATE TABLE offer_new (
        id                 TEXT PRIMARY KEY,
        posting_id         TEXT NOT NULL REFERENCES posting(id),
        employee_id        TEXT NOT NULL REFERENCES employee(id),
        rotation_position  INTEGER,
        offered_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        offered_by_user    TEXT NOT NULL,
        phase              TEXT,
        status             TEXT NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('proposed','pending','responded','expired','superseded','released')),
        eligibility_at_offer TEXT
      )
    `);
    // Preserve every column the existing offer table actually has. The ADD
    // COLUMN migration above would already have added eligibility_at_offer,
    // but the shared-columns intersection keeps the migration robust against
    // older DBs that pre-date that column too.
    const oldCols = conn
      .prepare(`PRAGMA table_info(offer)`)
      .all() as { name: string }[];
    const colNames = oldCols.map((c) => c.name);
    const sharedCols = [
      'id', 'posting_id', 'employee_id', 'rotation_position', 'offered_at',
      'offered_by_user', 'phase', 'status', 'eligibility_at_offer'
    ].filter((c) => colNames.includes(c));
    const colList = sharedCols.join(', ');
    conn.exec(`INSERT INTO offer_new (${colList}) SELECT ${colList} FROM offer`);
    conn.exec(`DROP TABLE offer`);
    conn.exec(`ALTER TABLE offer_new RENAME TO offer`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_offer_posting ON offer(posting_id)`);
  } finally {
    conn.pragma('foreign_keys = ON');
  }
}

export function withTransaction<T>(fn: (d: Database.Database) => T): T {
  const d = db();
  const tx = d.transaction(fn);
  return tx(d);
}
