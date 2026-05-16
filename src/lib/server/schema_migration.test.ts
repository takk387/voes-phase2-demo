// Schema migration tests for the Skilled Trades integration (Step 1).
//
// These tests open a fresh in-memory SQLite database, apply the full
// schemaSql + runMigrations() pipeline, and verify:
//   - All new columns exist with their expected defaults
//   - shift_pattern and posting_preferred_qualification tables exist
//   - Running migrations a second time is a no-op (idempotent)
//   - The existing production-OT seed shape (insert area + employee with
//     classification='production') still works post-migration
//   - ST-shaped inserts also work (type='skilled_trades' + ST employee fields)
//
// We do NOT touch the singleton `db()` here; each test gets its own
// `Database(':memory:')` connection so they are fully isolated.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { schemaSql } from './schema.js';
import { runMigrations } from './db.js';

type ColInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function freshDb() {
  const conn = new Database(':memory:');
  conn.pragma('foreign_keys = ON');
  conn.exec(schemaSql);
  runMigrations(conn);
  return conn;
}

function cols(conn: Database.Database, table: string): ColInfo[] {
  return conn.prepare(`PRAGMA table_info(${table})`).all() as ColInfo[];
}

function colByName(conn: Database.Database, table: string, name: string) {
  return cols(conn, table).find((c) => c.name === name);
}

describe('schema migration — Skilled Trades integration (Step 1)', () => {
  let conn: Database.Database;

  beforeEach(() => {
    conn = freshDb();
  });

  // --------------------------------------------------------------------------
  // Idempotency
  // --------------------------------------------------------------------------
  describe('idempotency', () => {
    it('running migrations twice does not throw and produces identical schema', () => {
      const before = cols(conn, 'employee').map((c) => c.name).sort();
      expect(() => runMigrations(conn)).not.toThrow();
      const after = cols(conn, 'employee').map((c) => c.name).sort();
      expect(after).toEqual(before);
    });

    it('running migrations three times stays stable', () => {
      runMigrations(conn);
      runMigrations(conn);
      const employeeCols = cols(conn, 'employee').map((c) => c.name);
      // Spot-check: no duplicate column names (would error in SQLite anyway,
      // but a regression here would surface as a throw above).
      expect(new Set(employeeCols).size).toBe(employeeCols.length);
    });
  });

  // --------------------------------------------------------------------------
  // New tables
  // --------------------------------------------------------------------------
  describe('new tables', () => {
    it('shift_pattern table exists with expected columns', () => {
      const c = cols(conn, 'shift_pattern');
      const names = c.map((x) => x.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'id',
          'name',
          'cycle_length_days',
          'crew_count',
          'calendar_json',
          'description'
        ])
      );
      // PK = id, autoincrement
      const pk = c.find((x) => x.pk === 1);
      expect(pk?.name).toBe('id');
    });

    it('shift_pattern.name has a UNIQUE constraint', () => {
      conn
        .prepare(
          `INSERT INTO shift_pattern (name, cycle_length_days, crew_count, calendar_json)
           VALUES (?, ?, ?, ?)`
        )
        .run('fixed_day', 7, 1, '[["D","D","D","D","D","RDO","RDO"]]');
      expect(() =>
        conn
          .prepare(
            `INSERT INTO shift_pattern (name, cycle_length_days, crew_count, calendar_json)
             VALUES (?, ?, ?, ?)`
          )
          .run('fixed_day', 7, 1, '[["D","D","D","D","D","RDO","RDO"]]')
      ).toThrow(/UNIQUE/);
    });

    it('posting_preferred_qualification table exists with composite PK', () => {
      const c = cols(conn, 'posting_preferred_qualification');
      const names = c.map((x) => x.name);
      expect(names).toEqual(
        expect.arrayContaining(['posting_id', 'qualification_id'])
      );
      // Both columns are part of the composite primary key.
      expect(c.find((x) => x.name === 'posting_id')?.pk).toBeGreaterThan(0);
      expect(c.find((x) => x.name === 'qualification_id')?.pk).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Area columns
  // --------------------------------------------------------------------------
  describe('area columns', () => {
    it('adds type with default production and CHECK constraint', () => {
      const c = colByName(conn, 'area', 'type');
      expect(c).toBeDefined();
      expect(c!.notnull).toBe(1);
      // dflt_value comes back as the literal SQL token, including quotes
      expect(c!.dflt_value).toContain("'production'");
    });

    it('type CHECK rejects unknown area types', () => {
      expect(() =>
        conn
          .prepare(
            `INSERT INTO area (id, name, shop, line, shift, type)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run('a-1', 'X', 'Body', 'L1', '1st', 'banana')
      ).toThrow(/CHECK/);
    });

    it('adds zero_out_month, challenge_window_days as nullable', () => {
      expect(colByName(conn, 'area', 'zero_out_month')?.notnull).toBe(0);
      expect(colByName(conn, 'area', 'challenge_window_days')?.notnull).toBe(0);
    });

    it('adds no_show_penalty_hours with default 0', () => {
      const c = colByName(conn, 'area', 'no_show_penalty_hours');
      expect(c).toBeDefined();
      expect(c!.dflt_value).toBe('0');
    });

    it('adds notification_policy with default in_app_default and CHECK', () => {
      const c = colByName(conn, 'area', 'notification_policy');
      expect(c!.dflt_value).toContain("'in_app_default'");
      expect(() =>
        conn
          .prepare(
            `INSERT INTO area (id, name, shop, line, shift, notification_policy)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run('a-2', 'X', 'Body', 'L1', '1st', 'nonsense_policy')
      ).toThrow(/CHECK/);
    });

    it('adds allow_inter_shop_canvass with default 0', () => {
      expect(colByName(conn, 'area', 'allow_inter_shop_canvass')?.dflt_value).toBe('0');
    });
  });

  // --------------------------------------------------------------------------
  // Employee columns
  // --------------------------------------------------------------------------
  describe('employee columns', () => {
    it('adds is_apprentice with default 0', () => {
      expect(colByName(conn, 'employee', 'is_apprentice')?.dflt_value).toBe('0');
    });

    it('adds area_of_expertise nullable with CHECK', () => {
      const c = colByName(conn, 'employee', 'area_of_expertise');
      expect(c).toBeDefined();
      expect(c!.notnull).toBe(0);
      expect(() =>
        conn
          .prepare(
            `INSERT INTO employee
               (id, display_name, first_name, last_name, hire_date, last4_ssn,
                shift, area_of_expertise)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run('e-1', 'X, A', 'Alex', 'X', '2020-01-01', '0000', '1st', 'Plumbing')
      ).toThrow(/CHECK/);
    });

    it('adds shift_pattern_id, crew_position, cycle_anchor_date all nullable', () => {
      expect(colByName(conn, 'employee', 'shift_pattern_id')?.notnull).toBe(0);
      expect(colByName(conn, 'employee', 'crew_position')?.notnull).toBe(0);
      expect(colByName(conn, 'employee', 'cycle_anchor_date')?.notnull).toBe(0);
    });

    it('crew_position CHECK rejects values outside 1..4', () => {
      expect(() =>
        conn
          .prepare(
            `INSERT INTO employee
               (id, display_name, first_name, last_name, hire_date, last4_ssn,
                shift, crew_position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run('e-bad', 'Bad', 'B', 'D', '2020-01-01', '0000', '1st', 5)
      ).toThrow(/CHECK/);
    });
  });

  // --------------------------------------------------------------------------
  // Posting columns
  // --------------------------------------------------------------------------
  describe('posting columns', () => {
    it('adds pay_multiplier with default 1.0 and CHECK to {1.0, 1.5, 2.0}', () => {
      const c = colByName(conn, 'posting', 'pay_multiplier');
      expect(c!.dflt_value).toBe('1.0');
      // Insert a posting at an illegal multiplier — must fail
      conn
        .prepare(`INSERT INTO area (id, name, shop, line, shift) VALUES (?, ?, ?, ?, ?)`)
        .run('a-p', 'A', 'Body', 'L1', '1st');
      expect(() =>
        conn
          .prepare(
            `INSERT INTO posting
               (id, area_id, work_date, start_time, duration_hours,
                volunteers_needed, posted_by_user, pay_multiplier)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run('p-bad', 'a-p', '2026-05-15', '07:00', 8, 1, 'admin', 3.0)
      ).toThrow(/CHECK/);
    });

    it('adds required_classification nullable and pending_sv_approval default 0', () => {
      expect(colByName(conn, 'posting', 'required_classification')?.notnull).toBe(0);
      expect(colByName(conn, 'posting', 'pending_sv_approval')?.dflt_value).toBe('0');
    });
  });

  // --------------------------------------------------------------------------
  // Charge column
  // --------------------------------------------------------------------------
  describe('charge column', () => {
    it('adds charge_multiplier with default 1.0', () => {
      const c = colByName(conn, 'charge', 'charge_multiplier');
      expect(c).toBeDefined();
      expect(c!.dflt_value).toBe('1.0');
    });
  });

  // --------------------------------------------------------------------------
  // Existing production seed shape still works
  // --------------------------------------------------------------------------
  describe('production seed compatibility', () => {
    it('inserting a production area with the legacy column set succeeds', () => {
      // Mirrors phase2/src/lib/server/seed.ts seedArea(): only the original
      // columns are supplied. Post-migration, defaults must fill the rest.
      conn
        .prepare(
          `INSERT INTO area (id, name, shop, line, shift, posting_location)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run('area-prod', 'Body 2 1st', 'Body', 'BA2', '1st', 'Whiteboard');

      const row = conn
        .prepare(`SELECT type, no_show_penalty_hours, notification_policy,
                         allow_inter_shop_canvass, zero_out_month,
                         challenge_window_days
                  FROM area WHERE id = ?`)
        .get('area-prod') as Record<string, unknown>;
      expect(row.type).toBe('production');
      expect(row.no_show_penalty_hours).toBe(0);
      expect(row.notification_policy).toBe('in_app_default');
      expect(row.allow_inter_shop_canvass).toBe(0);
      expect(row.zero_out_month).toBeNull();
      expect(row.challenge_window_days).toBeNull();
    });

    it("inserting a production employee with classification='production' still works", () => {
      conn
        .prepare(
          `INSERT INTO employee
             (id, display_name, first_name, last_name, hire_date, last4_ssn,
              classification, shift, status)
           VALUES (?, ?, ?, ?, ?, ?, 'production', ?, 'active')`
        )
        .run('emp-x', 'Adams, R.', 'Renee', 'Adams', '2008-03-15', '4421', '1st');

      const row = conn
        .prepare(`SELECT classification, is_apprentice, area_of_expertise,
                         shift_pattern_id, crew_position, cycle_anchor_date
                  FROM employee WHERE id = ?`)
        .get('emp-x') as Record<string, unknown>;
      expect(row.classification).toBe('production');
      expect(row.is_apprentice).toBe(0);
      expect(row.area_of_expertise).toBeNull();
      expect(row.shift_pattern_id).toBeNull();
      expect(row.crew_position).toBeNull();
      expect(row.cycle_anchor_date).toBeNull();
    });

    it('inserting a production posting with no pay_multiplier defaults to 1.0', () => {
      conn
        .prepare(`INSERT INTO area (id, name, shop, line, shift) VALUES (?, ?, ?, ?, ?)`)
        .run('area-q', 'Q', 'Body', 'L', '1st');
      conn
        .prepare(
          `INSERT INTO posting
             (id, area_id, work_date, start_time, duration_hours,
              volunteers_needed, posted_by_user)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('p-prod', 'area-q', '2026-05-15', '07:00', 8, 1, 'admin');
      const row = conn
        .prepare(`SELECT pay_multiplier, pending_sv_approval, required_classification
                  FROM posting WHERE id = ?`)
        .get('p-prod') as Record<string, unknown>;
      expect(row.pay_multiplier).toBe(1.0);
      expect(row.pending_sv_approval).toBe(0);
      expect(row.required_classification).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // ST-shaped inserts work end-to-end
  // --------------------------------------------------------------------------
  describe('skilled-trades-shape inserts', () => {
    it('inserts an ST area with all ST fields populated', () => {
      conn
        .prepare(
          `INSERT INTO area
             (id, name, shop, line, shift, type, zero_out_month,
              challenge_window_days, no_show_penalty_hours, notification_policy,
              allow_inter_shop_canvass)
           VALUES (?, ?, ?, ?, ?, 'skilled_trades', '01', 30, 1,
                   'in_app_only_no_home_except_emergency', 1)`
        )
        .run('area-st-body', 'Body Shop ST 1st', 'Body', 'ST', '1st');

      const row = conn
        .prepare(`SELECT * FROM area WHERE id = ?`)
        .get('area-st-body') as Record<string, unknown>;
      expect(row.type).toBe('skilled_trades');
      expect(row.zero_out_month).toBe('01');
      expect(row.challenge_window_days).toBe(30);
      expect(row.no_show_penalty_hours).toBe(1);
      expect(row.notification_policy).toBe('in_app_only_no_home_except_emergency');
      expect(row.allow_inter_shop_canvass).toBe(1);
    });

    it('inserts an ST employee with shift_pattern_id, crew_position, anchor', () => {
      // shift_pattern row first so the FK reference is satisfiable.
      const patternId = conn
        .prepare(
          `INSERT INTO shift_pattern (name, cycle_length_days, crew_count, calendar_json)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          '4_crew_12h_rotating',
          28,
          4,
          '[[],[],[],[]]'
        ).lastInsertRowid;

      conn
        .prepare(
          `INSERT INTO employee
             (id, display_name, first_name, last_name, hire_date, last4_ssn,
              classification, shift, status,
              is_apprentice, area_of_expertise, shift_pattern_id,
              crew_position, cycle_anchor_date)
           VALUES (?, ?, ?, ?, ?, ?, 'Electrician', ?, 'active',
                   0, 'Electrical', ?, 1, '2026-05-04')`
        )
        .run(
          'emp-singh-e',
          'Singh, E.',
          'Esha',
          'Singh',
          '2018-04-01',
          '9933',
          '2nd',
          patternId
        );

      const row = conn
        .prepare(
          `SELECT classification, is_apprentice, area_of_expertise,
                  shift_pattern_id, crew_position, cycle_anchor_date
           FROM employee WHERE id = ?`
        )
        .get('emp-singh-e') as Record<string, unknown>;
      expect(row.classification).toBe('Electrician');
      expect(row.area_of_expertise).toBe('Electrical');
      expect(row.shift_pattern_id).toBe(patternId);
      expect(row.crew_position).toBe(1);
      expect(row.cycle_anchor_date).toBe('2026-05-04');
    });

    it('inserts an ST posting at 1.5x with required_classification + pending_sv_approval', () => {
      conn
        .prepare(`INSERT INTO area (id, name, shop, line, shift, type) VALUES (?, ?, ?, ?, ?, 'skilled_trades')`)
        .run('area-st-p', 'Body ST 1st', 'Body', 'ST', '1st');
      conn
        .prepare(
          `INSERT INTO posting
             (id, area_id, work_date, start_time, duration_hours,
              volunteers_needed, posted_by_user, pay_multiplier,
              required_classification, pending_sv_approval)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1.5, 'PipeFitter', 1)`
        )
        .run('p-st-1', 'area-st-p', '2026-05-16', '06:00', 4, 1, 'coord-davis');

      const row = conn
        .prepare(
          `SELECT pay_multiplier, required_classification, pending_sv_approval
           FROM posting WHERE id = ?`
        )
        .get('p-st-1') as Record<string, unknown>;
      expect(row.pay_multiplier).toBe(1.5);
      expect(row.required_classification).toBe('PipeFitter');
      expect(row.pending_sv_approval).toBe(1);
    });
  });
});

// ============================================================================
// Step 4 upgrade-path regression
//
// Simulates an on-disk DB that pre-dates Step 4 (offer.status CHECK without
// 'released', response.response_type CHECK without 'no_show') with FK chains
// already in place. Runs runMigrations and asserts:
//   - The CHECK constraints get updated
//   - Pre-existing data survives
//   - The FKs in response → offer still resolve (i.e. no orphaned references
//     from the "new-name" rebuild swap)
// ============================================================================

describe('Step 4 upgrade path — pre-Step-4 DB shape rebuilds cleanly', () => {
  let conn: Database.Database;

  beforeEach(() => {
    conn = new Database(':memory:');
    conn.pragma('foreign_keys = ON');
    // Hand-roll the pre-Step-4 schema for the affected tables, with the
    // same FK structure the real Railway DB has.
    conn.exec(`
      CREATE TABLE posting (id TEXT PRIMARY KEY);
      CREATE TABLE employee (id TEXT PRIMARY KEY);
      CREATE TABLE offer (
        id TEXT PRIMARY KEY,
        posting_id TEXT NOT NULL REFERENCES posting(id),
        employee_id TEXT NOT NULL REFERENCES employee(id),
        rotation_position INTEGER,
        offered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        offered_by_user TEXT NOT NULL,
        phase TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','responded','expired','superseded'))
      );
      CREATE TABLE response (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id TEXT NOT NULL REFERENCES offer(id),
        response_type TEXT NOT NULL CHECK(response_type IN (
          'yes','no','passed_over_unqualified','on_leave',
          'on_the_job','no_contact','supervisor_override'
        )),
        recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        recorded_by_user TEXT NOT NULL,
        recorded_via TEXT NOT NULL DEFAULT 'team_member'
          CHECK(recorded_via IN ('team_member','supervisor_on_behalf','manual_entry')),
        reason TEXT,
        supersedes_response_id INTEGER REFERENCES response(id)
      );
      -- Sibling tables that runMigrations expects to exist for the ADD COLUMN
      -- loop. Keep them minimal — just the columns needed so the migration
      -- detects missing columns and adds them.
      CREATE TABLE area (id TEXT PRIMARY KEY, name TEXT, shop TEXT, line TEXT, shift TEXT);
      CREATE TABLE charge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id TEXT NOT NULL REFERENCES offer(id),
        employee_id TEXT NOT NULL REFERENCES employee(id),
        area_id TEXT NOT NULL REFERENCES area(id),
        charge_type TEXT NOT NULL,
        amount REAL NOT NULL,
        mode_at_charge TEXT NOT NULL,
        recorded_at TEXT,
        reverses_charge_id INTEGER REFERENCES charge(id),
        cycle_number INTEGER
      );
      CREATE TABLE shift_pattern (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cycle_length_days INTEGER NOT NULL,
        crew_count INTEGER NOT NULL,
        calendar_json TEXT NOT NULL,
        description TEXT
      );
    `);
    // Seed a posting → offer → response chain that the migration must
    // preserve through the rebuild.
    conn.prepare(`INSERT INTO posting VALUES ('pst-up')`).run();
    conn.prepare(`INSERT INTO employee VALUES ('emp-up')`).run();
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
         VALUES ('ofr-up', 'pst-up', 'emp-up', 'seed', 'responded')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO response (offer_id, response_type, recorded_by_user)
         VALUES ('ofr-up', 'yes', 'seed')`
      )
      .run();
  });

  it('rebuilds offer with status=released allowed; pre-existing offer survives', () => {
    runMigrations(conn);
    expect(
      conn.prepare(`SELECT COUNT(*) AS c FROM offer WHERE id = 'ofr-up'`).get()
    ).toEqual({ c: 1 });
    expect(() =>
      conn
        .prepare(
          `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
           VALUES ('ofr-rel', 'pst-up', 'emp-up', 'seed', 'released')`
        )
        .run()
    ).not.toThrow();
  });

  it('rebuilds response with response_type=no_show allowed; pre-existing response survives', () => {
    runMigrations(conn);
    expect(
      conn.prepare(`SELECT COUNT(*) AS c FROM response WHERE offer_id = 'ofr-up'`).get()
    ).toEqual({ c: 1 });
    expect(() =>
      conn
        .prepare(
          `INSERT INTO response (offer_id, response_type, recorded_by_user)
           VALUES ('ofr-up', 'no_show', 'seed')`
        )
        .run()
    ).not.toThrow();
  });

  it('FK chain stays intact across rebuild — response.offer_id still references offer', () => {
    runMigrations(conn);
    // Inserting a response that points at a missing offer must fail with
    // a FK violation. If the rebuild had broken the FK (e.g. by pointing
    // it at a renamed temp table), this would silently succeed.
    expect(() =>
      conn
        .prepare(
          `INSERT INTO response (offer_id, response_type, recorded_by_user)
           VALUES ('ofr-nonexistent', 'yes', 'seed')`
        )
        .run()
    ).toThrow(/FOREIGN KEY/);
  });

  it('eligibility_at_offer column added by ADD COLUMN, populated NULL on pre-existing rows', () => {
    runMigrations(conn);
    const row = conn
      .prepare(`SELECT eligibility_at_offer FROM offer WHERE id = 'ofr-up'`)
      .get() as { eligibility_at_offer: string | null };
    expect(row.eligibility_at_offer).toBeNull();
  });

  it('running migrations twice on a pre-Step-4 DB is idempotent', () => {
    runMigrations(conn);
    runMigrations(conn); // should be a no-op the second time
    const offerCount = conn.prepare(`SELECT COUNT(*) AS c FROM offer`).get();
    const responseCount = conn.prepare(`SELECT COUNT(*) AS c FROM response`).get();
    expect(offerCount).toEqual({ c: 1 });
    expect(responseCount).toEqual({ c: 1 });
  });

  it('Step 6: offer rebuild also picks up the proposed status value', () => {
    runMigrations(conn);
    expect(() =>
      conn
        .prepare(
          `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
           VALUES ('ofr-prop', 'pst-up', 'emp-up', 'seed', 'proposed')`
        )
        .run()
    ).not.toThrow();
  });
});

// ============================================================================
// Step 6 upgrade-path regression
//
// Simulates an on-disk DB that already shipped Step 4 (offer.status CHECK
// includes 'released' but not 'proposed') and verifies the Step 6 rebuild
// picks up just the new value without breaking pre-existing rows.
// ============================================================================

describe('Step 6 upgrade path — Step-4-era DB picks up proposed without churn', () => {
  let conn: Database.Database;

  beforeEach(() => {
    conn = new Database(':memory:');
    conn.pragma('foreign_keys = ON');
    // Step-4-era offer table (has 'released' but not 'proposed') + response
    // already including 'no_show'. Step 6's rebuildOfferTableIfNeeded should
    // detect that 'proposed' is missing and rebuild.
    conn.exec(`
      CREATE TABLE posting (id TEXT PRIMARY KEY);
      CREATE TABLE employee (id TEXT PRIMARY KEY);
      CREATE TABLE offer (
        id TEXT PRIMARY KEY,
        posting_id TEXT NOT NULL REFERENCES posting(id),
        employee_id TEXT NOT NULL REFERENCES employee(id),
        rotation_position INTEGER,
        offered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        offered_by_user TEXT NOT NULL,
        phase TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','responded','expired','superseded','released')),
        eligibility_at_offer TEXT
      );
      CREATE TABLE response (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id TEXT NOT NULL REFERENCES offer(id),
        response_type TEXT NOT NULL CHECK(response_type IN (
          'yes','no','no_show','passed_over_unqualified','on_leave',
          'on_the_job','no_contact','supervisor_override'
        )),
        recorded_at TEXT,
        recorded_by_user TEXT NOT NULL,
        recorded_via TEXT NOT NULL DEFAULT 'team_member',
        reason TEXT,
        supersedes_response_id INTEGER REFERENCES response(id)
      );
      CREATE TABLE area (id TEXT PRIMARY KEY, name TEXT, shop TEXT, line TEXT, shift TEXT);
      CREATE TABLE charge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id TEXT NOT NULL REFERENCES offer(id),
        employee_id TEXT NOT NULL REFERENCES employee(id),
        area_id TEXT NOT NULL REFERENCES area(id),
        charge_type TEXT NOT NULL,
        amount REAL NOT NULL,
        mode_at_charge TEXT NOT NULL,
        recorded_at TEXT,
        reverses_charge_id INTEGER REFERENCES charge(id),
        cycle_number INTEGER
      );
      CREATE TABLE shift_pattern (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        cycle_length_days INTEGER NOT NULL,
        crew_count INTEGER NOT NULL,
        calendar_json TEXT NOT NULL,
        description TEXT
      );
    `);
    conn.prepare(`INSERT INTO posting VALUES ('pst-s6')`).run();
    conn.prepare(`INSERT INTO employee VALUES ('emp-s6')`).run();
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
         VALUES ('ofr-s6', 'pst-s6', 'emp-s6', 'seed', 'pending')`
      )
      .run();
  });

  it('rebuilds offer table; proposed value newly allowed', () => {
    runMigrations(conn);
    expect(() =>
      conn
        .prepare(
          `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
           VALUES ('ofr-s6-prop', 'pst-s6', 'emp-s6', 'seed', 'proposed')`
        )
        .run()
    ).not.toThrow();
  });

  it('pre-existing pending offer survives the Step 6 rebuild', () => {
    runMigrations(conn);
    const row = conn
      .prepare(`SELECT status FROM offer WHERE id = 'ofr-s6'`)
      .get() as { status: string };
    expect(row.status).toBe('pending');
  });

  it('Step 6 rebuild is idempotent on a freshly-rebuilt DB', () => {
    runMigrations(conn);
    runMigrations(conn);
    const row = conn
      .prepare(`SELECT COUNT(*) AS c FROM offer`)
      .get();
    expect(row).toEqual({ c: 1 });
  });
});
