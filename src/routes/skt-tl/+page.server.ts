// Skilled Trades Team Leader dashboard (Step 6). Single-area scope; otherwise
// identical to /coord (renders one area summary card + recent activity).

import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { summarizeSTArea, type STAreaSummary } from '$lib/server/st_dashboard';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (persona.role !== 'skt_tl') redirect(303, '/');

  const scope = persona.area_scope ?? [];
  if (scope.length === 0) error(400, 'No ST area in scope');

  const areas = scope
    .map((aid) => summarizeSTArea(aid))
    .filter((a): a is STAreaSummary => a !== null);

  return { areas };
};
