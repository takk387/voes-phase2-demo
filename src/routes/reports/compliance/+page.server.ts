import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { complianceStats, runComplianceChecks } from '$lib/server/compliance';

export const load: PageServerLoad = ({ locals }) => {
  const role = locals.persona.role;
  if (!['supervisor', 'union_rep', 'plant_manager', 'admin'].includes(role)) {
    redirect(303, '/');
  }
  return {
    checks: runComplianceChecks(),
    stats: complianceStats()
  };
};
