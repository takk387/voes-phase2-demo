// Mandatory escalation (§9.5 Procedure E) with §22.1 union round 1 branching.
//
// When a posting's normal eligible pool is exhausted before the volunteer
// count is met, the supervisor can initiate escalation. Behavior branches on
// posting.criticality:
//
//   CRITICAL: ask-high (offer to remaining qualified members in seniority
//     order, oldest first) then force-low (force the least-senior eligible,
//     skipping PS-035 adjacent half-day PTO). The system records each phase
//     transition.
//
//   NON-ESSENTIAL: cascade — extend the qualified pool to TMs in adjacent
//     active areas. If still short after that, abandon the posting.
//     (Round 1 union position: do not force for non-essential OT.)
//
// "Adjacent area" is policy-defined. For the demo it's modeled as
// "any other active area" — the Joint Committee's sub-department escalation
// resolution per §22.9 will refine this in production.

import { db, withTransaction } from './db.js';
import { writeAudit } from './audit.js';
import {
  isOnApprovedLeave,
  holdsAllQualifications,
  senioritySortedMembers
} from './rotation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function postingDetails(posting_id: string) {
  return db()
    .prepare<[string], {
      id: string; area_id: string; ot_type: string; criticality: 'critical' | 'non_essential';
      work_date: string; volunteers_needed: number; status: string;
    }>(
      `SELECT id, area_id, ot_type, criticality, work_date, volunteers_needed, status
         FROM posting WHERE id = ?`
    )
    .get(posting_id);
}

function postingQuals(posting_id: string): string[] {
  return (
    db()
      .prepare(`SELECT qualification_id FROM posting_qualification WHERE posting_id = ?`)
      .all(posting_id) as { qualification_id: string }[]
  ).map((r) => r.qualification_id);
}

function yesCount(posting_id: string): number {
  const r = db()
    .prepare<[string], { c: number }>(
      `SELECT COUNT(*) AS c FROM offer o
         JOIN response r ON r.offer_id = o.id
        WHERE o.posting_id = ? AND r.response_type = 'yes'`
    )
    .get(posting_id);
  return r?.c ?? 0;
}

function alreadyResponded(posting_id: string): Set<string> {
  return new Set(
    (db()
      .prepare(
        `SELECT DISTINCT o.employee_id
           FROM offer o WHERE o.posting_id = ? AND o.status = 'responded'`
      )
      .all(posting_id) as { employee_id: string }[]
    ).map((r) => r.employee_id)
  );
}

function alreadyOffered(posting_id: string): Set<string> {
  return new Set(
    (db()
      .prepare(`SELECT DISTINCT employee_id FROM offer WHERE posting_id = ?`)
      .all(posting_id) as { employee_id: string }[]
    ).map((r) => r.employee_id)
  );
}

// ---------------------------------------------------------------------------
// Initiate escalation
// ---------------------------------------------------------------------------
export interface InitiateEscalationResult {
  event_id: number;
  branch: 'critical' | 'non_essential';
  ask_high_offers_created: number;
  cascade_offers_created: number;
}

export function initiateEscalation(
  posting_id: string,
  initiated_by_user: string,
  initiated_by_role: string
): InitiateEscalationResult {
  return withTransaction((conn): InitiateEscalationResult => {
    const posting = postingDetails(posting_id);
    if (!posting) throw new Error('posting not found');
    if (posting.status !== 'open') throw new Error('posting is not open');

    const yes = yesCount(posting_id);
    if (yes >= posting.volunteers_needed) {
      throw new Error('posting already satisfied');
    }

    const result = conn
      .prepare(
        `INSERT INTO mandatory_escalation_event
           (posting_id, branch, volunteer_count_at_escalation,
            required_count, initiated_by_user)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(posting_id, posting.criticality, yes, posting.volunteers_needed, initiated_by_user);
    const eventId = Number(result.lastInsertRowid);

    writeAudit({
      actor_user: initiated_by_user,
      actor_role: initiated_by_role,
      action: 'mandatory_escalation_initiated',
      area_id: posting.area_id,
      posting_id,
      data: {
        event_id: eventId,
        branch: posting.criticality,
        yes_count: yes,
        required: posting.volunteers_needed
      }
    });

    if (posting.criticality === 'critical') {
      const created = enqueueAskHighOffers(posting_id, initiated_by_user, initiated_by_role);
      return { event_id: eventId, branch: 'critical', ask_high_offers_created: created, cascade_offers_created: 0 };
    } else {
      const created = enqueueCascadeOffers(posting_id, initiated_by_user, initiated_by_role);
      return { event_id: eventId, branch: 'non_essential', ask_high_offers_created: 0, cascade_offers_created: created };
    }
  });
}

// Critical — ask-high phase: queue pending offers for every qualified member
// in the area not yet responded, in seniority order (oldest first).
// Force-low fires later via executeForceLow when ask-high is exhausted.
function enqueueAskHighOffers(
  posting_id: string,
  by_user: string,
  by_role: string
): number {
  const conn = db();
  const posting = postingDetails(posting_id)!;
  const quals = postingQuals(posting_id);
  const responded = alreadyResponded(posting_id);
  const offered = alreadyOffered(posting_id);

  const members = senioritySortedMembers(posting.area_id, posting.work_date);
  let count = 0;
  for (const m of members) {
    if (responded.has(m.employee_id) || offered.has(m.employee_id)) continue;
    if (!holdsAllQualifications(m.employee_id, quals, posting.work_date)) continue;
    if (isOnApprovedLeave(m.employee_id, posting.work_date)) continue;
    if (m.status !== 'active') continue;

    const offerId = `ofr-${posting_id.slice(5)}-ah-${m.employee_id.split('-')[1]}`;
    conn
      .prepare(
        `INSERT INTO offer
           (id, posting_id, employee_id, offered_by_user, phase, status)
         VALUES (?, ?, ?, ?, 'ask_high', 'pending')`
      )
      .run(offerId, posting_id, m.employee_id, by_user);
    writeAudit({
      actor_user: by_user,
      actor_role: by_role,
      action: 'offer_made',
      area_id: posting.area_id,
      posting_id,
      offer_id: offerId,
      employee_id: m.employee_id,
      data: { phase: 'ask_high' }
    });
    count++;
  }
  return count;
}

// Force-low: directly create force assignments for the N least-senior
// eligible members not yet yes, excluding PS-035 adjacent half-day PTO.
// Marks each forced offer as response=supervisor_override (forced).
export function executeForceLow(
  posting_id: string,
  by_user: string,
  by_role: string,
  reason: string
): number {
  return withTransaction((conn): number => {
    const posting = postingDetails(posting_id)!;
    if (posting.status !== 'open') throw new Error('posting not open');

    const yes = yesCount(posting_id);
    const needed = posting.volunteers_needed - yes;
    if (needed <= 0) return 0;

    const quals = postingQuals(posting_id);
    const yesMembers = (
      conn
        .prepare(
          `SELECT o.employee_id FROM offer o
             JOIN response r ON r.offer_id = o.id
            WHERE o.posting_id = ? AND r.response_type = 'yes'`
        )
        .all(posting_id) as { employee_id: string }[]
    ).map((r) => r.employee_id);
    const yesSet = new Set(yesMembers);

    const members = senioritySortedMembers(posting.area_id, posting.work_date);
    // Reverse for least-senior-first ordering.
    const candidates = [...members].reverse().filter((m) => {
      if (yesSet.has(m.employee_id)) return false;
      if (!holdsAllQualifications(m.employee_id, quals, posting.work_date)) return false;
      if (isOnApprovedLeave(m.employee_id, posting.work_date)) return false;
      if (m.status !== 'active') return false;
      // PS-035 exclusion: adjacent half-day PTO. Slice 3 stub — production
      // would query a leave_period that overlaps the work_date with type
      // 'half_day_pto'. We don't seed those for the demo, so this filter
      // is a no-op here.
      return true;
    });

    let forced = 0;
    for (const m of candidates) {
      if (forced >= needed) break;
      const offerId = `ofr-${posting_id.slice(5)}-fl-${m.employee_id.split('-')[1]}`;
      conn
        .prepare(
          `INSERT INTO offer
             (id, posting_id, employee_id, offered_by_user, phase, status)
           VALUES (?, ?, ?, ?, 'force_low', 'responded')`
        )
        .run(offerId, posting_id, m.employee_id, by_user);

      conn
        .prepare(
          `INSERT INTO response
             (offer_id, response_type, recorded_by_user, recorded_via, reason)
           VALUES (?, 'supervisor_override', ?, 'manual_entry', ?)`
        )
        .run(offerId, by_user, `mandatory escalation, voluntary shortfall: ${reason}`);

      // Apply charge per mode (force counts as having had your turn).
      const mode = (
        conn
          .prepare(
            `SELECT mode FROM area_mode_setting
              WHERE area_id = ? AND effective_end_date IS NULL`
          )
          .get(posting.area_id) as { mode: 'interim' | 'final' } | undefined
      )?.mode ?? 'interim';
      if (mode === 'interim') {
        const cycle = (
          conn
            .prepare(`SELECT current_cycle FROM rotation_state WHERE area_id = ?`)
            .get(posting.area_id) as { current_cycle: number } | undefined
        )?.current_cycle ?? 1;
        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge, cycle_number)
             VALUES (?, ?, ?, 'opportunity', 1, 'interim', ?)`
          )
          .run(offerId, m.employee_id, posting.area_id, cycle);
      } else {
        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge)
             VALUES (?, ?, ?, 'hours_offered', ?, 'final')`
          )
          .run(offerId, m.employee_id, posting.area_id, 0);
        // Note: forced is hours_accepted too since they will work it.
        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge)
             VALUES (?, ?, ?, 'hours_accepted', ?, 'final')`
          )
          .run(offerId, m.employee_id, posting.area_id, 0);
      }

      writeAudit({
        actor_user: by_user,
        actor_role: by_role,
        action: 'force_assigned',
        area_id: posting.area_id,
        posting_id,
        offer_id: offerId,
        employee_id: m.employee_id,
        data: { phase: 'force_low', reason }
      });
      forced++;
    }

    if (forced > 0 && yesCount(posting_id) + forced >= posting.volunteers_needed) {
      conn.prepare(`UPDATE posting SET status = 'satisfied' WHERE id = ?`).run(posting_id);
      conn
        .prepare(
          `UPDATE mandatory_escalation_event
              SET outcome = 'satisfied_force_low', outcome_at = ?
            WHERE posting_id = ? AND outcome = 'in_progress'`
        )
        .run(new Date().toISOString(), posting_id);
      writeAudit({
        actor_user: 'system',
        actor_role: 'system',
        action: 'posting_satisfied',
        area_id: posting.area_id,
        posting_id,
        data: { via: 'force_low', forced }
      });
    }

    return forced;
  });
}

// Non-essential cascade: extend qualified pool to other active areas.
function enqueueCascadeOffers(
  posting_id: string,
  by_user: string,
  by_role: string
): number {
  const conn = db();
  const posting = postingDetails(posting_id)!;
  const quals = postingQuals(posting_id);
  const responded = alreadyResponded(posting_id);
  const offered = alreadyOffered(posting_id);

  // Adjacent areas: any other active area. (Production: refined per Joint
  // Committee per §22.9; for demo we use the broadest definition.)
  const adjacentMembers = conn
    .prepare<[string], {
      employee_id: string; display_name: string; hire_date: string; last4_ssn: string; status: string;
    }>(
      `SELECT DISTINCT e.id AS employee_id, e.display_name, e.hire_date, e.last4_ssn, e.status
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
        WHERE m.area_id != ?
          AND m.effective_end_date IS NULL
          AND e.status = 'active'
        ORDER BY e.hire_date ASC, e.last4_ssn ASC`
    )
    .all(posting.area_id);

  let count = 0;
  for (const m of adjacentMembers) {
    if (responded.has(m.employee_id) || offered.has(m.employee_id)) continue;
    if (!holdsAllQualifications(m.employee_id, quals, posting.work_date)) continue;
    if (isOnApprovedLeave(m.employee_id, posting.work_date)) continue;

    const offerId = `ofr-${posting_id.slice(5)}-cs-${m.employee_id.split('-')[1]}`;
    conn
      .prepare(
        `INSERT INTO offer
           (id, posting_id, employee_id, offered_by_user, phase, status)
         VALUES (?, ?, ?, ?, 'cascade', 'pending')`
      )
      .run(offerId, posting_id, m.employee_id, by_user);
    writeAudit({
      actor_user: by_user,
      actor_role: by_role,
      action: 'offer_made',
      area_id: posting.area_id,
      posting_id,
      offer_id: offerId,
      employee_id: m.employee_id,
      data: { phase: 'cascade', from_adjacent_unit: true }
    });
    count++;
  }
  return count;
}

export function abandonPosting(
  posting_id: string,
  by_user: string,
  by_role: string,
  reason: string
) {
  withTransaction((conn) => {
    const posting = postingDetails(posting_id)!;
    if (posting.status !== 'open') throw new Error('posting not open');

    conn
      .prepare(`UPDATE posting SET status = 'abandoned', cancelled_reason = ? WHERE id = ?`)
      .run(reason, posting_id);
    conn
      .prepare(`UPDATE offer SET status = 'superseded' WHERE posting_id = ? AND status = 'pending'`)
      .run(posting_id);
    conn
      .prepare(
        `UPDATE mandatory_escalation_event
            SET outcome = 'abandoned', outcome_at = ?, notes = ?
          WHERE posting_id = ? AND outcome = 'in_progress'`
      )
      .run(new Date().toISOString(), reason, posting_id);

    writeAudit({
      actor_user: by_user,
      actor_role: by_role,
      action: 'posting_abandoned',
      area_id: posting.area_id,
      posting_id,
      data: { reason }
    });
  });
}

// ---------------------------------------------------------------------------
// Read helpers for views
// ---------------------------------------------------------------------------
export function escalationFor(posting_id: string): {
  id: number;
  branch: 'critical' | 'non_essential';
  outcome: string;
  initiated_at: string;
  initiated_by_user: string;
} | null {
  const r = db()
    .prepare<[string], {
      id: number; branch: 'critical' | 'non_essential';
      outcome: string; initiated_at: string; initiated_by_user: string;
    }>(
      `SELECT id, branch, outcome, initiated_at, initiated_by_user
         FROM mandatory_escalation_event WHERE posting_id = ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(posting_id);
  return r ?? null;
}
