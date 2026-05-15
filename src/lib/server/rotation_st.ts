// Rotation engine for Skilled Trades areas (area.type = 'skilled_trades').
// Implements SKT-04A overtime equalization tracking and charging (CBA pages
// 215-216 internal) for the Phase 2 demo.
//
// Differences from production (PS-036, see rotation.ts):
//   - Hours-of-pay charging via posting.pay_multiplier (1.5×, 2.0×) — handled
//     in offers.ts when the charge row is inserted; this file is selection-only
//   - Selection is always lowest-hours-first (final-mode style) — interim
//     opportunity-count rotation does not apply to ST
//   - Candidate pool gated by area_of_expertise OR required_classification
//   - Soft-qual preference (posting_preferred_qualification) as a sort
//     tiebreaker — never excludes
//   - Apprentice gating: an apprentice is excluded from the pool until every
//     journeyperson in their expertise group has been offered at least once
//     in the current cycle (cycle_offered table); once all journeypersons
//     have been offered, apprentices join the pool naturally. Step 4 layers
//     the "ask apprentices" escalation on top for the case when the pool
//     exhausts entirely.
//   - Inter-shop canvass: if area.allow_inter_shop_canvass = 1 AND the
//     in-area pool is empty, the candidate set extends to other ST areas
//     of the same shift × expertise. Returned offers carry phase
//     = 'inter_shop_canvass' for the audit trail.
//   - Schedule eligibility: ST employees have shift_pattern_id +
//     crew_position + cycle_anchor_date and the cycle math (Step 2's
//     schedule_eligibility helper) gates whether they're on a compatible
//     shift, on RDO (eligible to volunteer), or on a conflicting shift
//     (excluded).
//
// This file does not write to the DB. Callers (offers.ts) consume the
// NextEligibleSTResult and create offers, write audit entries, and insert
// charges with the correct multiplier.

import { db } from './db.js';
import { isOnApprovedLeave, holdsAllQualifications } from './rotation.js';
import { isOnDutyDateScheduled, type EligibilityResult } from './schedule_eligibility.js';

export interface STPosting {
  id: string;
  area_id: string;
  work_date: string;
  start_time: string;
  duration_hours: number;
  pay_multiplier: number;
  required_qualifications: string[];      // hard gate
  preferred_qualifications: string[];     // soft — sort tiebreaker
  required_classification: string | null; // e.g. 'PipeFitter'
  required_expertise: string | null;      // 'Electrical' | 'Mechanical' | null
}

export interface STCandidate {
  employee_id: string;
  display_name: string;
  hire_date: string;
  last4_ssn: string;
  status: string;
  is_apprentice: number;
  area_of_expertise: string | null;
  classification: string | null;
  shift_pattern_id: number | null;
  crew_position: number | null;
  cycle_anchor_date: string | null;
  hours_offered: number;
  preferred_quals_matched: number;
  eligibility_at_offer: 'on_normal_shift' | 'on_rdo_volunteer';
  source_area_id: string;
}

export interface NextEligibleSTResult {
  candidate: STCandidate | null;
  phase: 'normal' | 'inter_shop_canvass' | null;
  // Skips encountered during candidate enumeration. Mirrors rotation.ts —
  // qualification or leave skips don't get charged but show up in the audit
  // trail so the supervisor can see why a TM was passed over.
  skips: Array<{
    employee_id: string;
    reason:
      | 'passed_over_unqualified'
      | 'on_leave'
      | 'shift_conflict'
      | 'classification_mismatch'
      | 'expertise_mismatch'
      | 'apprentice_gated';
  }>;
}

export interface NextEligibleSTOptions {
  // Step 4's ask-apprentices escalation sets this true. Step 3's normal
  // rotation leaves it false, then apprentices come through naturally once
  // every journeyperson in the expertise group has been offered once.
  unlockApprentices?: boolean;
}

// Row shape pulled from the DB for ST candidate enumeration.
interface MemberRowST {
  employee_id: string;
  display_name: string;
  hire_date: string;
  last4_ssn: string;
  status: string;
  is_apprentice: number;
  area_of_expertise: string | null;
  classification: string | null;
  shift_pattern_id: number | null;
  crew_position: number | null;
  cycle_anchor_date: string | null;
  source_area_id: string;
}

// Pull the active members of a single area along with the ST employee fields
// needed for filtering and ordering. Active = membership window covers
// work_date.
function activeMembersForArea(area_id: string, work_date: string): MemberRowST[] {
  const conn = db();
  return conn
    .prepare<[string, string, string], MemberRowST>(
      `SELECT e.id AS employee_id, e.display_name, e.hire_date, e.last4_ssn,
              e.status, e.is_apprentice, e.area_of_expertise, e.classification,
              e.shift_pattern_id, e.crew_position, e.cycle_anchor_date,
              m.area_id AS source_area_id
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
        WHERE m.area_id = ?
          AND m.effective_begin_date <= ?
          AND (m.effective_end_date IS NULL OR m.effective_end_date > ?)`
    )
    .all(area_id, work_date, work_date);
}

// Inter-shop canvass: pull active members of OTHER skilled_trades areas on
// the same shift (so we don't drag a 2nd-shift TM into a 1st-shift posting).
// The matching expertise gets applied in the same filter pass as in-area
// candidates, so we don't pre-filter here.
function activeMembersForInterShopCanvass(
  source_area_id: string,
  work_date: string
): MemberRowST[] {
  const conn = db();
  // Source area shift drives the shift constraint — same shift family across
  // shops. We treat area.shift as the canonical "shift bucket" the contract's
  // equalization unit (shop × shift × expertise) sits in.
  const sourceArea = conn
    .prepare<[string], { shift: string }>(`SELECT shift FROM area WHERE id = ?`)
    .get(source_area_id);
  if (!sourceArea) return [];
  return conn
    .prepare<[string, string, string, string], MemberRowST>(
      `SELECT e.id AS employee_id, e.display_name, e.hire_date, e.last4_ssn,
              e.status, e.is_apprentice, e.area_of_expertise, e.classification,
              e.shift_pattern_id, e.crew_position, e.cycle_anchor_date,
              m.area_id AS source_area_id
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
         JOIN area a     ON a.id = m.area_id
        WHERE a.type = 'skilled_trades'
          AND a.id <> ?
          AND a.shift = ?
          AND m.effective_begin_date <= ?
          AND (m.effective_end_date IS NULL OR m.effective_end_date > ?)`
    )
    .all(source_area_id, sourceArea.shift, work_date, work_date);
}

function hoursOfferedByEmployee(area_id: string): Map<string, number> {
  const conn = db();
  const rows = conn
    .prepare<[string], { employee_id: string; total: number }>(
      `SELECT employee_id, COALESCE(SUM(amount), 0) AS total
         FROM charge
        WHERE area_id = ? AND charge_type = 'hours_offered'
        GROUP BY employee_id`
    )
    .all(area_id);
  return new Map(rows.map((r) => [r.employee_id, r.total]));
}

// Per-employee count of soft quals held (active on work_date) that this
// posting prefers. Used as a sort tiebreaker.
function preferredQualMatchCount(
  employee_id: string,
  preferred_qualification_ids: string[],
  on_date: string
): number {
  if (preferred_qualification_ids.length === 0) return 0;
  const conn = db();
  const placeholders = preferred_qualification_ids.map(() => '?').join(',');
  const row = conn
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) AS c FROM employee_qualification
        WHERE employee_id = ?
          AND qualification_id IN (${placeholders})
          AND granted_date <= ?
          AND (expiration_date IS NULL OR expiration_date >= ?)
          AND revoked_date IS NULL`
    )
    .get(employee_id, ...preferred_qualification_ids, on_date, on_date);
  return row?.c ?? 0;
}

// Apprentice gating predicate: returns true if at least one journeyperson in
// the same expertise group within the same source area has NOT yet been
// offered in the current cycle. When true, apprentices are still gated out.
//
// Per the plan: "exclude is_apprentice=1 from pool UNLESS all journeypersons
// in the expertise group have been offered at least once in the current
// cycle." The check is per-area, per-expertise: a Mechanical apprentice's
// gating is independent of whether every Electrical journeyperson has been
// offered.
function journeypersonsRemainingThisCycle(
  source_area_id: string,
  expertise: string,
  work_date: string
): boolean {
  const conn = db();
  const cycleRow = conn
    .prepare<[string], { current_cycle: number }>(
      `SELECT current_cycle FROM rotation_state WHERE area_id = ?`
    )
    .get(source_area_id);
  const cycle = cycleRow?.current_cycle ?? 1;

  // Count journeypersons in this area + expertise who have NOT been recorded
  // as offered this cycle. If > 0, gating stays on.
  const row = conn
    .prepare<[string, string, string, string, string, number], { c: number }>(
      `SELECT COUNT(*) AS c
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
        WHERE m.area_id = ?
          AND e.area_of_expertise = ?
          AND e.is_apprentice = 0
          AND e.status = 'active'
          AND m.effective_begin_date <= ?
          AND (m.effective_end_date IS NULL OR m.effective_end_date > ?)
          AND NOT EXISTS (
            SELECT 1 FROM cycle_offered co
             WHERE co.area_id = ?
               AND co.cycle_number = ?
               AND co.employee_id = e.id
          )`
    )
    .get(source_area_id, expertise, work_date, work_date, source_area_id, cycle);
  return (row?.c ?? 0) > 0;
}

// Filter a row set down to candidates that satisfy all hard gates, recording
// skips for transparency. Soft-qual scoring + sort happens in the caller.
function filterCandidates(
  rows: MemberRowST[],
  posting: STPosting,
  unlockApprentices: boolean,
  skips: NextEligibleSTResult['skips']
): MemberRowST[] {
  const out: MemberRowST[] = [];

  for (const r of rows) {
    // Status / leave gates first — these mirror production rotation's
    // skip-with-reason behavior.
    if (r.status !== 'active') continue;
    if (isOnApprovedLeave(r.employee_id, posting.work_date)) {
      skips.push({ employee_id: r.employee_id, reason: 'on_leave' });
      continue;
    }

    // Hard qualification gate.
    if (!holdsAllQualifications(r.employee_id, posting.required_qualifications, posting.work_date)) {
      skips.push({ employee_id: r.employee_id, reason: 'passed_over_unqualified' });
      continue;
    }

    // Classification gate: if posting names a specific classification, only
    // employees with that classification are eligible. This takes precedence
    // over expertise — a "PipeFitter needed" posting still excludes
    // Millwrights even though both are Mechanical.
    if (posting.required_classification != null) {
      if (r.classification !== posting.required_classification) {
        skips.push({ employee_id: r.employee_id, reason: 'classification_mismatch' });
        continue;
      }
    } else if (posting.required_expertise != null) {
      // Expertise-only gate when no specific classification is named.
      if (r.area_of_expertise !== posting.required_expertise) {
        skips.push({ employee_id: r.employee_id, reason: 'expertise_mismatch' });
        continue;
      }
    }

    // Apprentice gating. The expertise checked is the apprentice's own
    // expertise group, not the posting's — an apprentice with no area_of_expertise
    // can never satisfy the gate (data integrity issue) so we skip them.
    if (r.is_apprentice === 1 && !unlockApprentices) {
      if (r.area_of_expertise == null) {
        skips.push({ employee_id: r.employee_id, reason: 'apprentice_gated' });
        continue;
      }
      if (journeypersonsRemainingThisCycle(
        r.source_area_id,
        r.area_of_expertise,
        posting.work_date
      )) {
        skips.push({ employee_id: r.employee_id, reason: 'apprentice_gated' });
        continue;
      }
    }

    // Schedule eligibility: the cycle math from Step 2 returns one of four
    // states. Only on_normal_shift and on_rdo_volunteer are eligible; the
    // other two are skipped.
    const elig: EligibilityResult = isOnDutyDateScheduled(
      { shift_pattern_id: r.shift_pattern_id,
        crew_position: r.crew_position,
        cycle_anchor_date: r.cycle_anchor_date },
      posting.work_date,
      posting.start_time
    );
    if (elig === 'shift_conflict') {
      skips.push({ employee_id: r.employee_id, reason: 'shift_conflict' });
      continue;
    }
    if (elig === 'unavailable') continue;

    out.push(r);
  }

  return out;
}

// Sort: lowest hours_offered first, then most preferred-quals matched, then
// highest seniority (oldest hire / lowest last4 — same convention as
// production's tiebreaker per Article V §_.3). The plan calls this "seniority
// descending (final tiebreak)" — interpreted as "most senior first," matching
// production behavior.
function sortCandidates(a: STCandidate, b: STCandidate): number {
  if (a.hours_offered !== b.hours_offered) return a.hours_offered - b.hours_offered;
  if (a.preferred_quals_matched !== b.preferred_quals_matched) {
    return b.preferred_quals_matched - a.preferred_quals_matched;
  }
  if (a.hire_date !== b.hire_date) return a.hire_date < b.hire_date ? -1 : 1;
  return a.last4_ssn < b.last4_ssn ? -1 : 1;
}

// Score a filtered row into a candidate the caller can rank and return.
function scoreCandidate(
  r: MemberRowST,
  posting: STPosting,
  hoursMap: Map<string, number>
): STCandidate {
  // Eligibility was already checked in filterCandidates — re-run only to
  // capture the bucket (on_normal_shift vs on_rdo_volunteer) for the offer.
  // We don't expect 'shift_conflict' here because filter excludes them.
  const elig = isOnDutyDateScheduled(
    { shift_pattern_id: r.shift_pattern_id,
      crew_position: r.crew_position,
      cycle_anchor_date: r.cycle_anchor_date },
    posting.work_date,
    posting.start_time
  );
  const eligibility_at_offer: 'on_normal_shift' | 'on_rdo_volunteer' =
    elig === 'on_rdo_volunteer' ? 'on_rdo_volunteer' : 'on_normal_shift';

  return {
    employee_id: r.employee_id,
    display_name: r.display_name,
    hire_date: r.hire_date,
    last4_ssn: r.last4_ssn,
    status: r.status,
    is_apprentice: r.is_apprentice,
    area_of_expertise: r.area_of_expertise,
    classification: r.classification,
    shift_pattern_id: r.shift_pattern_id,
    crew_position: r.crew_position,
    cycle_anchor_date: r.cycle_anchor_date,
    hours_offered: hoursMap.get(r.employee_id) ?? 0,
    preferred_quals_matched: preferredQualMatchCount(
      r.employee_id,
      posting.preferred_qualifications,
      posting.work_date
    ),
    eligibility_at_offer,
    source_area_id: r.source_area_id
  };
}

export function nextEligibleST(
  posting: STPosting,
  options: NextEligibleSTOptions = {}
): NextEligibleSTResult {
  const skips: NextEligibleSTResult['skips'] = [];
  const unlockApprentices = options.unlockApprentices === true;

  // ---- In-area pool ---------------------------------------------------------
  const inAreaRows = activeMembersForArea(posting.area_id, posting.work_date);
  const inAreaFiltered = filterCandidates(inAreaRows, posting, unlockApprentices, skips);

  if (inAreaFiltered.length > 0) {
    const hoursMap = hoursOfferedByEmployee(posting.area_id);
    const ranked = inAreaFiltered
      .map((r) => scoreCandidate(r, posting, hoursMap))
      .sort(sortCandidates);
    return { candidate: ranked[0], phase: 'normal', skips };
  }

  // ---- Inter-shop canvass (if enabled) -------------------------------------
  const conn = db();
  const areaCfg = conn
    .prepare<[string], { allow_inter_shop_canvass: number }>(
      `SELECT allow_inter_shop_canvass FROM area WHERE id = ?`
    )
    .get(posting.area_id);
  if (!areaCfg || areaCfg.allow_inter_shop_canvass !== 1) {
    return { candidate: null, phase: null, skips };
  }

  const otherRows = activeMembersForInterShopCanvass(posting.area_id, posting.work_date);
  // Skips encountered while traversing other shops are useful for the audit
  // trail too, but we don't conflate them with in-area skips — they go into
  // the same array so the caller can render them under the canvass section.
  const otherFiltered = filterCandidates(otherRows, posting, unlockApprentices, skips);
  if (otherFiltered.length === 0) {
    return { candidate: null, phase: null, skips };
  }

  // Inter-shop hours snapshot: hours_offered in the SOURCE area's equalization
  // unit doesn't apply across shops directly, but for canvass ordering we use
  // each candidate's hours in their OWN area. This keeps lowest-hours-first
  // intent intact across the canvass.
  const ranked = otherFiltered
    .map((r) => {
      const hoursMap = hoursOfferedByEmployee(r.source_area_id);
      return scoreCandidate(r, posting, hoursMap);
    })
    .sort(sortCandidates);

  return { candidate: ranked[0], phase: 'inter_shop_canvass', skips };
}
