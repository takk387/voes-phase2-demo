// STAC Coordinator new-posting form. Creates an ST posting with
// pending_sv_approval=1 — the algorithm picks the proposed offer
// (status='proposed'), the dedicated ST SV later approves and the
// proposed offer flips to pending. Step 7 ships the SV approval queue.

import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createSTPosting } from '$lib/server/st_posting_actions';

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.persona.role !== 'skt_coordinator') redirect(303, '/');
  const scope = locals.persona.area_scope ?? [];
  if (scope.length === 0) error(400, 'No ST areas in scope');

  const conn = db();
  const areas = conn
    .prepare(
      `SELECT id, name FROM area
        WHERE type = 'skilled_trades' AND id IN (${scope.map(() => '?').join(',')})
        ORDER BY name`
    )
    .all(...scope) as { id: string; name: string }[];

  const selected = url.searchParams.get('area') ?? areas[0]?.id;
  if (selected && !scope.includes(selected)) error(403, 'Area out of scope');

  const qualifications = conn
    .prepare<[], { id: string; name: string }>(
      `SELECT id, name FROM qualification ORDER BY name`
    )
    .all();

  return { areas, selectedAreaId: selected ?? null, qualifications };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (locals.persona.role !== 'skt_coordinator') return fail(403, { error: 'Not authorized' });
    return createSTPosting(request, locals, 'skt_coordinator');
  }
};
