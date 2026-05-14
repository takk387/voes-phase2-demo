// Service functions for the offer lifecycle: record a response, apply or
// reverse charges, satisfy or cancel postings. Shared between TM-3 (TM
// responds directly) and SV-3 (Supervisor records on behalf).

import { db, withTransaction } from './db.js';
import { writeAudit } from './audit.js';
import {
  commitCycleReset,
  getCurrentCycle,
  markCycleOffered,
  nextEligibleInterim,
  nextEligibleFinal,
  senioritySortedMembers,
  type FinalModeContext,
  type PostingForRotation
} from './rotation.js';
import {
  dequeueRemedyForPosting,
  linkRemedyOffer,
  markRemedySatisfiedByOffer
} from './remedies.js';
import { randomUUID } from 'node:crypto';

export type ResponseType =
  | 'yes'
  | 'no'
  | 'passed_over_unqualified'
  | 'on_leave'
  | 'on_the_job'
  | 'no_contact';

/**
 * Whether a response type produces an opportunity charge in interim mode.
 *
 * Per Phase 1 plan §4.5 + §4.6, a Yes or No produces a charge; qualification,
 * leave, and on-the-job skips do not. A no-contact response also does NOT
 * produce a charge — treat it like approved leave for rotation purposes.
 */
export function shouldChargeInterim(responseType: ResponseType): boolean {
  switch (responseType) {
    case 'yes':
    case 'no':
      return true;
    default:
      return false;
  }
}

interface RecordResponseInput {
  offer_id: string;
  response_type: ResponseType;
  recorded_by_user: string;
  recorded_by_role: string;
  recorded_via: 'team_member' | 'supervisor_on_behalf' | 'manual_entry';
  reason?: string;
}

interface RecordResponseResult {
  postingNowSatisfied: boolean;
  cycleResetTriggered: boolean;
  newCycle: number;
}

export function recordResponse(input: RecordResponseInput): RecordResponseResult {
  return withTransaction((conn): RecordResponseResult => {
    const offer = conn
      .prepare<[string], {
        id: string;
        posting_id: string;
        employee_id: string;
        status: string;
      }>(
        `SELECT id, posting_id, employee_id, status FROM offer WHERE id = ?`
      )
      .get(input.offer_id);
    if (!offer) throw new Error('offer not found: ' + input.offer_id);
    if (offer.status !== 'pending') {
      throw new Error('offer already resolved: ' + input.offer_id);
    }

    const posting = conn
      .prepare<[string], {
        id: string;
        area_id: string;
        volunteers_needed: number;
        duration_hours: number;
        status: string;
      }>(
        `SELECT id, area_id, volunteers_needed, duration_hours, status
           FROM posting WHERE id = ?`
      )
      .get(offer.posting_id);
    if (!posting) throw new Error('posting not found');

    const mode = currentMode(posting.area_id);
    const cycle = getCurrentCycle(posting.area_id);

    // 1. Insert response.
    conn
      .prepare(
        `INSERT INTO response
           (offer_id, response_type, recorded_by_user, recorded_via, reason)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.offer_id,
        input.response_type,
        input.recorded_by_user,
        input.recorded_via,
        input.reason ?? null
      );

    // 2. Mark offer responded.
    conn
      .prepare(`UPDATE offer SET status = 'responded' WHERE id = ?`)
      .run(input.offer_id);

    writeAudit({
      actor_user: input.recorded_by_user,
      actor_role: input.recorded_by_role,
      action: 'response_recorded',
      area_id: posting.area_id,
      posting_id: posting.id,
      offer_id: offer.id,
      employee_id: offer.employee_id,
      data: {
        response_type: input.response_type,
        recorded_via: input.recorded_via
      },
      reason: input.reason ?? null
    });

    // 3. Apply charges per the area's mode.
    if (mode === 'interim' && shouldChargeInterim(input.response_type)) {
      conn
        .prepare(
          `INSERT INTO charge
             (offer_id, employee_id, area_id, charge_type, amount,
              mode_at_charge, cycle_number)
           VALUES (?, ?, ?, 'opportunity', 1, 'interim', ?)`
        )
        .run(offer.id, offer.employee_id, posting.area_id, cycle);

      markCycleOffered(posting.area_id, cycle, offer.employee_id);

      writeAudit({
        actor_user: 'system',
        actor_role: 'system',
        action: 'charge_applied',
        area_id: posting.area_id,
        posting_id: posting.id,
        offer_id: offer.id,
        employee_id: offer.employee_id,
        data: { charge_type: 'opportunity', amount: 1, cycle_number: cycle }
      });
    } else if (mode === 'final') {
      // Final mode: hours_offered is charged on the offer itself for both
      // Yes and No (§4.5, §9.2 PROCESS_OFFER_OUTCOME). hours_accepted is
      // charged only on Yes. No-charge response types (skip / leave / etc)
      // do not produce hours charges either.
      if (shouldChargeInterim(input.response_type)) {
        // Same shape as interim's charge predicate: yes and no charge,
        // skips don't.
        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge)
             VALUES (?, ?, ?, 'hours_offered', ?, 'final')`
          )
          .run(offer.id, offer.employee_id, posting.area_id, posting.duration_hours);

        writeAudit({
          actor_user: 'system',
          actor_role: 'system',
          action: 'charge_applied',
          area_id: posting.area_id,
          posting_id: posting.id,
          offer_id: offer.id,
          employee_id: offer.employee_id,
          data: { charge_type: 'hours_offered', amount: posting.duration_hours }
        });

        if (input.response_type === 'yes') {
          conn
            .prepare(
              `INSERT INTO charge
                 (offer_id, employee_id, area_id, charge_type, amount,
                  mode_at_charge)
               VALUES (?, ?, ?, 'hours_accepted', ?, 'final')`
            )
            .run(offer.id, offer.employee_id, posting.area_id, posting.duration_hours);

          writeAudit({
            actor_user: 'system',
            actor_role: 'system',
            action: 'charge_applied',
            area_id: posting.area_id,
            posting_id: posting.id,
            offer_id: offer.id,
            employee_id: offer.employee_id,
            data: { charge_type: 'hours_accepted', amount: posting.duration_hours }
          });
        }
      }

      // If this is the first cycle after a cutover, mark the TM as offered
      // in that cycle. The mode-cutover code will flip the flag once everyone
      // has been offered.
      const fcRow = conn
        .prepare<[string], { first_cycle_after_cutover: number }>(
          `SELECT first_cycle_after_cutover FROM rotation_state WHERE area_id = ?`
        )
        .get(posting.area_id);
      if (fcRow?.first_cycle_after_cutover) {
        conn
          .prepare(
            `INSERT OR IGNORE INTO first_cycle_offered (area_id, employee_id)
             VALUES (?, ?)`
          )
          .run(posting.area_id, offer.employee_id);

        // Check whether everyone is now offered; if so, flip the flag.
        const remaining = conn
          .prepare<[string, string], { c: number }>(
            `SELECT COUNT(*) AS c FROM area_membership m
              WHERE m.area_id = ?
                AND m.effective_end_date IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM first_cycle_offered fco
                   WHERE fco.area_id = m.area_id
                     AND fco.employee_id = m.employee_id
                )`
          )
          .get(posting.area_id, posting.area_id);

        if ((remaining?.c ?? 0) === 0) {
          conn
            .prepare(
              `UPDATE rotation_state SET first_cycle_after_cutover = 0
                WHERE area_id = ?`
            )
            .run(posting.area_id);
          writeAudit({
            actor_user: 'system',
            actor_role: 'system',
            action: 'first_cycle_after_cutover_complete',
            area_id: posting.area_id,
            data: { switching_to: 'lowest_hours_first' }
          });
        }
      }
    }

    // 3b. If this offer satisfies an open bypass remedy, mark it. Per §5.14,
    // the remedy is satisfied by *offering* the next available assignment —
    // not by what the TM responds. So Yes, No, or any no-charge skip all
    // satisfy the remedy.
    markRemedySatisfiedByOffer(offer.id);

    // 4. Check whether the posting is satisfied.
    const yesCount = conn
      .prepare<[string], { c: number }>(
        `SELECT COUNT(*) AS c FROM offer o
           JOIN response r ON r.offer_id = o.id
          WHERE o.posting_id = ? AND r.response_type = 'yes'`
      )
      .get(posting.id);
    const yes = yesCount?.c ?? 0;
    let satisfied = false;
    if (yes >= posting.volunteers_needed) {
      conn
        .prepare(`UPDATE posting SET status = 'satisfied' WHERE id = ?`)
        .run(posting.id);
      satisfied = true;

      // If satisfaction came via an escalation phase, record that on the
      // open MandatoryEscalationEvent. We look at the *responding* offer's
      // phase since that's what tipped the count.
      const phaseRow = conn
        .prepare<[string], { phase: string | null }>(
          `SELECT phase FROM offer WHERE id = ?`
        )
        .get(input.offer_id);
      const escalation = conn
        .prepare<[string], { id: number; branch: string }>(
          `SELECT id, branch FROM mandatory_escalation_event
            WHERE posting_id = ? AND outcome = 'in_progress'
            ORDER BY id DESC LIMIT 1`
        )
        .get(posting.id);
      if (escalation) {
        let outcome: string;
        if (phaseRow?.phase === 'ask_high') outcome = 'satisfied_ask_high';
        else if (phaseRow?.phase === 'cascade') outcome = 'satisfied_cascade';
        else if (phaseRow?.phase === 'force_low') outcome = 'satisfied_force_low';
        else outcome = 'in_progress';
        if (outcome !== 'in_progress') {
          conn
            .prepare(
              `UPDATE mandatory_escalation_event
                  SET outcome = ?, outcome_at = ?
                WHERE id = ?`
            )
            .run(outcome, new Date().toISOString(), escalation.id);
          writeAudit({
            actor_user: 'system',
            actor_role: 'system',
            action: 'mandatory_escalation_outcome',
            area_id: posting.area_id,
            posting_id: posting.id,
            data: { event_id: escalation.id, outcome }
          });
        }
      }

      writeAudit({
        actor_user: 'system',
        actor_role: 'system',
        action: 'posting_satisfied',
        area_id: posting.area_id,
        posting_id: posting.id,
        data: { yes_count: yes, volunteers_needed: posting.volunteers_needed }
      });
    }

    return {
      postingNowSatisfied: satisfied,
      cycleResetTriggered: false,
      newCycle: cycle
    };
  });
}

export function currentMode(area_id: string): 'interim' | 'final' {
  const conn = db();
  const row = conn
    .prepare<[string], { mode: 'interim' | 'final' }>(
      `SELECT mode FROM area_mode_setting
        WHERE area_id = ? AND effective_end_date IS NULL
        LIMIT 1`
    )
    .get(area_id);
  return row?.mode ?? 'interim';
}

/**
 * Create the next offer for an open posting. If the posting is already
 * satisfied, returns null. If no eligible candidate exists, returns null.
 *
 * In slice 1 this also auto-records the no-charge skips (qualification, leave)
 * that the rotation engine encountered along the way, so the audit trail and
 * area standing reflect them. The supervisor still confirms the offer that
 * lands on the candidate.
 */
export function generateNextOffer(
  posting_id: string,
  offered_by_user: string,
  offered_by_role: string
): { offer_id: string; employee_id: string } | null {
  return withTransaction((conn): { offer_id: string; employee_id: string } | null => {
    const posting = conn
      .prepare<[string], {
        id: string;
        area_id: string;
        work_date: string;
        status: string;
      }>(
        `SELECT id, area_id, work_date, status FROM posting WHERE id = ?`
      )
      .get(posting_id);
    if (!posting) throw new Error('posting not found');
    if (posting.status !== 'open') return null;

    const quals = conn
      .prepare<[string], { qualification_id: string }>(
        `SELECT qualification_id FROM posting_qualification WHERE posting_id = ?`
      )
      .all(posting.id)
      .map((r) => r.qualification_id);

    const rotPosting: PostingForRotation = {
      id: posting.id,
      area_id: posting.area_id,
      work_date: posting.work_date,
      required_qualifications: quals
    };

    // Bypass-remedy precedence (§5.14, §10.17). If an open remedy exists in
    // this area whose affected TM is eligible for this posting, that TM
    // gets the offer ahead of the normal rotation.
    const remedy = dequeueRemedyForPosting({
      area_id: posting.area_id,
      work_date: posting.work_date,
      required_qualifications: quals
    });
    if (remedy) {
      const offerId = 'ofr-' + posting.id.slice(5) + '-' + remedy.affected_employee_id.split('-')[1] + '-r';
      conn
        .prepare(
          `INSERT INTO offer
             (id, posting_id, employee_id, rotation_position, offered_by_user, status)
           VALUES (?, ?, ?, 0, ?, 'pending')`
        )
        .run(offerId, posting.id, remedy.affected_employee_id, offered_by_user);
      linkRemedyOffer(remedy.remedy_id, offerId);

      writeAudit({
        actor_user: offered_by_user,
        actor_role: offered_by_role,
        action: 'offer_made',
        area_id: posting.area_id,
        posting_id: posting.id,
        offer_id: offerId,
        employee_id: remedy.affected_employee_id,
        data: { bypass_remedy_id: remedy.remedy_id, takes_precedence: true }
      });

      return { offer_id: offerId, employee_id: remedy.affected_employee_id };
    }

    const mode = currentMode(posting.area_id);
    let result;
    if (mode === 'final') {
      const fcRow = conn
        .prepare<[string], { first_cycle_after_cutover: number }>(
          `SELECT first_cycle_after_cutover FROM rotation_state WHERE area_id = ?`
        )
        .get(posting.area_id);
      const offeredRows = conn
        .prepare<[string], { employee_id: string }>(
          `SELECT employee_id FROM first_cycle_offered WHERE area_id = ?`
        )
        .all(posting.area_id);
      const ctx: FinalModeContext = {
        firstCycleAfterCutover: !!fcRow?.first_cycle_after_cutover,
        firstCycleOffered: new Set(offeredRows.map((r) => r.employee_id))
      };
      result = nextEligibleFinal(rotPosting, ctx);
    } else {
      result = nextEligibleInterim(rotPosting);
    }

    // Record the no-charge skips that the rotation passed over getting here.
    for (const skip of result.skips) {
      const skipOfferId = 'ofr-' + randomUUID().slice(0, 8) + '-' + skip.employee_id.split('-')[1];
      conn
        .prepare(
          `INSERT INTO offer
             (id, posting_id, employee_id, offered_by_user, status)
           VALUES (?, ?, ?, ?, 'responded')`
        )
        .run(skipOfferId, posting.id, skip.employee_id, offered_by_user);

      conn
        .prepare(
          `INSERT INTO response
             (offer_id, response_type, recorded_by_user, recorded_via)
           VALUES (?, ?, ?, 'manual_entry')`
        )
        .run(skipOfferId, skip.reason, 'system');

      writeAudit({
        actor_user: 'system',
        actor_role: 'system',
        action: 'offer_skipped',
        area_id: posting.area_id,
        posting_id: posting.id,
        offer_id: skipOfferId,
        employee_id: skip.employee_id,
        data: { reason: skip.reason, charged: false }
      });
    }

    if (result.cycleResetTriggered) {
      commitCycleReset(posting.area_id, result.cycle);
      writeAudit({
        actor_user: 'system',
        actor_role: 'system',
        action: 'cycle_reset',
        area_id: posting.area_id,
        data: { new_cycle: result.cycle }
      });
    }

    if (!result.candidate) return null;

    // Create a real pending offer for the candidate. Include the cycle number
    // so the ID stays unique when a cycle reset causes the same employee to
    // appear again (fixes UNIQUE constraint violation / 500 on cycle wrap).
    const offerId = 'ofr-' + posting.id.slice(5) + '-' + result.candidate.employee_id.split('-')[1] + '-c' + result.cycle;
    conn
      .prepare(
        `INSERT INTO offer
           (id, posting_id, employee_id, rotation_position, offered_by_user,
            status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        offerId,
        posting.id,
        result.candidate.employee_id,
        // rotation position based on seniority order (1-based) — informational
        0,
        offered_by_user
      );

    writeAudit({
      actor_user: offered_by_user,
      actor_role: offered_by_role,
      action: 'offer_made',
      area_id: posting.area_id,
      posting_id: posting.id,
      offer_id: offerId,
      employee_id: result.candidate.employee_id,
      data: {}
    });

    return { offer_id: offerId, employee_id: result.candidate.employee_id };
  });
}

/**
 * Cancel a posting. Per §22.3, all charges for the posting are reversed
 * regardless of mode.
 */
export function cancelPosting(
  posting_id: string,
  cancelled_by_user: string,
  cancelled_by_role: string,
  reason: string
) {
  withTransaction((conn) => {
    const posting = conn
      .prepare<[string], { id: string; area_id: string; status: string }>(
        `SELECT id, area_id, status FROM posting WHERE id = ?`
      )
      .get(posting_id);
    if (!posting) throw new Error('posting not found');
    if (posting.status === 'cancelled') return;

    conn
      .prepare(
        `UPDATE posting SET status = 'cancelled',
                cancelled_at = ?, cancelled_reason = ?
          WHERE id = ?`
      )
      .run(new Date().toISOString(), reason, posting_id);

    // Close any pending offers.
    conn
      .prepare(
        `UPDATE offer SET status = 'superseded'
          WHERE posting_id = ? AND status = 'pending'`
      )
      .run(posting_id);

    // Reverse all charges for this posting.
    const charges = conn
      .prepare<[string], {
        id: number;
        offer_id: string;
        employee_id: string;
        area_id: string;
        charge_type: string;
        amount: number;
        mode_at_charge: string;
        cycle_number: number | null;
      }>(
        `SELECT c.* FROM charge c
           JOIN offer o ON o.id = c.offer_id
          WHERE o.posting_id = ?
            AND c.reverses_charge_id IS NULL`
      )
      .all(posting_id);

    for (const ch of charges) {
      conn
        .prepare(
          `INSERT INTO charge
             (offer_id, employee_id, area_id, charge_type, amount,
              mode_at_charge, cycle_number, reverses_charge_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ch.offer_id,
          ch.employee_id,
          ch.area_id,
          ch.charge_type,
          -ch.amount,
          ch.mode_at_charge,
          ch.cycle_number,
          ch.id
        );

      // Also free up the cycle-offered slot if this was an opportunity charge.
      if (ch.charge_type === 'opportunity' && ch.cycle_number !== null) {
        conn
          .prepare(
            `DELETE FROM cycle_offered
              WHERE area_id = ? AND cycle_number = ? AND employee_id = ?`
          )
          .run(ch.area_id, ch.cycle_number, ch.employee_id);
      }

      writeAudit({
        actor_user: 'system',
        actor_role: 'system',
        action: 'charge_reversed',
        area_id: ch.area_id,
        posting_id,
        offer_id: ch.offer_id,
        employee_id: ch.employee_id,
        data: {
          original_charge_id: ch.id,
          charge_type: ch.charge_type,
          amount: -ch.amount,
          reason: 'posting_cancelled'
        }
      });
    }

    writeAudit({
      actor_user: cancelled_by_user,
      actor_role: cancelled_by_role,
      action: 'posting_cancelled',
      area_id: posting.area_id,
      posting_id,
      data: { charges_reversed: charges.length },
      reason
    });
  });
}
