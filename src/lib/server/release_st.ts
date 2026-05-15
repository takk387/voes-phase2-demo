// SKT-04A reverse-selection ("go home") flow.
//
// Per SKT-04A, when fewer ST workers are needed than have already accepted,
// the supervisor releases excess workers in REVERSE seniority — highest-hours
// first. The released workers don't get the OT; their hours_accepted (and
// hours_worked, if any) charges net to zero so equalization treats it as if
// they were never assigned. Their hours_offered charge STAYS — they were
// still on the rotation and offered the opportunity.
//
// This module exposes a single function `releaseExcessST` consumed by the
// Step 4 endpoint at /coord/posting/[id]/release-excess and (in Step 6) by
// the coordinator UI's "Release excess workers" modal.

import { db, withTransaction } from './db.js';
import { writeAudit } from './audit.js';

export interface ReleaseExcessResult {
  released_employee_ids: string[];
  released_offer_ids: string[];
  reversal_charge_ids: number[];
}

export class ReleaseExcessError extends Error {
  constructor(public reason: 'not_found' | 'production_area' | 'count_invalid' | 'count_exceeds_assigned', message: string) {
    super(message);
  }
}

/**
 * Release `count` highest-hours accepted workers from an ST posting.
 *
 * Returns the identifiers of the released offers and the reversal charges so
 * the caller can audit / display the result. Throws ReleaseExcessError when
 * the area is production or the count is out of range.
 */
export function releaseExcessST(
  posting_id: string,
  count: number,
  initiated_by_user: string,
  initiated_by_role: string
): ReleaseExcessResult {
  if (!Number.isFinite(count) || count <= 0) {
    throw new ReleaseExcessError('count_invalid', 'count must be a positive integer');
  }

  return withTransaction((conn): ReleaseExcessResult => {
    const posting = conn
      .prepare<[string], { id: string; area_id: string; volunteers_needed: number }>(
        `SELECT id, area_id, volunteers_needed FROM posting WHERE id = ?`
      )
      .get(posting_id);
    if (!posting) {
      throw new ReleaseExcessError('not_found', 'posting not found: ' + posting_id);
    }
    const areaTypeRow = conn
      .prepare<[string], { type: string }>(`SELECT type FROM area WHERE id = ?`)
      .get(posting.area_id);
    if (areaTypeRow?.type !== 'skilled_trades') {
      throw new ReleaseExcessError(
        'production_area',
        'release-excess is an SKT-04A flow; not available for production areas'
      );
    }

    // Currently-assigned workers = offer.status='responded' AND there is a
    // 'yes' response on that offer. Highest-hours first per reverse-selection
    // (SKT-04A's "send home" rule).
    const assigned = conn
      .prepare<[string, string], {
        offer_id: string;
        employee_id: string;
        hours_offered_total: number;
        hire_date: string;
        last4_ssn: string;
      }>(
        `SELECT o.id AS offer_id,
                o.employee_id,
                COALESCE(SUM(CASE WHEN c.charge_type = 'hours_offered'
                                  THEN c.amount ELSE 0 END), 0) AS hours_offered_total,
                e.hire_date, e.last4_ssn
           FROM offer o
           JOIN employee e ON e.id = o.employee_id
           LEFT JOIN charge c
             ON c.employee_id = o.employee_id AND c.area_id = ?
           WHERE o.posting_id = ?
             AND o.status = 'responded'
             AND EXISTS (SELECT 1 FROM response r
                          WHERE r.offer_id = o.id AND r.response_type = 'yes')
           GROUP BY o.id, o.employee_id, e.hire_date, e.last4_ssn
           ORDER BY hours_offered_total DESC, e.hire_date ASC, e.last4_ssn ASC`
      )
      .all(posting.area_id, posting_id);

    if (count > assigned.length) {
      throw new ReleaseExcessError(
        'count_exceeds_assigned',
        `requested ${count} workers but only ${assigned.length} accepted`
      );
    }

    const releaseList = assigned.slice(0, count);
    const released_employee_ids: string[] = [];
    const released_offer_ids: string[] = [];
    const reversal_charge_ids: number[] = [];

    for (const r of releaseList) {
      // Flip the offer status to 'released'. Production tables don't see
      // this status — the CHECK constraint includes 'released' only after
      // the Step 4 migration.
      conn.prepare(`UPDATE offer SET status = 'released' WHERE id = ?`).run(r.offer_id);

      // Reverse hours_accepted + hours_worked charges from this offer.
      // hours_offered intentionally stays — the worker was still offered,
      // and equalization tracks that. The CBA's "go home" semantic is
      // "we don't need you; you don't get the hours" — equivalent to
      // a 'no' response retroactively.
      const charges = conn
        .prepare<[string], {
          id: number;
          offer_id: string;
          employee_id: string;
          area_id: string;
          charge_type: string;
          amount: number;
          mode_at_charge: string;
          charge_multiplier: number;
          cycle_number: number | null;
        }>(
          `SELECT id, offer_id, employee_id, area_id, charge_type, amount,
                  mode_at_charge, charge_multiplier, cycle_number
             FROM charge
            WHERE offer_id = ?
              AND charge_type IN ('hours_accepted', 'hours_worked')
              AND reverses_charge_id IS NULL`
        )
        .all(r.offer_id);

      for (const ch of charges) {
        const result = conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge, charge_multiplier, cycle_number,
                reverses_charge_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            ch.offer_id, ch.employee_id, ch.area_id, ch.charge_type,
            -ch.amount, ch.mode_at_charge, ch.charge_multiplier,
            ch.cycle_number, ch.id
          );
        reversal_charge_ids.push(Number(result.lastInsertRowid));
      }

      released_employee_ids.push(r.employee_id);
      released_offer_ids.push(r.offer_id);

      writeAudit({
        actor_user: initiated_by_user,
        actor_role: initiated_by_role,
        action: 'st_worker_released',
        area_id: posting.area_id,
        posting_id,
        offer_id: r.offer_id,
        employee_id: r.employee_id,
        data: {
          hours_offered_total_at_release: r.hours_offered_total,
          reversed_charges: charges.map((c) => c.id),
          reason: 'reverse_selection_send_home'
        }
      });
    }

    // If releasing brought the posting back under volunteers_needed,
    // reopen it so the supervisor can keep filling if they want. Demo
    // chooses the safe default: leave status alone — the supervisor can
    // explicitly reopen via posting action if needed. Otherwise releasing
    // any worker from a satisfied posting would silently re-open it,
    // which could surprise the user.

    return { released_employee_ids, released_offer_ids, reversal_charge_ids };
  });
}
