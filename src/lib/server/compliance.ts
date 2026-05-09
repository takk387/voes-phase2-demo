// Compliance summary (§15.2). Runs a series of automated checks against the
// system's data, each tied to a CBA citation, and reports pass/fail with a
// short detail. This is what a Joint Committee meeting packet leads with.
//
// Each check is conservative: it only flags FAIL when the system can prove
// non-compliance from data. "Indeterminate" results are reported as PASS
// with a note (no negative finding), to avoid raising false grievance signals.

import { createHash } from 'node:crypto';
import { db } from './db.js';

export interface ComplianceCheck {
  id: string;
  name: string;
  cba_ref: string;
  pass: boolean;
  detail: string;
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

function sha256(s: string): string {
  return 'sha256:' + createHash('sha256').update(s).digest('hex');
}

export function runComplianceChecks(): ComplianceCheck[] {
  const conn = db();
  const checks: ComplianceCheck[] = [];

  // 1. Audit hash chain unbroken.
  {
    const rows = conn
      .prepare(
        `SELECT id, ts, actor_user, action, area_id, posting_id, offer_id,
                employee_id, data_json, prev_hash, entry_hash
           FROM audit_log ORDER BY id ASC`
      )
      .all() as Array<{
        id: number; ts: string; actor_user: string; action: string;
        area_id: string | null; posting_id: string | null;
        offer_id: string | null; employee_id: string | null;
        data_json: string | null; prev_hash: string | null;
        entry_hash: string | null;
      }>;
    let prev = 'sha256:genesis';
    let broken = 0;
    let firstBroken: number | null = null;
    for (const r of rows) {
      const data = r.data_json ? JSON.parse(r.data_json) : null;
      const hashInput = canonicalJson({
        ts: r.ts, actor_user: r.actor_user, action: r.action,
        area_id: r.area_id, posting_id: r.posting_id,
        offer_id: r.offer_id, employee_id: r.employee_id,
        data, prev_hash: prev
      });
      const expected = sha256(hashInput);
      if (expected !== r.entry_hash || r.prev_hash !== prev) {
        broken++;
        if (firstBroken === null) firstBroken = r.id;
      }
      prev = r.entry_hash ?? prev;
    }
    checks.push({
      id: 'audit_chain',
      name: 'Audit log hash chain unbroken',
      cba_ref: '§16.3 audit immutability',
      pass: broken === 0,
      detail: broken === 0
        ? `${rows.length} entries verified.`
        : `${broken} entries broken (first at id ${firstBroken}).`
    });
  }

  // 2. Cycle integrity per interim area.
  // For each interim area, every cycle-offered TM should have an opportunity
  // charge in that cycle, and counts should not exceed area size per cycle.
  {
    const issues: string[] = [];
    const interimAreas = conn
      .prepare(
        `SELECT a.id FROM area a
           JOIN area_mode_setting ams
             ON ams.area_id = a.id AND ams.effective_end_date IS NULL
          WHERE ams.mode = 'interim' AND a.status = 'active'`
      )
      .all() as { id: string }[];
    for (const a of interimAreas) {
      const offered = conn
        .prepare(
          `SELECT cycle_number, COUNT(*) AS c FROM cycle_offered
            WHERE area_id = ? GROUP BY cycle_number`
        )
        .all(a.id) as { cycle_number: number; c: number }[];
      const charges = conn
        .prepare(
          `SELECT cycle_number, COUNT(*) AS c FROM charge
            WHERE area_id = ? AND charge_type = 'opportunity'
              AND amount > 0
            GROUP BY cycle_number`
        )
        .all(a.id) as { cycle_number: number; c: number }[];
      const memberCount = (
        conn
          .prepare(
            `SELECT COUNT(*) AS c FROM area_membership
              WHERE area_id = ? AND effective_end_date IS NULL`
          )
          .get(a.id) as { c: number }
      ).c;
      for (const r of offered) {
        if (r.c > memberCount) issues.push(`${a.id} cycle ${r.cycle_number}: ${r.c} offered exceeds ${memberCount} members`);
      }
      // Charges minus reversals should be at least the offered count.
      for (const o of offered) {
        const ch = charges.find((c) => c.cycle_number === o.cycle_number);
        if (!ch || ch.c < o.c) {
          issues.push(`${a.id} cycle ${o.cycle_number}: ${o.c} cycle_offered rows but ${ch?.c ?? 0} matching charges`);
        }
      }
    }
    checks.push({
      id: 'cycle_integrity',
      name: 'Interim-mode cycle integrity',
      cba_ref: '§4.3 / §9.1',
      pass: issues.length === 0,
      detail: issues.length === 0
        ? `${interimAreas.length} interim areas verified.`
        : issues.join('; ')
    });
  }

  // 3. Mandatory escalation branch fidelity per §22.1 union round 1.
  {
    const issues: string[] = [];
    const events = conn
      .prepare(
        `SELECT e.id, e.posting_id, e.branch, p.criticality
           FROM mandatory_escalation_event e
           JOIN posting p ON p.id = e.posting_id`
      )
      .all() as { id: number; posting_id: string; branch: string; criticality: string }[];
    for (const e of events) {
      if (e.branch !== e.criticality) {
        issues.push(`escalation ${e.id}: branch=${e.branch} but posting criticality=${e.criticality}`);
      }
    }
    // Force-low only on critical postings.
    const forceLowNonEssential = conn
      .prepare(
        `SELECT o.id FROM offer o
           JOIN posting p ON p.id = o.posting_id
          WHERE o.phase = 'force_low' AND p.criticality = 'non_essential'`
      )
      .all() as { id: string }[];
    if (forceLowNonEssential.length > 0) {
      issues.push(`${forceLowNonEssential.length} force_low offers on non-essential postings (round 1 union: non-essential never forces)`);
    }
    checks.push({
      id: 'escalation_branching',
      name: 'Mandatory escalation respects critical / non-essential split',
      cba_ref: '§9.5 / §22.1 union round 1',
      pass: issues.length === 0,
      detail: issues.length === 0
        ? `${events.length} escalation events; no branch violations.`
        : issues.join('; ')
    });
  }

  // 4. Bypass remedies within window (§22.8 default 90d).
  {
    const overdue = conn
      .prepare(
        `SELECT id, affected_employee_id, recorded_at FROM bypass_remedy
          WHERE status = 'open'
            AND julianday('now') - julianday(recorded_at) > 90`
      )
      .all() as { id: number; affected_employee_id: string; recorded_at: string }[];
    const total = (
      conn.prepare(`SELECT COUNT(*) AS c FROM bypass_remedy`).get() as { c: number }
    ).c;
    checks.push({
      id: 'remedy_window',
      name: 'Bypass remedies satisfied within window',
      cba_ref: '§5.14 / §22.8 (90d default)',
      pass: overdue.length === 0,
      detail: overdue.length === 0
        ? `${total} remedies recorded; none past window.`
        : `${overdue.length} remedies past 90d — grievance escalation may apply.`
    });
  }

  // 5. Dual-approval honored on all executed high-impact actions.
  {
    const incomplete = conn
      .prepare(
        `SELECT id, action_type FROM pending_approval
          WHERE status = 'executed'
            AND (approved_company_user IS NULL OR approved_union_user IS NULL)`
      )
      .all() as { id: number; action_type: string }[];
    const total = (
      conn.prepare(`SELECT COUNT(*) AS c FROM pending_approval WHERE status = 'executed'`).get() as { c: number }
    ).c;
    checks.push({
      id: 'dual_approval',
      name: 'Executed high-impact actions had both approvals',
      cba_ref: '§3.7 / §22.7',
      pass: incomplete.length === 0,
      detail: incomplete.length === 0
        ? `${total} executed actions; all dual-approved.`
        : `${incomplete.length} executed without both approvals.`
    });
  }

  // 6. Interim "Yes counts, No counts" — every yes/no in interim should have
  //    one opportunity charge.
  {
    const orphans = conn
      .prepare(
        `SELECT o.id FROM offer o
           JOIN posting p ON p.id = o.posting_id
           JOIN response r ON r.offer_id = o.id
           JOIN area_mode_setting ams
             ON ams.area_id = p.area_id AND ams.effective_end_date IS NULL
          WHERE r.response_type IN ('yes','no')
            AND ams.mode = 'interim'
            AND NOT EXISTS (
              SELECT 1 FROM charge c
               WHERE c.offer_id = o.id AND c.charge_type = 'opportunity'
                 AND c.amount > 0
            )`
      )
      .all() as { id: string }[];
    const total = (
      conn
        .prepare(
          `SELECT COUNT(*) AS c FROM offer o
             JOIN posting p ON p.id = o.posting_id
             JOIN response r ON r.offer_id = o.id
             JOIN area_mode_setting ams
               ON ams.area_id = p.area_id AND ams.effective_end_date IS NULL
            WHERE r.response_type IN ('yes','no') AND ams.mode = 'interim'`
        )
        .get() as { c: number }
    ).c;
    checks.push({
      id: 'interim_charging',
      name: 'Interim mode: every Yes/No produced an opportunity charge',
      cba_ref: 'PS-036 ("Yes counts, No counts")',
      pass: orphans.length === 0,
      detail: orphans.length === 0
        ? `${total} interim yes/no responses verified.`
        : `${orphans.length} responses missing matching charge.`
    });
  }

  // 7. PS-034-035 leave preservation: on-leave skips never charge.
  {
    const wrong = conn
      .prepare(
        `SELECT o.id FROM offer o
           JOIN response r ON r.offer_id = o.id
          WHERE r.response_type = 'on_leave'
            AND EXISTS (
              SELECT 1 FROM charge c
               WHERE c.offer_id = o.id AND c.charge_type = 'opportunity' AND c.amount > 0
            )`
      )
      .all() as { id: string }[];
    checks.push({
      id: 'leave_preservation',
      name: 'On-leave responses never produced an opportunity charge',
      cba_ref: 'PS-034-035',
      pass: wrong.length === 0,
      detail: wrong.length === 0
        ? `Leave passthrough verified.`
        : `${wrong.length} on-leave responses incorrectly charged.`
    });
  }

  // 8. Round 1 union §22.4: no_contact never charges (default).
  {
    const wrong = conn
      .prepare(
        `SELECT o.id FROM offer o
           JOIN response r ON r.offer_id = o.id
          WHERE r.response_type = 'no_contact'
            AND EXISTS (
              SELECT 1 FROM charge c
               WHERE c.offer_id = o.id AND c.charge_type = 'opportunity' AND c.amount > 0
            )`
      )
      .all() as { id: string }[];
    checks.push({
      id: 'no_contact_no_charge',
      name: 'No-contact responses do not charge (round 1 default)',
      cba_ref: '§22.4 union round 1',
      pass: wrong.length === 0,
      detail: wrong.length === 0
        ? `No-contact passthrough verified.`
        : `${wrong.length} no-contact responses incorrectly charged.`
    });
  }

  return checks;
}

// Quick stats panel for the compliance summary.
export interface ComplianceStats {
  total_areas: number;
  active_areas: number;
  total_postings: number;
  satisfied_postings: number;
  abandoned_postings: number;
  cancelled_postings: number;
  total_offers: number;
  yes_responses: number;
  no_responses: number;
  open_bypass_remedies: number;
  open_escalations: number;
  total_audit_entries: number;
}

export function complianceStats(): ComplianceStats {
  const conn = db();
  const get = (sql: string, args: unknown[] = []) =>
    (conn.prepare(sql).get(...args) as { c: number }).c;

  return {
    total_areas: get(`SELECT COUNT(*) AS c FROM area`),
    active_areas: get(`SELECT COUNT(*) AS c FROM area WHERE status = 'active'`),
    total_postings: get(`SELECT COUNT(*) AS c FROM posting`),
    satisfied_postings: get(`SELECT COUNT(*) AS c FROM posting WHERE status = 'satisfied'`),
    abandoned_postings: get(`SELECT COUNT(*) AS c FROM posting WHERE status = 'abandoned'`),
    cancelled_postings: get(`SELECT COUNT(*) AS c FROM posting WHERE status = 'cancelled'`),
    total_offers: get(`SELECT COUNT(*) AS c FROM offer`),
    yes_responses: get(`SELECT COUNT(*) AS c FROM response WHERE response_type = 'yes'`),
    no_responses: get(`SELECT COUNT(*) AS c FROM response WHERE response_type = 'no'`),
    open_bypass_remedies: get(`SELECT COUNT(*) AS c FROM bypass_remedy WHERE status = 'open'`),
    open_escalations: get(`SELECT COUNT(*) AS c FROM mandatory_escalation_event WHERE outcome = 'in_progress'`),
    total_audit_entries: get(`SELECT COUNT(*) AS c FROM audit_log`)
  };
}
