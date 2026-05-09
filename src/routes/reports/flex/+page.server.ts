// Flex day usage report (PS-004A + §22.10).
//
// PS-004A caps Mandatory Flex days at 24 per shift per calendar year,
// equalized between shifts. Per round 1 union feedback (§22.10), voluntary
// OT is excluded from the count — the cap is for mandatory Flex days only.
//
// Display: per shift, the year-to-date count of mandatory_flex postings
// against the 24-day cap; flagged amber at 18-23, red at 24+.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';

const ANNUAL_CAP = 24;

interface ShiftFlexUsage {
  shift: string;
  ytd_count: number;
  remaining: number;
  status: 'green' | 'amber' | 'red';
}

export const load: PageServerLoad = ({ locals }) => {
  const role = locals.persona.role;
  if (!['supervisor', 'union_rep', 'plant_manager', 'admin'].includes(role)) {
    redirect(303, '/');
  }

  const conn = db();
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

  const shifts = (
    conn.prepare(`SELECT DISTINCT shift FROM area WHERE status = 'active' ORDER BY shift`).all() as { shift: string }[]
  ).map((r) => r.shift);

  const usage: ShiftFlexUsage[] = shifts.map((shift) => {
    const c = (
      conn
        .prepare(
          `SELECT COUNT(DISTINCT p.work_date) AS c
             FROM posting p
             JOIN area a ON a.id = p.area_id
            WHERE p.ot_type = 'mandatory_flex'
              AND p.work_date >= ?
              AND a.shift = ?`
        )
        .get(yearStart, shift) as { c: number }
    ).c;
    let status: 'green' | 'amber' | 'red' = 'green';
    if (c >= ANNUAL_CAP) status = 'red';
    else if (c >= ANNUAL_CAP - 6) status = 'amber';
    return { shift, ytd_count: c, remaining: Math.max(0, ANNUAL_CAP - c), status };
  });

  // Recent mandatory Flex postings (any shift) for the activity panel.
  const recent = conn
    .prepare(
      `SELECT p.id, p.area_id, a.name AS area_name, a.shift, p.work_date, p.status, p.posted_at
         FROM posting p
         JOIN area a ON a.id = p.area_id
        WHERE p.ot_type = 'mandatory_flex' AND p.work_date >= ?
        ORDER BY p.work_date DESC LIMIT 25`
    )
    .all(yearStart) as Array<{
      id: string; area_id: string; area_name: string; shift: string;
      work_date: string; status: string; posted_at: string;
    }>;

  return {
    usage,
    recent,
    annual_cap: ANNUAL_CAP,
    year: new Date().getFullYear(),
    year_start: yearStart
  };
};
