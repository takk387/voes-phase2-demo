// Schedule-view helpers (Step 6). Computes the calendar grids the TM
// dashboard renders for ST employees:
//
//   - 7-day strip covering the demo's "this week" (Mon..Sun of DEMO_TODAY)
//   - 28-day "Next 4 weeks" grid
//   - 28-day "Last 4 weeks" grid (history reconstruction — uses the same
//     cycle math with negative dayDelta; the cycle helper from Step 2 already
//     handles it via positive modulo)
//
// All grids are computed server-side using getDesignation() so the
// Svelte component only renders cells. demo_clock.DEMO_TODAY is the
// anchor — production swaps in real `new Date()` (or HRIS-fed schedule
// data) behind this same shape.

import { demoToday } from './demo_clock.js';
import {
  getDesignation,
  lookupPattern,
  type EmployeeScheduleFields,
  type ShiftDesignation
} from './schedule_eligibility.js';

export interface ScheduleDay {
  date: string;            // YYYY-MM-DD
  weekday_short: string;   // 'Mon', 'Tue', etc.
  day_of_month: number;
  designation: ShiftDesignation | null;
  is_today: boolean;
}

export interface ScheduleGrid {
  start_date: string;
  end_date: string;
  days: ScheduleDay[];
}

export interface ScheduleView {
  pattern_name: string;
  pattern_description: string | null;
  crew_position: number | null;
  this_week: ScheduleGrid;
  next_four_weeks: ScheduleGrid;
  last_four_weeks: ScheduleGrid;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Most recent Monday on or before `iso`. Used as the "this-week" anchor so
// the strip always reads M T W Th F Sa Su.
function mostRecentMonday(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  // Days back to Monday: (dow + 6) % 7
  return addDays(iso, -((dow + 6) % 7));
}

function buildGrid(
  employee: EmployeeScheduleFields,
  start_date: string,
  span_days: number,
  today_iso: string
): ScheduleGrid {
  const days: ScheduleDay[] = [];
  for (let i = 0; i < span_days; i++) {
    const date = addDays(start_date, i);
    const d = new Date(date + 'T00:00:00Z');
    days.push({
      date,
      weekday_short: WEEKDAY_SHORT[d.getUTCDay()],
      day_of_month: d.getUTCDate(),
      designation: getDesignation(employee, date),
      is_today: date === today_iso
    });
  }
  return {
    start_date,
    end_date: addDays(start_date, span_days - 1),
    days
  };
}

/**
 * Builds the full schedule view for an ST employee. Returns null for
 * production employees (no shift_pattern_id) or ST employees missing
 * the required schedule fields — callers should fall back to "no
 * schedule visual" UI in those cases.
 */
export function buildScheduleView(employee: EmployeeScheduleFields): ScheduleView | null {
  if (employee.shift_pattern_id == null) return null;
  const pattern = lookupPattern(employee.shift_pattern_id);
  if (!pattern) return null;
  if (employee.cycle_anchor_date == null) return null;

  const today_iso = demoToday().toISOString().slice(0, 10);
  const thisWeekStart = mostRecentMonday(today_iso);

  // 4-week views: start aligned to a week boundary too so the grid renders
  // cleanly. Next-4-weeks starts at next Monday (today + 7 from this-week's
  // start); last-4-weeks starts 28 days before this week's start.
  const nextStart = addDays(thisWeekStart, 7);
  const lastStart = addDays(thisWeekStart, -28);

  return {
    pattern_name: pattern.name,
    pattern_description: pattern.description,
    crew_position: employee.crew_position,
    this_week: buildGrid(employee, thisWeekStart, 7, today_iso),
    next_four_weeks: buildGrid(employee, nextStart, 28, today_iso),
    last_four_weeks: buildGrid(employee, lastStart, 28, today_iso)
  };
}
