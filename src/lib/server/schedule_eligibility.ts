// Cycle-math + schedule-eligibility helpers for Skilled Trades areas.
//
// SKT-04A defines shift patterns as repeating calendars (7, 14, or 28
// days). Each ST employee is assigned a shift_pattern_id, crew_position
// (1..4, or NULL for single-crew patterns), and cycle_anchor_date —
// together they project to a designation (D / N / A / RDO) for any
// work date via simple modular arithmetic.
//
// Production employees do NOT have a shift_pattern_id. Production uses
// the legacy employee.shift field (1st / 2nd / 3rd) and the rotation
// engine treats them as always-available for postings in their shift.
// getDesignation() returns null in that case so the caller can branch.
//
// "Today" comes from demo_clock.DEMO_TODAY, not new Date(). This keeps
// seeded narrative scenarios stable across demo viewings; Phase 3 swaps
// in real `new Date()` (or HRIS-fed schedule data).

import { db } from './db.js';

export type ShiftDesignation = 'D' | 'N' | 'A' | 'RDO';

export type EligibilityResult =
  | 'on_normal_shift'   // schedule says the employee is working a compatible shift
  | 'on_rdo_volunteer'  // on RDO — they can volunteer (triggers no-show penalty if they accept and no-show)
  | 'shift_conflict'    // working a different shift slot — not eligible
  | 'unavailable';      // covers leave, separation, etc — set by caller, not by this helper

export interface ShiftPatternRow {
  id: number;
  name: string;
  cycle_length_days: number;
  crew_count: number;
  calendar_json: string;
  description: string | null;
}

export interface EmployeeScheduleFields {
  shift_pattern_id: number | null;
  crew_position: number | null;
  cycle_anchor_date: string | null;
  shift?: string;
}

// In-memory cache: shift_pattern rows are immutable post-seed and read
// many times per rotation cycle. Caching avoids hitting the DB for every
// candidate eligibility check. The cache is keyed by id; the calendar
// JSON is parsed once on cache fill.
type ParsedPattern = ShiftPatternRow & { calendar: ShiftDesignation[][] };
let _patternCache: Map<number, ParsedPattern> | null = null;

function loadPatternCache(): Map<number, ParsedPattern> {
  if (_patternCache) return _patternCache;
  const rows = db()
    .prepare(
      `SELECT id, name, cycle_length_days, crew_count, calendar_json, description
       FROM shift_pattern`
    )
    .all() as ShiftPatternRow[];
  const cache = new Map<number, ParsedPattern>();
  for (const r of rows) {
    cache.set(r.id, { ...r, calendar: JSON.parse(r.calendar_json) as ShiftDesignation[][] });
  }
  _patternCache = cache;
  return cache;
}

// Test hook: lets tests reset the cache between scenarios so they
// can reseed shift_pattern without process restart.
export function _resetPatternCacheForTests() {
  _patternCache = null;
}

export function lookupPattern(id: number): ParsedPattern | undefined {
  return loadPatternCache().get(id);
}

// Day-difference in whole UTC days between two ISO-date strings (YYYY-MM-DD).
// We anchor both dates at UTC midnight so daylight-saving doesn't shift the
// result. Returns can be negative when target < anchor (history reconstruction
// for grievance — Step 6 "Last 4 weeks" view uses this).
function daysBetween(anchorIso: string, targetIso: string): number {
  const anchor = new Date(anchorIso + 'T00:00:00Z');
  const target = new Date(targetIso + 'T00:00:00Z');
  return Math.floor((target.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000));
}

// Positive modulo. JS's `%` returns negative for negative operands; we always
// want a result in [0, n). Used so history-direction lookups (negative
// dayDelta) wrap correctly into the cycle.
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

// Returns the employee's shift designation on the given work date, or null
// for employees with no shift_pattern_id (production employees and any ST
// employee missing the schedule fields — caller should treat null as "use
// legacy shift logic" or "data integrity error").
export function getDesignation(
  employee: EmployeeScheduleFields,
  work_date: string
): ShiftDesignation | null {
  if (employee.shift_pattern_id == null) return null;

  const pattern = lookupPattern(employee.shift_pattern_id);
  if (!pattern) return null;
  if (employee.cycle_anchor_date == null) return null;

  const dayDelta = daysBetween(employee.cycle_anchor_date, work_date);
  const dayInCycle = mod(dayDelta, pattern.cycle_length_days);

  // Single-crew patterns (fixed_day, fixed_night, fixed_evening,
  // 1_crew_weekend) ignore crew_position. Multi-crew patterns
  // require a valid crew_position in [1, crew_count].
  let crewIdx = 0;
  if (pattern.crew_count > 1) {
    if (employee.crew_position == null) return null;
    if (employee.crew_position < 1 || employee.crew_position > pattern.crew_count) {
      return null;
    }
    crewIdx = employee.crew_position - 1;
  }

  const designation = pattern.calendar[crewIdx]?.[dayInCycle];
  if (designation == null) return null;
  return designation;
}

// Classifies a posting offer for an ST employee against their schedule.
// The posting's start_time (HH:MM 24h) drives the shift-compatibility check
// for day vs night vs afternoon slots. The mapping is intentionally simple
// for the demo:
//   - 05:00 .. 13:59  → posting is a Day slot
//   - 13:00 .. 21:59  → posting is an Afternoon slot
//   - all other times → posting is a Night slot
// Real plants would source the slot type from the supervisor configuring
// the posting; Step 3 may revisit this if walkthrough fidelity demands it.
export function isOnDutyDateScheduled(
  employee: EmployeeScheduleFields,
  work_date: string,
  start_time: string
): EligibilityResult {
  const designation = getDesignation(employee, work_date);

  // Production employees (no shift_pattern_id) — treat as on_normal_shift
  // by default. The rotation engine handles production via the legacy
  // shift field, not this helper.
  if (designation === null) return 'on_normal_shift';

  if (designation === 'RDO') return 'on_rdo_volunteer';

  // designation ∈ {'D','N','A'} — check shift compatibility
  const postingSlot = classifyPostingSlot(start_time);
  return postingSlot === designation ? 'on_normal_shift' : 'shift_conflict';
}

function classifyPostingSlot(start_time: string): ShiftDesignation {
  // Expecting "HH:MM" — defensive parse, fall back to N (most conservative,
  // most likely to surface a conflict if data is malformed).
  const m = /^(\d{2}):(\d{2})$/.exec(start_time);
  if (!m) return 'N';
  const hours = Number(m[1]);
  // Day: 05:00 .. 12:59. Afternoon: 13:00 .. 21:59. Night: 22:00 .. 04:59.
  // The Afternoon window is wider than D because ST trades often work
  // 4pm-midnight maintenance shifts in this plant.
  if (hours >= 5 && hours < 13) return 'D';
  if (hours >= 13 && hours < 22) return 'A';
  return 'N';
}
