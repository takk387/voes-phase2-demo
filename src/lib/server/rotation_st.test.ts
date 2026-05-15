// Skilled-Trades rotation + charge tests.
//
// Each test stands up a fresh in-memory DB with schema + migrations +
// shift_patterns + a minimal ST scenario, then exercises rotation_st.ts and
// the ST charge path in offers.ts. The db() singleton is patched per test so
// helpers downstream see the test connection.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schemaSql } from './schema.js';
import { runMigrations } from './db.js';
import { seedShiftPatterns } from './shift_patterns.js';
import { _resetPatternCacheForTests } from './schedule_eligibility.js';
import { nextEligibleST, type STPosting } from './rotation_st.js';
import { generateNextOffer, recordResponse } from './offers.js';

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
// Test scaffolding
// ============================================================================

function patternIdByName(name: string): number {
  const row = conn
    .prepare(`SELECT id FROM shift_pattern WHERE name = ?`)
    .get(name) as { id: number } | undefined;
  if (!row) throw new Error(`shift_pattern '${name}' not seeded`);
  return row.id;
}

interface AreaSpec {
  id: string;
  type?: 'production' | 'skilled_trades';
  shop?: string;
  shift?: string;
  allow_inter_shop_canvass?: number;
  no_show_penalty_hours?: number;
}
function seedArea(spec: AreaSpec) {
  conn
    .prepare(
      `INSERT INTO area (id, name, shop, line, shift, type,
                         allow_inter_shop_canvass, no_show_penalty_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      spec.id,
      `${spec.id} area`,
      spec.shop ?? 'Body',
      'L1',
      spec.shift ?? '1st',
      spec.type ?? 'skilled_trades',
      spec.allow_inter_shop_canvass ?? 0,
      spec.no_show_penalty_hours ?? 0
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

interface EmpSpec {
  id: string;
  area_id: string;
  hire_date: string;
  last4_ssn?: string;
  classification?: string;
  area_of_expertise?: 'Electrical' | 'Mechanical';
  is_apprentice?: 0 | 1;
  shift_pattern?: string;     // 'fixed_day' etc — sets shift_pattern_id
  crew_position?: number;
  cycle_anchor_date?: string;
  hours_offered?: number;     // bootstrap charge to control sort order
  soft_quals?: string[];      // qualification ids to grant
  hard_quals?: string[];
}
function seedEmployee(spec: EmpSpec) {
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
      spec.id,
      spec.id,
      spec.id,
      spec.id,
      spec.hire_date,
      spec.last4_ssn ?? '0001',
      spec.classification ?? 'production',
      spec.is_apprentice ?? 0,
      spec.area_of_expertise ?? null,
      patternId,
      spec.crew_position ?? null,
      spec.cycle_anchor_date ?? null
    );
  conn
    .prepare(
      `INSERT INTO area_membership (employee_id, area_id, effective_begin_date)
       VALUES (?, ?, '2026-01-01')`
    )
    .run(spec.id, spec.area_id);

  // Grant any quals (both soft and hard get the same employee_qualification
  // row; the soft-vs-hard distinction lives on the posting side).
  for (const q of [...(spec.soft_quals ?? []), ...(spec.hard_quals ?? [])]) {
    ensureQual(q);
    conn
      .prepare(
        `INSERT INTO employee_qualification (employee_id, qualification_id, granted_date)
         VALUES (?, ?, '2026-01-01')`
      )
      .run(spec.id, q);
  }

  // Bootstrap hours_offered to control ranking.
  if (spec.hours_offered != null && spec.hours_offered > 0) {
    // Need a paper offer to hang the charge on.
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

function ensureQual(id: string) {
  conn
    .prepare(`INSERT OR IGNORE INTO qualification (id, name) VALUES (?, ?)`)
    .run(id, id);
}

interface PostingSpec {
  id: string;
  area_id: string;
  work_date: string;
  start_time?: string;
  duration_hours?: number;
  pay_multiplier?: number;
  required_classification?: string;
  required_expertise?: 'Electrical' | 'Mechanical';
  hard_quals?: string[];
  soft_quals?: string[];
}
function seedPosting(spec: PostingSpec) {
  conn
    .prepare(
      `INSERT INTO posting
         (id, area_id, work_date, start_time, duration_hours,
          volunteers_needed, posted_by_user, pay_multiplier,
          required_classification, required_expertise)
       VALUES (?, ?, ?, ?, ?, 1, 'seed', ?, ?, ?)`
    )
    .run(
      spec.id,
      spec.area_id,
      spec.work_date,
      spec.start_time ?? '07:00',
      spec.duration_hours ?? 8,
      spec.pay_multiplier ?? 1.0,
      spec.required_classification ?? null,
      spec.required_expertise ?? null
    );
  for (const q of spec.hard_quals ?? []) {
    ensureQual(q);
    conn
      .prepare(`INSERT INTO posting_qualification (posting_id, qualification_id) VALUES (?, ?)`)
      .run(spec.id, q);
  }
  for (const q of spec.soft_quals ?? []) {
    ensureQual(q);
    conn
      .prepare(`INSERT INTO posting_preferred_qualification (posting_id, qualification_id) VALUES (?, ?)`)
      .run(spec.id, q);
  }
}

// Pull a posting back as STPosting for direct nextEligibleST calls.
function loadST(posting_id: string): STPosting {
  const p = conn
    .prepare(
      `SELECT id, area_id, work_date, start_time, duration_hours,
              pay_multiplier, required_classification, required_expertise
         FROM posting WHERE id = ?`
    )
    .get(posting_id) as {
      id: string;
      area_id: string;
      work_date: string;
      start_time: string;
      duration_hours: number;
      pay_multiplier: number;
      required_classification: string | null;
      required_expertise: string | null;
    };
  const hard = (
    conn.prepare(`SELECT qualification_id FROM posting_qualification WHERE posting_id = ?`)
      .all(posting_id) as { qualification_id: string }[]
  ).map((r) => r.qualification_id);
  const soft = (
    conn.prepare(`SELECT qualification_id FROM posting_preferred_qualification WHERE posting_id = ?`)
      .all(posting_id) as { qualification_id: string }[]
  ).map((r) => r.qualification_id);
  return {
    ...p,
    required_qualifications: hard,
    preferred_qualifications: soft
  };
}

// ============================================================================
// Selection — classification + expertise + schedule gates
// ============================================================================

describe('nextEligibleST — expertise + classification gating', () => {
  beforeEach(() => {
    seedArea({ id: 'area-body-st-1' });
    // Mixed-expertise area: 1 Electrician, 1 Millwright, 1 PipeFitter,
    // 1 Mechanical apprentice. Apprentice has the highest hours so they
    // sort last when un-gated; we focus on the gating logic.
    seedEmployee({
      id: 'emp-e1', area_id: 'area-body-st-1',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-m1', area_id: 'area-body-st-1',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'Millwright', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-p1', area_id: 'area-body-st-1',
      hire_date: '2012-01-01', last4_ssn: '0003',
      classification: 'PipeFitter', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
  });

  it('required_classification=PipeFitter excludes Millwrights even when expertise group matches', () => {
    seedPosting({
      id: 'pst-pf-1', area_id: 'area-body-st-1',
      work_date: '2026-05-11', start_time: '07:00',
      required_classification: 'PipeFitter', required_expertise: 'Mechanical'
    });
    const result = nextEligibleST(loadST('pst-pf-1'));
    expect(result.candidate?.employee_id).toBe('emp-p1');
    expect(
      result.skips.find((s) => s.employee_id === 'emp-m1')?.reason
    ).toBe('classification_mismatch');
  });

  it('required_expertise=Electrical (no classification) picks Electrician, skips Mechanical with expertise_mismatch', () => {
    seedPosting({
      id: 'pst-el-1', area_id: 'area-body-st-1',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const result = nextEligibleST(loadST('pst-el-1'));
    expect(result.candidate?.employee_id).toBe('emp-e1');
    expect(result.skips.find((s) => s.employee_id === 'emp-m1')?.reason)
      .toBe('expertise_mismatch');
    expect(result.skips.find((s) => s.employee_id === 'emp-p1')?.reason)
      .toBe('expertise_mismatch');
  });
});

describe('nextEligibleST — schedule eligibility', () => {
  beforeEach(() => {
    seedArea({ id: 'area-bat-st' });
    // Battery rotating area uses 4_crew_12h_rotating. Anchor Mon 2026-05-04.
    // Crew 1 on day 0 = D. Crew 2 on day 0 = N. Both Electricians.
    seedEmployee({
      id: 'emp-crew1', area_id: 'area-bat-st',
      hire_date: '2010-01-01', last4_ssn: '1111',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: '4_crew_12h_rotating',
      crew_position: 1, cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-crew2', area_id: 'area-bat-st',
      hire_date: '2011-01-01', last4_ssn: '2222',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: '4_crew_12h_rotating',
      crew_position: 2, cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
  });

  it('4-crew rotating Crew 2 (N on Mon) is excluded from a day-shift posting', () => {
    seedPosting({
      id: 'pst-day-1', area_id: 'area-bat-st',
      work_date: '2026-05-04', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const result = nextEligibleST(loadST('pst-day-1'));
    expect(result.candidate?.employee_id).toBe('emp-crew1');
    expect(result.skips.find((s) => s.employee_id === 'emp-crew2')?.reason)
      .toBe('shift_conflict');
  });

  it('same Crew 2 is INCLUDED on an overlapping night-shift posting (22:00)', () => {
    seedPosting({
      id: 'pst-night-1', area_id: 'area-bat-st',
      work_date: '2026-05-04', start_time: '22:00',
      required_expertise: 'Electrical'
    });
    const result = nextEligibleST(loadST('pst-night-1'));
    expect(result.candidate?.employee_id).toBe('emp-crew2');
  });

  it('RDO designation is included and eligibility_at_offer = on_rdo_volunteer', () => {
    // Sat 2026-05-09: fixed_day employees are on RDO and can volunteer.
    seedArea({ id: 'area-body-st-2' });
    seedEmployee({
      id: 'emp-fixed-1', area_id: 'area-body-st-2',
      hire_date: '2010-01-01', last4_ssn: '0099',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-sat-1', area_id: 'area-body-st-2',
      work_date: '2026-05-09', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const result = nextEligibleST(loadST('pst-sat-1'));
    expect(result.candidate?.employee_id).toBe('emp-fixed-1');
    expect(result.candidate?.eligibility_at_offer).toBe('on_rdo_volunteer');
  });
});

// ============================================================================
// Apprentice gating
// ============================================================================

describe('nextEligibleST — apprentice gating', () => {
  beforeEach(() => {
    seedArea({ id: 'area-bat' });
    // 2 Electrician journeymen, 1 Electrical apprentice. All eligible on
    // schedule. Apprentice has LOWER hours so they'd win if not gated.
    seedEmployee({
      id: 'emp-elec-1', area_id: 'area-bat',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 20
    });
    seedEmployee({
      id: 'emp-elec-2', area_id: 'area-bat',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 30
    });
    seedEmployee({
      id: 'emp-app-e', area_id: 'area-bat',
      hire_date: '2024-01-01', last4_ssn: '0003',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      is_apprentice: 1,
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 0
    });
  });

  it('apprentice is gated out when journeyperson has not yet been offered this cycle', () => {
    seedPosting({
      id: 'pst-e1', area_id: 'area-bat',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const result = nextEligibleST(loadST('pst-e1'));
    expect(result.candidate?.employee_id).toBe('emp-elec-1');
    expect(result.skips.find((s) => s.employee_id === 'emp-app-e')?.reason)
      .toBe('apprentice_gated');
  });

  it('apprentice joins pool once all journeypersons in expertise have been offered this cycle', () => {
    // Mark both Electrician journeypersons as offered in cycle 1.
    conn
      .prepare(`INSERT INTO cycle_offered (area_id, cycle_number, employee_id) VALUES (?, 1, ?)`)
      .run('area-bat', 'emp-elec-1');
    conn
      .prepare(`INSERT INTO cycle_offered (area_id, cycle_number, employee_id) VALUES (?, 1, ?)`)
      .run('area-bat', 'emp-elec-2');

    seedPosting({
      id: 'pst-e2', area_id: 'area-bat',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const result = nextEligibleST(loadST('pst-e2'));
    // Apprentice has lowest hours (0) and is now ungated.
    expect(result.candidate?.employee_id).toBe('emp-app-e');
  });

  it('cross-expertise: an Electrical journeyperson being un-offered does NOT gate a Mechanical apprentice', () => {
    // Add a Mechanical apprentice and Mechanical journeyperson.
    seedEmployee({
      id: 'emp-mw-1', area_id: 'area-bat',
      hire_date: '2010-06-01', last4_ssn: '0011',
      classification: 'Millwright', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 50
    });
    seedEmployee({
      id: 'emp-app-m', area_id: 'area-bat',
      hire_date: '2024-06-01', last4_ssn: '0012',
      classification: 'Millwright', area_of_expertise: 'Mechanical',
      is_apprentice: 1,
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 5
    });
    // Mark the one Mechanical journeyperson as already offered this cycle.
    conn
      .prepare(`INSERT INTO cycle_offered (area_id, cycle_number, employee_id) VALUES (?, 1, ?)`)
      .run('area-bat', 'emp-mw-1');

    seedPosting({
      id: 'pst-m1', area_id: 'area-bat',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Mechanical'
    });
    const result = nextEligibleST(loadST('pst-m1'));
    // Apprentice gets the offer — emp-mw-1 was offered already, so Mechanical
    // group is past the gate.
    expect(result.candidate?.employee_id).toBe('emp-app-m');
  });
});

// ============================================================================
// Soft-qual preference
// ============================================================================

describe('nextEligibleST — soft-qual preference ordering', () => {
  it('hours tied → candidate with the welding cert wins over one without', () => {
    seedArea({ id: 'area-mq' });
    seedEmployee({
      id: 'emp-a', area_id: 'area-mq',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10,
      soft_quals: ['qual-welding']
    });
    seedEmployee({
      id: 'emp-b', area_id: 'area-mq',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-mq', area_id: 'area-mq',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical',
      soft_quals: ['qual-welding']
    });
    const result = nextEligibleST(loadST('pst-mq'));
    expect(result.candidate?.employee_id).toBe('emp-a');
    expect(result.candidate?.preferred_quals_matched).toBe(1);
  });

  it('soft quals never EXCLUDE — candidate missing a soft qual still appears', () => {
    seedArea({ id: 'area-only-b' });
    seedEmployee({
      id: 'emp-only-b', area_id: 'area-only-b',
      hire_date: '2011-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-only-b', area_id: 'area-only-b',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical',
      soft_quals: ['qual-welding']
    });
    const result = nextEligibleST(loadST('pst-only-b'));
    expect(result.candidate?.employee_id).toBe('emp-only-b');
    expect(result.candidate?.preferred_quals_matched).toBe(0);
  });
});

// ============================================================================
// Inter-shop canvass
// ============================================================================

describe('nextEligibleST — inter-shop canvass', () => {
  it('triggers when in-area pool is exhausted AND allow_inter_shop_canvass=1', () => {
    seedArea({ id: 'area-paint-st', shop: 'Paint', shift: '1st', allow_inter_shop_canvass: 1 });
    seedArea({ id: 'area-body-st',  shop: 'Body',  shift: '1st', allow_inter_shop_canvass: 1 });

    // Paint area has no PipeFitter. Body area has one.
    seedEmployee({
      id: 'emp-paint-mw', area_id: 'area-paint-st',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Millwright', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-body-pf', area_id: 'area-body-st',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'PipeFitter', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });

    seedPosting({
      id: 'pst-pf-paint', area_id: 'area-paint-st',
      work_date: '2026-05-11', start_time: '07:00',
      required_classification: 'PipeFitter', required_expertise: 'Mechanical'
    });
    const result = nextEligibleST(loadST('pst-pf-paint'));
    expect(result.phase).toBe('inter_shop_canvass');
    expect(result.candidate?.employee_id).toBe('emp-body-pf');
    expect(result.candidate?.source_area_id).toBe('area-body-st');
  });

  it('does NOT trigger when allow_inter_shop_canvass=0 (returns null)', () => {
    seedArea({ id: 'area-paint-st', shop: 'Paint', shift: '1st', allow_inter_shop_canvass: 0 });
    seedArea({ id: 'area-body-st',  shop: 'Body',  shift: '1st', allow_inter_shop_canvass: 0 });
    seedEmployee({
      id: 'emp-paint-mw', area_id: 'area-paint-st',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Millwright', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedEmployee({
      id: 'emp-body-pf', area_id: 'area-body-st',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'PipeFitter', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-pf-paint-2', area_id: 'area-paint-st',
      work_date: '2026-05-11', start_time: '07:00',
      required_classification: 'PipeFitter'
    });
    const result = nextEligibleST(loadST('pst-pf-paint-2'));
    expect(result.candidate).toBeNull();
    expect(result.phase).toBeNull();
  });

  it('stays within shift × expertise — does not pull a 2nd-shift ST area into a 1st-shift canvass', () => {
    seedArea({ id: 'area-paint-1st', shop: 'Paint', shift: '1st', allow_inter_shop_canvass: 1 });
    seedArea({ id: 'area-body-2nd',  shop: 'Body',  shift: '2nd', allow_inter_shop_canvass: 1 });
    seedEmployee({
      id: 'emp-body-pf', area_id: 'area-body-2nd',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'PipeFitter', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-pf-cross-shift', area_id: 'area-paint-1st',
      work_date: '2026-05-11', start_time: '07:00',
      required_classification: 'PipeFitter'
    });
    const result = nextEligibleST(loadST('pst-pf-cross-shift'));
    // 2nd-shift area is excluded from a 1st-shift posting's canvass; pool is empty.
    expect(result.candidate).toBeNull();
  });
});

// ============================================================================
// ST charge calculation (recordResponse + generateNextOffer end-to-end)
// ============================================================================

describe('ST charges via recordResponse — pay multiplier weighting', () => {
  beforeEach(() => {
    seedArea({ id: 'area-charge-st' });
    seedEmployee({
      id: 'emp-x', area_id: 'area-charge-st',
      hire_date: '2010-01-01', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 0
    });
  });

  it('1h posting at 1.5× → hours_offered charge.amount=1.5 and charge_multiplier=1.5 (on no)', () => {
    seedPosting({
      id: 'pst-tah', area_id: 'area-charge-st',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 1, pay_multiplier: 1.5,
      required_expertise: 'Electrical'
    });
    const made = generateNextOffer('pst-tah', 'tester', 'sv');
    expect(made?.employee_id).toBe('emp-x');
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no',
      recorded_by_user: 'tester',
      recorded_by_role: 'sv',
      recorded_via: 'manual_entry'
    });
    const rows = conn
      .prepare(
        `SELECT charge_type, amount, charge_multiplier FROM charge
          WHERE area_id = ? AND charge_type = 'hours_offered'`
      )
      .all('area-charge-st') as { charge_type: string; amount: number; charge_multiplier: number }[];
    expect(rows.length).toBe(1);
    expect(rows[0].amount).toBeCloseTo(1.5);
    expect(rows[0].charge_multiplier).toBeCloseTo(1.5);
  });

  it('4h posting at 2.0× → both hours_offered and hours_accepted = 8.0 on yes', () => {
    seedPosting({
      id: 'pst-dt', area_id: 'area-charge-st',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 4, pay_multiplier: 2.0,
      required_expertise: 'Electrical'
    });
    const made = generateNextOffer('pst-dt', 'tester', 'sv');
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'yes',
      recorded_by_user: 'tester',
      recorded_by_role: 'sv',
      recorded_via: 'manual_entry'
    });
    const charges = conn
      .prepare(
        `SELECT charge_type, amount, charge_multiplier FROM charge
          WHERE area_id = ? ORDER BY charge_type`
      )
      .all('area-charge-st') as { charge_type: string; amount: number; charge_multiplier: number }[];
    const offered = charges.find((c) => c.charge_type === 'hours_offered');
    const accepted = charges.find((c) => c.charge_type === 'hours_accepted');
    expect(offered?.amount).toBeCloseTo(8.0);
    expect(offered?.charge_multiplier).toBeCloseTo(2.0);
    expect(accepted?.amount).toBeCloseTo(8.0);
    expect(accepted?.charge_multiplier).toBeCloseTo(2.0);
  });

  it('marks cycle_offered for ST so apprentice gating sees the offer', () => {
    seedPosting({
      id: 'pst-co', area_id: 'area-charge-st',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 8, pay_multiplier: 1.0,
      required_expertise: 'Electrical'
    });
    const made = generateNextOffer('pst-co', 'tester', 'sv');
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no',
      recorded_by_user: 'tester',
      recorded_by_role: 'sv',
      recorded_via: 'manual_entry'
    });
    const cycleRow = conn
      .prepare(`SELECT employee_id FROM cycle_offered WHERE area_id = ? AND cycle_number = 1`)
      .get('area-charge-st');
    expect(cycleRow).toBeDefined();
  });
});

// ============================================================================
// generateNextOffer dispatch — phase tagging
// ============================================================================

describe('generateNextOffer — ST dispatch + phase tagging', () => {
  it('tags inter-shop canvass offers with phase=inter_shop_canvass on the offer row', () => {
    seedArea({ id: 'area-paint-st', shop: 'Paint', shift: '1st', allow_inter_shop_canvass: 1 });
    seedArea({ id: 'area-body-st',  shop: 'Body',  shift: '1st', allow_inter_shop_canvass: 1 });
    seedEmployee({
      id: 'emp-body-pf', area_id: 'area-body-st',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'PipeFitter', area_of_expertise: 'Mechanical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-canvass', area_id: 'area-paint-st',
      work_date: '2026-05-11', start_time: '07:00',
      required_classification: 'PipeFitter'
    });
    const made = generateNextOffer('pst-canvass', 'tester', 'sv');
    expect(made?.employee_id).toBe('emp-body-pf');
    const offerRow = conn
      .prepare(`SELECT phase FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { phase: string | null };
    expect(offerRow.phase).toBe('inter_shop_canvass');
  });

  it('normal ST offers leave offer.phase NULL', () => {
    seedArea({ id: 'area-normal' });
    seedEmployee({
      id: 'emp-normal', area_id: 'area-normal',
      hire_date: '2011-01-01', last4_ssn: '0002',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04',
      hours_offered: 10
    });
    seedPosting({
      id: 'pst-normal', area_id: 'area-normal',
      work_date: '2026-05-11', start_time: '07:00',
      required_expertise: 'Electrical'
    });
    const made = generateNextOffer('pst-normal', 'tester', 'sv');
    const offerRow = conn
      .prepare(`SELECT phase FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { phase: string | null };
    expect(offerRow.phase).toBeNull();
  });
});

// ============================================================================
// Production regression — ST migration must not break PS-036 path
// ============================================================================

describe('production area regression — PS-036 path unchanged by ST additions', () => {
  it('production area uses opportunity charges in interim mode (no multiplier weighting)', () => {
    seedArea({ id: 'area-prod', type: 'production' });
    // Override mode to interim (seedArea defaults to final).
    conn.prepare(`DELETE FROM area_mode_setting WHERE area_id = ?`).run('area-prod');
    conn
      .prepare(
        `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
         VALUES ('area-prod', 'interim', '2026-01-01')`
      )
      .run();

    // Plain production employee — no classification, no shift_pattern.
    conn
      .prepare(
        `INSERT INTO employee (id, display_name, first_name, last_name,
                               hire_date, last4_ssn, shift)
         VALUES ('emp-prod', 'Prod, P.', 'P', 'Prod', '2010-01-01', '0001', '1st')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO area_membership (employee_id, area_id, effective_begin_date)
         VALUES ('emp-prod', 'area-prod', '2026-01-01')`
      )
      .run();

    seedPosting({
      id: 'pst-prod', area_id: 'area-prod',
      work_date: '2026-05-11', start_time: '07:00',
      duration_hours: 8
    });
    const made = generateNextOffer('pst-prod', 'tester', 'sv');
    expect(made?.employee_id).toBe('emp-prod');
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'yes',
      recorded_by_user: 'tester',
      recorded_by_role: 'sv',
      recorded_via: 'manual_entry'
    });
    const charges = conn
      .prepare(`SELECT charge_type, amount, charge_multiplier FROM charge WHERE area_id = ?`)
      .all('area-prod') as { charge_type: string; amount: number; charge_multiplier: number }[];
    // Interim mode → opportunity charge, no hours-based rows.
    expect(charges.length).toBe(1);
    expect(charges[0].charge_type).toBe('opportunity');
    expect(charges[0].amount).toBe(1);
    // Default multiplier on a production charge is 1.0 (the column default).
    expect(charges[0].charge_multiplier).toBe(1.0);
  });
});
