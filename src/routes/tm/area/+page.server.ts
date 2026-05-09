// Area equalization list — the "openly displayed" view per the CBA.
// Shows every TM in the area with their current standing.
//
// Open to:
//   - Team Member: defaults to their own area membership
//   - Supervisor: their area scope (?area= query picks; default first)
//   - Union Rep: their area scope (?area= query picks; default first)
//   - Plant Mgmt / Admin: any active area (?area= query picks; default first)

import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { areaStanding, getCurrentCycle } from '$lib/server/rotation';

export const load: PageServerLoad = ({ locals, url }) => {
  const persona = locals.persona;
  if (persona.role === 'plant_manager') {
    // Plant Manager has no operational view here per the demo's structure;
    // route them to /reports instead. (They can still navigate here manually
    // by pasting a URL, but it's not their default landing.)
  }

  const conn = db();

  // Resolve the candidate area list visible to this persona.
  let visibleAreaIds: string[] = [];
  if (persona.role === 'team_member' && persona.employee_id) {
    const memberships = conn
      .prepare<[string], { area_id: string }>(
        `SELECT m.area_id FROM area_membership m
          WHERE m.employee_id = ? AND m.effective_end_date IS NULL`
      )
      .all(persona.employee_id);
    visibleAreaIds = memberships.map((r) => r.area_id);
  } else if (persona.role === 'supervisor' || persona.role === 'union_rep') {
    visibleAreaIds = persona.area_scope ?? [];
  } else if (persona.role === 'plant_manager' || persona.role === 'admin') {
    visibleAreaIds = (
      conn
        .prepare(`SELECT id FROM area WHERE status = 'active' ORDER BY name`)
        .all() as { id: string }[]
    ).map((r) => r.id);
  } else {
    redirect(303, '/');
  }

  if (visibleAreaIds.length === 0) {
    error(404, 'No areas in your jurisdiction');
  }

  // Resolve the chosen area: ?area= if present and visible, else first visible.
  const requested = url.searchParams.get('area');
  const chosenAreaId =
    requested && visibleAreaIds.includes(requested) ? requested : visibleAreaIds[0];

  const area = conn
    .prepare<[string], { area_id: string; area_name: string; posting_location: string; mode: string }>(
      `SELECT a.id AS area_id, a.name AS area_name, a.posting_location, ams.mode
         FROM area a
         JOIN area_mode_setting ams
           ON ams.area_id = a.id AND ams.effective_end_date IS NULL
        WHERE a.id = ?`
    )
    .get(chosenAreaId);
  if (!area) error(404, 'Area not found');

  // Pull display info for all visible areas (for the picker).
  const visibleAreas = visibleAreaIds.length === 1
    ? [{ id: area.area_id, name: area.area_name }]
    : (
        conn
          .prepare(
            `SELECT id, name FROM area WHERE id IN (${visibleAreaIds.map(() => '?').join(',')}) ORDER BY name`
          )
          .all(...visibleAreaIds) as { id: string; name: string }[]
      );

  const today = new Date().toISOString().slice(0, 10);
  const standing = areaStanding(area.area_id, today);
  const cycle = getCurrentCycle(area.area_id);

  return {
    area,
    standing,
    cycle,
    myEmployeeId: persona.employee_id ?? null,
    visibleAreas,
    canChooseArea: visibleAreas.length > 1
  };
};
