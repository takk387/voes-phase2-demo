// SKT TL new-posting form. Reuses the createSTPosting helper from /coord/post.
// Difference vs coord: the area is locked to the TL's single area scope.

import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createSTPosting } from '$lib/server/st_posting_actions';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.persona.role !== 'skt_tl') redirect(303, '/');
  const scope = locals.persona.area_scope ?? [];
  if (scope.length === 0) error(400, 'No ST area in scope');

  const conn = db();
  const areas = conn
    .prepare(
      `SELECT id, name FROM area
        WHERE type = 'skilled_trades' AND id IN (${scope.map(() => '?').join(',')})
        ORDER BY name`
    )
    .all(...scope) as { id: string; name: string }[];

  if (areas.length === 0) error(404, 'Scoped area not found or not ST');

  const qualifications = conn
    .prepare<[], { id: string; name: string }>(
      `SELECT id, name FROM qualification ORDER BY name`
    )
    .all();

  return { areas, selectedAreaId: areas[0].id, qualifications };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (locals.persona.role !== 'skt_tl') return fail(403, { error: 'Not authorized' });
    return createSTPosting(request, locals, 'skt_tl');
  }
};
