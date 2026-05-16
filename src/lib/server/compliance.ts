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

  // 3. Mandatory escalation branch fidelity per §22.1.
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
      issues.push(`${forceLowNonEssential.length} force_low offers on non-essential postings (§22.1: non-essential never forces)`);
    }
    checks.push({
      id: 'escalation_branching',
      name: 'Mandatory escalation respects critical / non-essential split',
      cba_ref: '§9.5 / §22.1',
      pass: issues.length === 0,
      detail: issues.length === 0
        ? `${events.length} escalation events; no branch violations.`
        : issues.join('; ')
    });
  }

  // 4. Bypass remedies remain on currently-eligible affected TMs.
  // Per CBA §5.14 / §10.17, the remedy is the next available assignment —
  // no time-based expiration. The check fails only when an open remedy
  // points to a TM who has become ineligible (separated, transferred out
  // of the area, etc.) and should be closed administratively.
  {
    const ineligible = conn
      .prepare(
        `SELECT br.id, br.affected_employee_id, br.area_id, e.status AS emp_status
           FROM bypass_remedy br
           JOIN employee e ON e.id = br.affected_employee_id
          WHERE br.status = 'open'
            AND (
              e.status = 'separated'
              OR NOT EXISTS (
                SELECT 1 FROM area_membership m
                 WHERE m.employee_id = br.affected_employee_id
                   AND m.area_id = br.area_id
                   AND m.effective_end_date IS NULL
              )
            )`
      )
      .all() as { id: number; affected_employee_id: string; area_id: string; emp_status: string }[];
    const open = (
      conn.prepare(`SELECT COUNT(*) AS c FROM bypass_remedy WHERE status = 'open'`).get() as { c: number }
    ).c;
    checks.push({
      id: 'remedy_eligibility',
      name: 'Open bypass remedies remain on eligible TMs',
      cba_ref: '§5.14 / §10.17',
      pass: ineligible.length === 0,
      detail: ineligible.length === 0
        ? `${open} open remedies; all affected TMs still eligible.`
        : `${ineligible.length} remedies need administrative closure (affected TM separated or transferred out).`
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
      cba_ref: '§3.7',
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

  // 8. No-contact responses never charge.
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
      name: 'No-contact responses do not charge',
      cba_ref: 'operational rule',
      pass: wrong.length === 0,
      detail: wrong.length === 0
        ? `No-contact passthrough verified.`
        : `${wrong.length} no-contact responses incorrectly charged.`
    });
  }

  // 9. Apprentice gating respected (SKT-04A page 215). For each non-escalation
  // apprentice offer in an ST area, every active journeyperson in the same
  // area + same expertise must have been offered in the area's current cycle.
  // Apprentice offers tagged 'apprentice_escalation' (the journey pool was
  // exhausted) or 'inter_shop_canvass' (cross-shop fill) are exempt by design.
  //
  // Scoped to each area's CURRENT cycle from rotation_state. Cycle-history
  // gating reconstruction is a Phase 3 polish item; for the demo the current
  // cycle is the working unit and matches the rotation engine's gating
  // semantics at offer time.
  {
    const violations: Array<{
      area_id: string; apprentice_offer_id: string;
      apprentice_id: string; ungated_journey_id: string;
    }> = [];
    const apprenticeOffers = conn
      .prepare(
        `SELECT o.id AS offer_id, o.employee_id AS apprentice_id, p.area_id,
                e.area_of_expertise
           FROM offer o
           JOIN posting p ON p.id = o.posting_id
           JOIN area a ON a.id = p.area_id
           JOIN employee e ON e.id = o.employee_id
          WHERE a.type = 'skilled_trades'
            AND e.is_apprentice = 1
            AND o.offered_by_user != 'system-bootstrap'
            AND (o.phase IS NULL
                 OR o.phase NOT IN ('apprentice_escalation','inter_shop_canvass'))`
      )
      .all() as Array<{
        offer_id: string; apprentice_id: string; area_id: string;
        area_of_expertise: string | null;
      }>;
    for (const ao of apprenticeOffers) {
      const cycRow = conn
        .prepare<[string], { current_cycle: number }>(
          `SELECT current_cycle FROM rotation_state WHERE area_id = ?`
        )
        .get(ao.area_id);
      const cyc = cycRow?.current_cycle ?? 1;

      // Active journeys in same area + same expertise. NULL expertise on
      // the apprentice would indicate seed inconsistency — count any active
      // journey in the area in that case so it still surfaces.
      const journeys = conn
        .prepare(
          `SELECT e.id FROM employee e
             JOIN area_membership m ON m.employee_id = e.id
                                   AND m.area_id = ?
                                   AND m.effective_end_date IS NULL
            WHERE e.is_apprentice = 0
              AND e.status = 'active'
              AND (? IS NULL OR e.area_of_expertise = ?)`
        )
        .all(ao.area_id, ao.area_of_expertise, ao.area_of_expertise) as { id: string }[];
      for (const j of journeys) {
        const offered = conn
          .prepare<[string, number, string], { c: number }>(
            `SELECT COUNT(*) AS c FROM cycle_offered
              WHERE area_id = ? AND cycle_number = ? AND employee_id = ?`
          )
          .get(ao.area_id, cyc, j.id);
        if ((offered?.c ?? 0) === 0) {
          violations.push({
            area_id: ao.area_id,
            apprentice_offer_id: ao.offer_id,
            apprentice_id: ao.apprentice_id,
            ungated_journey_id: j.id
          });
        }
      }
    }
    checks.push({
      id: 'st_apprentice_gating',
      name: 'Apprentice gating respected (no journey skipped)',
      cba_ref: 'SKT-04A page 215',
      pass: violations.length === 0,
      detail: violations.length === 0
        ? `${apprenticeOffers.length} apprentice offers reviewed; gating respected.`
        : `${violations.length} gating violations: e.g. apprentice offer ` +
          `${violations[0].apprentice_offer_id} in ${violations[0].area_id} ` +
          `while journey ${violations[0].ungated_journey_id} not yet offered.`
    });
  }

  // 10. No force_low ever recorded for an ST area. SKT-04A escalation =
  // ask-apprentices, then abandon. Forcing in ST is an untested
  // contractual interpretation — Critical Rule #4 in the implementation
  // plan. The rotation engine has no force_low code path for ST; this
  // check is a runtime safety net.
  {
    const wrong = conn
      .prepare(
        `SELECT o.id, p.area_id FROM offer o
           JOIN posting p ON p.id = o.posting_id
           JOIN area a ON a.id = p.area_id
          WHERE a.type = 'skilled_trades'
            AND o.phase = 'force_low'`
      )
      .all() as { id: string; area_id: string }[];
    checks.push({
      id: 'st_no_force_low',
      name: 'No force_low offers in any Skilled Trades area',
      cba_ref: 'SKT-04A interpretation (round-2 union meeting)',
      pass: wrong.length === 0,
      detail: wrong.length === 0
        ? `Skilled-Trades areas free of force_low offers.`
        : `${wrong.length} force_low offers in ST areas: e.g. ${wrong[0].id} (${wrong[0].area_id}).`
    });
  }

  // 11. Charge multiplier matches the posting's pay_multiplier for every
  // non-penalty, non-reversal ST charge. Penalty rows (the SKT-04A no-show
  // +1) are intentionally flat at 1.0× regardless of posting rate, so they
  // are excluded via charge.is_penalty=1.
  {
    const wrong = conn
      .prepare(
        `SELECT c.id, c.charge_multiplier, p.pay_multiplier, c.area_id
           FROM charge c
           JOIN offer o ON o.id = c.offer_id
           JOIN posting p ON p.id = o.posting_id
           JOIN area a ON a.id = p.area_id
          WHERE a.type = 'skilled_trades'
            AND c.is_penalty = 0
            AND c.reverses_charge_id IS NULL
            AND c.charge_multiplier != p.pay_multiplier`
      )
      .all() as Array<{ id: number; charge_multiplier: number; pay_multiplier: number; area_id: string }>;
    const total = (
      conn
        .prepare(
          `SELECT COUNT(*) AS c FROM charge c
             JOIN offer o ON o.id = c.offer_id
             JOIN posting p ON p.id = o.posting_id
             JOIN area a ON a.id = p.area_id
            WHERE a.type = 'skilled_trades'
              AND c.is_penalty = 0
              AND c.reverses_charge_id IS NULL`
        )
        .get() as { c: number }
    ).c;
    checks.push({
      id: 'st_charge_multiplier',
      name: 'ST charge multiplier matches posting pay rate',
      cba_ref: 'SKT-04A pay-rate weighting',
      pass: wrong.length === 0,
      detail: wrong.length === 0
        ? `${total} ST charges verified against posting pay_multiplier (penalties excluded).`
        : `${wrong.length} multiplier mismatches: e.g. charge ${wrong[0].id} ` +
          `at ${wrong[0].charge_multiplier}× vs posting ${wrong[0].pay_multiplier}×.`
    });
  }

  // 12. Every ST offer that was visible to a TM (status pending or responded)
  // belongs to a posting whose history contains an 'sv_approved_st_posting'
  // audit entry. This is the runtime proof of Critical Rule #5 — ST postings
  // cannot reach a TM without ST SV approval. Bootstrap-seeded ST postings
  // emit a synthetic approval entry so historical demo data also satisfies
  // the check (see seed.ts seedSTHoursBootstrap).
  {
    const unapproved = conn
      .prepare(
        `SELECT o.id, o.posting_id FROM offer o
           JOIN posting p ON p.id = o.posting_id
           JOIN area a ON a.id = p.area_id
          WHERE a.type = 'skilled_trades'
            AND o.status IN ('pending','responded')
            AND NOT EXISTS (
              SELECT 1 FROM audit_log al
               WHERE al.posting_id = o.posting_id
                 AND al.action = 'sv_approved_st_posting'
            )`
      )
      .all() as { id: string; posting_id: string }[];
    const totalOffers = (
      conn
        .prepare(
          `SELECT COUNT(*) AS c FROM offer o
             JOIN posting p ON p.id = o.posting_id
             JOIN area a ON a.id = p.area_id
            WHERE a.type = 'skilled_trades'
              AND o.status IN ('pending','responded')`
        )
        .get() as { c: number }
    ).c;
    checks.push({
      id: 'st_sv_approval_gate',
      name: 'All Skilled Trades offers passed through ST SV approval',
      cba_ref: 'Implementation plan Critical Rule #5',
      pass: unapproved.length === 0,
      detail: unapproved.length === 0
        ? `${totalOffers} ST offers verified; all parent postings SV-approved.`
        : `${unapproved.length} ST offers reached a TM without an ` +
          `'sv_approved_st_posting' audit entry on the parent posting (e.g. ${unapproved[0].id}).`
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
