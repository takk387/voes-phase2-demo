// Demo reset endpoint. POST here to wipe and re-seed the database.
//
// Open by design: any visitor can reset. This is a demo with synthetic
// data — chaos from a previous click-through shouldn't trap the next
// reviewer. The reset itself is logged in the audit trail (after re-seed,
// so the reset event itself starts the new chain).

import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { runSeed } from '$lib/server/seed';
import { writeAudit } from '$lib/server/audit';

export const POST: RequestHandler = async ({ locals }) => {
  const counts = runSeed();
  // After the seed, write a log entry noting who reset (the persona at the
  // moment of reset). This becomes the second entry in the new audit chain
  // (the seed wrote one bootstrap entry).
  writeAudit({
    actor_user: locals.persona.id,
    actor_role: locals.persona.role,
    action: 'demo_reset',
    data: { row_counts: counts }
  });
  redirect(303, '/');
};
