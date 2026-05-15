// Persona-aware home: redirect each role to their landing page.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = ({ locals }) => {
  switch (locals.persona.role) {
    case 'team_member':
      redirect(303, '/tm');
    case 'supervisor':
      redirect(303, '/sv');
    case 'union_rep':
      redirect(303, '/audit');
    case 'plant_manager':
      redirect(303, '/approvals');
    case 'admin':
      redirect(303, '/admin');
    // Skilled-Trades roles land on /audit until their dedicated dashboards
    // ship in Step 6 (/coord, /skt-tl) and Step 7 (/sv/approvals queue for
    // st_supervisor). Audit is read-only, area-scope-aware, and surfaces
    // the seeded ST audit entries so reviewers can validate the persona
    // switched correctly even before the role-specific dashboards exist.
    case 'st_supervisor':
    case 'skt_coordinator':
    case 'skt_tl':
      redirect(303, '/audit');
  }
};
