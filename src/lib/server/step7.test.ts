// Step 7 tests — ST SV approval queue (reject path), notification policy
// audit, no-show penalty is_penalty flag, and the four new compliance
// checks (9-12) plus their violation fixtures.
//
// Test scaffolding mirrors step6.test.ts.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schemaSql } from './schema.js';
import { runMigrations } from './db.js';
import { seedShiftPatterns } from './shift_patterns.js';
import { _resetPatternCacheForTests } from './schedule_eligibility.js';
import {
  generateNextOffer,
  recordResponse,
  approveProposedSTPosting,
  rejectProposedSTPosting
} from './offers.js';
import { runComplianceChecks } from './compliance.js';

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
// Scaffolding (mirrors step6.test.ts)
// ============================================================================

function patternIdByName(name: string): number {
  const row = conn.prepare(`SELECT id FROM shift_pattern WHERE name = ?`).get(name) as { id: number };
  return row.id;
}

function seedSTArea(
  id: string,
  opts: { policy?: 'in_app_default' | 'in_app_only_no_home_except_emergency' } = {}
) {
  conn
    .prepare(
      `INSERT INTO area
         (id, name, shop, line, shift, type, no_show_penalty_hours, notification_policy)
       VALUES (?, ?, 'Body', 'L1', '1st', 'skilled_trades', 1, ?)`
    )
    .run(id, `${id} area`, opts.policy ?? 'in_app_only_no_home_except_emergency');
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
  required_classification?: string;
  ot_type?: string;
  work_date?: string;
  start_time?: string;
}) {
  conn
    .prepare(
      `INSERT INTO posting
         (id, area_id, ot_type, work_date, start_time, duration_hours,
          volunteers_needed, posted_by_user, pay_multiplier,
          required_expertise, required_classification, pending_sv_approval)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'seed', ?, ?, ?, ?)`
    )
    .run(
      spec.id, spec.area_id,
      spec.ot_type ?? 'voluntary_daily',
      spec.work_date ?? '2026-05-11',
      spec.start_time ?? '07:00',
      spec.duration_hours ?? 4,
      spec.pay_multiplier ?? 1.5,
      spec.required_expertise ?? 'Electrical',
      spec.required_classification ?? null,
      spec.pending_sv_approval ?? 1
    );
}

// ============================================================================
// rejectProposedSTPosting (Step 7 core)
// ============================================================================

describe('rejectProposedSTPosting', () => {
  beforeEach(() => {
    seedSTArea('area-st-1');
    seedSTEmployee({
      id: 'emp-electrician', area_id: 'area-st-1',
      classification: 'Electrician', area_of_expertise: 'Electrical',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
  });

  it('marks posting status rejected_by_sv, clears pending_sv_approval, supersedes proposed offer', () => {
    seedSTPosting({ id: 'pst-rej', area_id: 'area-st-1', pending_sv_approval: 1 });
    const made = generateNextOffer('pst-rej', 'coord-davis', 'skt_coordinator');

    const result = rejectProposedSTPosting(
      'pst-rej', 'sv-body-1st-st', 'st_supervisor', 'work cancelled by upstream'
    );
    expect(result.superseded_offers).toBe(1);

    const posting = conn
      .prepare(`SELECT status, pending_sv_approval, cancelled_reason FROM posting WHERE id = ?`)
      .get('pst-rej') as { status: string; pending_sv_approval: number; cancelled_reason: string };
    expect(posting.status).toBe('rejected_by_sv');
    expect(posting.pending_sv_approval).toBe(0);
    expect(posting.cancelled_reason).toBe('work cancelled by upstream');

    const offer = conn
      .prepare(`SELECT status FROM offer WHERE id = ?`)
      .get(made!.offer_id) as { status: string };
    expect(offer.status).toBe('superseded');
  });

  it('writes sv_rejected_st_posting audit entry with reason', () => {
    seedSTPosting({ id: 'pst-rej-audit', area_id: 'area-st-1', pending_sv_approval: 1 });
    generateNextOffer('pst-rej-audit', 'coord-davis', 'skt_coordinator');
    rejectProposedSTPosting(
      'pst-rej-audit', 'sv-body-1st-st', 'st_supervisor', 'duplicate posting'
    );
    const audit = conn
      .prepare(`SELECT actor_user, actor_role, reason FROM audit_log
                  WHERE posting_id = ? AND action = 'sv_rejected_st_posting'`)
      .get('pst-rej-audit') as { actor_user: string; actor_role: string; reason: string };
    expect(audit).toBeDefined();
    expect(audit.actor_user).toBe('sv-body-1st-st');
    expect(audit.actor_role).toBe('st_supervisor');
    expect(audit.reason).toBe('duplicate posting');
  });

  it('throws if posting is not awaiting SV approval', () => {
    seedSTPosting({ id: 'pst-not-pending', area_id: 'area-st-1', pending_sv_approval: 0 });
    expect(() =>
      rejectProposedSTPosting('pst-not-pending', 'sv', 'st_supervisor', 'reason')
    ).toThrow(/not awaiting SV approval/);
  });

  it('throws on missing posting', () => {
    expect(() =>
      rejectProposedSTPosting('does-not-exist', 'sv', 'st_supervisor', 'reason')
    ).toThrow(/posting not found/);
  });

  it('rejected posting cannot then be approved (status no longer awaiting)', () => {
    seedSTPosting({ id: 'pst-rej-then-app', area_id: 'area-st-1', pending_sv_approval: 1 });
    generateNextOffer('pst-rej-then-app', 'coord-davis', 'skt_coordinator');
    rejectProposedSTPosting('pst-rej-then-app', 'sv', 'st_supervisor', 'no');
    expect(() =>
      approveProposedSTPosting('pst-rej-then-app', 'sv', 'st_supervisor')
    ).toThrow(/not awaiting SV approval/);
  });

  it('superseded offer rejects subsequent recordResponse', () => {
    seedSTPosting({ id: 'pst-rej-resp', area_id: 'area-st-1', pending_sv_approval: 1 });
    const made = generateNextOffer('pst-rej-resp', 'coord-davis', 'skt_coordinator');
    rejectProposedSTPosting('pst-rej-resp', 'sv', 'st_supervisor', 'reason');
    expect(() =>
      recordResponse({
        offer_id: made!.offer_id,
        response_type: 'yes',
        recorded_by_user: 'tester',
        recorded_by_role: 'admin',
        recorded_via: 'manual_entry'
      })
    ).toThrow();  // offer.status='superseded', not pending — generic resolved guard
  });
});

// ============================================================================
// Notification policy audit
// ============================================================================

describe('notification_sent_in_app_only audit (SKT-04A policy)', () => {
  it('emits per offer when ST posting auto-approves to pending in policy area', () => {
    seedSTArea('area-policy-on', {
      policy: 'in_app_only_no_home_except_emergency'
    });
    seedSTEmployee({
      id: 'emp-elect-policy', area_id: 'area-policy-on',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
    seedSTPosting({
      id: 'pst-auto', area_id: 'area-policy-on', pending_sv_approval: 0
    });
    const made = generateNextOffer('pst-auto', 'coord', 'skt_coordinator');
    const audit = conn
      .prepare(`SELECT action FROM audit_log WHERE offer_id = ?`)
      .all(made!.offer_id) as { action: string }[];
    expect(audit.map((a) => a.action)).toContain('notification_sent_in_app_only');
  });

  it('emits per promoted offer on approveProposedSTPosting in policy area', () => {
    seedSTArea('area-policy-approve', {
      policy: 'in_app_only_no_home_except_emergency'
    });
    seedSTEmployee({
      id: 'emp-approve-policy', area_id: 'area-policy-approve',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
    seedSTPosting({
      id: 'pst-approve-flow', area_id: 'area-policy-approve', pending_sv_approval: 1
    });
    const made = generateNextOffer('pst-approve-flow', 'coord', 'skt_coordinator');
    // Proposed offer should NOT yet have the notification audit — TM is not
    // notified until SV approves.
    const beforeApprove = conn
      .prepare(`SELECT COUNT(*) AS c FROM audit_log
                  WHERE offer_id = ? AND action = 'notification_sent_in_app_only'`)
      .get(made!.offer_id) as { c: number };
    expect(beforeApprove.c).toBe(0);

    approveProposedSTPosting('pst-approve-flow', 'sv', 'st_supervisor');

    const afterApprove = conn
      .prepare(`SELECT COUNT(*) AS c FROM audit_log
                  WHERE offer_id = ? AND action = 'notification_sent_in_app_only'`)
      .get(made!.offer_id) as { c: number };
    expect(afterApprove.c).toBe(1);
  });

  it('does NOT emit when area uses default policy', () => {
    seedSTArea('area-default-policy', { policy: 'in_app_default' });
    seedSTEmployee({
      id: 'emp-default-policy', area_id: 'area-default-policy',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
    seedSTPosting({
      id: 'pst-default', area_id: 'area-default-policy', pending_sv_approval: 0
    });
    const made = generateNextOffer('pst-default', 'coord', 'skt_coordinator');
    const audit = conn
      .prepare(`SELECT COUNT(*) AS c FROM audit_log
                  WHERE offer_id = ? AND action = 'notification_sent_in_app_only'`)
      .get(made!.offer_id) as { c: number };
    expect(audit.c).toBe(0);
  });

  it('does NOT emit for production offers', () => {
    seedProductionArea('area-prod-policy');
    conn
      .prepare(
        `INSERT INTO employee
           (id, display_name, first_name, last_name, hire_date, last4_ssn,
            classification, shift)
         VALUES ('emp-prod-pol', 'prod', 'p', 'p', '2010-01-01', '0001',
                 'production', '1st')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO area_membership (employee_id, area_id, effective_begin_date)
         VALUES ('emp-prod-pol', 'area-prod-policy', '2026-01-01')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO posting
           (id, area_id, ot_type, work_date, start_time, duration_hours,
            volunteers_needed, posted_by_user)
         VALUES ('pst-prod-pol', 'area-prod-policy', 'voluntary_daily',
                 '2026-05-11', '07:00', 4, 1, 'sv')`
      )
      .run();
    const made = generateNextOffer('pst-prod-pol', 'sv', 'supervisor');
    const audit = conn
      .prepare(`SELECT COUNT(*) AS c FROM audit_log
                  WHERE offer_id = ? AND action = 'notification_sent_in_app_only'`)
      .get(made!.offer_id) as { c: number };
    expect(audit.c).toBe(0);
  });
});

// ============================================================================
// no-show penalty is_penalty=1 marker
// ============================================================================

describe('no-show penalty charge has is_penalty=1', () => {
  it('penalty row has is_penalty=1 and charge_multiplier=1.0 even on a 1.5x posting', () => {
    seedSTArea('area-pen', { policy: 'in_app_default' });
    seedSTEmployee({
      id: 'emp-pen', area_id: 'area-pen',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
    // Saturday voluntary_weekend posting at 1.5x. With fixed_day pattern,
    // anchor 2026-05-04 (Mon) the candidate is on RDO Saturday. Charge
    // qualifies for the no-show penalty path.
    seedSTPosting({
      id: 'pst-pen', area_id: 'area-pen',
      pending_sv_approval: 0, work_date: '2026-05-09',
      ot_type: 'voluntary_weekend', pay_multiplier: 1.5
    });
    const made = generateNextOffer('pst-pen', 'coord', 'skt_coordinator');
    expect(made).not.toBeNull();
    recordResponse({
      offer_id: made!.offer_id,
      response_type: 'no_show',
      recorded_by_user: 'sv',
      recorded_by_role: 'st_supervisor',
      recorded_via: 'supervisor_on_behalf'
    });

    const penalty = conn
      .prepare(
        `SELECT id, is_penalty, charge_multiplier, amount FROM charge
          WHERE offer_id = ? AND is_penalty = 1`
      )
      .all(made!.offer_id) as Array<{ id: number; is_penalty: number; charge_multiplier: number; amount: number }>;
    expect(penalty.length).toBe(1);
    expect(penalty[0].is_penalty).toBe(1);
    expect(penalty[0].charge_multiplier).toBe(1.0);
    expect(penalty[0].amount).toBe(1);  // area.no_show_penalty_hours

    // Non-penalty rows should have is_penalty=0 and the posting's multiplier.
    const normal = conn
      .prepare(
        `SELECT is_penalty, charge_multiplier FROM charge
          WHERE offer_id = ? AND is_penalty = 0`
      )
      .all(made!.offer_id) as Array<{ is_penalty: number; charge_multiplier: number }>;
    expect(normal.length).toBeGreaterThan(0);
    for (const r of normal) {
      expect(r.is_penalty).toBe(0);
      expect(r.charge_multiplier).toBe(1.5);
    }
  });
});

// ============================================================================
// Compliance check 9 — apprentice gating respected
// ============================================================================

describe('compliance check: st_apprentice_gating', () => {
  it('passes when no apprentice offers exist', () => {
    seedSTArea('area-no-app');
    seedSTEmployee({
      id: 'emp-jrn', area_id: 'area-no-app', is_apprentice: 0
    });
    const checks = runComplianceChecks();
    const c9 = checks.find((c) => c.id === 'st_apprentice_gating');
    expect(c9).toBeDefined();
    expect(c9!.pass).toBe(true);
  });

  it('passes when apprentice offer is tagged apprentice_escalation', () => {
    seedSTArea('area-esc');
    seedSTEmployee({
      id: 'emp-jrn-esc', area_id: 'area-esc',
      classification: 'Electrician', area_of_expertise: 'Electrical', is_apprentice: 0
    });
    seedSTEmployee({
      id: 'emp-app-esc', area_id: 'area-esc', last4_ssn: '0002',
      classification: 'ApprenticeElectrical', area_of_expertise: 'Electrical', is_apprentice: 1
    });
    seedSTPosting({ id: 'pst-esc', area_id: 'area-esc', pending_sv_approval: 0 });
    // Directly insert an apprentice offer tagged apprentice_escalation.
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status, phase)
         VALUES ('ofr-esc-app', 'pst-esc', 'emp-app-esc', 'sv', 'pending', 'apprentice_escalation')`
      )
      .run();
    const checks = runComplianceChecks();
    const c9 = checks.find((c) => c.id === 'st_apprentice_gating');
    expect(c9!.pass).toBe(true);
  });

  it('FAILS when apprentice offer is NOT tagged apprentice_escalation while a journey is ungated', () => {
    seedSTArea('area-violate');
    seedSTEmployee({
      id: 'emp-jrn-vio', area_id: 'area-violate',
      classification: 'Electrician', area_of_expertise: 'Electrical', is_apprentice: 0
    });
    seedSTEmployee({
      id: 'emp-app-vio', area_id: 'area-violate', last4_ssn: '0002',
      classification: 'ApprenticeElectrical', area_of_expertise: 'Electrical', is_apprentice: 1
    });
    seedSTPosting({ id: 'pst-vio', area_id: 'area-violate', pending_sv_approval: 0 });
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status, phase)
         VALUES ('ofr-vio-app', 'pst-vio', 'emp-app-vio', 'sv', 'pending', NULL)`
      )
      .run();
    const checks = runComplianceChecks();
    const c9 = checks.find((c) => c.id === 'st_apprentice_gating');
    expect(c9!.pass).toBe(false);
    expect(c9!.detail).toContain('emp-jrn-vio');
  });
});

// ============================================================================
// Compliance check 10 — no force_low for ST
// ============================================================================

describe('compliance check: st_no_force_low', () => {
  it('passes on clean ST seed', () => {
    seedSTArea('area-clean-fl');
    const checks = runComplianceChecks();
    const c10 = checks.find((c) => c.id === 'st_no_force_low');
    expect(c10!.pass).toBe(true);
  });

  it('FAILS when an ST offer has phase=force_low (synthetic violation)', () => {
    seedSTArea('area-fl');
    seedSTEmployee({ id: 'emp-fl', area_id: 'area-fl' });
    seedSTPosting({ id: 'pst-fl', area_id: 'area-fl', pending_sv_approval: 0 });
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status, phase)
         VALUES ('ofr-fl', 'pst-fl', 'emp-fl', 'sv', 'pending', 'force_low')`
      )
      .run();
    const checks = runComplianceChecks();
    const c10 = checks.find((c) => c.id === 'st_no_force_low');
    expect(c10!.pass).toBe(false);
    expect(c10!.detail).toContain('ofr-fl');
  });
});

// ============================================================================
// Compliance check 11 — charge multiplier matches posting rate
// ============================================================================

describe('compliance check: st_charge_multiplier', () => {
  it('passes on clean ST yes-response (multiplier matches)', () => {
    seedSTArea('area-mult-ok', { policy: 'in_app_default' });
    seedSTEmployee({
      id: 'emp-mult-ok', area_id: 'area-mult-ok',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
    seedSTPosting({
      id: 'pst-mult-ok', area_id: 'area-mult-ok',
      pending_sv_approval: 0, pay_multiplier: 1.5, duration_hours: 4
    });
    const made = generateNextOffer('pst-mult-ok', 'coord', 'skt_coordinator');
    recordResponse({
      offer_id: made!.offer_id, response_type: 'yes',
      recorded_by_user: 'sv', recorded_by_role: 'st_supervisor',
      recorded_via: 'supervisor_on_behalf'
    });
    const checks = runComplianceChecks();
    const c11 = checks.find((c) => c.id === 'st_charge_multiplier');
    expect(c11!.pass).toBe(true);
  });

  it('passes when no-show penalty row exists at 1.0x against a 1.5x posting (penalty exempt)', () => {
    seedSTArea('area-pen-ok', { policy: 'in_app_default' });
    seedSTEmployee({
      id: 'emp-pen-ok', area_id: 'area-pen-ok',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
    seedSTPosting({
      id: 'pst-pen-ok', area_id: 'area-pen-ok',
      pending_sv_approval: 0, pay_multiplier: 1.5,
      ot_type: 'voluntary_weekend', work_date: '2026-05-09'
    });
    const made = generateNextOffer('pst-pen-ok', 'coord', 'skt_coordinator');
    recordResponse({
      offer_id: made!.offer_id, response_type: 'no_show',
      recorded_by_user: 'sv', recorded_by_role: 'st_supervisor',
      recorded_via: 'supervisor_on_behalf'
    });
    const checks = runComplianceChecks();
    const c11 = checks.find((c) => c.id === 'st_charge_multiplier');
    expect(c11!.pass).toBe(true);
  });

  it('FAILS on synthetic multiplier-drift charge (1.0x charge against 2.0x posting)', () => {
    seedSTArea('area-mult-drift');
    seedSTEmployee({ id: 'emp-md', area_id: 'area-mult-drift' });
    seedSTPosting({
      id: 'pst-md', area_id: 'area-mult-drift',
      pending_sv_approval: 0, pay_multiplier: 2.0
    });
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
         VALUES ('ofr-md', 'pst-md', 'emp-md', 'sv', 'responded')`
      )
      .run();
    // is_penalty=0, charge_multiplier=1.0, but posting.pay_multiplier=2.0 => violation
    conn
      .prepare(
        `INSERT INTO charge
           (offer_id, employee_id, area_id, charge_type, amount,
            mode_at_charge, charge_multiplier, is_penalty)
         VALUES ('ofr-md', 'emp-md', 'area-mult-drift', 'hours_offered',
                 4, 'final', 1.0, 0)`
      )
      .run();
    const checks = runComplianceChecks();
    const c11 = checks.find((c) => c.id === 'st_charge_multiplier');
    expect(c11!.pass).toBe(false);
    expect(c11!.detail).toMatch(/multiplier mismatch/);
  });
});

// ============================================================================
// Compliance check 12 — all ST offers passed through SV approval
// ============================================================================

describe('compliance check: st_sv_approval_gate', () => {
  it('passes when no ST offers exist', () => {
    seedSTArea('area-no-offers');
    const checks = runComplianceChecks();
    const c12 = checks.find((c) => c.id === 'st_sv_approval_gate');
    expect(c12!.pass).toBe(true);
  });

  it('passes when an ST offer has an sv_approved_st_posting audit on its parent posting', () => {
    seedSTArea('area-approved', { policy: 'in_app_default' });
    seedSTEmployee({
      id: 'emp-app-ok', area_id: 'area-approved',
      shift_pattern: 'fixed_day', cycle_anchor_date: '2026-05-04'
    });
    seedSTPosting({
      id: 'pst-approved', area_id: 'area-approved', pending_sv_approval: 1
    });
    generateNextOffer('pst-approved', 'coord', 'skt_coordinator');
    approveProposedSTPosting('pst-approved', 'sv', 'st_supervisor');

    const checks = runComplianceChecks();
    const c12 = checks.find((c) => c.id === 'st_sv_approval_gate');
    expect(c12!.pass).toBe(true);
  });

  it('FAILS when an ST offer reached pending without an SV approval audit (synthetic)', () => {
    seedSTArea('area-unapproved');
    seedSTEmployee({ id: 'emp-unapp', area_id: 'area-unapproved' });
    seedSTPosting({
      id: 'pst-unapp', area_id: 'area-unapproved', pending_sv_approval: 0
    });
    // Insert a pending offer directly without going through generateNextOffer
    // and without an sv_approved_st_posting audit entry.
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
         VALUES ('ofr-unapp', 'pst-unapp', 'emp-unapp', 'someone', 'pending')`
      )
      .run();
    const checks = runComplianceChecks();
    const c12 = checks.find((c) => c.id === 'st_sv_approval_gate');
    expect(c12!.pass).toBe(false);
    expect(c12!.detail).toContain('ofr-unapp');
  });
});

// ============================================================================
// Production regression — checks 9-12 should not flag production-only data
// ============================================================================

describe('compliance checks 9-12 ignore production-only data', () => {
  it('production force_low offer does not trip st_no_force_low', () => {
    seedProductionArea('area-prod-fl');
    conn
      .prepare(
        `INSERT INTO employee
           (id, display_name, first_name, last_name, hire_date, last4_ssn,
            classification, shift)
         VALUES ('emp-pf', 'pf', 'p', 'f', '2010-01-01', '0001',
                 'production', '1st')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO posting (id, area_id, ot_type, work_date, start_time,
                              duration_hours, volunteers_needed, posted_by_user)
         VALUES ('pst-prod-fl', 'area-prod-fl', 'voluntary_daily',
                 '2026-05-11', '07:00', 4, 1, 'sv')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status, phase)
         VALUES ('ofr-prod-fl', 'pst-prod-fl', 'emp-pf', 'sv', 'pending', 'force_low')`
      )
      .run();
    const checks = runComplianceChecks();
    const c10 = checks.find((c) => c.id === 'st_no_force_low');
    expect(c10!.pass).toBe(true);  // production force_low is allowed (PS-036)
  });

  it('production offer without sv_approved_st_posting audit does not trip st_sv_approval_gate', () => {
    seedProductionArea('area-prod-noapp');
    conn
      .prepare(
        `INSERT INTO employee
           (id, display_name, first_name, last_name, hire_date, last4_ssn,
            classification, shift)
         VALUES ('emp-pna', 'pna', 'p', 'na', '2010-01-01', '0001',
                 'production', '1st')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO posting (id, area_id, ot_type, work_date, start_time,
                              duration_hours, volunteers_needed, posted_by_user)
         VALUES ('pst-prod-na', 'area-prod-noapp', 'voluntary_daily',
                 '2026-05-11', '07:00', 4, 1, 'sv')`
      )
      .run();
    conn
      .prepare(
        `INSERT INTO offer (id, posting_id, employee_id, offered_by_user, status)
         VALUES ('ofr-prod-na', 'pst-prod-na', 'emp-pna', 'sv', 'pending')`
      )
      .run();
    const checks = runComplianceChecks();
    const c12 = checks.find((c) => c.id === 'st_sv_approval_gate');
    expect(c12!.pass).toBe(true);
  });
});
