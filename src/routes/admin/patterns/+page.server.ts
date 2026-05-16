// Admin pattern preview (Step 6). Renders all 8 shift patterns as
// crew × day-of-cycle calendar grids, color-coded D / A / N / RDO.
// Pixel-comparable to the SKT-04A contract images (cba_pages/page_215.png
// through page_217.png) — Critical Rule #12 calls this out as the
// credibility-anchor view for the ST union president.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { ShiftDesignation } from '$lib/server/schedule_eligibility';

export interface PatternForView {
  id: number;
  name: string;
  description: string | null;
  cycle_length_days: number;
  crew_count: number;
  // calendar[crew_idx][day_in_cycle] -> designation
  calendar: ShiftDesignation[][];
}

export const load: PageServerLoad = ({ locals }) => {
  if (locals.persona.role !== 'admin') redirect(303, '/');

  const conn = db();
  const rows = conn
    .prepare<[], {
      id: number; name: string; description: string | null;
      cycle_length_days: number; crew_count: number; calendar_json: string;
    }>(
      `SELECT id, name, description, cycle_length_days, crew_count, calendar_json
         FROM shift_pattern
        ORDER BY crew_count, cycle_length_days, name`
    )
    .all();

  const patterns: PatternForView[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    cycle_length_days: r.cycle_length_days,
    crew_count: r.crew_count,
    calendar: JSON.parse(r.calendar_json) as ShiftDesignation[][]
  }));

  return { patterns };
};
