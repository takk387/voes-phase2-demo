// STAC Coordinator dashboard (Step 6). Lists the coord's ST areas with the
// expertise-group / apprentice counts, the lowest-hours next-up TM per
// expertise, and recent posting activity (including pending SV approval).
//
// Coord posts a new ST opportunity from here; the algorithm picks the first
// candidate as a *proposed* offer; the dedicated ST SV approves and the
// proposed offer is promoted to pending (Step 7's approval queue handles
// the SV side; Step 6 ships the upstream half).

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { summarizeSTArea, type STAreaSummary } from '$lib/server/st_dashboard';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (persona.role !== 'skt_coordinator') redirect(303, '/');

  const scope = persona.area_scope ?? [];
  const areas = scope
    .map((aid) => summarizeSTArea(aid))
    .filter((a): a is STAreaSummary => a !== null);

  return { areas };
};
