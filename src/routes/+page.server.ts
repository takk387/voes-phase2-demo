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
    // Step 6: ST roles route to their dedicated dashboards. The ST SV
    // approval queue itself ships in Step 7 (/sv/approvals); /sv handles
    // the st_supervisor landing layout in the meantime.
    case 'skt_coordinator':
      redirect(303, '/coord');
    case 'skt_tl':
      redirect(303, '/skt-tl');
    case 'st_supervisor':
      redirect(303, '/sv');
  }
};
