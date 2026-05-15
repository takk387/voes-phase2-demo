// POST /coord/posting/:id/release-excess
//
// SKT-04A reverse-selection ("go home") endpoint. The Step 6 coordinator UI
// surfaces a "Release excess workers" modal that posts here. Step 4 ships
// the endpoint so the server-side flow is real even though no UI hits it
// until Step 6.
//
// Production areas: returns 400 (the flow is ST-only per SKT-04A; in
// production, supervisors cancel the posting or supersede individual offers
// instead of mass-releasing).
//
// Authorization: skt_coordinator, skt_tl, and admin. The ST roles don't
// exist as personas until Step 5 — until then this endpoint is reachable
// only via the admin persona, which is fine for end-to-end smoke testing.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { releaseExcessST, ReleaseExcessError } from '$lib/server/release_st';

const ALLOWED_ROLES = new Set<string>(['skt_coordinator', 'skt_tl', 'admin']);

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!ALLOWED_ROLES.has(locals.persona.role as string)) {
    error(403, 'Not authorized');
  }
  if (!params.id) error(400, 'Missing posting id');

  const form = await request.formData();
  const countRaw = form.get('count');
  const count = Number(countRaw ?? 0);
  if (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) {
    error(400, 'count must be a positive integer');
  }

  try {
    const result = releaseExcessST(
      params.id,
      count,
      locals.persona.id,
      locals.persona.role
    );
    return json({
      ok: true,
      released_count: result.released_employee_ids.length,
      released_employee_ids: result.released_employee_ids,
      released_offer_ids: result.released_offer_ids
    });
  } catch (e) {
    if (e instanceof ReleaseExcessError) {
      if (e.reason === 'not_found') error(404, e.message);
      error(400, e.message);
    }
    throw e;
  }
};
