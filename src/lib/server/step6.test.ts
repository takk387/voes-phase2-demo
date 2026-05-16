// Step 6 tests — proposed-offer flow (SV approval gate), schedule_view
// grid helpers, /admin/patterns shape, st_dashboard summarisation, and
// the production regression on offer.status CHECK.
//
// Test scaffolding mirrors rotation_st_step4.test.ts.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schemaSql } from './schema.js';
import { runMigrations } from './db.js';
import { seedShiftPatterns } from './shift_patterns.js';
import { _resetPatternCacheForTests } from './schedule_eligibility.js';
import {
  generateNextOffer,
  recordResponse,
  approveProposedSTPosting
} from './offers.js';
import { buildScheduleView } from './schedule_view.js';
import { summarizeSTArea } from './st_dashboard.js';

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
// Scaffolding
// ============================================================================

function patternIdByName(name: string): number {
  const row = conn.prepare(`SELECT id FROM shift_pattern WHERE name = ?`).get(name) as { id: number };
  return row.id;
}
function seedSTArea(id: string) {
  conn
    .prepare(
      `INSERT INTO area (id, name, shop, line, shift, type, no_show_penalty_hours)
       VALUES (?, ?, 'Body', 'L1', '1st', 'skilled_trades', 1)`
    )
    .run(id, `${id} area`);
  conn
    .prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES (?, 'final', '2026-01-01')`
    )
    .run(id);
  conn
    .prepare(`INSERT INTO rotation_state (area_id, current_cycle) VALUES (?, 1)`)
    .run(id);
}
function seedProductionArea(id: string) {
  conn
    .prepare(
      `INSERT INTO area (id, name, shop, line, shift, type)
       VALUES (?, ?, 'Body', 'L1', '1st', 'production')`
    )
    .run(id, `${id} area`);
  conn
    .prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES (?, 'final', '2026-01-01')`
    )
    .run(id);
  conn
    .prepare(`INSERT INTO rotation_state (area_id, current_cycle) VALUES (?, 1)`)
    .run(id);
}
function seedSTEmployee(spec: {
  id: string; area_id: string;
  hire_date?: string; last4_ssn?: string;
  classification?: string;
  area_of_expertise?: 'Electrical' | 'Mechanical';
  is_apprentice?: 0 | 1;
  shift_pattern?: string;
  crew_position?: number | null;
  cycle_anchor_date?: string | null;
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
      spec.id, spec.id, spec.id, spec.id,
      spec.hire_date ?? '2010-01-01',
      spec.last4_ssn ?? '0001',
      spec.classification ?? 'Electrician',
      spec.is_apprentice ?? 0,
      spec.area_of_expertise ?? 'Electrical',
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
}
function seedSTPosting(spec: {
  id: string; area_id: string;
  pending_sv_approval?: number;
  duration_hours?: number;
  pay_multiplier?: number;
  required_expertise?: 'Electrical' | 'Mechanical';
  work_date?: string;
  start_time?: string;
}) {
  conn
    .prepare(
      `INSERT INTO posting
         (id, area_id, ot_type, work_date, start_time, duration_hours,
          volunteers_needed, posted_by_user, pay_multiplier,
          required_expertise, pending_sv_approval)
       VALUES (?, ?, 'voluntary_daily', ?, ?, ?, 1, 'seed', ?, ?, ?)`
    )
    .run(
      spec.id, spec.area_id,
      spec.work_date ?? '2026-05-11',
      spec.start_time ?? '07:00',
      spec.duration_hours ?? 4,
      spec.pay_multiplier ?? 1.5,
      spec.required_expertise ?? 'Electrical',
      spec.pending_sv_approval ?? 0
    );
}

// ============================================================================
// Proposed-offer flow (Step 6 core)
// ============================================================================

describe('proposed-offer flow (pending_sv_approval=1)', () => {
  beforeEach(() => {
    seedSTArea('area-st-1');
    seedSTEmployee({
      id: 'emp-electrician', area_id: 'area-st-1',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
  });

  it('generateNextOffer creates offer with status=proposed when pending_sv_approval=1', () => {
    seedSTPosting({ id: 'pst-prop', area_id: 'area-st-1', pending_sv_approval: 1 });
    const made = generateNextOffer('pst-prop', 'coord-davis', 'skt_coordinator');
    expect(made).not.toBeNull();

    const offer = conn
      .prepare(`SELECT status FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { status: string };
    expect(offer.status).toBe('proposed');
  });

  it('generateNextOffer creates offer with status=pending when pending_sv_approval=0', () => {
    seedSTPosting({ id: 'pst-direct', area_id: 'area-st-1', pending_sv_approval: 0 });
    const made = generateNextOffer('pst-direct', 'coord-davis', 'skt_coordinator');
    expect(made).not.toBeNull();
    const offer = conn
      .prepare(`SELECT status FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { status: string };
    expect(offer.status).toBe('pending');
  });

  it('recordResponse on a proposed offer throws "offer awaits ST SV approval"', () => {
    seedSTPosting({ id: 'pst-blocked', area_id: 'area-st-1', pending_sv_approval: 1 });
    const made = generateNextOffer('pst-blocked', 'coord-davis', 'skt_coordinator');
    expect(() =>
      recordResponse({
        offer_id: made!.offer_id,
        response_type: 'yes',
        recorded_by_user: 'tester',
        recorded_by_role: 'admin',
        recorded_via: 'supervisor_on_behalf'
      })
    ).toThrow(/awaits ST SV approval/);
  });

  it('approveProposedSTPosting flips proposed -> pending and writes sv_approved_st_posting audit', () => {
    seedSTPosting({ id: 'pst-toapprove', area_id: 'area-st-1', pending_sv_approval: 1 });
    const made = generateNextOffer('pst-toapprove', 'coord-davis', 'skt_coordinator');

    const result = approveProposedSTPosting('pst-toapprove', 'sv-body-1st-st', 'st_supervisor');
    expect(result.offer_id).toBe(made!.offer_id);

    const offer = conn
      .prepare(`SELECT status FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { status: string };
    expect(offer.status).toBe('pending');

    const posting = conn
      .prepare(`SELECT pending_sv_approval FROM posting WHERE id = ?`)
      .get('pst-toapprove') as { pending_sv_approval: number };
    expect(posting.pending_sv_approval).toBe(0);

    const audit = conn
      .prepare(`SELECT action FROM audit_log WHERE posting_id = ?
                  AND action = 'sv_approved_st_posting'`)
      .all('pst-toapprove');
    expect(audit.length).toBe(1);
  });

  it('approveProposedSTPosting throws if posting is not awaiting SV approval', () => {
    seedSTPosting({ id: 'pst-already-live', area_id: 'area-st-1', pending_sv_approval: 0 });
    expect(() =>
      approveProposedSTPosting('pst-already-live', 'sv', 'st_supervisor')
    ).toThrow(/not awaiting SV approval/);
  });

  it('after approveProposedSTPosting, recording response now works', () => {
    seedSTPosting({ id: 'pst-postapprove', area_id: 'area-st-1', pending_sv_approval: 1 });
    const made = generateNextOffer('pst-postapprove', 'coord-davis', 'skt_coordinator');
    approveProposedSTPosting('pst-postapprove', 'sv-body-1st-st', 'st_supervisor');

    // Now recording response should succeed.
    expect(() =>
      recordResponse({
        offer_id: made!.offer_id,
        response_type: 'yes',
        recorded_by_user: 'tester',
        recorded_by_role: 'st_supervisor',
        recorded_via: 'supervisor_on_behalf'
      })
    ).not.toThrow();
  });

  it('proposed offer is audited as st_offer_proposed, not offer_made', () => {
    seedSTPosting({ id: 'pst-audit', area_id: 'area-st-1', pending_sv_approval: 1 });
    const made = generateNextOffer('pst-audit', 'coord-davis', 'skt_coordinator');
    const audit = conn
      .prepare(`SELECT action FROM audit_log WHERE offer_id = ?`)
      .all(made!.offer_id) as { action: string }[];
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('st_offer_proposed');
    expect(actions).not.toContain('offer_made');
  });
});

// ============================================================================
// Production regression
// ============================================================================

describe('production offer status unaffected by Step 6', () => {
  it('production offers still land as pending (no proposed path)', () => {
    seedProductionArea('area-prod-1');
    conn
      .prepare(
        `INSERT INTO employee
           (id, display_name, first_name, last_name, hire_date, last4_ssn,
            classification, shift)
         VALUES ('emp-prod', 'prod tm', 'prod', 'tm', '2010-01-01', '0001',
                 'production', '1st')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO area_membership (employee_id, area_id, effective_begin_date)
         VALUES ('emp-prod', 'area-prod-1', '2026-01-01')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO posting
           (id, area_id, ot_type, work_date, start_time, duration_hours,
            volunteers_needed, posted_by_user)
         VALUES ('pst-prod', 'area-prod-1', 'voluntary_daily', '2026-05-11',
                 '07:00', 4, 1, 'sv-test')`
      )
      .run();

    const made = generateNextOffer('pst-prod', 'sv-test', 'supervisor');
    expect(made).not.toBeNull();
    const offer = conn
      .prepare(`SELECT status FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { status: string };
    expect(offer.status).toBe('pending');
  });
});

// ============================================================================
// buildScheduleView — Step 6 schedule strip helpers
// ============================================================================

describe('buildScheduleView (TM dashboard schedule visuals)', () => {
  it('returns null for production employees (no shift_pattern_id)', () => {
    const view = buildScheduleView({
      shift_pattern_id: null,
      crew_position: null,
      cycle_anchor_date: null
    });
    expect(view).toBeNull();
  });

  it('returns 7-day this-week strip starting Monday', () => {
    const view = buildScheduleView({
      shift_pattern_id: patternIdByName('fixed_day'),
      crew_position: null,
      cycle_anchor_date: '2026-05-04'  // a Monday
    });
    expect(view).not.toBeNull();
    expect(view!.this_week.days.length).toBe(7);
    expect(view!.this_week.days[0].weekday_short).toBe('Mon');
    expect(view!.this_week.days[6].weekday_short).toBe('Sun');
  });

  it('fixed_day designations: Mon-Fri = D, Sat-Sun = RDO', () => {
    const view = buildScheduleView({
      shift_pattern_id: patternIdByName('fixed_day'),
      crew_position: null,
      cycle_anchor_date: '2026-05-04'
    });
    const designations = view!.this_week.days.map((d) => d.designation);
    expect(designations).toEqual(['D', 'D', 'D', 'D', 'D', 'RDO', 'RDO']);
  });

  it('today is highlighted on exactly one day of this_week (DEMO_TODAY = 2026-05-14, a Thu)', () => {
    const view = buildScheduleView({
      shift_pattern_id: patternIdByName('fixed_day'),
      crew_position: null,
      cycle_anchor_date: '2026-05-04'
    });
    const todays = view!.this_week.days.filter((d) => d.is_today);
    expect(todays.length).toBe(1);
    expect(todays[0].date).toBe('2026-05-14');
    expect(todays[0].weekday_short).toBe('Thu');
  });

  it('next_four_weeks is a 28-day grid', () => {
    const view = buildScheduleView({
      shift_pattern_id: patternIdByName('fixed_day'),
      crew_position: null,
      cycle_anchor_date: '2026-05-04'
    });
    expect(view!.next_four_weeks.days.length).toBe(28);
  });

  it('last_four_weeks is a 28-day grid covering dates BEFORE this week', () => {
    const view = buildScheduleView({
      shift_pattern_id: patternIdByName('fixed_day'),
      crew_position: null,
      cycle_anchor_date: '2026-05-04'
    });
    expect(view!.last_four_weeks.days.length).toBe(28);
    // last_four_weeks.end_date should be the day before this_week.start_date
    const lastEnd = new Date(view!.last_four_weeks.end_date + 'T00:00:00Z');
    const thisStart = new Date(view!.this_week.start_date + 'T00:00:00Z');
    expect((thisStart.getTime() - lastEnd.getTime()) / 86400000).toBe(1);
  });

  it('rotating pattern (4-crew 12h rotating) reflects crew_position', () => {
    const crew1 = buildScheduleView({
      shift_pattern_id: patternIdByName('4_crew_12h_rotating'),
      crew_position: 1,
      cycle_anchor_date: '2026-05-04'
    });
    const crew3 = buildScheduleView({
      shift_pattern_id: patternIdByName('4_crew_12h_rotating'),
      crew_position: 3,
      cycle_anchor_date: '2026-05-04'
    });
    // Two different crews on the same anchor should have different
    // weekly designation arrays.
    const c1 = crew1!.this_week.days.map((d) => d.designation).join('');
    const c3 = crew3!.this_week.days.map((d) => d.designation).join('');
    expect(c1).not.toBe(c3);
  });
});

// ============================================================================
// st_dashboard — summarizeSTArea (Step 6 dashboard helper)
// ============================================================================

describe('summarizeSTArea (coord + skt-tl dashboard helper)', () => {
  it('returns null for production areas', () => {
    seedProductionArea('area-prod-only');
    expect(summarizeSTArea('area-prod-only')).toBeNull();
  });

  it('returns null for unknown area', () => {
    expect(summarizeSTArea('nope')).toBeNull();
  });

  it('counts journeypersons and apprentices per expertise', () => {
    seedSTArea('area-counts');
    seedSTEmployee({
      id: 'e1', area_id: 'area-counts',
      classification: 'Electrician', area_of_expertise: 'Electrical'
    });
    seedSTEmployee({
      id: 'e2', area_id: 'area-counts', last4_ssn: '0002',
      classification: 'ApprenticeElectrical', area_of_expertise: 'Electrical',
      is_apprentice: 1
    });
    seedSTEmployee({
      id: 'm1', area_id: 'area-counts', last4_ssn: '0003',
      classification: 'Millwright', area_of_expertise: 'Mechanical'
    });

    const sum = summarizeSTArea('area-counts')!;
    const elec = sum.expertise.find((e) => e.expertise === 'Electrical');
    const mech = sum.expertise.find((e) => e.expertise === 'Mechanical');
    expect(elec).toMatchObject({ journey_count: 1, apprentice_count: 1 });
    expect(mech).toMatchObject({ journey_count: 1, apprentice_count: 0 });
  });

  it('next_up_name picks the lowest-hours journey TM', () => {
    seedSTArea('area-nextup');
    seedSTEmployee({
      id: 'high-hours', area_id: 'area-nextup', last4_ssn: '0001',
      classification: 'Electrician', area_of_expertise: 'Electrical'
    });
    seedSTEmployee({
      id: 'low-hours', area_id: 'area-nextup', last4_ssn: '0002',
      classification: 'Electrician', area_of_expertise: 'Electrical'
    });
    // Seed charges so low-hours is genuinely lower.
    conn
      .prepare(
        `INSERT INTO posting (id, area_id, work_date, start_time,
                              duration_hours, volunteers_needed, posted_by_user)
         VALUES ('pst-seed', 'area-nextup', '2026-01-01', '07:00', 0, 0, 'seed')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
         VALUES ('ofr-h', 'pst-seed', 'high-hours', 'seed', 'responded'),
                ('ofr-l', 'pst-seed', 'low-hours',  'seed', 'responded')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO charge (offer_id, employee_id, area_id, charge_type,
                             amount, mode_at_charge)
         VALUES ('ofr-h', 'high-hours', 'area-nextup', 'hours_offered', 20, 'final'),
                ('ofr-l', 'low-hours',  'area-nextup', 'hours_offered',  4, 'final')`
      )
      .run();

    const sum = summarizeSTArea('area-nextup')!;
    const elec = sum.expertise.find((e) => e.expertise === 'Electrical');
    expect(elec?.next_up_name).toBe('low-hours');
    expect(elec?.next_up_hours_offered).toBe(4);
  });

  it('recent_postings flags pending_sv_approval', () => {
    seedSTArea('area-recent');
    seedSTPosting({ id: 'pst-1', area_id: 'area-recent', pending_sv_approval: 1 });
    seedSTPosting({ id: 'pst-2', area_id: 'area-recent', pending_sv_approval: 0 });

    const sum = summarizeSTArea('area-recent')!;
    expect(sum.recent_postings.length).toBe(2);
    expect(sum.recent_postings.find((p) => p.id === 'pst-1')?.pending_sv_approval).toBe(true);
    expect(sum.recent_postings.find((p) => p.id === 'pst-2')?.pending_sv_approval).toBe(false);
  });
});
