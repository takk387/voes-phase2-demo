// SKT-04A shift-pattern definitions.
//
// Transcribed pixel-for-pixel from the 2026 UAW-VW CBA, internal pages
// 212-214 (PDF pages 215-217). Verification path:
//   1. `npm run preview-patterns` — render every pattern as an ASCII grid
//      to stdout
//   2. Compare side-by-side with `cba_pages/page_215.png` through
//      `page_217.png` (or the live PDF)
//
// Conventions:
//   - calendar[crew_idx][day_in_cycle] -> 'D' | 'N' | 'A' | 'RDO'
//   - day_in_cycle 0 = Monday of week 1 of the pattern
//   - For multi-crew patterns crew_idx 0 = Crew 1, etc.
//   - For single-crew patterns crew_idx is always 0
//
// Where the contract diverges from the plan stub (Step 2 spec), the
// divergence is flagged inline with `// PLAN-DEVIATION:`.

import type Database from 'better-sqlite3';
import type { ShiftDesignation } from './schedule_eligibility.js';

export interface ShiftPatternDef {
  name: string;
  cycle_length_days: number;
  crew_count: number;
  calendar: ShiftDesignation[][];
  description: string;
}

// ---------------------------------------------------------------------------
// Pattern 1: fixed_day — 7-day, 1 crew (Mon-Fri days, weekend off)
// Used by Body Shop ST 1st + Paint Shop ST 1st areas in the Step 5 seed.
// ---------------------------------------------------------------------------
const FIXED_DAY: ShiftPatternDef = {
  name: 'fixed_day',
  cycle_length_days: 7,
  crew_count: 1,
  calendar: [['D', 'D', 'D', 'D', 'D', 'RDO', 'RDO']],
  description: 'Mon-Fri day shift (1st), weekends off.'
};

// ---------------------------------------------------------------------------
// Pattern 2: fixed_evening — 7-day, 1 crew (Mon-Fri afternoon, weekend off)
// SKT-04A treats afternoon as a distinct designation from night.
// ---------------------------------------------------------------------------
const FIXED_EVENING: ShiftPatternDef = {
  name: 'fixed_evening',
  cycle_length_days: 7,
  crew_count: 1,
  calendar: [['A', 'A', 'A', 'A', 'A', 'RDO', 'RDO']],
  description: 'Mon-Fri afternoon shift (2nd), weekends off.'
};

// ---------------------------------------------------------------------------
// Pattern 3: fixed_night — 7-day, 1 crew (Mon-Fri nights, weekend off)
// ---------------------------------------------------------------------------
const FIXED_NIGHT: ShiftPatternDef = {
  name: 'fixed_night',
  cycle_length_days: 7,
  crew_count: 1,
  calendar: [['N', 'N', 'N', 'N', 'N', 'RDO', 'RDO']],
  description: 'Mon-Fri night shift (3rd), weekends off.'
};

// ---------------------------------------------------------------------------
// Pattern 4: 1_crew_weekend — 14-day, 1 crew, "Working Every Other Monday"
//
// Contract reference: SKT-04A internal p.212 (PDF p.215), heading
// "1 Crew 1 Shift Weekend Schedule Working Every Other Monday 80 Hours".
//
// PLAN-DEVIATION: the Step 2 stub had cycle_length_days=7 with a single
// week's Sat+Sun pattern. The contract is a BI-WEEKLY (14-day) cycle —
// Week 1 is 4 work days (46 hrs), Week 2 is 3 work days (34 hrs), totaling
// 80 hrs / 2 weeks. The plan was written without the contract pages
// available; this transcription supersedes it.
//
// Week 1: Mon 10h D, Tue/Wed/Thu RDO, Fri 12h D, Sat 12h D, Sun 12h D
// Week 2: Mon-Thu RDO, Fri 10h D, Sat 12h D, Sun 12h D
// ---------------------------------------------------------------------------
const ONE_CREW_WEEKEND: ShiftPatternDef = {
  name: '1_crew_weekend',
  cycle_length_days: 14,
  crew_count: 1,
  calendar: [
    [
      // Week 1: Mon D, Tue-Thu RDO, Fri-Sun D
      'D', 'RDO', 'RDO', 'RDO', 'D', 'D', 'D',
      // Week 2: Mon-Thu RDO, Fri-Sun D
      'RDO', 'RDO', 'RDO', 'RDO', 'D', 'D', 'D'
    ]
  ],
  description:
    '1 Crew 1 Shift Weekend Schedule — bi-weekly 80h total. Week 1: Mon + Fri-Sun. ' +
    'Week 2: Fri-Sun. SKT-04A p.212.'
};

// ---------------------------------------------------------------------------
// Pattern 5: 2_crew_fixed_d_n — 7-day, 2 crews
//
// Contract reference: SKT-04A internal p.212 (PDF p.215), heading
// "Two Crew / 2 Shifts 8 Hours Fixed Days/Night, 5 Days 40 Hours".
//
// PLAN-DEVIATION: the Step 2 stub had Crew 2 as N N N N N RDO RDO. The
// contract shows Crew 2 with an offset RDO block (Fri+Sat off, Sun night
// on). The contract's pattern reflects how night-shift work weeks
// typically start Sunday evening — Sun N covers into Mon morning. Both
// crews still total 40 hrs/wk.
//
// Crew 1: Mon-Fri D, Sat-Sun RDO
// Crew 2: Mon-Thu N, Fri-Sat RDO, Sun N
// ---------------------------------------------------------------------------
const TWO_CREW_FIXED_D_N: ShiftPatternDef = {
  name: '2_crew_fixed_d_n',
  cycle_length_days: 7,
  crew_count: 2,
  calendar: [
    // Crew 1 (Day)
    ['D', 'D', 'D', 'D', 'D', 'RDO', 'RDO'],
    // Crew 2 (Night, offset)
    ['N', 'N', 'N', 'N', 'RDO', 'RDO', 'N']
  ],
  description:
    'Two Crew / 2 Shifts 8 Hours Fixed Days/Night. Crew 1: Mon-Fri D. ' +
    'Crew 2: Mon-Thu N, Sun N (Sun N starts the next work week). SKT-04A p.212.'
};

// ---------------------------------------------------------------------------
// Pattern 6: 2_crew_fixed_d_afternoon — 7-day, 2 crews
//
// Contract reference: SKT-04A internal p.212-213 (PDF p.215-216 boundary),
// heading "Two Crews Two Shifts Fixed Days/Afternoons, 5 Days 40 Hours".
//
// Crew 1: Mon-Fri D, weekend RDO
// Crew 2: Mon-Fri A, weekend RDO
// (Both crews symmetric, both off Sat-Sun.)
// ---------------------------------------------------------------------------
const TWO_CREW_FIXED_D_AFTERNOON: ShiftPatternDef = {
  name: '2_crew_fixed_d_afternoon',
  cycle_length_days: 7,
  crew_count: 2,
  calendar: [
    ['D', 'D', 'D', 'D', 'D', 'RDO', 'RDO'],
    ['A', 'A', 'A', 'A', 'A', 'RDO', 'RDO']
  ],
  description:
    'Two Crews Two Shifts Fixed Days/Afternoons. Crew 1: Mon-Fri D. ' +
    'Crew 2: Mon-Fri A. SKT-04A p.213.'
};

// ---------------------------------------------------------------------------
// Pattern 7: 4_crew_12h_rotating — 28-day, 4 crews
//
// Contract reference: SKT-04A internal p.213 (PDF p.216), heading
// "Two Shift/Four Crew-12 Hour Rotating Schedule, Model Repeats Every
// 4 Weeks / All shifts are 12 Hours".
//
// Color coding on the contract page maps to crews:
//   Crew 1 = BLUE highlight
//   Crew 2 = RED highlight
//   Crew 3 = GRAY highlight
//   Crew 4 = WHITE (no highlight)
//
// NOTE: Crew 4 is asymmetric — it works 4 D + 10 N shifts over 28 days
// vs other crews' 7 D + 7 N. Total hours still match (14 shifts × 12 h =
// 168 h / 4 weeks = 42 h/wk avg). This is the contract design, not a
// transcription error; verified via the colored highlight column on the
// page-216 grid.
//
// On some Fri-Sun spans the day shift has no crew assigned (both row 1
// and row 2 of the cell show N — two night crews stacked). This is
// faithfully captured: getDesignation returns 'RDO' for any crew not
// assigned 'D' or 'N' on that day.
// ---------------------------------------------------------------------------
const FOUR_CREW_12H_ROTATING: ShiftPatternDef = {
  name: '4_crew_12h_rotating',
  cycle_length_days: 28,
  crew_count: 4,
  calendar: [
    // Crew 1 (BLUE): 7 D + 7 N over 28 days
    [
      // Week 1: D Mon-Thu, RDO Fri-Sun
      'D', 'D', 'D', 'D', 'RDO', 'RDO', 'RDO',
      // Week 2: RDO Mon-Thu, N Fri-Sun
      'RDO', 'RDO', 'RDO', 'RDO', 'N', 'N', 'N',
      // Week 3: N Mon, RDO Tue-Thu, D Fri-Sun
      'N', 'RDO', 'RDO', 'RDO', 'D', 'D', 'D',
      // Week 4: RDO Mon, N Tue-Thu, RDO Fri-Sun
      'RDO', 'N', 'N', 'N', 'RDO', 'RDO', 'RDO'
    ],
    // Crew 2 (RED): 7 D + 7 N over 28 days
    [
      // Week 1: N Mon, RDO Tue-Thu, D Fri-Sun
      'N', 'RDO', 'RDO', 'RDO', 'D', 'D', 'D',
      // Week 2: RDO Mon, N Tue-Thu, RDO Fri-Sun
      'RDO', 'N', 'N', 'N', 'RDO', 'RDO', 'RDO',
      // Week 3: D Mon-Thu, RDO Fri-Sun
      'D', 'D', 'D', 'D', 'RDO', 'RDO', 'RDO',
      // Week 4: RDO Mon-Thu, N Fri-Sun
      'RDO', 'RDO', 'RDO', 'RDO', 'N', 'N', 'N'
    ],
    // Crew 3 (GRAY): 7 D + 7 N over 28 days
    [
      // Week 1: RDO Mon, N Tue-Thu, RDO Fri-Sun
      'RDO', 'N', 'N', 'N', 'RDO', 'RDO', 'RDO',
      // Week 2: D Mon-Thu, RDO Fri-Sun
      'D', 'D', 'D', 'D', 'RDO', 'RDO', 'RDO',
      // Week 3: RDO Mon-Thu, N Fri-Sun
      'RDO', 'RDO', 'RDO', 'RDO', 'N', 'N', 'N',
      // Week 4: N Mon, RDO Tue-Thu, D Fri-Sun
      'N', 'RDO', 'RDO', 'RDO', 'D', 'D', 'D'
    ],
    // Crew 4 (WHITE/no highlight): 4 D + 10 N over 28 days (asymmetric per
    // contract — predominantly nights, with a single 4-day D block in week 4)
    [
      // Week 1: RDO Mon-Thu, N Fri-Sun
      'RDO', 'RDO', 'RDO', 'RDO', 'N', 'N', 'N',
      // Week 2: N Mon, RDO Tue-Thu, N Fri-Sun
      'N', 'RDO', 'RDO', 'RDO', 'N', 'N', 'N',
      // Week 3: RDO Mon, N Tue-Thu, RDO Fri-Sun
      'RDO', 'N', 'N', 'N', 'RDO', 'RDO', 'RDO',
      // Week 4: D Mon-Thu, RDO Fri-Sun
      'D', 'D', 'D', 'D', 'RDO', 'RDO', 'RDO'
    ]
  ],
  description:
    'Two Shift/Four Crew 12-Hour Rotating Schedule. Model repeats every 4 weeks. ' +
    'Crew 4 is asymmetric (predominantly nights) per contract. SKT-04A p.213.'
};

// ---------------------------------------------------------------------------
// Pattern 8: 4_crew_12h_fixed — 14-day, 4 crews
//
// Contract reference: SKT-04A internal p.214 (PDF p.217), heading
// "Two Shift/Four Crew-12 Hour Fixed Schedule, Model Repeats every Two
// Weeks / All Shifts are 12 Hours".
//
// Fixed (non-rotating): Crews 1 and 3 always N, Crews 2 and 4 always D.
// Pair structure:
//   Crew 1 (N) and Crew 2 (D) share the same work days
//   Crew 3 (N) and Crew 4 (D) share the same work days
//   Week 1: Pair 1+2 work Tue/Wed/Sat/Sun. Pair 3+4 work Mon/Thu/Fri.
//   Week 2: swap.
//
// Each crew works exactly 7 × 12h = 84h / 2 weeks = 42 h/wk avg.
// ---------------------------------------------------------------------------
const FOUR_CREW_12H_FIXED: ShiftPatternDef = {
  name: '4_crew_12h_fixed',
  cycle_length_days: 14,
  crew_count: 4,
  calendar: [
    // Crew 1 (BLUE, always N)
    [
      // Week 1: RDO Mon, N Tue-Wed, RDO Thu-Fri, N Sat-Sun
      'RDO', 'N', 'N', 'RDO', 'RDO', 'N', 'N',
      // Week 2: N Mon, RDO Tue-Wed, N Thu-Fri, RDO Sat-Sun
      'N', 'RDO', 'RDO', 'N', 'N', 'RDO', 'RDO'
    ],
    // Crew 2 (RED, always D) — same days as Crew 1, opposite shift
    [
      'RDO', 'D', 'D', 'RDO', 'RDO', 'D', 'D',
      'D', 'RDO', 'RDO', 'D', 'D', 'RDO', 'RDO'
    ],
    // Crew 3 (GRAY, always N)
    [
      // Week 1: N Mon, RDO Tue-Wed, N Thu-Fri, RDO Sat-Sun
      'N', 'RDO', 'RDO', 'N', 'N', 'RDO', 'RDO',
      // Week 2: RDO Mon, N Tue-Wed, RDO Thu-Fri, N Sat-Sun
      'RDO', 'N', 'N', 'RDO', 'RDO', 'N', 'N'
    ],
    // Crew 4 (WHITE, always D) — same days as Crew 3, opposite shift
    [
      'D', 'RDO', 'RDO', 'D', 'D', 'RDO', 'RDO',
      'RDO', 'D', 'D', 'RDO', 'RDO', 'D', 'D'
    ]
  ],
  description:
    'Two Shift/Four Crew 12-Hour Fixed Schedule. Model repeats every 2 weeks. ' +
    'Crews 1+3 fixed N, Crews 2+4 fixed D. SKT-04A p.214.'
};

export const ALL_SHIFT_PATTERNS: readonly ShiftPatternDef[] = [
  FIXED_DAY,
  FIXED_EVENING,
  FIXED_NIGHT,
  ONE_CREW_WEEKEND,
  TWO_CREW_FIXED_D_N,
  TWO_CREW_FIXED_D_AFTERNOON,
  FOUR_CREW_12H_ROTATING,
  FOUR_CREW_12H_FIXED
];

// Populates the shift_pattern table from ALL_SHIFT_PATTERNS. Idempotent:
// patterns are keyed by `name UNIQUE`, so re-running is a no-op for any
// pattern already present. Returns the rows inserted (skipping existing).
export function seedShiftPatterns(conn: Database.Database): number {
  const insert = conn.prepare(
    `INSERT OR IGNORE INTO shift_pattern (name, cycle_length_days, crew_count, calendar_json, description)
     VALUES (?, ?, ?, ?, ?)`
  );
  let inserted = 0;
  for (const p of ALL_SHIFT_PATTERNS) {
    // Sanity check at seed time: each crew's calendar row must equal
    // cycle_length_days. A miscounted array would silently break the
    // modulo lookup. Catch it loud here.
    if (p.calendar.length !== p.crew_count) {
      throw new Error(
        `shift_pattern '${p.name}': calendar has ${p.calendar.length} crews, expected ${p.crew_count}`
      );
    }
    for (let i = 0; i < p.calendar.length; i++) {
      if (p.calendar[i].length !== p.cycle_length_days) {
        throw new Error(
          `shift_pattern '${p.name}' crew ${i + 1}: calendar has ${p.calendar[i].length} days, ` +
            `expected ${p.cycle_length_days}`
        );
      }
    }
    const result = insert.run(
      p.name,
      p.cycle_length_days,
      p.crew_count,
      JSON.stringify(p.calendar),
      p.description
    );
    if (result.changes > 0) inserted++;
  }
  return inserted;
}
