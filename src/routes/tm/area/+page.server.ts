// TM-2: Area equalization list — the "openly displayed" view per the CBA.
// Shows every TM in the area with their current standing.

import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { areaStanding, getCurrentCycle } from '$lib/server/rotation';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (persona.role !== 'team_member' || !persona.employee_id) {
    redirect(303, '/');
  }
  const conn = db();

  const membership = conn
    .prepare<[string], { area_id: string; area_name: string; posting_location: string; mode: string }>(
      `SELECT a.id AS area_id, a.name AS area_name, a.posting_location,
              ams.mode
         FROM area_membership m
         JOIN area a ON a.id = m.area_id
         JOIN area_mode_setting ams
           ON ams.area_id = a.id AND ams.effective_end_date IS NULL
        WHERE m.employee_id = ?
          AND m.effective_end_date IS NULL
        LIMIT 1`
    )
    .get(persona.employee_id);
  if (!membership) error(404, 'No active area membership');

  const today = new Date().toISOString().slice(0, 10);
  const standing = areaStanding(membership.area_id, today);
  const cycle = getCurrentCycle(membership.area_id);

  return { area: membership, standing, cycle, myEmployeeId: persona.employee_id };
};
