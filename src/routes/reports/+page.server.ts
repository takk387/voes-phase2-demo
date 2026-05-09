// Reports hub. Visible to roles whose jurisdiction includes report access:
// Supervisor (their areas), Union Rep (jurisdiction), Plant Mgmt (all),
// Admin (all). TMs see only their own offer history, which lives on /tm.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = ({ locals }) => {
  const role = locals.persona.role;
  if (!['supervisor', 'union_rep', 'plant_manager', 'admin'].includes(role)) {
    redirect(303, '/');
  }
  return { role };
};
