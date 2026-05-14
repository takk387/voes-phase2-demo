// Fairness report (§15.3). Per area, computes the distribution of OT
// opportunities across active TMs and flags areas with deviations exceeding
// the threshold. Default threshold is fixed 10%; configurable.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';

const FAIRNESS_THRESHOLD_PCT = 10; // operational default

interface MemberStats {
  employee_id: string;
  display_name: string;
  hire_date: string;
  measure: number;        // opportunities (interim) or hours offered (final)
}

interface AreaFairness {
  id: string;
  name: string;
  mode: 'interim' | 'final';
  measure_label: string;  // 'opportunities' or 'hours offered'
  members: MemberStats[];
  count: number;
  mean: number;
  min: number;
  max: number;
  max_dev_pct: number;    // largest |member - mean| as % of mean
  flagged: boolean;
  threshold_pct: number;
}

function statsFor(area_id: string, mode: 'interim' | 'final'): AreaFairness | null {
  const conn = db();
  const area = conn.prepare(`SELECT id, name FROM area WHERE id = ?`).get(area_id) as { id: string; name: string } | undefined;
  if (!area) return null;

  const today = new Date().toISOString().slice(0, 10);
  const members = conn
    .prepare(
      `SELECT e.id AS employee_id, e.display_name, e.hire_date
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
        WHERE m.area_id = ?
          AND m.effective_begin_date <= ?
          AND (m.effective_end_date IS NULL OR m.effective_end_date > ?)
          AND e.status = 'active'`
    )
    .all(area_id, today, today) as { employee_id: string; display_name: string; hire_date: string }[];

  const measureRows = mode === 'final'
    ? conn
        .prepare(
          `SELECT employee_id, COALESCE(SUM(amount), 0) AS m FROM charge
            WHERE area_id = ? AND charge_type = 'hours_offered'
            GROUP BY employee_id`
        )
        .all(area_id) as { employee_id: string; m: number }[]
    : conn
        .prepare(
          `SELECT employee_id, COUNT(*) AS m FROM charge
            WHERE area_id = ? AND charge_type = 'opportunity'
            GROUP BY employee_id`
        )
        .all(area_id) as { employee_id: string; m: number }[];
  const map = new Map(measureRows.map((r) => [r.employee_id, r.m]));

  const stats: MemberStats[] = members.map((m) => ({
    employee_id: m.employee_id,
    display_name: m.display_name,
    hire_date: m.hire_date,
    measure: map.get(m.employee_id) ?? 0
  }));

  const count = stats.length;
  if (count === 0) {
    return {
      id: area.id, name: area.name, mode,
      measure_label: mode === 'final' ? 'hours offered' : 'opportunities',
      members: [], count: 0, mean: 0, min: 0, max: 0, max_dev_pct: 0,
      flagged: false, threshold_pct: FAIRNESS_THRESHOLD_PCT
    };
  }

  const sum = stats.reduce((s, x) => s + x.measure, 0);
  const mean = sum / count;
  const min = Math.min(...stats.map((s) => s.measure));
  const max = Math.max(...stats.map((s) => s.measure));
  const max_abs_dev = Math.max(...stats.map((s) => Math.abs(s.measure - mean)));
  const max_dev_pct = mean > 0 ? (max_abs_dev / mean) * 100 : 0;
  const flagged = max_dev_pct > FAIRNESS_THRESHOLD_PCT && mean > 0;

  // Sort: largest deviators first, so the report opens to the most
  // interesting cases.
  stats.sort((a, b) => Math.abs(b.measure - mean) - Math.abs(a.measure - mean));

  return {
    id: area.id, name: area.name, mode,
    measure_label: mode === 'final' ? 'hours offered' : 'opportunities',
    members: stats, count,
    mean: Math.round(mean * 10) / 10,
    min, max,
    max_dev_pct: Math.round(max_dev_pct * 10) / 10,
    flagged,
    threshold_pct: FAIRNESS_THRESHOLD_PCT
  };
}

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (!['union_rep', 'supervisor', 'plant_manager', 'admin'].includes(persona.role)) {
    redirect(303, '/');
  }

  const conn = db();
  let areaIds: string[];
  if (persona.role === 'admin' || persona.role === 'plant_manager') {
    areaIds = (conn.prepare(`SELECT id FROM area WHERE status = 'active' ORDER BY name`).all() as { id: string }[]).map((r) => r.id);
  } else {
    areaIds = persona.area_scope ?? [];
  }

  const areaModes = conn
    .prepare(`SELECT area_id, mode FROM area_mode_setting WHERE effective_end_date IS NULL`)
    .all() as { area_id: string; mode: 'interim' | 'final' }[];
  const modeMap = new Map(areaModes.map((r) => [r.area_id, r.mode]));

  const areas: AreaFairness[] = areaIds
    .map((id) => statsFor(id, modeMap.get(id) ?? 'interim'))
    .filter((a): a is AreaFairness => a !== null);

  return { areas, threshold_pct: FAIRNESS_THRESHOLD_PCT };
};
