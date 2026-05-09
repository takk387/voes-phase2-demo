// Rotation engine. Procedure A (interim mode next-eligible) per plan §9.1
// and Procedure B (final mode next-eligible) per §9.2. Procedure D (cutover)
// is in cutover.ts. Procedure E (mandatory escalation) arrives in Slice 3.

import { db } from './db.js';

export interface MemberRow {
  employee_id: string;
  display_name: string;
  hire_date: string;
  last4_ssn: string;
  status: string;
}

/**
 * Returns the active members of an area, sorted by seniority (oldest hire
 * first; SSN tie-breaker per Article V §_.3). "Active" = membership has not
 * ended on or before work_date.
 */
export function senioritySortedMembers(area_id: string, work_date: string): MemberRow[] {
  const conn = db();
  return conn
    .prepare<[string, string, string], MemberRow>(
      `SELECT e.id AS employee_id, e.display_name, e.hire_date, e.last4_ssn, e.status
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
        WHERE m.area_id = ?
          AND m.effective_begin_date <= ?
          AND (m.effective_end_date IS NULL OR m.effective_end_date > ?)
        ORDER BY e.hire_date ASC, e.last4_ssn ASC`
    )
    .all(area_id, work_date, work_date);
}

export function isOnApprovedLeave(employee_id: string, work_date: string): boolean {
  const conn = db();
  const row = conn
    .prepare<[string, string, string], { c: number }>(
      `SELECT COUNT(*) AS c FROM leave_period
        WHERE employee_id = ?
          AND effective_begin_date <= ?
          AND (effective_end_date IS NULL OR effective_end_date >= ?)`
    )
    .get(employee_id, work_date, work_date);
  return (row?.c ?? 0) > 0;
}

export function holdsAllQualifications(
  employee_id: string,
  qualification_ids: string[],
  on_date: string
): boolean {
  if (qualification_ids.length === 0) return true;
  const conn = db();
  const placeholders = qualification_ids.map(() => '?').join(',');
  const row = conn
    .prepare<unknown[], { c: number }>(
      `SELECT COUNT(*) AS c FROM employee_qualification
        WHERE employee_id = ?
          AND qualification_id IN (${placeholders})
          AND granted_date <= ?
          AND (expiration_date IS NULL OR expiration_date >= ?)
          AND revoked_date IS NULL`
    )
    .get(employee_id, ...qualification_ids, on_date, on_date);
  return (row?.c ?? 0) === qualification_ids.length;
}

export function getCurrentCycle(area_id: string): number {
  const conn = db();
  const row = conn
    .prepare<[string], { current_cycle: number }>(
      `SELECT current_cycle FROM rotation_state WHERE area_id = ?`
    )
    .get(area_id);
  return row?.current_cycle ?? 1;
}

export function membersOfferedInCycle(area_id: string, cycle: number): Set<string> {
  const conn = db();
  const rows = conn
    .prepare<[string, number], { employee_id: string }>(
      `SELECT employee_id FROM cycle_offered
        WHERE area_id = ? AND cycle_number = ?`
    )
    .all(area_id, cycle);
  return new Set(rows.map((r) => r.employee_id));
}

export interface PostingForRotation {
  id: string;
  area_id: string;
  work_date: string;
  required_qualifications: string[];
}

export interface NextEligibleResult {
  candidate: MemberRow | null;
  // Skips encountered while searching (qualification mismatch, on leave) get
  // recorded as no-charge "passed-over" responses so the audit trail reflects
  // why a TM was not offered. The supervisor still confirms each offer; this
  // list lets the runner UI show context for skips that already happened.
  skips: Array<{ employee_id: string; reason: 'passed_over_unqualified' | 'on_leave' }>;
  cycle: number;
  cycleResetTriggered: boolean;
}

/**
 * Procedure A — determine next eligible TM in interim mode.
 *
 * Returns the next candidate the system would offer the posting to, plus any
 * automatic skips it encountered (qualification, leave). The caller is
 * responsible for actually creating the offer once the supervisor confirms;
 * skips are also expected to be recorded by the caller (we don't write to the
 * DB here so this function is safe to call repeatedly for "preview").
 */
export function nextEligibleInterim(posting: PostingForRotation): NextEligibleResult {
  const members = senioritySortedMembers(posting.area_id, posting.work_date);
  let cycle = getCurrentCycle(posting.area_id);
  let offered = membersOfferedInCycle(posting.area_id, cycle);
  let cycleResetTriggered = false;

  const skips: NextEligibleResult['skips'] = [];

  // Two passes: in case the cycle is fully consumed by previously-offered
  // members, we increment to the next cycle and try once more.
  for (let pass = 0; pass < 2; pass++) {
    for (const m of members) {
      if (offered.has(m.employee_id)) continue;

      if (!holdsAllQualifications(
            m.employee_id, posting.required_qualifications, posting.work_date)) {
        skips.push({ employee_id: m.employee_id, reason: 'passed_over_unqualified' });
        continue;
      }

      if (isOnApprovedLeave(m.employee_id, posting.work_date)) {
        skips.push({ employee_id: m.employee_id, reason: 'on_leave' });
        continue;
      }

      if (m.status !== 'active') {
        // separated or otherwise not active — exclude silently
        continue;
      }

      return { candidate: m, skips, cycle, cycleResetTriggered };
    }

    // No candidate found in this cycle. If we've already retried, give up.
    if (pass === 1) break;

    // Cycle complete — reset.
    cycle = cycle + 1;
    offered = new Set();
    cycleResetTriggered = true;
  }

  return { candidate: null, skips, cycle, cycleResetTriggered };
}

/**
 * Procedure B — determine next eligible TM in final (hours-based) mode (§9.2).
 *
 * Sort eligible by hours_offered ASC, then seniority (hire_date ASC, last4 ASC).
 * Return the lowest-hours eligible candidate.
 *
 * Special-case: while an area is within its first cycle after a mode cutover,
 * offers go in seniority order regardless of hours (§9.4 STEP 5 / §9.9).
 * This is conveyed via the `firstCycleAfterCutover` flag and a separate
 * `firstCycleOffered` set tracked by the cutover bookkeeping.
 */
export interface FinalModeContext {
  firstCycleAfterCutover: boolean;
  firstCycleOffered: Set<string>;
}

export function nextEligibleFinal(
  posting: PostingForRotation,
  ctx: FinalModeContext
): NextEligibleResult {
  const conn = db();
  const members = senioritySortedMembers(posting.area_id, posting.work_date);
  const skips: NextEligibleResult['skips'] = [];

  // Compute current hours_offered per active member.
  const hoursRows = conn
    .prepare<[string], { employee_id: string; total: number }>(
      `SELECT employee_id, COALESCE(SUM(amount), 0) AS total
         FROM charge
        WHERE area_id = ? AND charge_type = 'hours_offered'
        GROUP BY employee_id`
    )
    .all(posting.area_id);
  const hoursMap = new Map<string, number>(hoursRows.map((r) => [r.employee_id, r.total]));

  type Candidate = {
    employee_id: string;
    display_name: string;
    hire_date: string;
    last4_ssn: string;
    status: string;
    hours_offered: number;
  };

  const eligible: Candidate[] = [];

  for (const m of members) {
    if (!holdsAllQualifications(m.employee_id, posting.required_qualifications, posting.work_date)) {
      skips.push({ employee_id: m.employee_id, reason: 'passed_over_unqualified' });
      continue;
    }
    if (isOnApprovedLeave(m.employee_id, posting.work_date)) {
      skips.push({ employee_id: m.employee_id, reason: 'on_leave' });
      continue;
    }
    if (m.status !== 'active') continue;

    eligible.push({
      employee_id: m.employee_id,
      display_name: m.display_name,
      hire_date: m.hire_date,
      last4_ssn: m.last4_ssn,
      status: m.status,
      hours_offered: hoursMap.get(m.employee_id) ?? 0
    });
  }

  if (eligible.length === 0) {
    return { candidate: null, skips, cycle: 1, cycleResetTriggered: false };
  }

  if (ctx.firstCycleAfterCutover) {
    // Override: seniority order, skipping anyone already offered in the first
    // cycle. (Members are already in seniority order from senioritySortedMembers.)
    for (const m of eligible) {
      if (!ctx.firstCycleOffered.has(m.employee_id)) {
        return {
          candidate: { employee_id: m.employee_id, display_name: m.display_name, hire_date: m.hire_date, last4_ssn: m.last4_ssn, status: m.status },
          skips,
          cycle: 1,
          cycleResetTriggered: false
        };
      }
    }
    return { candidate: null, skips, cycle: 1, cycleResetTriggered: false };
  }

  // Normal final-mode selection: lowest hours offered, seniority tie-break.
  eligible.sort((a, b) => {
    if (a.hours_offered !== b.hours_offered) return a.hours_offered - b.hours_offered;
    if (a.hire_date !== b.hire_date) return a.hire_date < b.hire_date ? -1 : 1;
    return a.last4_ssn < b.last4_ssn ? -1 : 1;
  });

  const winner = eligible[0];
  return {
    candidate: {
      employee_id: winner.employee_id,
      display_name: winner.display_name,
      hire_date: winner.hire_date,
      last4_ssn: winner.last4_ssn,
      status: winner.status
    },
    skips,
    cycle: 1,
    cycleResetTriggered: false
  };
}

/**
 * Persist the cycle reset that nextEligibleInterim previewed. Called when the
 * supervisor confirms an offer that crosses the cycle boundary.
 */
export function commitCycleReset(area_id: string, new_cycle: number) {
  const conn = db();
  conn
    .prepare(
      `UPDATE rotation_state SET current_cycle = ?, cycle_started_at = ?
        WHERE area_id = ?`
    )
    .run(new_cycle, new Date().toISOString(), area_id);
}

/**
 * Record that an employee has been offered (and consumed a cycle position) in
 * the given cycle. Called when the supervisor confirms a Yes/No response —
 * not for no-charge skips.
 */
export function markCycleOffered(area_id: string, cycle: number, employee_id: string) {
  const conn = db();
  conn
    .prepare(
      `INSERT OR IGNORE INTO cycle_offered (area_id, cycle_number, employee_id)
       VALUES (?, ?, ?)`
    )
    .run(area_id, cycle, employee_id);
}

// ---------------------------------------------------------------------------
// Helpers used by views to render area standing
// ---------------------------------------------------------------------------

export interface AreaStandingRow {
  employee_id: string;
  display_name: string;
  hire_date: string;
  rotation_position: number;          // seniority position (1-based)
  // Interim-mode counts (opportunity-based)
  cycle_charges: number;
  lifetime_charges: number;
  // Final-mode counts (hours-based)
  hours_offered: number;
  hours_accepted: number;
  hours_worked: number;
  qualifications: string[];
  status: string;
  on_leave: boolean;
}

export function areaStanding(area_id: string, on_date: string): AreaStandingRow[] {
  const conn = db();
  const members = senioritySortedMembers(area_id, on_date);
  const cycle = getCurrentCycle(area_id);

  const cycleCharges = conn
    .prepare<[string, number], { employee_id: string; n: number }>(
      `SELECT employee_id, COUNT(*) AS n FROM charge
        WHERE area_id = ? AND charge_type = 'opportunity' AND cycle_number = ?
        GROUP BY employee_id`
    )
    .all(area_id, cycle);
  const cycleMap = new Map(cycleCharges.map((r) => [r.employee_id, r.n]));

  const lifetimeCharges = conn
    .prepare<[string], { employee_id: string; n: number }>(
      `SELECT employee_id, COUNT(*) AS n FROM charge
        WHERE area_id = ? AND charge_type = 'opportunity'
        GROUP BY employee_id`
    )
    .all(area_id);
  const lifetimeMap = new Map(lifetimeCharges.map((r) => [r.employee_id, r.n]));

  // Hours sums (final mode). Charges may include reversal rows (negative
  // amount) per §22.5; SUM handles those naturally.
  const hoursRows = conn
    .prepare<[string], { employee_id: string; charge_type: string; total: number }>(
      `SELECT employee_id, charge_type, COALESCE(SUM(amount), 0) AS total
         FROM charge
        WHERE area_id = ? AND charge_type IN ('hours_offered','hours_accepted','hours_worked')
        GROUP BY employee_id, charge_type`
    )
    .all(area_id);
  const hoursMap = new Map<string, { offered: number; accepted: number; worked: number }>();
  for (const r of hoursRows) {
    if (!hoursMap.has(r.employee_id)) {
      hoursMap.set(r.employee_id, { offered: 0, accepted: 0, worked: 0 });
    }
    const slot = hoursMap.get(r.employee_id)!;
    if (r.charge_type === 'hours_offered') slot.offered = r.total;
    else if (r.charge_type === 'hours_accepted') slot.accepted = r.total;
    else if (r.charge_type === 'hours_worked') slot.worked = r.total;
  }

  const qualRows = conn
    .prepare<[], { employee_id: string; qual_id: string; qual_name: string }>(
      `SELECT eq.employee_id, q.id AS qual_id, q.name AS qual_name
         FROM employee_qualification eq
         JOIN qualification q ON q.id = eq.qualification_id
        WHERE eq.revoked_date IS NULL`
    )
    .all();
  const qualMap = new Map<string, string[]>();
  for (const r of qualRows) {
    if (!qualMap.has(r.employee_id)) qualMap.set(r.employee_id, []);
    qualMap.get(r.employee_id)!.push(r.qual_name);
  }

  return members.map((m, i) => {
    const h = hoursMap.get(m.employee_id) ?? { offered: 0, accepted: 0, worked: 0 };
    return {
      employee_id: m.employee_id,
      display_name: m.display_name,
      hire_date: m.hire_date,
      rotation_position: i + 1,
      cycle_charges: cycleMap.get(m.employee_id) ?? 0,
      lifetime_charges: lifetimeMap.get(m.employee_id) ?? 0,
      hours_offered: h.offered,
      hours_accepted: h.accepted,
      hours_worked: h.worked,
      qualifications: qualMap.get(m.employee_id) ?? [],
      status: m.status,
      on_leave: isOnApprovedLeave(m.employee_id, on_date)
    };
  });
}
