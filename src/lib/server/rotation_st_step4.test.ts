// Step 4 tests — no-show penalty, reverse-selection ("go home"),
// ask-apprentices escalation, no force-low for ST.
//
// Test scaffolding mirrors rotation_st.test.ts: per-test in-memory DB with
// schema + migrations + shift_patterns, db() singleton patched to the test
// connection.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schemaSql } from './schema.js';
import { runMigrations } from './db.js';
import { seedShiftPatterns } from './shift_patterns.js';
import { _resetPatternCacheForTests } from './schedule_eligibility.js';
import { generateNextOffer, recordResponse } from './offers.js';
import { releaseExcessST, ReleaseExcessError } from './release_st.js';
import { initiateEscalation } from './escalation.js';

let conn: Database.Database;

beforeEach(async () => {
  conn = new Database(':memory:');
  conn.pragma('foreign_keys = ON');
  conn.exec(schemaSql);
  runMigrations(conn);
  seedShiftPatterns(conn);

  const dbModule = await import('./db.js');
  vi.spyOn(dbModule, 'db').mockReturnValue(conn);
  vi.spyOn(dbModule, 'withTransaction').mockImplementation((fn) => {
    const tx = conn.transaction(fn);
    return tx(conn);
  });
  _resetPatternCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  conn.close();
});

// ============================================================================
// Scaffolding (copied/adapted from rotation_st.test.ts — kept local to keep
// each test file self-contained)
// ============================================================================

function patternIdByName(name: string): number {
  const row = conn.prepare(`SELECT id FROM shift_pattern WHERE name = ?`).get(name) as { id: number };
  return row.id;
}
function seedArea(spec: {
  id: string; type?: 'production' | 'skilled_trades';
  shop?: string; shift?: string;
  allow_inter_shop_canvass?: number; no_show_penalty_hours?: number;
}) {
  conn
    .prepare(
      `INSERT INTO area (id, name, shop, line, shift, type,
                         allow_inter_shop_canvass, no_show_penalty_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      spec.id, `${spec.id} area`, spec.shop ?? 'Body', 'L1',
      spec.shift ?? '1st', spec.type ?? 'skilled_trades',
      spec.allow_inter_shop_canvass ?? 0,
      spec.no_show_penalty_hours ?? 1
    );
  conn
    .prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES (?, 'final', '2026-01-01')`
    )
    .run(spec.id);
  conn
    .prepare(`INSERT INTO rotation_state (area_id, current_cycle) VALUES (?, 1)`)
    .run(spec.id);
}
function seedEmployee(spec: {
  id: string; area_id: string; hire_date: string; last4_ssn?: string;
  classification?: string; area_of_expertise?: 'Electrical' | 'Mechanical';
  is_apprentice?: 0 | 1; shift_pattern?: string;
  crew_position?: number; cycle_anchor_date?: string;
  hours_offered?: number;
}) {
  const patternId = spec.shift_pattern ? patternIdByName(spec.shift_pattern) : null;
  conn
    .prepare(
      `INSERT INTO employee
         (id, display_name, first_name, last_name, hire_date, last4_ssn,
          classification, shift, is_apprentice, area_of_expertise,
          shift_pattern_id, crew_position, cycle_anchor_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, '1st', ?, ?, ?, ?, ?)`
    )
    .run(
      spec.id, spec.id, spec.id, spec.id, spec.hire_date, spec.last4_ssn ?? '0001',
      spec.classification ?? 'production', spec.is_apprentice ?? 0,
      spec.area_of_expertise ?? null, patternId,
      spec.crew_position ?? null, spec.cycle_anchor_date ?? null
    );
  conn
    .prepare(
      `INSERT INTO area_membership (employee_id, area_id, effective_begin_date)
       VALUES (?, ?, '2026-01-01')`
    )
    .run(spec.id, spec.area_id);
  if (spec.hours_offered != null && spec.hours_offered > 0) {
    const offerId = `ofr-bootstrap-${spec.id}`;
    conn
      .prepare(
        `INSERT INTO posting (id, area_id, work_date, start_time, duration_hours,
                              volunteers_needed, posted_by_user)
         VALUES (?, ?, '2026-01-01', '07:00', 0, 0, 'seed')`
      )
      .run(`pst-bootstrap-${spec.id}`, spec.area_id);
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
         VALUES (?, ?, ?, 'seed', 'responded')`
      )
      .run(offerId, `pst-bootstrap-${spec.id}`, spec.id);
    conn
      .prepare(
        `INSERT INTO charge
           (offer_id, employee_id, area_id, charge_type, amount,
            mode_at_charge, charge_multiplier)
         VALUES (?, ?, ?, 'hours_offered', ?, 'final', 1.0)`
      )
      .run(offerId, spec.id, spec.area_id, spec.hours_offered);
  }
}
function seedPosting(spec: {
  id: string; area_id: string; work_date: string;
  start_time?: string; duration_hours?: number; volunteers_needed?: number;
  pay_multiplier?: number; required_classification?: string;
  required_expertise?: 'Electrical' | 'Mechanical';
  ot_type?: string;
}) {
  conn
    .prepare(
      `INSERT INTO posting
         (id, area_id, ot_type, work_date, start_time, duration_hours,
          volunteers_needed, posted_by_user, pay_multiplier,
          required_classification, required_expertise)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'seed', ?, ?, ?)`
    )
    .run(
      spec.id, spec.area_id, spec.ot_type ?? 'voluntary_daily',
      spec.work_date, spec.start_time ?? '07:00',
      spec.duration_hours ?? 8, spec.volunteers_needed ?? 1,
      spec.pay_multiplier ?? 1.0,
      spec.required_classification ?? null,
      spec.required_expertise ?? null
    );
}

// ============================================================================
// No-show penalty
// ============================================================================

describe('SKT-04A no-show penalty', () => {
  beforeEach(() => {
    seedArea({ id: 'area-ns-st', no_show_penalty_hours: 1 });
    seedEmployee({
      id: 'emp-ns', area_id: 'area-ns-st',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 0
    });
  });

  it('on_rdo_volunteer + no_show → hours_offered + hours_accepted + penalty (3 charges)', () => {
    // Saturday 2026-05-09: Electrician is on RDO → on_rdo_volunteer
    seedPosting({
      id: 'pst-rdo', area_id: 'area-ns-st',
      work_date: '2026-05-09', start_time: '07:00',
      duration_hours: 4, pay_multiplier: 1.5,
      required_expertise: 'Electrical'
    });
    const made = generateNextOffer('pst-rdo', 'tester', 'admin');
    expect(made).not.toBeNull();
    // Sanity: the offer captured eligibility_at_offer at creation time.
    const offerRow = conn
      .prepare(`SELECT eligibility_at_offer FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { eligibility_at_offer: string };
    expect(offerRow.eligibility_at_offer).toBe('on_rdo_volunteer');

    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no_show',
      recorded_by_user: 'tester',
      recorded_by_role: 'admin',
      recorded_via: 'supervisor_on_behalf'
    });

    const charges = conn
      .prepare(
        `SELECT charge_type, amount, charge_multiplier FROM charge
          WHERE offer_id = ? ORDER BY id`
      )
      .all(made!.offer_id) as { charge_type: string; amount: number; charge_multiplier: number }[];
    expect(charges.length).toBe(3);
    // weightedHours = 4 × 1.5 = 6
    expect(charges[0]).toMatchObject({ charge_type: 'hours_offered', amount: 6, charge_multiplier: 1.5 });
    expect(charges[1]).toMatchObject({ charge_type: 'hours_accepted', amount: 6, charge_multiplier: 1.5 });
    // penalty: 1.0 hour, multiplier 1.0 (the penalty itself is a flat hour)
    expect(charges[2]).toMatchObject({ charge_type: 'hours_offered', amount: 1, charge_multiplier: 1.0 });
  });

  it('voluntary_weekend posting + no_show on a regular shift day → penalty still applies', () => {
    // Mon 2026-05-11: fixed_day = D. Posting marked as voluntary_weekend.
    // The penalty fires from the ot_type even though eligibility is on_normal_shift.
    seedPosting({
      id: 'pst-wkend', area_id: 'area-ns-st',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 8, pay_multiplier: 1.5,
      required_expertise: 'Electrical',
      ot_type: 'voluntary_weekend'
    });
    const made = generateNextOffer('pst-wkend', 'tester', 'admin');
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no_show',
      recorded_by_user: 'tester',
      recorded_by_role: 'admin',
      recorded_via: 'supervisor_on_behalf'
    });
    const charges = conn
      .prepare(`SELECT charge_type, amount FROM charge WHERE offer_id = ? ORDER BY id`)
      .all(made!.offer_id) as { charge_type: string; amount: number }[];
    expect(charges.length).toBe(3);
    expect(charges.find((c) => c.charge_type === 'hours_offered' && c.amount === 1)).toBeDefined();
  });

  it('voluntary_holiday + no_show → penalty', () => {
    seedPosting({
      id: 'pst-hol', area_id: 'area-ns-st',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 8, pay_multiplier: 2.0,
      required_expertise: 'Electrical',
      ot_type: 'voluntary_holiday'
    });
    const made = generateNextOffer('pst-hol', 'tester', 'admin');
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no_show',
      recorded_by_user: 'tester',
      recorded_by_role: 'admin',
      recorded_via: 'supervisor_on_behalf'
    });
    const charges = conn
      .prepare(`SELECT charge_type, amount FROM charge WHERE offer_id = ? ORDER BY id`)
      .all(made!.offer_id) as { charge_type: string; amount: number }[];
    expect(charges.length).toBe(3);
    // 8h × 2.0 = 16h for offered + accepted; penalty = 1.0 flat
    expect(charges.find((c) => c.charge_type === 'hours_accepted')?.amount).toBe(16);
    expect(charges.find((c) => c.charge_type === 'hours_offered' && c.amount === 1)).toBeDefined();
  });

  it('voluntary_daily + on_normal_shift + no_show → NO penalty, hours_offered only', () => {
    // Mon 2026-05-11: fixed_day = D, posting at 07:00 = day slot, voluntary_daily
    seedPosting({
      id: 'pst-daily', area_id: 'area-ns-st',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 4, pay_multiplier: 1.5,
      required_expertise: 'Electrical',
      ot_type: 'voluntary_daily'
    });
    const made = generateNextOffer('pst-daily', 'tester', 'admin');
    const offerRow = conn
      .prepare(`SELECT eligibility_at_offer FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { eligibility_at_offer: string };
    expect(offerRow.eligibility_at_offer).toBe('on_normal_shift');

    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no_show',
      recorded_by_user: 'tester',
      recorded_by_role: 'admin',
      recorded_via: 'supervisor_on_behalf'
    });
    const charges = conn
      .prepare(`SELECT charge_type, amount FROM charge WHERE offer_id = ? ORDER BY id`)
      .all(made!.offer_id) as { charge_type: string; amount: number }[];
    expect(charges.length).toBe(1);
    expect(charges[0].charge_type).toBe('hours_offered');
    expect(charges[0].amount).toBe(6); // 4h × 1.5
  });

  it('production no_show (regression) → no penalty; treated as a "no" in interim mode', () => {
    seedArea({ id: 'area-prod', type: 'production' });
    conn.prepare(`DELETE FROM area_mode_setting WHERE area_id = ?`).run('area-prod');
    conn.prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES ('area-prod','interim','2026-01-01')`
    ).run();
    conn.prepare(
      `INSERT INTO employee (id, display_name, first_name, last_name,
                              hire_date, last4_ssn, shift)
       VALUES ('emp-prod','Prod','P','P','2010-01-01','0001','1st')`
    ).run();
    conn.prepare(
      `INSERT INTO area_membership (employee_id, area_id, effective_begin_date)
       VALUES ('emp-prod','area-prod','2026-01-01')`
    ).run();
    seedPosting({
      id: 'pst-prod-ns', area_id: 'area-prod',
      work_date: '2026-05-11', duration_hours: 8
    });
    const made = generateNextOffer('pst-prod-ns', 'tester', 'admin');
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no_show',
      recorded_by_user: 'tester',
      recorded_by_role: 'admin',
      recorded_via: 'supervisor_on_behalf'
    });
    const charges = conn
      .prepare(`SELECT charge_type, amount FROM charge WHERE offer_id = ?`)
      .all(made!.offer_id) as { charge_type: string; amount: number }[];
    // Interim mode: opportunity charge only, no penalty.
    expect(charges.length).toBe(1);
    expect(charges[0].charge_type).toBe('opportunity');
    expect(charges[0].amount).toBe(1);
  });
});

// ============================================================================
// Ask-apprentices escalation
// ============================================================================

describe('SKT-04A ask-apprentices escalation', () => {
  it('exhausting the journey pool retries with apprentices unlocked, tags phase=apprentice_escalation', () => {
    seedArea({ id: 'area-app-esc' });
    // Two Electrician journeymen + one Electrical apprentice.
    seedEmployee({
      id: 'emp-j1', area_id: 'area-app-esc',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-j2', area_id: 'area-app-esc',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-app', area_id: 'area-app-esc',
      hire_date: '2024-01-01', last4_ssn: '0003',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      is_apprentice: 1,
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 50
    });
    // Put both journeymen on leave so the journey pool is empty.
    conn.prepare(
      `INSERT INTO leave_period (employee_id, leave_type, effective_begin_date)
       VALUES ('emp-j1','vacation','2026-05-01')`
    ).run();
    conn.prepare(
      `INSERT INTO leave_period (employee_id, leave_type, effective_begin_date)
       VALUES ('emp-j2','vacation','2026-05-01')`
    ).run();

    seedPosting({
      id: 'pst-app-esc', area_id: 'area-app-esc',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const made = generateNextOffer('pst-app-esc', 'tester', 'admin');
    expect(made?.employee_id).toBe('emp-app');
    const offerRow = conn
      .prepare(`SELECT phase FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { phase: string };
    expect(offerRow.phase).toBe('apprentice_escalation');
  });

  it('both pools exhaust → null returned, posting stays open, audit shows st_pool_exhausted', () => {
    seedArea({ id: 'area-exhaust' });
    seedEmployee({
      id: 'emp-only', area_id: 'area-exhaust',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    conn.prepare(
      `INSERT INTO leave_period (employee_id, leave_type, effective_begin_date)
       VALUES ('emp-only','vacation','2026-05-01')`
    ).run();
    seedPosting({
      id: 'pst-exh', area_id: 'area-exhaust',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const made = generateNextOffer('pst-exh', 'tester', 'admin');
    expect(made).toBeNull();
    const posting = conn
      .prepare(`SELECT status FROM posting WHERE id = ?`).get('pst-exh') as { status: string };
    expect(posting.status).toBe('open');
    const audit = conn
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'st_pool_exhausted'`)
      .get() as { c: number };
    expect(audit.c).toBeGreaterThan(0);
  });
});

describe('ST no force-low — defensive guards', () => {
  it('initiateEscalation on an ST posting throws (no force_low for ST)', () => {
    seedArea({ id: 'area-no-force' });
    seedEmployee({
      id: 'emp-x', area_id: 'area-no-force',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-no-force', area_id: 'area-no-force',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    expect(() => initiateEscalation('pst-no-force', 'tester', 'admin')).toThrow(/ST areas/);
  });

  it('post-fixture sweep: no force_low offer in any ST-area offer row', () => {
    // After all the ST scenarios above have run (in their own beforeEach
    // contexts), this fixture spins up a fresh DB and verifies the
    // invariant holds for a generated escalation case too. Acts as
    // compliance check 10's logical precursor.
    seedArea({ id: 'area-sweep' });
    seedEmployee({
      id: 'emp-s', area_id: 'area-sweep',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-sweep', area_id: 'area-sweep',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    generateNextOffer('pst-sweep', 'tester', 'admin');
    const forceLow = conn
      .prepare(
        `SELECT COUNT(*) AS c FROM offer o
           JOIN posting p ON p.id = o.posting_id
           JOIN area a ON a.id = p.area_id
          WHERE o.phase = 'force_low' AND a.type = 'skilled_trades'`
      )
      .get() as { c: number };
    expect(forceLow.c).toBe(0);
  });
});

// ============================================================================
// Reverse-selection (release-excess / "go home")
// ============================================================================

describe('SKT-04A reverse-selection ("go home")', () => {
  beforeEach(() => {
    seedArea({ id: 'area-rel' });
    // Three Electricians, all eligible, varying hours.
    seedEmployee({
      id: 'emp-low', area_id: 'area-rel',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-mid', area_id: 'area-rel',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 20
    });
    seedEmployee({
      id: 'emp-high', area_id: 'area-rel',
      hire_date: '2012-01-01', last4_ssn: '0003',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 30
    });
  });

  function fillThreeYeses(): string {
    // Volunteers_needed = 3 so all three say yes without satisfying early.
    seedPosting({
      id: 'pst-rel', area_id: 'area-rel',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 8, pay_multiplier: 1.5,
      volunteers_needed: 3, required_expertise: 'Electrical'
    });
    for (let i = 0; i < 3; i++) {
      const made = generateNextOffer('pst-rel', 'tester', 'admin');
      expect(made).not.toBeNull();
      recordResponse({
        offer_id: made!.offer_id,
        response_type: 'yes',
        recorded_by_user: 'tester',
        recorded_by_role: 'admin',
        recorded_via: 'supervisor_on_behalf'
      });
    }
    return 'pst-rel';
  }

  it('picks the highest-hours assigned worker first (reverse-selection)', () => {
    const pid = fillThreeYeses();
    const result = releaseExcessST(pid, 1, 'admin', 'admin');
    expect(result.released_employee_ids).toEqual(['emp-high']);
  });

  it('releases multiple workers in highest-hours-first order', () => {
    const pid = fillThreeYeses();
    const result = releaseExcessST(pid, 2, 'admin', 'admin');
    expect(result.released_employee_ids).toEqual(['emp-high', 'emp-mid']);
  });

  it('released worker hours_accepted nets to zero (reversal charge inserted)', () => {
    const pid = fillThreeYeses();
    releaseExcessST(pid, 1, 'admin', 'admin');
    // emp-high's net hours_accepted from this posting:
    const row = conn
      .prepare(
        `SELECT COALESCE(SUM(c.amount), 0) AS net
           FROM charge c
           JOIN offer o ON o.id = c.offer_id
          WHERE o.posting_id = ?
            AND c.employee_id = 'emp-high'
            AND c.charge_type = 'hours_accepted'`
      )
      .get(pid) as { net: number };
    expect(row.net).toBe(0);
    // Released offer status flipped.
    const offer = conn
      .prepare(
        `SELECT status FROM offer
          WHERE posting_id = ? AND employee_id = 'emp-high'`
      )
      .get(pid) as { status: string };
    expect(offer.status).toBe('released');
  });

  it('hours_offered is NOT reversed for the released worker (they were still offered)', () => {
    const pid = fillThreeYeses();
    releaseExcessST(pid, 1, 'admin', 'admin');
    const row = conn
      .prepare(
        `SELECT COALESCE(SUM(c.amount), 0) AS net
           FROM charge c
           JOIN offer o ON o.id = c.offer_id
          WHERE o.posting_id = ?
            AND c.employee_id = 'emp-high'
            AND c.charge_type = 'hours_offered'`
      )
      .get(pid) as { net: number };
    // 8h × 1.5 = 12 hours_offered, no reversal.
    expect(row.net).toBe(12);
  });

  it('rejects release-excess on a production area with 400-equivalent error', () => {
    seedArea({ id: 'area-prod-rel', type: 'production' });
    seedPosting({
      id: 'pst-prod-rel', area_id: 'area-prod-rel',
      work_date: '2026-05-11'
    });
    expect(() => releaseExcessST('pst-prod-rel', 1, 'admin', 'admin')).toThrow(ReleaseExcessError);
  });

  it('rejects count that exceeds the number of assigned workers', () => {
    const pid = fillThreeYeses();
    expect(() => releaseExcessST(pid, 5, 'admin', 'admin')).toThrow(/only 3 accepted/);
  });

  it('writes a st_worker_released audit entry per released worker', () => {
    const pid = fillThreeYeses();
    releaseExcessST(pid, 2, 'admin', 'admin');
    const audit = conn
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_log
          WHERE action = 'st_worker_released' AND posting_id = ?`
      )
      .get(pid) as { c: number };
    expect(audit.c).toBe(2);
  });
});

// ============================================================================
// Production escalation — regression sanity (ST guards don't break the
// existing PS-036 flow)
// ============================================================================

describe('production escalation regression — ST guard does not affect production', () => {
  it('initiateEscalation on a production posting still works (no guard fires)', () => {
    seedArea({ id: 'area-prod-esc', type: 'production' });
    conn.prepare(`DELETE FROM area_mode_setting WHERE area_id = ?`).run('area-prod-esc');
    conn.prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES ('area-prod-esc','interim','2026-01-01')`
    ).run();
    conn.prepare(
      `INSERT INTO employee (id, display_name, first_name, last_name,
                              hire_date, last4_ssn, shift)
       VALUES ('emp-prod','Prod','P','P','2010-01-01','0001','1st')`
    ).run();
    conn.prepare(
      `INSERT INTO area_membership (employee_id, area_id, effective_begin_date)
       VALUES ('emp-prod','area-prod-esc','2026-01-01')`
    ).run();
    seedPosting({
      id: 'pst-prod-esc', area_id: 'area-prod-esc',
      work_date: '2026-05-11', duration_hours: 8, volunteers_needed: 2
    });
    // No yeses yet — escalation can initiate.
    const result = initiateEscalation('pst-prod-esc', 'tester', 'admin');
    expect(result.branch).toBe('critical');
    // critical → ask_high path active
    expect(result.ask_high_offers_created).toBeGreaterThan(0);
  });
});
