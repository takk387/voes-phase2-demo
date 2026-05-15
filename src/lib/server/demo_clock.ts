// DEMO_TODAY — single source of truth for "today" across the demo.
//
// The Skilled Trades rotation engine derives each ST employee's shift
// designation (D / N / RDO) from `(work_date - cycle_anchor_date) mod
// cycle_length_days`. If we used `new Date()`, the seeded designations
// engineered into the persona fixtures would drift every time wall-clock
// time advances — a Battery-rotating persona seeded as "currently on D-Crew
// week" would silently become "currently on RDO" or "currently on N-Crew"
// depending on when the demo was opened. That defeats the whole point of
// engineering specific narrative scenarios into the seed.
//
// So all rotation math in the ST path reads DEMO_TODAY instead of the
// system clock. Production (PS-036) rotation does not need this — it uses
// the legacy `employee.shift` field, not a cycle calendar.
//
// Production hand-off (Phase 3 reference impl): swap DEMO_TODAY for
// `new Date()` and feed HRIS-sourced anchor dates. Everything downstream
// keeps working — the helper signature doesn't change.

// 2026-05-14 is the date round-2 union consultation closed and the date
// the seed personas are engineered around. Reset Demo may advance this
// (see seed.ts), but the default is stable.
export const DEMO_TODAY = '2026-05-14';

export function demoToday(): Date {
  return new Date(DEMO_TODAY + 'T00:00:00Z');
}

// Convenience: get DEMO_TODAY as a YYYY-MM-DD string (same value as the
// constant, but typed as string for callers that just need the ISO date).
export function demoTodayIso(): string {
  return DEMO_TODAY;
}
