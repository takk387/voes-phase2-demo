// SV-1: Supervisor dashboard. Lists the supervisor's areas with summary cards.
// (§11.2 Flow SV-1.) Slice 1 supports a single area scope; Slice 2 will fan
// out to multiple areas if a supervisor has more than one.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getCurrentCycle } from '$lib/server/rotation';
import { listOpenRemedies } from '$lib/server/remedies';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (persona.role !== 'supervisor') redirect(303, '/');
  const conn = db();

  const areaIds = persona.area_scope ?? [];
  const areas = areaIds.map((aid) => {
    const area = conn
      .prepare<[string], { id: string; name: string; mode: string }>(
        `SELECT a.id, a.name, ams.mode FROM area a
           JOIN area_mode_setting ams
             ON ams.area_id = a.id AND ams.effective_end_date IS NULL
          WHERE a.id = ?`
      )
      .get(aid);
    if (!area) return null;

    const cycle = getCurrentCycle(area.id);
    const memberCount = conn
      .prepare<[string], { c: number }>(
        `SELECT COUNT(*) AS c FROM area_membership
          WHERE area_id = ? AND effective_end_date IS NULL`
      )
      .get(area.id);

    const openPostings = conn
      .prepare<[string], {
        id: string; work_date: string; start_time: string;
        duration_hours: number; volunteers_needed: number;
        yes_count: number; criticality: string; ot_type: string;
      }>(
        `SELECT p.id, p.work_date, p.start_time, p.duration_hours,
                p.volunteers_needed, p.criticality, p.ot_type,
                (SELECT COUNT(*) FROM offer o JOIN response r
                   ON r.offer_id = o.id
                  WHERE o.posting_id = p.id AND r.response_type = 'yes') AS yes_count
           FROM posting p
          WHERE p.area_id = ? AND p.status = 'open'
          ORDER BY p.work_date, p.start_time`
      )
      .all(area.id);

    const recentlyCompleted = conn
      .prepare<[string], {
        id: string; work_date: string; start_time: string;
        duration_hours: number; volunteers_needed: number; status: string;
      }>(
        `SELECT id, work_date, start_time, duration_hours, volunteers_needed, status
           FROM posting
          WHERE area_id = ? AND status IN ('satisfied','cancelled','abandoned')
          ORDER BY work_date DESC, start_time DESC
          LIMIT 5`
      )
      .all(area.id);

    return {
      id: area.id,
      name: area.name,
      mode: area.mode,
      cycle,
      memberCount: memberCount?.c ?? 0,
      openPostings,
      recentlyCompleted
    };
  }).filter(Boolean);

  const openRemedies = listOpenRemedies(areaIds);

  return { areas, openRemedies };
};
