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
import { nextEligibleST, type STPosting } from './rotation_st.js';
import {
  dequeueRemedyForPosting,
  linkRemedyOffer,
  markRemedySatisfiedByOffer
} from './remedies.js';
import { randomUUID } from 'node:crypto';

export type ResponseType =
  | 'yes'
  | 'no'
  | 'no_show'
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
 *
 * Step 4: `no_show` is treated as `no` for production charge purposes — the
 * employee was offered and counted, just didn't show up. The SKT-04A penalty
 * logic for ST areas is layered on separately in recordResponse.
 */
export function shouldChargeInterim(responseType: ResponseType): boolean {
  switch (responseType) {
    case 'yes':
    case 'no':
    case 'no_show':
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
        eligibility_at_offer: string | null;
      }>(
        `SELECT id, posting_id, employee_id, status, eligibility_at_offer
           FROM offer WHERE id = ?`
      )
      .get(input.offer_id);
    if (!offer) throw new Error('offer not found: ' + input.offer_id);
    if (offer.status === 'proposed') {
      // Step 6: proposed offers are gated behind ST SV approval. The approval
      // queue (Step 7) flips them to 'pending'; until then no response can be
      // recorded. This is the response-side enforcement of the SV approval
      // gate from Critical Rule #5.
      throw new Error('offer awaits ST SV approval: ' + input.offer_id);
    }
    if (offer.status !== 'pending') {
      throw new Error('offer already resolved: ' + input.offer_id);
    }

    const posting = conn
      .prepare<[string], {
        id: string;
        area_id: string;
        volunteers_needed: number;
        duration_hours: number;
        pay_multiplier: number;
        ot_type: string;
        status: string;
      }>(
        `SELECT id, area_id, volunteers_needed, duration_hours, pay_multiplier,
                ot_type, status
           FROM posting WHERE id = ?`
      )
      .get(offer.posting_id);
    if (!posting) throw new Error('posting not found');

    const areaTypeRow = conn
      .prepare<[string], { type: string; no_show_penalty_hours: number | null }>(
        `SELECT type, no_show_penalty_hours FROM area WHERE id = ?`
      )
      .get(posting.area_id);
    const isST = areaTypeRow?.type === 'skilled_trades';

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

    // 3. Apply charges per the area's mode (or ST rules, which override
    //    mode — ST is always hours-based with pay-multiplier weighting per
    //    SKT-04A pages 215-216).
    if (isST) {
      if (shouldChargeInterim(input.response_type)) {
        const weightedHours = posting.duration_hours * posting.pay_multiplier;

        // SKT-04A no-show penalty triggers when the worker was offered
        // overtime they accepted on RDO (volunteer slot) OR the posting
        // covers weekend/holiday OT — and then no-showed. The penalty is
        // an extra `area.no_show_penalty_hours` of hours_offered charged
        // against the worker, on top of treating the slot as worked.
        const isWeekendOrHoliday =
          posting.ot_type === 'voluntary_weekend' ||
          posting.ot_type === 'voluntary_holiday';
        const isPenaltyEligibleNoShow =
          input.response_type === 'no_show' &&
          (offer.eligibility_at_offer === 'on_rdo_volunteer' || isWeekendOrHoliday);

        // hours_offered always charges (yes / no / no_show) — the worker
        // was contacted and was on the rotation. Counted regardless of
        // outcome for the equalization unit.
        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge, charge_multiplier)
             VALUES (?, ?, ?, 'hours_offered', ?, 'final', ?)`
          )
          .run(
            offer.id, offer.employee_id, posting.area_id,
            weightedHours, posting.pay_multiplier
          );
        writeAudit({
          actor_user: 'system',
          actor_role: 'system',
          action: 'charge_applied',
          area_id: posting.area_id,
          posting_id: posting.id,
          offer_id: offer.id,
          employee_id: offer.employee_id,
          data: {
            charge_type: 'hours_offered',
            amount: weightedHours,
            pay_multiplier: posting.pay_multiplier,
            area_type: 'skilled_trades'
          }
        });

        // hours_accepted charges on actual acceptance (yes) AND on the
        // penalty-eligible no-show case — the worker is treated as if
        // they worked the slot for tracking purposes (per SKT-04A: a
        // weekend no-show "counts" as the worker having taken the OT).
        if (input.response_type === 'yes' || isPenaltyEligibleNoShow) {
          conn
            .prepare(
              `INSERT INTO charge
                 (offer_id, employee_id, area_id, charge_type, amount,
                  mode_at_charge, charge_multiplier)
               VALUES (?, ?, ?, 'hours_accepted', ?, 'final', ?)`
            )
            .run(
              offer.id, offer.employee_id, posting.area_id,
              weightedHours, posting.pay_multiplier
            );
          writeAudit({
            actor_user: 'system',
            actor_role: 'system',
            action: 'charge_applied',
            area_id: posting.area_id,
            posting_id: posting.id,
            offer_id: offer.id,
            employee_id: offer.employee_id,
            data: {
              charge_type: 'hours_accepted',
              amount: weightedHours,
              pay_multiplier: posting.pay_multiplier,
              area_type: 'skilled_trades',
              via: isPenaltyEligibleNoShow ? 'no_show_penalty_path' : 'yes'
            }
          });
        }

        // SKT-04A no-show penalty: extra hours_offered charge of
        // area.no_show_penalty_hours (typically 1.0). This is the
        // "extra hour" the contract assesses for breaking a
        // weekend/holiday/RDO-volunteer commitment.
        if (isPenaltyEligibleNoShow) {
          const penalty = areaTypeRow?.no_show_penalty_hours ?? 0;
          if (penalty > 0) {
            conn
              .prepare(
                `INSERT INTO charge
                   (offer_id, employee_id, area_id, charge_type, amount,
                    mode_at_charge, charge_multiplier)
                 VALUES (?, ?, ?, 'hours_offered', ?, 'final', 1.0)`
              )
              .run(offer.id, offer.employee_id, posting.area_id, penalty);
            writeAudit({
              actor_user: 'system',
              actor_role: 'system',
              action: 'no_show_penalty_applied',
              area_id: posting.area_id,
              posting_id: posting.id,
              offer_id: offer.id,
              employee_id: offer.employee_id,
              data: {
                penalty_hours: penalty,
                trigger: offer.eligibility_at_offer === 'on_rdo_volunteer'
                  ? 'on_rdo_volunteer'
                  : posting.ot_type,
                area_type: 'skilled_trades'
              }
            });
          }
        }

        // Mark cycle_offered so apprentice gating in rotation_st.ts sees
        // this employee as offered in the current cycle. ST cycles don't
        // auto-advance in the demo; once every journeyperson in an
        // expertise group has been offered once, apprentices enter the
        // pool naturally.
        markCycleOffered(posting.area_id, cycle, offer.employee_id);
      }
    } else if (mode === 'interim' && shouldChargeInterim(input.response_type)) {
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
        start_time: string;
        duration_hours: number;
        status: string;
        pay_multiplier: number;
        required_classification: string | null;
        required_expertise: string | null;
      }>(
        `SELECT id, area_id, work_date, start_time, duration_hours, status,
                pay_multiplier, required_classification, required_expertise
           FROM posting WHERE id = ?`
      )
      .get(posting_id);
    if (!posting) throw new Error('posting not found');
    if (posting.status !== 'open') return null;

    // Dispatch by area.type. ST areas use a distinct rotation engine
    // (rotation_st.ts) that handles expertise, classification, schedule
    // eligibility, soft-qual preference, apprentice gating, and inter-shop
    // canvass. Production areas keep the existing PS-036 path.
    const areaTypeRow = conn
      .prepare<[string], { type: string }>(
        `SELECT type FROM area WHERE id = ?`
      )
      .get(posting.area_id);
    if (areaTypeRow?.type === 'skilled_trades') {
      return generateNextOfferST(
        posting,
        offered_by_user,
        offered_by_role
      );
    }

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

// ---------------------------------------------------------------------------
// Skilled-Trades dispatch arm of generateNextOffer.
//
// Runs inside the same transaction as the caller (we still call db() / writeAudit
// while withTransaction is active). Returns the new offer's id + employee id,
// or null if no candidate was found (in-area + inter-shop canvass both empty).
// ---------------------------------------------------------------------------
function generateNextOfferST(
  posting: {
    id: string;
    area_id: string;
    work_date: string;
    start_time: string;
    duration_hours: number;
    pay_multiplier: number;
    required_classification: string | null;
    required_expertise: string | null;
  },
  offered_by_user: string,
  offered_by_role: string
): { offer_id: string; employee_id: string } | null {
  const conn = db();

  // Step 6: when a posting is still gated by ST SV approval, the offer this
  // pass creates lands as 'proposed' instead of 'pending'. The TM is not
  // notified and cannot respond until the ST SV approves the posting (Step 7
  // approval queue flips the posting flag + promotes the offer).
  const approvalRow = conn
    .prepare<[string], { pending_sv_approval: number }>(
      `SELECT pending_sv_approval FROM posting WHERE id = ?`
    )
    .get(posting.id);
  const isProposed = (approvalRow?.pending_sv_approval ?? 0) === 1;

  const hardQuals = conn
    .prepare<[string], { qualification_id: string }>(
      `SELECT qualification_id FROM posting_qualification WHERE posting_id = ?`
    )
    .all(posting.id)
    .map((r) => r.qualification_id);
  const softQuals = conn
    .prepare<[string], { qualification_id: string }>(
      `SELECT qualification_id FROM posting_preferred_qualification WHERE posting_id = ?`
    )
    .all(posting.id)
    .map((r) => r.qualification_id);

  const stPosting: STPosting = {
    id: posting.id,
    area_id: posting.area_id,
    work_date: posting.work_date,
    start_time: posting.start_time,
    duration_hours: posting.duration_hours,
    pay_multiplier: posting.pay_multiplier,
    required_qualifications: hardQuals,
    preferred_qualifications: softQuals,
    required_classification: posting.required_classification,
    required_expertise: posting.required_expertise
  };

  // First pass — apprentice gating in effect. Returns a candidate from the
  // in-area pool or (if allow_inter_shop_canvass=1 and in-area empty) an
  // inter-shop candidate.
  let result = nextEligibleST(stPosting);
  let phase: 'normal' | 'inter_shop_canvass' | 'apprentice_escalation' | null = result.phase;

  // Step 4 ask-apprentices escalation: when the first pass returns no
  // candidate AND apprentices were gated (the normal case where Step 3
  // skipped them because journeypersons remained in-cycle), retry with
  // apprentices unlocked. Tag the resulting offer phase explicitly so the
  // audit log records that this came via escalation.
  //
  // No force-low fallback. Per SKT-04A interpretation in the round-2
  // union meeting, forcing in ST areas is an untested contractual
  // interpretation — if pursued by the Company it goes through the
  // Grievance Procedure, not the rotation engine. If apprentices ALSO
  // produce no candidate, the posting stays open with no offer created.
  if (!result.candidate) {
    const apprenticeResult = nextEligibleST(stPosting, { unlockApprentices: true });
    if (apprenticeResult.candidate) {
      result = apprenticeResult;
      phase = 'apprentice_escalation';
    }
  }

  // Record audit-only skips for transparency. We don't insert response rows
  // for ST-specific skip reasons (shift_conflict / classification_mismatch /
  // expertise_mismatch / apprentice_gated) because the response.response_type
  // CHECK constraint doesn't list them. The audit log captures the full skip
  // set across both passes.
  for (const skip of result.skips) {
    writeAudit({
      actor_user: 'system',
      actor_role: 'system',
      action: 'st_candidate_skipped',
      area_id: posting.area_id,
      posting_id: posting.id,
      employee_id: skip.employee_id,
      data: { reason: skip.reason, charged: false, phase }
    });
  }

  if (!result.candidate) {
    // Both passes exhausted. Per SKT-04A interpretation, no force-low —
    // posting stays open and the supervisor's options are grievance
    // procedure or manual outside-shop request. Step 6 surfaces this
    // state in the UI with a "pool exhausted — no force available" note.
    writeAudit({
      actor_user: 'system',
      actor_role: 'system',
      action: 'st_pool_exhausted',
      area_id: posting.area_id,
      posting_id: posting.id,
      data: { note: 'no force-low per SKT-04A interpretation' }
    });
    return null;
  }

  const c = result.candidate;
  const offerSuffix =
    phase === 'inter_shop_canvass' ? '-isc' :
    phase === 'apprentice_escalation' ? '-app' : '-st';
  // Random tail: in ST final-mode selection, the same employee can be the
  // lowest-hours candidate across multiple iterations of a single posting
  // (cycle doesn't advance like it does in interim mode), so an employee
  // can legitimately receive multiple offers on the same posting. Append
  // a short UUID slice to keep the offer.id unique.
  const offerId =
    'ofr-' + posting.id.slice(5) + '-' + c.employee_id.split('-')[1] + offerSuffix +
    '-' + randomUUID().slice(0, 6);

  conn
    .prepare(
      `INSERT INTO offer
         (id, posting_id, employee_id, rotation_position, offered_by_user,
          phase, eligibility_at_offer, status)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
    )
    .run(
      offerId,
      posting.id,
      c.employee_id,
      offered_by_user,
      phase === 'normal' || phase == null ? null : phase,
      c.eligibility_at_offer,
      isProposed ? 'proposed' : 'pending'
    );

  writeAudit({
    actor_user: offered_by_user,
    actor_role: offered_by_role,
    action: isProposed ? 'st_offer_proposed' : 'offer_made',
    area_id: posting.area_id,
    posting_id: posting.id,
    offer_id: offerId,
    employee_id: c.employee_id,
    data: {
      area_type: 'skilled_trades',
      phase,
      eligibility_at_offer: c.eligibility_at_offer,
      source_area_id: c.source_area_id,
      pay_multiplier: posting.pay_multiplier,
      preferred_quals_matched: c.preferred_quals_matched,
      is_apprentice: c.is_apprentice === 1,
      pending_sv_approval: isProposed
    }
  });

  return { offer_id: offerId, employee_id: c.employee_id };
}

/**
 * Promote the proposed offer on an ST posting to a real pending offer once
 * the ST SV approves. Clears posting.pending_sv_approval, flips status
 * proposed -> pending, and writes the approval audit entry. Step 7's
 * `/sv/approvals` action will call this; Step 6 ships the function so the
 * proposed-state plumbing is exercised end-to-end.
 */
export function approveProposedSTPosting(
  posting_id: string,
  approved_by_user: string,
  approved_by_role: string
): { offer_id: string | null; employee_id: string | null } {
  return withTransaction((conn) => {
    const posting = conn
      .prepare<[string], { id: string; area_id: string; pending_sv_approval: number }>(
        `SELECT id, area_id, pending_sv_approval FROM posting WHERE id = ?`
      )
      .get(posting_id);
    if (!posting) throw new Error('posting not found');
    if (posting.pending_sv_approval !== 1) {
      throw new Error('posting is not awaiting SV approval');
    }

    conn
      .prepare(`UPDATE posting SET pending_sv_approval = 0 WHERE id = ?`)
      .run(posting_id);

    // Promote any proposed offers (typically just one — the first lowest-hours
    // candidate the algorithm picked when the posting was created) to pending.
    const proposed = conn
      .prepare<[string], { id: string; employee_id: string }>(
        `SELECT id, employee_id FROM offer
          WHERE posting_id = ? AND status = 'proposed'`
      )
      .all(posting_id);
    for (const o of proposed) {
      conn
        .prepare(`UPDATE offer SET status = 'pending' WHERE id = ?`)
        .run(o.id);
      writeAudit({
        actor_user: 'system',
        actor_role: 'system',
        action: 'offer_made',
        area_id: posting.area_id,
        posting_id,
        offer_id: o.id,
        employee_id: o.employee_id,
        data: {
          area_type: 'skilled_trades',
          via: 'sv_approval_promotion'
        }
      });
    }

    writeAudit({
      actor_user: approved_by_user,
      actor_role: approved_by_role,
      action: 'sv_approved_st_posting',
      area_id: posting.area_id,
      posting_id,
      data: { promoted_offers: proposed.length }
    });

    return {
      offer_id: proposed[0]?.id ?? null,
      employee_id: proposed[0]?.employee_id ?? null
    };
  });
}
