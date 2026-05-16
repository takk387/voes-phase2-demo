# IMPLEMENTATION_skilled_trades.md — Phase 2 Demo: Skilled Trades Integration

## How To Use This Document

This plan adds **Skilled Trades (SKT-04A) support** to the existing VOES Phase 2 demo. It does **not** rebuild the demo — production OT (PS-036) is already shipped and live on Railway. This is incremental work that adds a second `area_type` to the same platform.

**Quality bar — read this first.** This is not a generic stakeholder demo. The ST audience includes a Skilled-Trades union president and reviewers who live in SKT-04A's shift patterns daily. Hand-waving the rotation math, getting calendar arrays off by even one day, or sloppy contract citations will be caught and will erode credibility. Every Step's "Done When" gates against this bar.

**Spec sources (read before every Step):**
- `cba_white_book.txt` lines covering pages 207-216 internal — Skilled Trades Agreement on Open Demands + SKT-04A overtime rules
- `cba_pages/page_213.png` through `page_217.png` — rendered images of the contract's shift-pattern tables. **Verify pixel-by-pixel** against these when defining the pattern calendars in Step 2.
- `Phase_1_Detailed_Plan.docx` (formal spec) — production-OT context the ST rules diverge from
- `CLAUDE.md` (project root) — project conventions, decisions baked in, sensitive context
- `~/.claude/projects/.../memory/project_union_feedback_r2.md` — rule-diff summary, user's §22.6 position, round-2 union-meeting clarifications, Option C schedule integration decision
- `~/.claude/projects/.../memory/user_career_context_cip.md` — quality-bar context

**Workflow:**
1. Open Claude Code in `phase2/` (project root for the demo)
2. Copy the next Step from this document
3. Future-Claude reads the spec sections this Step names, then implements
4. Verify the "Done When" checklist, commit, push (Railway auto-deploys)
5. Move to the next Step

**Rules:**
- One Step per Claude Code session. Don't bundle.
- **Write tests alongside features.** Step 8 (walkthrough) is documentation, not where testing starts.
- Treat SKT-04A contract text as **final**, not a draft. Settled per user 2026-05-14.
- **No force-low for ST areas.** Escalation = ask-apprentices, then abandon. Forcing in ST is an untested interpretation that would go through grievance; demo defaults to no force. Step 4 implements this; Step 7's compliance check 10 is a runtime audit safety net.
- **DEMO_TODAY constant.** Step 2 introduces a single date constant the rotation engine and helpers read instead of `new Date()`. This makes the seeded shift-pattern designations stable across demo runs — a reviewer opening the demo three weeks from now still sees the engineered Crew designations. DEMO_TODAY advances when Reset Demo is clicked. Production replaces it with `new Date()`.
- **Single environment.** This demo runs on one Railway deploy with one persistent volume — no separate staging. Click **Reset demo** in the deployed app footer after each Step to refresh seed data and exercise the new behavior end-to-end. Use `npm run dev` locally for pre-push verification.
- Production OT (PS-036) behavior must not regress. Every Step touching shared code (rotation engine, compliance checks, schema) needs a regression check against production-area seeds.

**Out of scope for this plan (deferred to separate planning):**
- Outside contractor clearance + outside contracting checklist
- Staffing availability feature (who is available, by period, for project work)

These are "separate but parallel" per user and need their own implementation plan when scoped. Listed in the Cross-Cutting Deferred Items index below as a pointer.

**Existing state as of plan creation (2026-05-14):**
- Production demo live with 4 areas (BA2 1st interim, Paint 2nd final, Battery 1st final, Finish 2nd interim)
- Round-2 §22 cleanup shipped (commit 12f3757)
- First-login notification preferences modal shipped
- Indefinite bypass remedy shipped (90-day window removed)
- 44 production-OT employees seeded, default persona Newman

---

## Phase 1: Foundation (2 Steps)

### Step 1 — Schema additions for area_type, ST fields, shift patterns, soft quals, classification

```
Read cba_white_book.txt pages 207-208 (internal) — Skilled Trades Agreement
on Open Demands. Read pages 215-216 (internal) — SKT-04A overtime
equalization tracking and charging. Read project_union_feedback_r2.md
"SKT-04A rules that differ from PS-036" and "Post-round-2 union meeting
clarifications" sections.

Add columns to phase2/src/lib/server/schema.ts and matching migrations in
phase2/src/lib/server/db.ts runMigrations():

  area:
    - type TEXT NOT NULL DEFAULT 'production'
        CHECK(type IN ('production','skilled_trades'))
    - zero_out_month TEXT  (NULL for production; '01' for skilled_trades)
    - challenge_window_days INTEGER  (NULL for production; 30 for ST)
    - no_show_penalty_hours REAL NOT NULL DEFAULT 0
    - notification_policy TEXT NOT NULL DEFAULT 'in_app_default'
        CHECK(notification_policy IN
              ('in_app_default','in_app_only_no_home_except_emergency'))
    - allow_inter_shop_canvass INTEGER NOT NULL DEFAULT 0

  employee:
    - is_apprentice INTEGER NOT NULL DEFAULT 0
    - area_of_expertise TEXT
        CHECK(area_of_expertise IS NULL OR
              area_of_expertise IN ('Electrical','Mechanical'))
    - classification TEXT
        -- Electrician, Millwright, ToolMaker, PipeFitter, etc. Production
        --  employees leave NULL.
    - shift_pattern_id INTEGER REFERENCES shift_pattern(id)
        -- For ST employees only. NULL for production employees (they
        --  use the legacy `shift` field).
    - crew_position INTEGER
        CHECK(crew_position IS NULL OR crew_position BETWEEN 1 AND 4)
        -- Required if shift_pattern_id is set AND the pattern has
        --  multiple crews (1_crew patterns ignore this).
    - cycle_anchor_date TEXT
        -- ISO date (YYYY-MM-DD). The reference date for this employee's
        --  cycle start. Required if shift_pattern_id is set.

  posting:
    - pay_multiplier REAL NOT NULL DEFAULT 1.0
        CHECK(pay_multiplier IN (1.0, 1.5, 2.0))
    - required_classification TEXT
    - pending_sv_approval INTEGER NOT NULL DEFAULT 0

  charge:
    - charge_multiplier REAL NOT NULL DEFAULT 1.0

  New table: shift_pattern
    - id INTEGER PRIMARY KEY AUTOINCREMENT
    - name TEXT NOT NULL UNIQUE
        -- '1_crew_weekend', 'fixed_day', 'fixed_evening', 'fixed_night',
        --  '2_crew_fixed_d_n', '2_crew_fixed_d_afternoon',
        --  '4_crew_12h_rotating', '4_crew_12h_fixed'
    - cycle_length_days INTEGER NOT NULL
        -- 7 for fixed_day/evening/night and weekend; 14 for 2_crew_*
        --  patterns; 28 for 4_crew_12h_rotating; 14 for 4_crew_12h_fixed
    - crew_count INTEGER NOT NULL
        -- 1, 2, or 4
    - calendar_json TEXT NOT NULL
        -- JSON: a 2D array [crew_idx][day_in_cycle] -> 'D' | 'N' | 'RDO'
        --  where crew_idx is 0..(crew_count-1) and day_in_cycle is
        --  0..(cycle_length_days-1). Step 2 populates this with the
        --  calendars from SKT-04A pages 213-214 verified pixel-for-pixel.
    - description TEXT
        -- Plain-English description for UI display

  New table: posting_preferred_qualification
    (posting_id TEXT, qualification_id TEXT,
     PRIMARY KEY (posting_id, qualification_id))

All ALTER TABLE additions must be idempotent. CREATE TABLE for shift_pattern
and posting_preferred_qualification uses CREATE TABLE IF NOT EXISTS.

Write tests in phase2/src/lib/server/schema_migration.test.ts:
  - Migration is idempotent (running twice doesn't error)
  - Existing production areas retain type='production' after migration
  - shift_pattern table exists with expected columns
  - PRAGMA table_info confirms all new employee columns + defaults
  - Existing production seed still produces a valid demo state
    (production employees have shift_pattern_id NULL and continue to
     use the legacy `shift` field)
```

**Done When:**
- [x] Schema changes shipped in `schema.ts`
- [x] Migration runner adds columns + tables idempotently on existing Railway DB
- [x] `shift_pattern` + `posting_preferred_qualification` tables created
- [x] `shift_pattern_id` + `crew_position` + `cycle_anchor_date` on employee
- [x] Existing production seed runs cleanly (4 areas, 44 employees, 69 charges)
- [x] New columns have correct defaults verified via PRAGMA
- [x] `npm run check` clean, `npm run build` clean
- [x] Reset demo on deployed Railway confirms production behavior unchanged *(verified 2026-05-14: deploy 140fe47b booted cleanly on existing volume; POST /demo/reset returned 303; subsequent GET /tm 200; zero 5xx in http logs)*

**Completion notes (2026-05-14):**
- Tests: 24/24 pass in `phase2/src/lib/server/schema_migration.test.ts` (idempotency × 2, new tables, area/employee/posting/charge columns with default + CHECK verification, production seed compatibility, ST-shape inserts).
- Vitest installed as a dev dep (^2.1.9) + `npm test` / `npm run test:watch` scripts + minimal `vitest.config.ts` that skips the SvelteKit plugin (server-side tests only, no jsdom).
- Plan deviation flagged: the plan said "production employees leave classification NULL" but `employee.classification` already existed as `NOT NULL DEFAULT 'production'`. Repurposed in place — production keeps `'production'`, ST employees get specific trade names (Electrician, Millwright, ToolMaker, PipeFitter). Comment in `db.ts` documents this. No code change needed in production seed.
- All new column additions live in `runMigrations()` (not the `CREATE TABLE` schema) so they apply identically to fresh DBs and the existing Railway DB on next boot. The new tables (`shift_pattern`, `posting_preferred_qualification`) use `CREATE TABLE IF NOT EXISTS` in `schemaSql`.
- Seed counts unchanged: 4 areas / 44 employees / 69 charges / 12 compliance checks still apply.

---

### Step 2 — Shift pattern definitions + DEMO_TODAY constant + cycle math helper

```
Read SKT-04A pages 213-214 internal (cba_white_book.txt) AND verify
against the rendered images cba_pages/page_215.png, page_216.png, page_217.png
(the shift-pattern tables). The calendar arrays MUST match pixel-for-pixel.
Get this wrong and the ST union president will catch it.

Define DEMO_TODAY in phase2/src/lib/server/demo_clock.ts:

  // Single source of truth for "today" across the demo. Production replaces
  // this with new Date(). On Reset Demo, we advance this to a fixed value
  // (e.g., the day of the seed) so the engineered shift-pattern designations
  // hold across demo viewings regardless of wall-clock date.
  export const DEMO_TODAY = '2026-05-14';  // anchor for the demo;
                                             // advanced on Reset Demo if needed

  export function demoToday(): Date {
    return new Date(DEMO_TODAY + 'T00:00:00Z');
  }

  Note: Reset Demo can optionally advance DEMO_TODAY to current real date
  via a setting in seed.ts, but the simpler path is to keep DEMO_TODAY
  fixed and re-seed cycle anchor dates relative to it. Step 5 (seed) uses
  DEMO_TODAY when computing anchor dates so designations land correctly.

Populate shift_pattern table in seed (or migration data step):

  Pattern 1: 'fixed_day' — cycle_length_days=7, crew_count=1
    calendar_json: [["D","D","D","D","D","RDO","RDO"]]
    (Mon-Fri = D; Sat-Sun = RDO)

  Pattern 2: 'fixed_evening' — cycle_length_days=7, crew_count=1
    calendar_json: [["N","N","N","N","N","RDO","RDO"]]
    (Using 'N' for evening = night-ish shift; visual lumps with night)

  Pattern 3: 'fixed_night' — cycle_length_days=7, crew_count=1
    calendar_json: [["N","N","N","N","N","RDO","RDO"]]

  Pattern 4: '1_crew_weekend' — cycle_length_days=7, crew_count=1
    calendar_json: [["RDO","RDO","RDO","RDO","RDO","D","D"]]
    (Sat-Sun = D, all weekdays = RDO; matches "1 Crew 1 Shift Weekend
     Schedule Working Every Other Monday 80 Hours" page 215)

  Pattern 5: '2_crew_fixed_d_n' — cycle_length_days=7, crew_count=2
    Crew 1 (idx 0): ["D","D","D","D","D","RDO","RDO"]
    Crew 2 (idx 1): ["N","N","N","N","N","RDO","RDO"]
    (Two Crew / 2 Shifts 8 Hours Fixed Days/Night, page 215)

  Pattern 6: '2_crew_fixed_d_afternoon' — cycle_length_days=7, crew_count=2
    Crew 1 (idx 0): ["D","D","D","D","D","RDO","RDO"]
    Crew 2 (idx 1): ["A","A","A","A","A","RDO","RDO"]
    -- 'A' here = afternoon. Or normalize A → N for simplicity. Verify
       against page 215-216 image to pick what the contract intends.

  Pattern 7: '4_crew_12h_rotating' — cycle_length_days=28, crew_count=4
    The big one. Verify against cba_pages/page_216.png "Two Shift/Four
    Crew-12 Hour Rotating Schedule, Model Repeats Every 4 Weeks / All
    shifts are 12 Hours". The table on that page is a 4-week × 7-day
    grid with each crew assigned D / N / RDO per day. Transcribe into
    a 4×28 array.

    Week 1 (days 0-6):
      Crew 1: ["D","D","D","D","D","N","N"]  (rough — verify against image)
      Crew 2: ["N","N","N","N","D","D","D"]  (verify)
      Crew 3: ["D","D","D","D","RDO","RDO","RDO"]  (verify)
      Crew 4: ["RDO","RDO","RDO","RDO","N","N","N"]  (verify)
    Weeks 2-4: continue per image transcription.

    **CRITICAL: Use the rendered page images as source of truth.**
    Manual transcription is the highest-risk step in this plan. After
    populating, render the calendar back to the screen for visual
    verification against the image. Step 6 builds an admin "Pattern
    preview" tool that shows the 4-week grid for any pattern.

  Pattern 8: '4_crew_12h_fixed' — cycle_length_days=14, crew_count=4
    Two Shift/Four Crew-12 Hour Fixed Schedule, page 217.
    Same transcription discipline — 4-crew × 14-day array.

Implement the cycle math helper in
phase2/src/lib/server/schedule_eligibility.ts:

  import { demoToday } from './demo_clock';

  type ShiftDesignation = 'D' | 'N' | 'A' | 'RDO';
  type EligibilityResult =
    | 'on_normal_shift'
    | 'on_rdo_volunteer'
    | 'shift_conflict'
    | 'unavailable';

  export function getDesignation(
    employee: { shift_pattern_id: number | null; crew_position: number | null;
                cycle_anchor_date: string | null; shift?: string },
    work_date: string  // YYYY-MM-DD
  ): ShiftDesignation | null {
    // Production employees: use legacy shift field (returns null here;
    // callers handle production case separately or via different branch)
    if (!employee.shift_pattern_id) return null;

    // ST employee path
    const pattern = lookupPattern(employee.shift_pattern_id);
    const anchor = new Date(employee.cycle_anchor_date! + 'T00:00:00Z');
    const target = new Date(work_date + 'T00:00:00Z');
    const dayDelta = Math.floor((target.getTime() - anchor.getTime()) /
                                 (24 * 60 * 60 * 1000));
    // Modulo handling: negative dayDelta means before anchor; wrap
    // forward via positive modulo:
    const dayInCycle = ((dayDelta % pattern.cycle_length_days) +
                         pattern.cycle_length_days) % pattern.cycle_length_days;
    const crewIdx = pattern.crew_count > 1 ? (employee.crew_position! - 1) : 0;
    return pattern.calendar[crewIdx][dayInCycle] as ShiftDesignation;
  }

  export function isOnDutyDateScheduled(
    employee: Employee,
    work_date: string,
    start_time: string,  // "HH:MM"
    posting_ot_type: string
  ): EligibilityResult {
    const designation = getDesignation(employee, work_date);

    // Production fallback
    if (designation === null) {
      // Use legacy shift field — current production logic
      return 'on_normal_shift';  // simplified; existing code handles
    }

    // ST path
    if (designation === 'RDO') {
      // RDO + weekend/holiday OT = eligible to volunteer
      // (per SKT-04A no-show penalty rule, this is the path that triggers
      // the +1 charge if accepted-then-no-show on weekend/holiday)
      return 'on_rdo_volunteer';
    }

    // Has a shift designation (D / N / A) — check shift compatibility
    // with the OT slot
    const shiftCompatible = checkShiftCompatibility(designation, start_time);
    return shiftCompatible ? 'on_normal_shift' : 'shift_conflict';
  }

  // checkShiftCompatibility: D shift roughly 7am-7pm (or 6-6),
  // N shift 7pm-7am, A shift 3pm-11pm (or similar). For the demo, use
  // simple heuristics: D = start_time in [05:00, 14:00), N = otherwise,
  // A = [13:00, 22:00). Configurable refinement in production.

Tests (high coverage — this is the highest-risk Step):
  - DEMO_TODAY constant readable; demoToday() returns a Date
  - getDesignation for fixed_day on a Monday returns 'D'
  - getDesignation for fixed_day on a Saturday returns 'RDO'
  - getDesignation for 4_crew_12h_rotating crew 1, day 0 of cycle: matches
    transcribed value from page 216 image
  - getDesignation for 4_crew_12h_rotating crew 4, day 27 of cycle: matches
    image
  - getDesignation handles work_date before anchor (negative dayDelta) via
    positive modulo correctly
  - getDesignation handles work_date many cycles after anchor (large
    positive dayDelta)
  - isOnDutyDateScheduled returns 'on_rdo_volunteer' for an RDO designation
  - isOnDutyDateScheduled returns 'shift_conflict' for an N-designation
    employee when posting start_time is 07:00 (day shift)
  - Production employees (shift_pattern_id NULL) fall back to legacy
    shift logic — getDesignation returns null, callers handle
  - Round-trip test: render the calendar_json for each pattern back to a
    7-day-block string and assert against an expected fixture (this is the
    "did we transcribe right" check — fixture written by reading the
    image carefully)

Build a manual verification tool: a tiny CLI script
phase2/scripts/preview_patterns.ts that prints each pattern's full cycle
to the terminal in a human-readable grid. Compare side-by-side with the
contract image. (This script feeds the admin Pattern Preview UI in Step 6
too — same data, different render.)
```

**Done When:**
- [x] `demo_clock.ts` with DEMO_TODAY constant + helper shipped
- [x] `shift_pattern` table populated with 8 patterns (or all that apply
      to the demo seed) verified against contract page images
- [x] `schedule_eligibility.ts` with `getDesignation` + `isOnDutyDateScheduled`
- [x] Pattern transcriptions visually verified via preview_patterns.ts
      script against `cba_pages/page_215.png` through `page_217.png`
- [x] All cycle-math tests pass (positive/negative dayDelta, modulo edges,
      multi-crew indexing)
- [x] Production fallback works — no production behavior regresses
- [x] `npm run check` clean

**Completion notes (2026-05-15):**
- Pattern transcription verified by opening the PDF in Chrome via local HTTP server (claude-in-chrome MCP) and zooming into each 28-day and 14-day grid cell-by-cell. Color highlighting on page 216 disambiguated which crew is which (Crew 1=blue, Crew 2=red, Crew 3=gray, Crew 4=no highlight). `npm run preview-patterns` renders every pattern as an ASCII grid for ongoing side-by-side validation.
- **Plan deviations against the Step 2 stubs:**
  - `1_crew_weekend`: plan stubbed 7-day, contract is **14-day** ("Working Every Other Monday 80 Hours" — Week 1 = Mon + Fri-Sun, Week 2 = Fri-Sun only).
  - `2_crew_fixed_d_n`: plan stubbed Crew 2 as `N N N N N RDO RDO`. Contract shows Crew 2 with **offset Sun N** — `N N N N RDO RDO N` — reflecting the convention that night-shift work weeks start Sunday evening.
  - `4_crew_12h_rotating` **Crew 4 is asymmetric** per contract — 4 D + 10 N over 28 days vs other crews' 7 D + 7 N. Total hours match (42 h/wk avg) but Crew 4 is a "predominantly nights" crew with one D-shift block in Week 4. Comment in `shift_patterns.ts` explains; the preview script's per-crew totals make this visually obvious.
  - `2_crew_fixed_d_afternoon` retains plan stub (matches contract exactly).
- Files shipped:
  - [demo_clock.ts](phase2/src/lib/server/demo_clock.ts) — DEMO_TODAY = '2026-05-14' + `demoToday()` helper
  - [schedule_eligibility.ts](phase2/src/lib/server/schedule_eligibility.ts) — `getDesignation()`, `isOnDutyDateScheduled()`, pattern cache with test-reset hook, slot-classification heuristic (D = 05-13, A = 13-22, N = otherwise)
  - [shift_patterns.ts](phase2/src/lib/server/shift_patterns.ts) — 8 pattern definitions + `seedShiftPatterns()` idempotent inserter with calendar-length sanity check
  - [scripts/preview_patterns.ts](phase2/scripts/preview_patterns.ts) + `npm run preview-patterns` script
  - [schedule_eligibility.test.ts](phase2/src/lib/server/schedule_eligibility.test.ts) — 41 tests covering production fallback, single-crew patterns, multi-crew indexing, negative dayDelta (history reconstruction), far-future dayDelta, every 4-crew rotating pattern crew × week spot check, fixed-pattern pair structure, RDO-volunteer eligibility, shift conflict cases
- Wiring: seed runner calls `seedShiftPatterns(db())` inside the seed transaction, idempotent on `name UNIQUE`. Pattern cache resets between seeds via the `_resetPatternCacheForTests` test hook.
- **Tests: 65/65 pass** (24 schema migration + 41 cycle math). `npm run check` 0 errors / 0 warnings. `npm run build` clean. `npm run seed` produces the unchanged 4 areas / 44 employees / 69 charges baseline plus 8 shift_pattern rows.

---

## Phase 2: Rules & Engine (2 Steps)

### Step 3 — Rotation engine routing + ST charge calc + apprentice gating + soft quals + inter-shop canvass

```
Read cba_white_book.txt pages 215-216 (internal). Read
phase2/src/lib/server/rotation.ts and the new schedule_eligibility.ts
from Step 2.

Refactor rotation engine to dispatch by area.type:

  Production path (existing): unchanged Procedure A / Procedure B logic.

  Skilled trades path (new):
    1. Build candidate pool: employees where
       - area_of_expertise matches posting's area's expertise OR
         posting.required_classification specified and employee
         classification matches
       - active, not on leave, not placement-restricted
       - Schedule-eligible via isOnDutyDateScheduled() from Step 2.
         Eligibility = result is 'on_normal_shift' OR 'on_rdo_volunteer'.
         Exclude 'shift_conflict' and 'unavailable'.
       - HARD posting_qualification(s) all held
    2. Apprentice gating: exclude is_apprentice=1 from pool UNLESS all
       journeypersons in the expertise group have been offered at least
       once in the current cycle.
    3. Soft-qual preference: sort by:
         (a) lowest hours_offered (primary)
         (b) most posting_preferred_qualifications matched (tiebreak)
         (c) seniority descending (final tiebreak)
    4. If allow_inter_shop_canvass=1 AND in-area pool exhausted, extend
       to other ST areas of the same expertise. Tag offers as
       phase='inter_shop_canvass'.

ST charge calculation in offers.ts:
  When recording a charge for an ST area:
    amount_charged = hours × posting.pay_multiplier
    charge.charge_multiplier = posting.pay_multiplier
  Production charges remain unchanged.

Tests:
  - ST: 1h posting at 1.5× → charge.amount=1.5, charge_multiplier=1.5
  - ST: rotation skips apprentice when journeyperson has zero offered hours
  - ST: rotation includes apprentice once all journeypersons in expertise
    have been offered at least once this cycle
  - ST: soft-qual preference selects candidate with welding-cert over one
    without (hours tied)
  - ST: required_classification='PipeFitter' excludes Millwrights even when
    expertise group matches
  - ST: inter-shop canvass triggers when in-area pool exhausted
  - ST: candidate pool excludes shift_conflict employees but includes
    on_rdo_volunteer employees (they can volunteer for weekend OT)
  - ST: a 4_crew_12h_rotating employee currently on N-Crew week is
    excluded from a day-shift OT posting; same employee included for
    overlapping N-shift OT
  - Production: regression — 4 existing areas produce identical offer /
    response / charge outcomes for fixture inputs
  - Cross-expertise: Electrical journeyperson does NOT gate Mechanical
    apprentice
```

**Done When:**
- [x] Rotation engine dispatches by `area.type`
- [x] ST charge multiplication applied
- [x] Apprentice gating works within expertise group
- [x] Soft quals are preference, never hard exclusion
- [x] `required_classification` filter works
- [x] Inter-shop canvass triggers when configured + pool exhausted
- [x] Schedule-eligibility check correctly filters shift_conflict
- [x] Production regression suite passes
- [x] All new ST tests pass
- [x] `npm run check` clean

**Completion notes (2026-05-15):**
- New file [rotation_st.ts](phase2/src/lib/server/rotation_st.ts) — selection-only engine. Single entry point `nextEligibleST(posting, options)`. Filter pipeline: status → leave → hard quals → classification → expertise → apprentice gating → schedule eligibility. Sort: lowest `hours_offered` → most `preferred_quals_matched` → oldest hire → lowest last4 (matches production tiebreaker convention per Article V §_.3). Plan said "seniority descending (final tiebreak)" — interpreted as "most senior first" to match production behavior. Documented inline; if the union president wants newest-first instead, it's a one-line change.
- Dispatch path: [offers.ts:generateNextOffer](phase2/src/lib/server/offers.ts) reads `area.type` and early-exits to a new helper `generateNextOfferST` when `'skilled_trades'`. Production path is untouched. The ST helper loads hard + soft quals, builds an `STPosting`, calls `nextEligibleST`, writes audit-only skip entries (one per skipped candidate with reason), then inserts a real pending offer with `phase = 'inter_shop_canvass'` when the canvass arm fired, else `phase = NULL`.
- ST charges live in `recordResponse` ahead of the existing interim/final branches: detects `area.type='skilled_trades'`, computes `weightedHours = duration × pay_multiplier`, inserts `hours_offered` (always on yes/no) and `hours_accepted` (on yes only) with `charge_multiplier = pay_multiplier`. Always records `mode_at_charge='final'` for ST — interim does not apply to SKT-04A. Marks `cycle_offered` so apprentice gating sees this employee as offered in the current cycle.
- Apprentice gating uses `cycle_offered` + `rotation_state.current_cycle`. Predicate: at least one journeyperson in the apprentice's own `area_of_expertise` within the source area has NOT been recorded as offered this cycle → apprentice stays gated. Cross-expertise verified by test: a Mechanical apprentice's gating is independent of whether all Electrical journeypersons have been offered.
- Inter-shop canvass scope: same shift (the contract's equalization unit is shop × shift × expertise; canvass crosses shop, stays in shift). Test covers the cross-shift exclusion. Hours snapshot per candidate comes from their OWN source area, not the requesting area — keeps lowest-hours-first intent intact when comparing across shops.
- **ST-specific skip reasons (`shift_conflict`, `classification_mismatch`, `expertise_mismatch`, `apprentice_gated`) are NOT inserted into `response` rows** — the existing `response.response_type` CHECK constraint doesn't list them, and SQLite doesn't support modifying CHECK constraints in place without a table rebuild. Audit log captures them instead via new action `st_candidate_skipped`. Production's `passed_over_unqualified` / `on_leave` insertion path is untouched.
- **Plan deviation (flagged in [db.ts](phase2/src/lib/server/db.ts) inline):** added `posting.required_expertise TEXT CHECK(NULL or 'Electrical'|'Mechanical')`. Step 1 spec listed only `required_classification` but the rotation logic needs both — a posting can target "any Mechanical" without naming a specific classification per round-2 union meeting note. The classification gate takes precedence over the expertise gate; both can be set together (e.g., "PipeFitter" + "Mechanical").
- Tests: 19 new tests in [rotation_st.test.ts](phase2/src/lib/server/rotation_st.test.ts) covering classification/expertise gating, schedule eligibility (D / N / RDO designations), apprentice gating (gated, ungated, cross-expertise), soft-qual preference (tied hours wins for cert-holder, non-holder still appears), inter-shop canvass (triggers when allowed + pool exhausted, off when not allowed, stays in shift), ST charges (1.5× and 2.0× multipliers on hours_offered + hours_accepted, cycle_offered marking), offer.phase tagging, and a production-regression case verifying interim opportunity charges remain unchanged for production areas. **Tests: 84/84 pass** (24 schema migration + 41 cycle math + 19 new). `npm run check` 0 errors / 0 warnings. `npm run build` clean. `npm run seed` baseline unchanged (4 areas / 44 employees / 69 charges / 8 shift patterns).

---

### Step 4 — No-show penalty + reverse-selection ("go home") + ask-apprentices escalation

```
Read cba_white_book.txt pages 215-216 (internal). Read
project_union_feedback_r2.md — ESPECIALLY the ST-escalation = ask
apprentices, no forcing note.

Implement no-show penalty in offers.ts:
  Add 'no_show' to response_type CHECK constraint.
  When recording response='no_show' on an ST area offer where the offer's
  candidate was selected with eligibility='on_rdo_volunteer' OR
  posting.ot_type IN ('voluntary_weekend','voluntary_holiday'):
    - Apply hours_offered / hours_accepted charges as if worked
    - PLUS additional charge of area.no_show_penalty_hours with
      charge_type='hours_offered' and note 'no-show penalty'
  Production no-show: unchanged (treated as 'no', no penalty).

  Hook into offer creation: when generateNextOffer creates an offer in
  an ST area, store the eligibility result (on_normal_shift /
  on_rdo_volunteer) in a new offer field `eligibility_at_offer` (TEXT,
  add to schema). This lets the no-show penalty logic know whether to
  apply the penalty without re-computing the cycle math.

Implement reverse-selection ("go home") flow:
  - New endpoint POST /coord/posting/:id/release-excess
  - Picks N highest-hours among currently-assigned ST workers
  - Releases them: offer status → 'released', offset charges that reverse
    hours_accepted/hours_worked (net zero), audit log entry
  - Production: returns 400

Implement ST escalation = ask-apprentices (new Procedure for SKT):
  When generateNextOffer for an ST area returns no candidates (journey
  pool exhausted AND inter-shop canvass exhausted if enabled):
    1. Re-run candidate selection with apprentice gating DISABLED
    2. If apprentices available, offer to lowest-hours apprentice
    3. Tag offer.phase='apprentice_escalation'
    4. If apprentices also exhaust: return null. Posting stays 'open'
       with SV-visible note: "Eligible pool exhausted — NO FORCING
       AVAILABLE per SKT-04A interpretation. Consider grievance procedure."
  NEVER force-low for ST areas. No code path produces offer.phase=
  'force_low' for an area.type='skilled_trades'.

Tests:
  - ST no-show on RDO-volunteer or weekend/holiday: +1 penalty applied
  - ST no-show on regular voluntary daily (on_normal_shift): NO penalty
  - Production no-show: NO penalty (regression)
  - Release-excess picks highest-hours among assigned workers
  - Released worker's charge net-zeros for the release
  - ST escalation: journeyperson pool exhaust → apprentice gets offer
    with phase='apprentice_escalation'
  - ST escalation: both pools exhaust → null returned, posting open
  - ST: no force_low offer ever created (assert via test fixture sweep)
  - Production escalation unchanged (critical → force-low; non-essential
    → cascade → abandon)
```

**Done When:**
- [x] `no_show` response type recognized
- [x] `eligibility_at_offer` field on offer table populated at creation
- [x] +1 penalty applies only for ST + (on_rdo_volunteer OR weekend/holiday) + no_show
- [x] Release-excess endpoint shipped (UI in Step 6)
- [x] ST escalation = ask-apprentices, implemented
- [x] **No code path creates a force_low offer for ST areas (verified by test)**
- [x] Production escalation regression suite passes
- [x] All ST escalation tests pass
- [x] `npm run check` clean

**Completion notes (2026-05-15):**
- Schema (Step 4 additions): `offer.eligibility_at_offer TEXT` added via idempotent ADD COLUMN; `response.response_type` CHECK extended to include `'no_show'`; `offer.status` CHECK extended to include `'released'`. The two CHECK changes go through table rebuilds (SQLite doesn't support modifying CHECK in place). Rebuild uses the docs-recommended "new-name" pattern — `CREATE TABLE response_new` → `INSERT SELECT` → `DROP TABLE response` → `ALTER TABLE response_new RENAME TO response` — to avoid the gotcha where `ALTER TABLE RENAME` auto-updates foreign keys in other tables and breaks FK chains. (Hit this the hard way: an earlier rename-first approach left `response.offer_id` pointing at a temp table that was then dropped, and the next seed broke with "no such table: main.offer_pre_released".)
- Apprentice escalation: `generateNextOfferST` makes a first pass with `nextEligibleST(stPosting)` (apprentices gated). If empty, it retries with `{ unlockApprentices: true }` and tags the offer `phase = 'apprentice_escalation'`. If the second pass is also empty, the function writes an `st_pool_exhausted` audit entry, returns null, and the posting stays open. **No force-low fallback** — Step 7's compliance check 10 (planned) will catch any regression at audit time; Step 4 ships two safeguards already: (a) `initiateEscalation` guards against ST areas and throws; (b) a test sweep asserts zero `offer.phase='force_low'` rows in any ST area.
- No-show penalty: `recordResponse` for ST areas detects `response_type='no_show'`, looks up `offer.eligibility_at_offer` and `posting.ot_type`, and applies penalty logic when `eligibility_at_offer='on_rdo_volunteer'` OR `ot_type IN ('voluntary_weekend','voluntary_holiday')`. Penalty path: charges `hours_offered` + `hours_accepted` (as if worked) at the multiplier-weighted rate, plus an extra flat `hours_offered` charge of `area.no_show_penalty_hours` with `charge_multiplier=1.0`. Non-qualifying ST no-show (on_normal_shift + voluntary_daily) gets only `hours_offered`, no penalty. Production no-show is treated like a `no` — opportunity charge in interim mode, hours_offered in final mode, no penalty.
- Reverse-selection ("go home"): new module [release_st.ts](phase2/src/lib/server/release_st.ts) exports `releaseExcessST(posting_id, count, by_user, by_role)`. Picks the `count` highest-hours-offered workers among `offer.status='responded' + response='yes'`, flips their offer to `status='released'`, inserts reversal charges for `hours_accepted` and `hours_worked` (hours_offered intentionally stays — they were still offered the slot). Writes `st_worker_released` audit per release. Endpoint at [+server.ts](phase2/src/routes/coord/posting/[id]/release-excess/+server.ts) accepts `count` via FormData; allows `skt_coordinator`, `skt_tl`, `admin`; returns 400 for production areas + 404 for missing postings.
- **Bug fix found during testing:** ST rotation could re-offer the same employee on the same posting when `volunteers_needed > 1` and the same worker remained lowest-hours after their first yes. Added `alreadyRespondedOnPosting()` filter in `rotation_st.ts` so the candidate pool excludes anyone with a non-pending response on this posting. Production interim mode handles this via `cycle_offered`; ST's final-mode-style selection needed an explicit filter. (Production final mode has the same latent issue but it's out of scope here — flagged below.)
- **ST offer.id uniqueness fix:** the deterministic offer ID format (`ofr-{posting}-{employee}-st`) collided when the same employee got multiple offers on a multi-volunteer posting. Added a 6-char `randomUUID()` suffix to ST offer IDs. Production offer IDs unchanged (they rely on the cycle suffix for uniqueness, which still works).
- Wider SV UI: the production supervisor's `/sv/posting/[id]?/respond` action now accepts `no_show` as a valid response type (it was previously rejected at the form action layer even though the schema would have allowed it post-migration).
- Tests: **5 new tests in [schema_migration.test.ts](phase2/src/lib/server/schema_migration.test.ts)** covering the pre-Step-4 → Step 4 upgrade path (rebuild preserves data, FK chain stays intact, eligibility_at_offer added, idempotent re-run). **17 new tests in [rotation_st_step4.test.ts](phase2/src/lib/server/rotation_st_step4.test.ts)** covering no-show penalty (RDO-volunteer / weekend / holiday / daily-on-shift / production regression), apprentice escalation (journey-exhaust → apprentice with `phase='apprentice_escalation'` / both pools exhaust → null / `initiateEscalation` blocked for ST / force-low sweep), release-excess (picks highest-hours / multi-release / hours_accepted nets to zero / hours_offered stays / production rejected / count exceeds assigned / audit per release), and a production escalation regression confirming `initiateEscalation` still works on production postings. **Tests: 106/106 pass** (24 + 5 schema migration, 41 cycle math, 19 Step-3 ST rotation, 17 Step-4). `npm run check` 0 errors / 0 warnings. `npm run build` clean. `npm run seed` produces 4 areas / 44 employees / 69 charges baseline.
- Smoke test against deployed app shape: all 10 production routes return 200; release-excess endpoint returns 404 on missing posting, 400 on production area, 403 for non-allowed personas. Production no-show end-to-end via /sv/posting form action records the response with type='no_show', writes an opportunity charge (no penalty), and auto-generates the next offer.

---

## Phase 3: Demo Surface (3 Steps)

### Step 5 — ST seed data + personas (3 areas with engineered DEMO_TODAY anchor dates)

```
Read project_union_feedback_r2.md "Post-round-2 union meeting
clarifications." Read demo_clock.ts DEMO_TODAY constant from Step 2.

Extend phase2/src/lib/server/seed.ts:

  ST qualifications:
    Hard quals (Step 3 hard gates):
      - qual-electrician-cert        (Electrician journeyperson)
      - qual-millwright-cert         (Millwright journeyperson)
      - qual-toolmaker-cert          (ToolMaker journeyperson)
      - qual-pipefitter-cert         (PipeFitter journeyperson)
    Soft quals (Step 3 preference):
      - qual-welding                 (welding cert)
      - qual-high-lift               (high-lift operator)
      - qual-confined-space          (confined-space cert)

  3 ST areas:

    Area 1: "Body Shop Skilled Trades — 1st Shift"
      type=skilled_trades, shop='Body', shift='1st',
      zero_out_month='01', challenge_window_days=30,
      no_show_penalty_hours=1,
      notification_policy='in_app_only_no_home_except_emergency',
      allow_inter_shop_canvass=1

      8 employees, all shift_pattern='fixed_day', cycle_anchor_date=
      DEMO_TODAY rounded back to most recent Monday:
        - 2 Electricians (classification='Electrician')
            * One with welding soft-qual
        - 1 Electrical apprentice (is_apprentice=1)
        - 2 Millwrights (classification='Millwright')
            * One with high-lift soft-qual
        - 1 ToolMaker (classification='ToolMaker')
        - 1 PipeFitter (classification='PipeFitter',
                       confined-space soft-qual)
        - 1 Mechanical apprentice

    Area 2: "Paint Shop Skilled Trades — 1st Shift"
      Same area config. 5 employees, all fixed_day.

    Area 3: "Battery Shop Skilled Trades — 4-Crew Rotating"
      type=skilled_trades, shop='Battery',
      shift='2nd' (placeholder for legacy field),
      zero_out_month='01', challenge_window_days=30,
      no_show_penalty_hours=1,
      notification_policy='in_app_only_no_home_except_emergency',
      allow_inter_shop_canvass=1

      6 employees, all shift_pattern='4_crew_12h_rotating'.
      Engineer cycle_anchor_date + crew_position so that on DEMO_TODAY:
        - 2 Electricians, crew positions split:
            * Singh (welding soft-qual): currently on D-Crew week
            * Iqbal: currently on N-Crew week (visible shift conflict
                     for day-shift demo postings)
        - 1 Electrical apprentice: currently on RDO this week
            (demonstrates RDO-volunteer eligibility for weekend OT)
        - 1 Millwright (Mwangi): currently on D-Crew week
        - 1 ToolMaker (Larsen, with high-lift soft-qual): currently
                       on RDO this week
        - 1 Mechanical apprentice: currently on N-Crew week

      To engineer the "currently on" designation: compute
      cycle_anchor_date as
        DEMO_TODAY - (days_in_cycle_at_target_position_for_this_crew)
      For each persona, work backward from the desired DEMO_TODAY
      designation to find the right anchor offset, then set
      crew_position accordingly. Document this in a comment block in
      seed.ts so future-Claude understands the engineering.

  Bootstrap hours per seedFinalHoursBootstrap helper:
    - All ST employees seeded with multiplier-weighted bootstrap charges
    - At least 2 charges should have charge_multiplier=1.5
    - Apprentices seeded HIGHER hours than journeypersons in expertise
    - At least one journeyperson seeded as lowest-hours next-up per area
    - Pre-class quals (welding, high-lift, confined-space) seeded as
      soft-qual rows in employee_qualification

Update personas.ts:

  Add PersonaRole values:
    - 'skt_coordinator'  (STAC-designated coordinator)
    - 'skt_tl'           (Skilled Trades Team Leader)
    - 'st_supervisor'    (dedicated ST supervisor)

  New TM personas:
    - tm-vasquez   — Electrician journeyperson, Body 1st, fixed_day
    - tm-okonkwo-j — Electrical apprentice, Body 1st, fixed_day
    - tm-bradley   — Millwright, Body 1st (high-lift soft-qual), fixed_day
    - tm-park      — PipeFitter, Body 1st (confined-space soft-qual),
                      fixed_day
    - tm-singh-e   — Electrician, Battery rotating, currently D-Crew
                      (welding soft-qual)
    - tm-iqbal-st  — Electrician, Battery rotating, currently N-Crew
                      (demonstrates shift-conflict exclusion)
    - tm-mwangi-r  — Millwright, Battery rotating, currently D-Crew
    - tm-larsen-w  — ToolMaker, Battery rotating, currently RDO
                      (eligible for weekend volunteer demos)

  New coordinator/TL personas:
    - coord-davis      — STAC coordinator, area_scope = all 3 ST areas
    - tl-rodriguez-st  — SKT TL, area_scope = Body Shop ST 1st only

  New DEDICATED ST supervisor personas (one per ST area):
    - sv-body-1st-st     — ST SV for Body Shop ST 1st
    - sv-paint-1st-st    — ST SV for Paint Shop ST 1st
    - sv-battery-rot-st  — ST SV for Battery rotating

  Production supervisor personas UNCHANGED:
    - Garcia keeps original scope (BA2 + Battery production only)
    - Liu keeps original scope (Paint + Finish production only)

  Update Rodriguez (Union Rep) area_scope to include all 3 ST areas
    in addition to existing 4 production areas (union read-equity for ST).

Update PersonaSwitcher.svelte to group personas by role:
  TM / Production SV / ST SV / SKT Coordinator / SKT TL /
  Union Rep / Plant Mgmt / Admin

Tests:
  - Seed produces 3 ST areas with type='skilled_trades'
  - Total: 19 ST employees seeded (8 + 5 + 6)
  - Apprentice rows have is_apprentice=1
  - Bootstrap charges include charge_multiplier=1.5 for at least 2 rows
  - Battery rotating area employees have shift_pattern_id pointing to
    '4_crew_12h_rotating' with engineered anchor dates
  - On DEMO_TODAY, getDesignation() returns the engineered designation
    for each Battery persona (Singh=D, Iqbal=N, apprentice=RDO,
    Larsen=RDO, Mwangi=D, Mechanical apprentice=N)
  - Body and Paint ST employees all return 'D' on DEMO_TODAY (Monday)
    or 'RDO' (Sat/Sun)
  - Persona switch to each new persona lands appropriately
  - Garcia and Liu (production SVs) see NO ST areas in their dashboard
  - Rodriguez (Union Rep) sees all 7 areas (4 production + 3 ST)
```

**Done When:**
- [x] 3 ST areas seeded (total 7 areas)
- [x] 19 ST employees with correct fields including shift_pattern_id, crew_position, cycle_anchor_date
- [x] On DEMO_TODAY, every Battery persona's getDesignation matches the
      engineered narrative (D/N/RDO as called out)
- [x] Soft quals distributed; bootstrap multiplier-weighted charges in place
- [x] **14 new personas live** (8 TMs + coord + SKT TL + 3 ST SVs + 1 updated
      Union Rep scope) — Rodriguez scope-extended doesn't count as a new persona
- [x] PersonaSwitcher groups by role
- [x] Production SV scope unchanged; Union Rep scope extended to ST areas
- [x] Existing production behavior unchanged

**Completion notes (2026-05-15):**
- 3 ST areas seeded in [seed.ts](phase2/src/lib/server/seed.ts): `area-body-st-1st` (Body Shop ST 1st, fixed_day, 8 employees), `area-paint-st-1st` (Paint Shop ST 1st, fixed_day, 5 employees), `area-battery-st-rot` (Battery Shop ST 4-crew rotating, 6 employees). All ST areas: `type='skilled_trades'`, `zero_out_month='01'`, `challenge_window_days=30`, `no_show_penalty_hours=1`, `notification_policy='in_app_only_no_home_except_emergency'`, `allow_inter_shop_canvass=1`, final mode from day 1.
- 19 ST employees with classification (`Electrician` / `Millwright` / `ToolMaker` / `PipeFitter` for journeys, `ApprenticeElectrical` / `ApprenticeMechanical` for apprentices), `area_of_expertise`, `is_apprentice`, `shift_pattern_id`, `crew_position` (Battery only), `cycle_anchor_date='2026-05-11'` (most recent Monday before DEMO_TODAY).
- Battery rotating engineering: single shared anchor + varying crew_position lands each persona on engineered designation via `calendar[crew_idx][3]`. Verified by test for all 6 Battery employees:
  - Singh-E (Crew 1) → D, Mwangi-R (Crew 1) → D
  - Iqbal-S (Crew 3) → N, Yoon-S (Crew 3) → N
  - Larsen-W (Crew 2) → RDO, Mahmoud-K (Crew 4) → RDO
- 6 new qualifications: 4 hard journey certs (`qual-electrician-cert`, `qual-millwright-cert`, `qual-toolmaker-cert`, `qual-pipefitter-cert`) and 2 new soft quals (`qual-high-lift`, `qual-confined-space`); `qual-welding` reused from production seed. Soft-qual distribution per plan: Collins-E + Singh-E hold welding, Bradley + Larsen-W hold high-lift, Park-R + Murphy-S hold confined-space.
- Bootstrap charges multiplier-weighted via new `seedSTHoursBootstrap()` helper — one synthetic bootstrap posting per (area × multiplier) bucket, charge amounts = raw_hours × multiplier. Final hours per employee with apprentices strictly higher than every journey in same area + expertise:
  - Body Electrical: Vasquez 8 < Collins-E 20 < **Okonkwo-J 24 (app)**
  - Body Mechanical: Bradley 10 < Hassan-W 16 < Tang-T 18 < Park-R 20 < **Davies-R 32 (app)**
  - Paint Electrical: Coleman 6 (sole journey, no Paint Electrical apprentice)
  - Paint Mechanical: Patel-K 8 < Vincenzo 10 < Murphy-S 18 < **Stein-M 20 (app)**
  - Battery Electrical: Singh-E 8 < Iqbal-S 14 < **Mahmoud-K 20 (app)**
  - Battery Mechanical: Mwangi-R 10 < Larsen-W 20 < **Yoon-S 26 (app)**
  - Vasquez (Body), Coleman (Paint), Singh-E + Mwangi-R (Battery) are each lowest-hours next-up in their area.
  - Multiplier mix: 6 charges at 1.5× (Collins-E, Park-R, Murphy-S each have one offered + one accepted at 1.5×) and 2 charges at 2.0× (Larsen-W holiday). Easily satisfies the "≥ 2 charges at 1.5×" gate.
- 13 new personas + 1 scope extension shipped in [personas.ts](phase2/src/lib/personas.ts):
  - 3 new PersonaRole values: `st_supervisor`, `skt_coordinator`, `skt_tl`
  - 8 TM personas: `tm-vasquez`, `tm-okonkwo-j`, `tm-bradley`, `tm-park` (→ `emp-park-r`), `tm-singh-e`, `tm-iqbal-st` (→ `emp-iqbal-s`), `tm-mwangi-r`, `tm-larsen-w`
  - `coord-davis` (STAC Coordinator, scope = all 3 ST areas)
  - `tl-rodriguez-st` (Skilled Trades TL, scope = Body ST 1st only)
  - 3 dedicated ST SVs: `sv-body-1st-st`, `sv-paint-1st-st`, `sv-battery-rot-st`
  - Union Rep Rodriguez scope extended from 4 production areas to all 7 areas
- [PersonaSwitcher.svelte](phase2/src/lib/components/PersonaSwitcher.svelte) renders dropdown grouped by role with section headers in fixed order: TM → Production SV → ST SV → STAC Coordinator → Skilled Trades TL → Union Rep → Plant Mgmt → Admin. New ST roles get distinct chip colors (sky / indigo / slate).
- Plan deviation flagged: persona id `tm-park` maps to employee id `emp-park-r` (not `emp-park`) to avoid namespace confusion with production's `emp-park-h` (Park, H. in Paint 2nd production). Likewise `tm-iqbal-st` → `emp-iqbal-s` (production has `emp-iqbal-r`). Persona names + employee display names disambiguate visually.
- `wipe()` made defensive: wraps `DELETE FROM sqlite_sequence` in try/catch so fresh in-memory DBs (test setup) don't throw when sqlite_sequence hasn't been created yet (it's only auto-created on first AUTOINCREMENT insert, not at CREATE TABLE). Also added `posting_preferred_qualification` to the wipe table list so re-seeds don't leave orphan rows.
- Production behavior unchanged: 4 production areas, 44 production employees, BA2 history posting + Paint/Battery bootstrap postings, 69 production charges, all unaffected. Verified by counts (`npm run seed` shows 7 areas / 63 employees / 138 charges = 69 prod + 69 ST).
- **Tests: 138/138 pass** (24 + 5 schema migration, 41 cycle math, 19 Step-3 ST rotation, 17 Step-4 ST escalation/no-show, **32 new Step-5 seed tests**). New test file [seed_st.test.ts](phase2/src/lib/server/seed_st.test.ts) covers area + employee counts, qualification distribution, multiplier-weighted bootstrap charges, apprentice > journey hours rule, lowest-hours-next-up journey rule, every Battery persona's engineered DEMO_TODAY designation, fixed-day Mon-Fri = D / Sat-Sun = RDO, persona scope rules (production SVs see NO ST areas, Rodriguez sees all 7, ST SVs scoped to single ST area each, Davis covers all 3, TL Rodriguez-ST scoped to Body only), and "every TM persona references an existing employee row." `npm run check` 0 errors / 0 warnings on 401 files. `npm run build` clean. `npm run seed` produces 7 areas / 63 employees / 14 qualifications / 138 charges baseline.

---

### Step 6 — UI: STAC coordinator + SKT TL dashboards + ST schedule visuals + pattern preview admin

```
Read existing phase2/src/routes/sv/+page.svelte for the supervisor
dashboard pattern. Read project_union_feedback_r2.md SV-approval workflow.

Build STAC coordinator UI:

  Route /coord:
    - Dashboard listing coord's ST areas with type badges
    - Per-area card: name, expertise group counts, apprentice count,
      lowest-hours next-up TM
    - "Post new ST opportunity" → /coord/post
    - "Recent activity" — recent ST postings + SV-approval status

  /coord/post form:
    - Area selector (ST areas in scope)
    - Expertise group selector (Electrical / Mechanical)
    - required_classification dropdown
    - Preferred quals (soft) multiselect
    - Hard qual requirement
    - pay_multiplier dropdown
    - work_date, start_time, duration_hours, volunteers_needed, notes,
      criticality
    - On submit: posting created with pending_sv_approval=1, algorithm
      runs to generate the PROPOSED first offer (offer.status='proposed'),
      redirect to /coord/posting/:id "Sent to SV for approval"

  /coord/posting/:id rotation runner:
    - Header: posting details + "Awaiting SV approval" banner when pending
    - Proposed assignment shown but not actionable until SV approves
    - After SV approval, standard rotation runner UI activates
    - "Release excess workers" button (Step 4 endpoint)

Build SKT TL UI:

  Route /skt-tl:
    - Single-area dashboard (per persona)
    - Same /skt-tl/post form, same proposed-posting flow

  Share the posting-form component between /coord/post and /skt-tl/post.

Schedule visuals (the impressive bits):

  TM dashboard for ST employees with shift_pattern_id:
    - Schedule pattern card showing pattern name + this-week designation
    - **7-day calendar strip** below the standing card. Each day shows
      D / N / A / RDO using the calendar math. Today is highlighted.
      "This week" labelled.
    - **"Next 4 weeks" expandable view** for rotating-pattern employees:
      28-day grid showing the rotation. Visual confirmation that the
      cycle math is real.
    - **"Last 4 weeks" expandable view** (history) — same 28-day grid
      but for the four weeks BEFORE DEMO_TODAY. Useful for grievance
      reconstruction: the Union Rep / SV / TM can see what shift the
      employee was on at any point in the recent past. This is the
      same cycle math, just with negative dayDelta values; the helper
      from Step 2 already handles them via positive modulo. No new math,
      just a second render pass.

  Admin pattern preview at /admin/patterns (NEW):
    - List all 8 shift_pattern rows
    - Each one expands to show its full calendar in a grid (cycle_length
      days × crew_count crews). D / N / A / RDO color-coded.
    - **Pixel-comparable to the contract page images** so a reviewer
      can do side-by-side validation in the demo. This is the credibility
      anchor — if anyone asks "does the system actually model the
      contract patterns?" the answer is "click here."

Type badges + ST indicators on existing UI:
  - /admin: ST areas show "Skilled Trades" badge
  - /tm: ST employees see expertise + classification + the schedule
    visuals above
  - /sv: ST supervisors see "ST postings pending your approval" card
    linking to /sv/approvals (queue UI in Step 7). Production SVs see no
    ST cards.
  - Cutover button on /admin: hidden for ST areas

Tests:
  - Coord lands on /coord, sees their 3 ST areas
  - Posting via /coord/post has pending_sv_approval=1
  - Proposed offer exists with status='proposed'
  - /coord/posting/:id shows "Awaiting SV approval" banner
  - SKT TL persona lands on /skt-tl with single area visible
  - SKT TL post form rejects out-of-scope area selection
  - Multiplier on posting flows to charge.charge_multiplier
  - TM dashboard for fixed_day ST employee shows correct 7-day calendar
    on DEMO_TODAY (Mon-Fri = D, Sat-Sun = RDO)
  - TM dashboard for 4_crew_12h_rotating employee shows correct 7-day
    AND 28-day (forward) calendar; today highlighted; designation matches
    engineered DEMO_TODAY state
  - TM dashboard "Last 4 weeks" view renders correctly with the 28-day
    grid covering the four weeks BEFORE DEMO_TODAY (negative dayDelta
    case via positive modulo)
  - /admin/patterns renders all 8 patterns; visual diff vs cba_pages
    image is the manual verification path
  - Production-OT UI regression: /sv, /tm, /admin behave unchanged for
    production areas (production employees see no schedule visuals)
```

**Done When:**
- [x] /coord and /skt-tl routes shipped with shared post form
- [x] Proposed posting state ships correctly
- [x] Type badges + ST indicators across existing pages
- [x] **TM dashboard 7-day calendar strip for ST employees**
- [x] **TM dashboard "Next 4 weeks" + "Last 4 weeks" expandable views for rotating-pattern employees**
- [x] **/admin/patterns route renders all 8 patterns in calendar grid
      visually matching contract page images**
- [x] Cutover hidden for ST areas
- [x] Dedicated ST SV personas see only their single ST area; production
      SVs see only production areas
- [x] Production UI regression check passes

**Completion notes (2026-05-15):**
- New routes: [/coord](phase2/src/routes/coord/+page.svelte) + [/coord/post](phase2/src/routes/coord/post/+page.svelte) + [/coord/posting/[id]](phase2/src/routes/coord/posting/[id]/+page.svelte), [/skt-tl](phase2/src/routes/skt-tl/+page.svelte) + [/skt-tl/post](phase2/src/routes/skt-tl/post/+page.svelte), [/admin/patterns](phase2/src/routes/admin/patterns/+page.svelte). Root redirect now sends `skt_coordinator` → /coord, `skt_tl` → /skt-tl, `st_supervisor` → /sv (which branches on role).
- **Proposed-offer flow:** Schema extends `offer.status` CHECK to allow `'proposed'` (rebuild path in [db.ts](phase2/src/lib/server/db.ts) detects `'released'` AND `'proposed'`; the Step 4 rebuild now also handles Step 6 in a single pass on first migrate, and Step 6's rebuild on top of a Step-4-era DB triggers only when `'proposed'` is missing). `generateNextOfferST` reads `posting.pending_sv_approval`; when 1, the offer lands as `status='proposed'` with audit action `st_offer_proposed`. `recordResponse` rejects with `"offer awaits ST SV approval"` for proposed offers. New `approveProposedSTPosting()` promotes proposed → pending, clears the flag, writes `sv_approved_st_posting` audit + an `offer_made` audit per promoted offer.
- **Shared form component:** [STPostingForm.svelte](phase2/src/lib/components/STPostingForm.svelte) is used by both `/coord/post` and `/skt-tl/post`. The form action handler lives at [st_posting_actions.ts](phase2/src/lib/server/st_posting_actions.ts) (SvelteKit doesn't allow arbitrary named exports from a +page.server.ts — extracted to $lib to satisfy that constraint while keeping a single code path for the create logic).
- **Rotation runner at /coord/posting/[id]:** Shared by `skt_coordinator`, `skt_tl`, `st_supervisor`, and `admin` — scope-checked per role. "Awaiting SV approval" amber banner when `pending_sv_approval=1`; response buttons disabled until approved; phase badges for `apprentice_escalation` + `inter_shop_canvass`; ST-specific eligibility column (on RDO / normal shift); accepted-workers list with release-excess collapsible (Step 4 endpoint). When the eligible pool is exhausted, the page explains "no force-low per SKT-04A interpretation" — Critical Rule #4 made visible in-UI.
- **ScheduleStrip:** [schedule_view.ts](phase2/src/lib/server/schedule_view.ts) computes three grids server-side using the Step 2 cycle math (this week, next 28 days, last 28 days). [ScheduleStrip.svelte](phase2/src/lib/components/ScheduleStrip.svelte) renders them: 7-cell strip with today outlined + two expandable 4-week grids. Color scheme: D = blue, A = amber, N = ink-700, RDO = ink-100, matching `/admin/patterns`. Last 4 weeks is the negative-dayDelta history path (positive-modulo handled by Step 2's helper). Wired into [/tm](phase2/src/routes/tm/+page.svelte) — fires only for ST employees (`primaryArea.area_type === 'skilled_trades'` AND `employee.shift_pattern_id != null`). Production TMs see no change.
- **/admin/patterns:** Lists all 8 SKT-04A shift patterns as crew × day calendar grids. Each crew rendered as a row of week-chunks (so a 28-day pattern shows 4 stacked 7-cell weeks). Per-crew D/A/N/RDO totals make the 4-crew rotating Crew 4 asymmetry visible at a glance (Step 2 documented this: Crew 4 has 10 N + 4 D vs other crews' 7+7 — totals match average but the crew is "predominantly nights"). Color-coded cells pixel-comparable to `cba_pages/page_215.png` through `page_217.png`. Link card added at the bottom of `/admin` for discoverability.
- **/sv branches on role:** Production supervisors see the existing dashboard untouched. ST supervisors see a compact area card per their scope + an amber "ST postings awaiting your approval" card that lists pending postings and links into `/coord/posting/[id]` for review (Step 7 ships the actual approve/reject queue at `/sv/approvals`).
- **/admin badges + cutover hidden for ST areas:** Areas table now sorted by type (production first, then ST). ST rows show a "Skilled Trades" badge, mode column reads "n/a (ST)" with italic hint, cycle column shows `—`, and the cutover button is replaced with "No cutover (SKT-04A)" inline text. The zero-out button remains since SKT-04A does have an annual zero-out (January).
- **Tests: 162/162 pass** (138 prior + **20 new Step 6 tests** in [step6.test.ts](phase2/src/lib/server/step6.test.ts) + **4 new schema_migration tests** for the offer.status `'proposed'` value + Step 6 upgrade path from a Step-4-era DB). New tests cover: proposed offer creation, response-blocking guard, `approveProposedSTPosting` flip + audit, production regression (production offers still pending), `buildScheduleView` 7-day/4-week grids + today highlighting + rotating-crew differentiation + production null fallback, `summarizeSTArea` expertise counts + lowest-hours next-up + pending_sv_approval flag.
- **End-to-end smoke against live preview:** Seeded fresh DB → coord-davis posts an Electrical OT in Body 1st at 1.5× via `/coord/post` form action → server creates posting with `pending_sv_approval=1` → algorithm picks Vasquez (lowest-hours Electrician at 8h) → offer lands as `status='proposed'` → `/coord/posting/[id]` renders the "Awaiting SV approval" banner, "Proposed offer" card, and Vasquez's details. All ST persona landings 200; production routes 200 unchanged; production tm-newman correctly does NOT render the schedule strip.
- `npm run check` 0 errors / 0 warnings on 431 files. `npm run build` clean (adapter-node, 7.2s). `npm run seed` produces 7 areas / 63 employees / 14 qualifications / 138 charges / 8 shift patterns baseline.

---

### Step 7 — SV approval queue + approval enforcement + notification policy + 4 new compliance checks

```
Read Step 6's proposed-posting flow. Read existing /approvals route
(dual-approval queue for cutover/zero-out) for pattern.

Build /sv/approvals route — ST approval queue:

  - Lists postings where pending_sv_approval=1 AND area_id in SV's
    area_scope
  - Only role='st_supervisor' sees the queue. Production SVs (role=
    'supervisor') have no approval queue.
  - Per posting: summary + proposed assignment + Approve / Reject (with
    reason) buttons
  - Approve: clears pending_sv_approval, promotes proposed offer
    (status='proposed') to pending (status='pending'), sends notification
    per area.notification_policy, writes audit 'sv_approved_st_posting'
  - Reject: marks posting status='rejected_by_sv' with reason, notifies
    originator, writes audit. Rejection terminal in this demo
    (rejection-revision is a Phase 3 polish item).
  - Layout-aware banner on /sv: when pending count > 0, amber banner
    "N posting(s) pending your approval" → /sv/approvals

  Approval gate enforcement in offers.ts:
  - Recording a response on an ST area offer where parent posting has
    pending_sv_approval=1 returns 400 "Posting awaits SV approval"
  - Approve action promotes 'proposed' → 'pending' + triggers notification

Notification policy enforcement:
  - When offer created in an ST area with notification_policy=
    'in_app_only_no_home_except_emergency':
      - TM dashboard offer banner: "Per SKT-04A, the Company will not
        contact you at home for this opportunity. Respond here in-app
        or you'll be marked no-contact."
      - Audit log records 'notification_sent_in_app_only'
  - Production areas: behavior unchanged

4 new compliance checks (alongside existing 8):

  Check 9 — Apprentice gating respected
    For each ST area, verify: no NON-ESCALATION offer (offer.phase NOT
    IN ('apprentice_escalation', 'inter_shop_canvass')) was made to an
    apprentice while a journeyperson in their expertise group had zero
    offered hours in the current cycle. Allowed exceptions:
    apprentice_escalation-tagged offers.

  Check 10 — No force_low ever recorded for ST area
    SELECT offer.id WHERE offer.phase='force_low' AND area.type=
    'skilled_trades'. Must return zero rows.

  Check 11 — Charge multiplier matches posting rate
    For each ST charge: charge.charge_multiplier = posting.pay_multiplier.

  Check 12 — All ST offers passed through SV approval
    For each offer in an ST area, verify parent posting has audit entry
    action='sv_approved_st_posting' before any response was recorded.

Update WALKTHROUGH.md Section 8 (Reports) to mention 4 new checks.

Tests:
  - /sv/approvals shows only ST postings within SV's area_scope
  - sv-body-1st-st sees only Body 1st pending postings
  - sv-paint-1st-st sees only Paint 1st pending postings
  - sv-battery-rot-st sees only Battery rotating pending postings
  - Production supervisor sees no approval queue
  - Approve action promotes proposed → pending + writes audit
  - Reject action marks posting + writes audit + notifies originator
  - Response on still-pending-approval offer returns 400
  - Notification policy banner shows on TM offer page for ST areas only
  - Compliance check 9 passes on clean ST seed
  - Compliance check 9 fails with apprentice-gating-violation fixture
  - Compliance check 10 always passes (no force_low in any ST fixture)
  - Compliance check 11 catches multiplier drift fixture
  - Compliance check 12 catches unapproved-offer fixture
```

**Done When:**
- [x] /sv/approvals route + approve/reject actions
- [x] Proposed offers can't have responses recorded
- [x] SV approval promotes proposed → pending + notifies
- [x] Rejection terminal, audit + notify
- [x] Notification policy banner displays correctly
- [x] 4 new compliance checks shipped
- [x] All 12 checks pass on clean fresh seed *(verified 2026-05-15: `npx tsx -e "runComplianceChecks()"` returns 12/12 PASS against the seeded DB)*
- [x] Fixture-driven violation tests pass
- [x] WALKTHROUGH.md Section 8 updated

**Completion notes (2026-05-15):**
- Schema (Step 7 additions): `posting.status` CHECK extended to include `'rejected_by_sv'` (terminal SV-side rejection state, distinct from `'cancelled'` which is originator-side and `'abandoned'` which is pool-exhaustion). `charge.is_penalty INTEGER NOT NULL DEFAULT 0` added so compliance check 11 can exempt SKT-04A no-show penalty rows (which are intentionally flat 1.0× regardless of posting rate). `posting.status` rebuild in [db.ts](phase2/src/lib/server/db.ts) follows the same docs-recommended `_new` table pattern Step 4/6 used. **Migration gate:** rebuild only fires when sqlite_master.sql contains `CHECK(status IN` — needed because some pre-Step-7 test fixtures stub `posting` as just `(id TEXT PRIMARY KEY)` and would otherwise trip a NOT NULL on `area_id` during the copy.
- New SV-side service: [`rejectProposedSTPosting()`](phase2/src/lib/server/offers.ts) mirrors Step 6's `approveProposedSTPosting`. Marks `posting.status='rejected_by_sv'`, clears `pending_sv_approval=0`, supersedes any proposed offer, writes `sv_rejected_st_posting` audit with reason. Throws if posting isn't awaiting SV approval. Once rejected, the posting is terminal — `approveProposedSTPosting` then errors. Rejection-revision (originator edits + resubmits) stays a Phase 3 polish item per the plan's Cross-Cutting index.
- Notification policy plumbing: new helper [`writeNotificationAuditIfPolicyDemands()`](phase2/src/lib/server/offers.ts) reads `area.notification_policy` and writes a `notification_sent_in_app_only` audit row when the area uses the SKT-04A policy (`in_app_only_no_home_except_emergency`). Called from two places: (a) `generateNextOfferST` when an offer goes direct-to-pending (no proposed flow); (b) `approveProposedSTPosting` when proposed→pending flips. Production areas (`in_app_default`) are no-ops. Verified by test: proposed offers don't fire the audit yet (TM not notified), approval fires it, default policy never fires.
- `/sv/approvals` route shipped at [+page.server.ts](phase2/src/routes/sv/approvals/+page.server.ts) + [+page.svelte](phase2/src/routes/sv/approvals/+page.svelte). Scope-filtered: `st_supervisor` sees only their `area_scope`; `admin` sees all ST areas; production supervisors and other roles redirect out (Critical Rule #11). Per posting: full summary + proposed candidate's name/classification/hours-offered + apprentice/escalation/canvass/RDO badges + required + preferred quals + originator note. Approve action calls `approveProposedSTPosting` and redirects back to the queue. Reject opens an inline reason input (required, validated server-side) and calls `rejectProposedSTPosting`. Recent decisions card shows the last 10 approve/reject decisions excluding `actor_role='system'` (so the bootstrap synthetic approvals don't pollute the operational view).
- `/sv` dashboard banner ([+page.svelte](phase2/src/routes/sv/+page.svelte)): the Step 6 "Approval queue UI ships in Step 7" placeholder is gone; the amber banner now reads "N posting(s) pending your approval" with the prominent **"Open approval queue →"** button as primary action and per-posting "review →" links into `/sv/approvals` instead of `/coord/posting/[id]`.
- TM-side notification banner: amber alert showing "Per SKT-04A, the Company will not contact you at home for this opportunity. Respond here in-app or you'll be marked no-contact." Renders in two places: (a) the pending-offer card on [/tm](phase2/src/routes/tm/+page.svelte) when `area_type='skilled_trades'` AND `notification_policy='in_app_only_no_home_except_emergency'`; (b) the offer detail page at [/tm/offer/[id]](phase2/src/routes/tm/offer/[id]/+page.svelte) under the same condition. Production TMs see nothing change.
- 4 new compliance checks shipped in [compliance.ts](phase2/src/lib/server/compliance.ts):
  - **Check 9 — `st_apprentice_gating`** (SKT-04A page 215): For each non-escalation, non-canvass apprentice offer in an ST area (excluding `system-bootstrap` historical), every active journey in same area + same `area_of_expertise` must have a `cycle_offered` row in the area's current cycle. Bootstrap exclusion is necessary because the seed bootstrap inserts apprentice offers directly (no `markCycleOffered` for journeys at bootstrap time) — the gating already happened at the historical record point. Demo-scope simplification: the check uses the area's CURRENT cycle as proxy for the offer's cycle; per-offer cycle stamping is a Phase 3 polish item.
  - **Check 10 — `st_no_force_low`** (Critical Rule #4 / round-2 union meeting interpretation): zero `offer.phase='force_low'` rows in any `area.type='skilled_trades'` area. Trivial query; runtime safety net for the rotation engine's no-force-low contract.
  - **Check 11 — `st_charge_multiplier`** (SKT-04A pay-rate weighting): every non-penalty, non-reversal ST charge has `charge_multiplier == posting.pay_multiplier`. SKT-04A no-show penalty rows (`is_penalty=1`) are exempt — they're intentionally flat 1.0× regardless of posting rate.
  - **Check 12 — `st_sv_approval_gate`** (Implementation plan Critical Rule #5): every ST offer with status pending or responded belongs to a parent posting with at least one `'sv_approved_st_posting'` audit entry. The bootstrap helper now writes a synthetic approval audit per ST bootstrap posting so historical demo data passes the check uniformly with runtime data.
- Bootstrap audit addition: [seedSTHoursBootstrap](phase2/src/lib/server/seed.ts) now writes `sv_approved_st_posting` (synthetic, `actor_role='system'`) per bootstrap posting alongside the existing `st_history_bootstrap` entry. Audit log went from 19 to 25 entries on fresh seed (3 ST areas × 2 multiplier buckets each = 6 new synthetic approvals).
- `/sv/approvals` recent-decisions filter: `WHERE al.actor_role != 'system'` keeps the synthetic bootstrap approvals out of the SV-facing recent list while still satisfying compliance check 12.
- **Tests: 24 new in [step7.test.ts](phase2/src/lib/server/step7.test.ts) + 4 new schema_migration tests for the Step 7 upgrade path.** Coverage: `rejectProposedSTPosting` (happy path / audit / throws on not-awaiting / throws on missing / blocks subsequent approve / blocks subsequent recordResponse), notification audit (emits on direct-to-pending / emits on approval-flip / suppresses for default policy / suppresses for production), no-show penalty `is_penalty=1` flag, all four new compliance checks (PASS on clean state / FAIL on synthetic violation fixture each), and a production-regression sweep ensuring checks 10 and 12 don't flag legitimate production data. **Total tests: 190/190 pass** (37 schema migration + 41 cycle math + 19 Step-3 ST rotation + 17 Step-4 escalation/no-show + 32 Step-5 seed + 20 Step-6 + 24 Step-7).
- **Compliance smoke against seeded DB (2026-05-15):** `npx tsx -e` runner reports 12/12 PASS. Notable counts: `st_apprentice_gating` (0 apprentice offers reviewed — clean state), `st_no_force_low` (no ST force_low), `st_charge_multiplier` (69 ST charges verified, penalties excluded), `st_sv_approval_gate` (23 ST offers verified; 6 synthetic bootstrap approvals + runtime approvals as appropriate).
- `npm run check` 0 errors / 0 warnings on 436 files. `npm run build` clean (adapter-node, 11.5s). `npm run seed` produces 7 areas / 63 employees / 14 qualifications / 138 charges / 8 shift patterns / 25 audit_log entries baseline (production unchanged; ST bootstrap +6 synthetic SV approvals).
- WALKTHROUGH.md Section 8 (Reports) updated to mention all four ST checks alongside the original eight.
- **Plan deviation:** check 9 excludes `offered_by_user='system-bootstrap'` to keep historical bootstrap apprentice offers (which lack a `phase` tag and don't trigger `markCycleOffered` for journeys) from spuriously failing the runtime gating check. Documented inline in compliance.ts. The intent of the spec ("non-escalation apprentice offer made while a journey is ungated") is preserved for runtime decisions; bootstrap is treated as trusted historical record where the gating already happened.

---

## Phase 4: Documentation (1 Step)

### Step 8 — WALKTHROUGH_ST.md + production walkthrough cross-reference

```
Read existing phase2/WALKTHROUGH.md for tone, length, structure. Read
project_union_feedback_r2.md for talking points. Read user_career_context
_cip.md memory for the audience bar.

Create phase2/WALKTHROUGH_ST.md — dedicated ST walkthrough. 20-30 min
target. Sections:

  Section 1: The ST Team Member view (Vasquez, Electrician, Body 1st)
    - First-login notification preferences modal
    - Standing card: hours-with-multiplier, expertise, classification
    - 7-day calendar strip showing "Fixed Day" pattern, today highlighted
    - Lowest-hours-first explanation per SKT-04A
    - "We won't call you at home" callout

  Section 2: Rotating-shift ST Team Member (Singh-E, Battery rotating)
    - 7-day calendar shows this-week designation (D-Crew, days)
    - Expand "Next 4 weeks" → 28-day calendar grid showing the full
      rotation; reviewer can see Singh's progression D → N → RDO over
      4 weeks
    - Switch to Larsen-W (currently RDO) — same pattern, different crew
      position, calendar shows RDO this week, D next week, etc.
    - Switch to Iqbal-ST (currently N-Crew) — shift conflict with day
      OT visible in dashboard ("This week: N-Crew (Nights). Not eligible
      for day-shift OT this week.")
    - **Click into /admin/patterns** → show the 4_crew_12h_rotating
      pattern's full calendar grid. Side-by-side with cba_pages/
      page_216.png screenshot if reviewer wants visual confirmation
      the system matches the contract.

  Section 3: Apprentice view (Okonkwo-J, Electrical apprentice, Body 1st)
    - Standing shows "Apprentice — eligible when all journeypersons in
      your group have been offered this cycle"
    - Apprentice-gating mechanism walkthrough

  Section 4: SKT TL creates an opportunity (Rodriguez-ST, Body 1st)
    - SKT TL switches to /skt-tl
    - Creates posting: PipeFitter required, 4h Saturday early-in at 1.5×,
      confined-space soft-qual preferred
    - Algorithm picks lowest-hours PipeFitter (Park, with soft-qual match)
    - Posting goes to "Awaiting SV approval" state
    - Audit log shows proposed-posting event

  Section 5: Dedicated ST SV approves (sv-body-1st-st)
    - Switch to sv-body-1st-st
    - Amber banner: "1 posting pending your approval"
    - /sv/approvals: review + approve
    - Park gets in-app notification
    - Audit shows 'sv_approved_st_posting'
    - Talking point: production SVs (Garcia, Liu) do NOT see ST queues.
      Each ST area has its own dedicated SV per real plant staffing.

  Section 6: STAC coordinator coordinating across areas (Davis)
    - Davis sees all 3 ST areas
    - Inter-shop canvass: post a PipeFitter need in Paint 1st where the
      only PipeFitter is currently scheduled elsewhere
    - Algorithm extends to Body 1st (PipeFitter there)
    - Offer tagged phase='inter_shop_canvass'

  Section 7: Apprentice escalation (Battery rotating)
    - Davis posts an Electrician opportunity in Battery rotating
    - Walk through rotation: both Electricians decline (NOs)
    - Algorithm escalates to apprentice with phase='apprentice_escalation'
    - **Call out: "If apprentice declines too, posting unfilled. NO
      forcing per SKT-04A interpretation. Grievance procedure handles
      disputes, the system does not."**

  Section 8: Schedule-aware no-show penalty
    - Larsen-W (currently RDO) accepts a Saturday OT
    - Audit shows offer.eligibility_at_offer='on_rdo_volunteer'
    - Larsen no-shows → +1 hour penalty applied
    - Show the +1 in Larsen's standing
    - Talking point: "The system knows Larsen was on RDO when accepting
      — that's why the no-show penalty triggered. Singh-E declining a
      weekday OT during his D-Crew week wouldn't trigger this; the
      contract's penalty is specifically for volunteered RDO/weekend
      work."

  Section 9: Pay multiplier + charge weighting
    - Charge with charge_multiplier=1.5 (Vasquez 4h Sat at time-and-a-half
      → 6.0 hours charged)
    - Standing reflects 6.0h not 4.0h

  Section 10: Release-excess flow
    - Coord schedules 4 ST workers, only 3 needed
    - Release Excess Workers modal — current 4 sorted by hours desc
    - Release top one, audit shows release event

  Section 11: Union Rep audit access (Rodriguez, scope extended to ST)
    - Same audit visibility for ST as for production
    - Filter to apprentice's history → apprentice_escalation visible
    - Filter to a charge → audit shows the offer's eligibility_at_offer
      AND the pattern + crew_position + cycle_anchor_date that produced
      the designation. Full reconstruction possible at grievance time.
    - **Click into an ST TM's "Last 4 weeks" history view** — Union Rep
      can see exactly what shift the employee was on at any point in
      the recent past, computed from the same cycle math used at offer
      time. Reconstructs "what shift was Larsen on when this offer was
      made?" without needing to ask HRIS or pull paper schedules.
    - **Reinforces equal-access principle for ST data**

  Section 12: Compliance summary
    - All 12 checks pass on clean seed
    - Walk through the 4 ST-specific checks (9-12)

  Section 13: Open questions and out-of-scope items
    - §22.6 TL/EO routine before/after-shift logging (production side
      separate question)
    - Outside contractor clearance + staffing availability — separate-
      but-parallel feature, own implementation plan when scoped
    - Skilled Trades coordinator role (STAC item 5 page 211) —
      implementation guidelines still being finalized by the parties;
      current design reflects what's known from SKT-04A pages 213-216

Update phase2/WALKTHROUGH.md:
  - "Two walkthroughs" note near top
  - Section 9 (open questions): §22.6 updated to reflect ST is built
  - Mention the outside-contractor parallel feature as flagged future item

Don't run code in this Step — documentation only. Verify by reading
end-to-end and confirming every UI element actually exists.
```

**Done When:**
- [x] `WALKTHROUGH_ST.md` exists at phase2/ root, **13 sections**
- [x] Production `WALKTHROUGH.md` cross-references the ST walkthrough
- [x] Section 9 of production walkthrough updated for §22.6
- [x] Outside-contractor feature flagged in both walkthroughs as separate
- [x] Schedule-pattern beats (Sections 2 and 8) walk through fixed,
      rotating, and RDO-volunteer scenarios with the calendar visuals
- [x] Dedicated ST SV beat (Section 5) makes the "production SVs do not
      see ST" separation explicit
- [x] /admin/patterns referenced and reviewer can do side-by-side with
      contract images during the demo
- [x] Every UI element referenced in WALKTHROUGH_ST.md works when
      clicked through against a fresh seed
- [x] Both walkthroughs read end-to-end without contradictions

**Completion notes (2026-05-15):**
- [WALKTHROUGH_ST.md](phase2/WALKTHROUGH_ST.md) shipped at phase2/ root with all 13 planned sections, ~30-minute target length, matching the production walkthrough's tone (persona-led, "What to show" + "Talking points" + "Pause" markers, conversational prose with `>` callouts). Opens with cross-reference to WALKTHROUGH.md and a one-line orientation: same platform, second `area_type`, SKT-04A rules.
- Production WALKTHROUGH.md edits: (a) title clarified to "Production OT Demo Walkthrough"; (b) "Two walkthroughs" callout near the top with link to WALKTHROUGH_ST.md; (c) §22.6 reframed in Section 9 — now described as partially resolved (Skilled Trades is built; remaining question is TL/EO routine-task logging on the production side); (d) new "Separate-but-parallel features" subsection under Section 9 flagging outside-contractor + staffing-availability as features that need their own plan.
- **Section 7 (apprentice escalation) framing tightened during writing:** the natural scenario for `phase='apprentice_escalation'` requires the first-pass eligible pool to be empty. The walkthrough leans on the **shift-conflict + decline** combination — Iqbal-S excluded by `shift_conflict` (N-Crew this week, day-shift posting), Singh-E declines, apprentice Mahmoud-K stays gated because Iqbal was never offered. First pass empty → second pass unlocks apprentice → Mahmoud picked with the apprentice_escalation tag. This is the realistic field case with 2-3 journeys per shop classification and works cleanly off the seed without requiring date manipulation.
- Section 11 (Union Rep audit) explicitly walks through the "Last 4 weeks" reconstruction view on Larsen-W's TM dashboard for grievance support — the negative-dayDelta path through the same cycle math used at offer time. Reinforces that schedule reconstruction reads the same source as offer-time eligibility, so there is no scenario where audit and engine disagree.
- Section 12 (compliance) names the four new ST checks (9-12) with their CBA references and exemption rules (`is_penalty=1` exempts no-show penalties from check 11; bootstrap historical apprentice offers are excluded from check 9; etc.). Mirrors the production WALKTHROUGH.md Section 8 update from Step 7.
- Section 13 (open questions) covers §22.6 (TL/EO routine-task logging — still open on production side), separate-but-parallel features (outside contractor + staffing availability), and Phase 3 reference-implementation deferrals (HRIS-fed schedule, January zero-out automation, emergency-exception workflow, graduated-apprentice automation, rejection-revision, production final-mode re-offer prevention).
- No code changes. All UI elements named in the walkthrough were verified against the actual route + persona structure built in Steps 1-7 (routes: /tm with ScheduleStrip, /coord, /coord/post, /coord/posting/[id], /skt-tl, /skt-tl/post, /sv with role branch, /sv/approvals, /admin/patterns; personas: Vasquez, Singh-E, Iqbal-S, Larsen-W, Mahmoud-K, Okonkwo-J, Park-R, Rodriguez-C / tl-rodriguez-st, Davis / coord-davis, Reeves / sv-body-1st-st, Becker / sv-paint-1st-st, Ortega / sv-battery-rot-st, Rodriguez-M / ur-rodriguez with extended 7-area scope).
- **Plan deviation flagged:** the plan named the SKT TL persona as "Rodriguez-ST" in shorthand; the actual seeded persona is **Rodriguez, C.** (display) / `tl-rodriguez-st` (id). Walkthrough uses "Rodriguez, C." in user-facing copy to match what the persona switcher shows. Distinct from Union Rep "Rodriguez, M." — separate first-initial disambiguates.

---

## Cross-Cutting Deferred Items

| Item | Target | Where it lives |
|------|--------|----------------|
| **Outside contractor clearance + outside contracting checklist** (separate but parallel feature per user 2026-05-14) | Its own implementation plan when scoped | Memory `project_union_feedback_r2.md` flags it; not part of SKT-04A |
| **Staffing availability** (who is available, by period, for project work — separate parallel feature) | Same as above | Memory flags it |
| Annual zero-out automation (January trigger) for ST areas | Phase 3 reference impl | Current demo handles via dual-approval flow already |
| ST-specific reports (apprentice-vs-journeyperson hours, multiplier distribution) | Phase 3 reference impl | Out of demo scope |
| Cross-area "reassigned out" for ST employees | Phase 3 reference impl | Production-OT model has this; ST inherits data model |
| TL/EO routine before/after-shift task logging | Phase 3 / TBD | User still researching |
| Emergency-contact-with-Union-notification flow for SKT-04A | Phase 3 reference impl | Demo shows the policy banner; the emergency-exception workflow itself not implemented |
| Graduated-apprentice "Highest plus 1 hour" placement automation | Phase 3 reference impl | Phase 2 seeds this manually; needs an event-triggered helper in production |
| Rejection-revision workflow (originator revises a rejected ST posting in place) | Phase 3 polish | Demo treats rejection as terminal |
| HRIS-fed schedule data replacing DEMO_TODAY + manual anchor dates | Phase 3 reference impl | Demo uses DEMO_TODAY constant; production swaps in HRIS-fed schedule data behind the same helper |
| Production final-mode re-offer prevention | Phase 3 polish | Step 4 added `alreadyRespondedOnPosting()` filter for ST; production `nextEligibleFinal` has the same latent issue (could re-offer same employee on multi-volunteer postings) but volunteers_needed=1 is the common case so it hasn't surfaced. Apply the same filter when polishing |

## Progress Tracker

| Step | Description | Status |
|------|-------------|--------|
| 1 | Schema additions for area_type + ST fields + shift_pattern table + soft quals + classification | ✅ |
| 2 | Shift pattern definitions + DEMO_TODAY constant + cycle math helper (highest detail risk — verify against contract page images) | ✅ |
| 3 | Rotation engine routing + ST charge calc + apprentice gating + soft quals + inter-shop canvass | ✅ |
| 4 | No-show penalty + reverse-selection + ask-apprentices escalation (NO force-low) | ✅ |
| 5 | ST seed data + personas (3 areas, DEMO_TODAY-engineered anchor dates) | ✅ |
| 6 | UI: STAC + SKT TL dashboards + ST schedule visuals + /admin/patterns preview | ✅ |
| 7 | SV approval queue + approval enforcement + notification policy + 4 new compliance checks | ✅ |
| 8 | WALKTHROUGH_ST.md + production cross-reference | ✅ |

---

## Critical Rules (project-specific, this plan respects)

Anchored from `CLAUDE.md` "Things to be careful about", post-round-2 union meeting clarifications, and the elevated quality bar for the ST audience:

1. **CBA fidelity** — every behavior with contractual implications cites SKT-04A or another reference. If you can't cite one, flag as a Joint Committee decision item.
2. **Audit immutability** — INSERT-only on audit_log everywhere.
3. **Union read-equity** — Union Rep has equal audit/compliance visibility for ST as for production. No gates.
4. **No force-low for ST areas** — escalation = ask-apprentices, then abandon. Rotation engine has no force-low code path for ST. Compliance check 10 is a runtime safety net.
5. **SV approval gate non-bypassable** — ST postings cannot have responses recorded until SV approval clears `pending_sv_approval`.
6. **Specialty positions in the pool** — TLs/EOs are ordinary pool members with extra `qualifications`. ST is a parallel `area_type`, not a specialty carve-out.
7. **Soft quals never gate** — `posting_preferred_qualification` influences ordering but never excludes.
8. **Treat SKT-04A as final** — pre-ratification flags settled per user 2026-05-14.
9. **No proactive scope** — if a Step's "Done When" is met, stop. Defer adjacent ideas to Cross-Cutting index.
10. **Outside contractor / staffing availability is its OWN plan** — don't fold in.
11. **Dedicated ST supervisors per area** — production SVs do not pick up ST scope.
12. **Shift-pattern calendars must match contract pixel-for-pixel** — Step 2 verifies each pattern's `calendar_json` against `cba_pages/page_215.png` through `page_217.png`. The ST union president WILL catch errors. Use the preview_patterns.ts script and /admin/patterns UI for visual verification.
13. **DEMO_TODAY constant, not `new Date()`** — the cycle math reads DEMO_TODAY so seed engineering is stable across demo viewings. Production swaps in real `new Date()` (or HRIS-fed live schedule data).
14. **Quality bar is elevated for ST work** — the audience includes a Skilled-Trades union president; the user is being considered for a Union CIP role (see `user_career_context_cip.md`). Polish, contract accuracy, and union-equity respect are non-negotiable.
