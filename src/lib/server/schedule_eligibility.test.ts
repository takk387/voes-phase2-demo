// Cycle-math + eligibility tests for the Skilled Trades rotation engine.
//
// Strategy:
//   1. Open a fresh :memory: DB per test, apply schemaSql + runMigrations
//   2. Seed the shift_pattern table with all 8 canonical patterns
//   3. Patch the `db()` singleton to return our test connection for the
//      duration of the test (the schedule_eligibility cache reads through
//      `db()`)
//   4. Reset the pattern cache between tests
//
// We test:
//   - Production fallback (shift_pattern_id NULL → null designation)
//   - Single-crew patterns (fixed_day on Mon vs Sat)
//   - Multi-crew indexing (2_crew_fixed_d_n Crew 1 vs Crew 2)
//   - Negative dayDelta (history reconstruction)
//   - Multi-cycle dayDelta (far future)
//   - 4_crew_12h_rotating spot checks for each crew across all 4 weeks
//   - 4_crew_12h_fixed pair structure
//   - 1_crew_weekend bi-weekly cycle
//   - 2_crew_fixed_d_n offset Sun N for Crew 2
//   - isOnDutyDateScheduled returns on_rdo_volunteer for RDO designation
//   - isOnDutyDateScheduled returns shift_conflict when slots disagree
//   - isOnDutyDateScheduled returns on_normal_shift for production employees

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schemaSql } from './schema.js';
import { runMigrations } from './db.js';
import { seedShiftPatterns } from './shift_patterns.js';
import {
  getDesignation,
  isOnDutyDateScheduled,
  lookupPattern,
  _resetPatternCacheForTests,
  type EmployeeScheduleFields
} from './schedule_eligibility.js';

let conn: Database.Database;

beforeEach(async () => {
  conn = new Database(':memory:');
  conn.pragma('foreign_keys = ON');
  conn.exec(schemaSql);
  runMigrations(conn);
  seedShiftPatterns(conn);

  // Patch the db() module export so the eligibility helper's cache loads
  // from THIS connection rather than the real on-disk DB.
  const dbModule = await import('./db.js');
  vi.spyOn(dbModule, 'db').mockReturnValue(conn);
  _resetPatternCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  conn.close();
});

function patternIdByName(name: string): number {
  const row = conn
    .prepare(`SELECT id FROM shift_pattern WHERE name = ?`)
    .get(name) as { id: number } | undefined;
  if (!row) throw new Error(`shift_pattern '${name}' not seeded`);
  return row.id;
}

function emp(opts: Partial<EmployeeScheduleFields> = {}): EmployeeScheduleFields {
  return {
    shift_pattern_id: null,
    crew_position: null,
    cycle_anchor_date: null,
    ...opts
  };
}

describe('getDesignation — production fallback', () => {
  it('returns null when shift_pattern_id is null (production employee)', () => {
    expect(getDesignation(emp({ shift: '1st' }), '2026-05-14')).toBeNull();
  });

  it('returns null when pattern row is missing for a given id', () => {
    expect(getDesignation(emp({ shift_pattern_id: 9999, cycle_anchor_date: '2026-05-14' }), '2026-05-14')).toBeNull();
  });

  it('returns null when cycle_anchor_date is missing', () => {
    const id = patternIdByName('fixed_day');
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: null }), '2026-05-14')).toBeNull();
  });

  it('returns null for multi-crew pattern when crew_position is missing', () => {
    const id = patternIdByName('2_crew_fixed_d_n');
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: null, cycle_anchor_date: '2026-05-04' }), '2026-05-14')
    ).toBeNull();
  });

  it('returns null for multi-crew pattern when crew_position is out of range', () => {
    const id = patternIdByName('2_crew_fixed_d_n');
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 3, cycle_anchor_date: '2026-05-04' }), '2026-05-14')
    ).toBeNull();
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 0, cycle_anchor_date: '2026-05-04' }), '2026-05-14')
    ).toBeNull();
  });
});

describe('getDesignation — fixed_day (single crew, 7-day cycle)', () => {
  // Anchor: Mon 2026-05-04. Mon is day_in_cycle=0 → 'D'.
  let id: number;
  beforeEach(() => {
    id = patternIdByName('fixed_day');
  });

  it('Monday at anchor returns D', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-05-04')).toBe('D');
  });
  it('Friday returns D', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-05-08')).toBe('D');
  });
  it('Saturday returns RDO', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-05-09')).toBe('RDO');
  });
  it('Sunday returns RDO', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-05-10')).toBe('RDO');
  });
  it('next Monday (day 7 into a 7-day cycle) returns D again', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-05-11')).toBe('D');
  });
});

describe('getDesignation — modulo edges (negative + far positive dayDelta)', () => {
  let id: number;
  beforeEach(() => {
    id = patternIdByName('fixed_day');
  });

  it('handles dayDelta = -1 (one day before anchor — Sunday is RDO)', () => {
    // 2026-05-03 is a Sunday; cycle "Sunday" maps to day 6 of the previous
    // cycle, which is RDO under fixed_day.
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-05-03')).toBe('RDO');
  });

  it('handles dayDelta = -7 (one cycle before — same designation as anchor)', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-04-27')).toBe('D');
  });

  it('handles dayDelta = -8 (Sun before previous Monday — RDO)', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-04-26')).toBe('RDO');
  });

  it('handles many cycles forward (52 weeks later, same weekday)', () => {
    // 52 × 7 = 364 days; +1 day = 365 (one year). Anchor=Mon 2026-05-04 +365 = Tue 2027-05-04.
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2027-05-04')).toBe('D');
  });
});

describe('getDesignation — 2_crew_fixed_d_n (multi-crew, offset Sun N for Crew 2)', () => {
  let id: number;
  beforeEach(() => {
    id = patternIdByName('2_crew_fixed_d_n');
  });

  it('Crew 1 (D crew): Mon D, Fri D, Sat RDO', () => {
    const e = emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' });
    expect(getDesignation(e, '2026-05-04')).toBe('D');
    expect(getDesignation(e, '2026-05-08')).toBe('D');
    expect(getDesignation(e, '2026-05-09')).toBe('RDO');
  });

  it('Crew 2 (N crew, offset): Mon N, Thu N, Fri RDO, Sat RDO, Sun N (the offset!)', () => {
    const e = emp({ shift_pattern_id: id, crew_position: 2, cycle_anchor_date: '2026-05-04' });
    expect(getDesignation(e, '2026-05-04')).toBe('N');         // Mon
    expect(getDesignation(e, '2026-05-07')).toBe('N');         // Thu
    expect(getDesignation(e, '2026-05-08')).toBe('RDO');       // Fri
    expect(getDesignation(e, '2026-05-09')).toBe('RDO');       // Sat
    expect(getDesignation(e, '2026-05-10')).toBe('N');         // Sun — the contract's offset N
  });
});

describe('getDesignation — 1_crew_weekend (14-day bi-weekly cycle)', () => {
  let id: number;
  beforeEach(() => {
    id = patternIdByName('1_crew_weekend');
  });

  it('Week 1 Mon (anchor): D (10h work day)', () => {
    expect(getDesignation(emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' }), '2026-05-04')).toBe('D');
  });

  it('Week 1 Tue-Thu: RDO', () => {
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(getDesignation(e, '2026-05-05')).toBe('RDO');
    expect(getDesignation(e, '2026-05-06')).toBe('RDO');
    expect(getDesignation(e, '2026-05-07')).toBe('RDO');
  });

  it('Week 1 Fri-Sun: D', () => {
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(getDesignation(e, '2026-05-08')).toBe('D');
    expect(getDesignation(e, '2026-05-09')).toBe('D');
    expect(getDesignation(e, '2026-05-10')).toBe('D');
  });

  it('Week 2 Mon-Thu: RDO (the contract\'s "every other Monday" off week)', () => {
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(getDesignation(e, '2026-05-11')).toBe('RDO');
    expect(getDesignation(e, '2026-05-12')).toBe('RDO');
    expect(getDesignation(e, '2026-05-13')).toBe('RDO');
    expect(getDesignation(e, '2026-05-14')).toBe('RDO');
  });

  it('Week 2 Fri-Sun: D', () => {
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(getDesignation(e, '2026-05-15')).toBe('D');
    expect(getDesignation(e, '2026-05-16')).toBe('D');
    expect(getDesignation(e, '2026-05-17')).toBe('D');
  });
});

describe('getDesignation — 4_crew_12h_rotating (28-day, 4 crews, Crew 4 asymmetric)', () => {
  let id: number;
  beforeEach(() => {
    id = patternIdByName('4_crew_12h_rotating');
  });

  // Anchor: Mon 2026-05-04 (day 0 of cycle for Crew 1).

  it('Crew 1 Week 1 Mon: D', () => {
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' }), '2026-05-04')
    ).toBe('D');
  });

  it('Crew 1 Week 2 Fri (day 11): N', () => {
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' }), '2026-05-15')
    ).toBe('N');
  });

  it('Crew 1 Week 3 Mon (day 14): N (the single-N transition)', () => {
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' }), '2026-05-18')
    ).toBe('N');
  });

  it('Crew 2 Week 1 Mon (day 0): N', () => {
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 2, cycle_anchor_date: '2026-05-04' }), '2026-05-04')
    ).toBe('N');
  });

  it('Crew 2 Week 3 Mon (day 14): D', () => {
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 2, cycle_anchor_date: '2026-05-04' }), '2026-05-18')
    ).toBe('D');
  });

  it('Crew 4 Week 4 Mon (day 21): D (the single D block — predominantly-nights crew)', () => {
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 4, cycle_anchor_date: '2026-05-04' }), '2026-05-25')
    ).toBe('D');
  });

  it('Crew 4 Week 2 Fri (day 11): N (double-staffed nights — both Crew 1 and Crew 4 on N)', () => {
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 4, cycle_anchor_date: '2026-05-04' }), '2026-05-15')
    ).toBe('N');
    // Crew 1 is also N this day — sanity-cross-check:
    expect(
      getDesignation(emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' }), '2026-05-15')
    ).toBe('N');
  });

  it('cycle wraps cleanly — day 28 == day 0 designation for every crew', () => {
    for (let crew = 1; crew <= 4; crew++) {
      const e = emp({ shift_pattern_id: id, crew_position: crew, cycle_anchor_date: '2026-05-04' });
      const day0 = getDesignation(e, '2026-05-04');
      const day28 = getDesignation(e, '2026-06-01');
      expect(day28).toBe(day0);
    }
  });
});

describe('getDesignation — 4_crew_12h_fixed (14-day, fixed crews)', () => {
  let id: number;
  beforeEach(() => {
    id = patternIdByName('4_crew_12h_fixed');
  });

  it('Crew 1 (N-only): never returns D or A', () => {
    const e = emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' });
    for (let offset = 0; offset < 14; offset++) {
      const date = new Date('2026-05-04T00:00:00Z');
      date.setUTCDate(date.getUTCDate() + offset);
      const iso = date.toISOString().slice(0, 10);
      const d = getDesignation(e, iso);
      expect(['N', 'RDO']).toContain(d);
    }
  });

  it('Crew 2 (D-only): never returns N or A', () => {
    const e = emp({ shift_pattern_id: id, crew_position: 2, cycle_anchor_date: '2026-05-04' });
    for (let offset = 0; offset < 14; offset++) {
      const date = new Date('2026-05-04T00:00:00Z');
      date.setUTCDate(date.getUTCDate() + offset);
      const iso = date.toISOString().slice(0, 10);
      const d = getDesignation(e, iso);
      expect(['D', 'RDO']).toContain(d);
    }
  });

  it('Pair structure: when Crew 1 is N, Crew 2 is D, both on same days', () => {
    const c1 = emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' });
    const c2 = emp({ shift_pattern_id: id, crew_position: 2, cycle_anchor_date: '2026-05-04' });
    for (let offset = 0; offset < 14; offset++) {
      const date = new Date('2026-05-04T00:00:00Z');
      date.setUTCDate(date.getUTCDate() + offset);
      const iso = date.toISOString().slice(0, 10);
      const d1 = getDesignation(c1, iso);
      const d2 = getDesignation(c2, iso);
      // When one is working, the other is working — and they're on opposite shifts.
      if (d1 === 'N') expect(d2).toBe('D');
      if (d1 === 'RDO') expect(d2).toBe('RDO');
    }
  });

  it('Crew 1 vs Crew 3 work opposite days (different pair)', () => {
    const c1 = emp({ shift_pattern_id: id, crew_position: 1, cycle_anchor_date: '2026-05-04' });
    const c3 = emp({ shift_pattern_id: id, crew_position: 3, cycle_anchor_date: '2026-05-04' });
    // Mon: Crew 1 RDO, Crew 3 N
    expect(getDesignation(c1, '2026-05-04')).toBe('RDO');
    expect(getDesignation(c3, '2026-05-04')).toBe('N');
    // Tue: Crew 1 N, Crew 3 RDO
    expect(getDesignation(c1, '2026-05-05')).toBe('N');
    expect(getDesignation(c3, '2026-05-05')).toBe('RDO');
  });
});

describe('isOnDutyDateScheduled', () => {
  it('production employee → on_normal_shift (fallback)', () => {
    expect(isOnDutyDateScheduled(emp({ shift: '1st' }), '2026-05-14', '07:00')).toBe('on_normal_shift');
  });

  it('ST on RDO → on_rdo_volunteer (no-show penalty trigger on accept-then-no-show)', () => {
    const id = patternIdByName('fixed_day');
    // Sat 2026-05-09 is RDO for fixed_day with Mon 2026-05-04 anchor
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(isOnDutyDateScheduled(e, '2026-05-09', '07:00')).toBe('on_rdo_volunteer');
  });

  it('ST on D-designation + day-time posting → on_normal_shift', () => {
    const id = patternIdByName('fixed_day');
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(isOnDutyDateScheduled(e, '2026-05-04', '07:00')).toBe('on_normal_shift');
  });

  it('ST on N-designation + day-time posting (07:00) → shift_conflict', () => {
    const id = patternIdByName('fixed_night');
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(isOnDutyDateScheduled(e, '2026-05-04', '07:00')).toBe('shift_conflict');
  });

  it('ST on N-designation + night-time posting (22:00) → on_normal_shift', () => {
    const id = patternIdByName('fixed_night');
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(isOnDutyDateScheduled(e, '2026-05-04', '22:00')).toBe('on_normal_shift');
  });

  it('ST on A-designation + afternoon posting (15:00) → on_normal_shift', () => {
    const id = patternIdByName('fixed_evening');
    const e = emp({ shift_pattern_id: id, cycle_anchor_date: '2026-05-04' });
    expect(isOnDutyDateScheduled(e, '2026-05-04', '15:00')).toBe('on_normal_shift');
  });
});

describe('lookupPattern caching', () => {
  it('returns parsed calendar (not raw JSON)', () => {
    const id = patternIdByName('fixed_day');
    const p = lookupPattern(id);
    expect(p).toBeDefined();
    expect(p!.calendar).toEqual([['D', 'D', 'D', 'D', 'D', 'RDO', 'RDO']]);
  });

  it('returns undefined for unknown id', () => {
    expect(lookupPattern(99999)).toBeUndefined();
  });
});
