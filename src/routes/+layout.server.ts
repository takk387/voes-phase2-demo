import type { LayoutServerLoad } from './$types';
import { PERSONAS } from '$lib/personas';
import { db } from '$lib/server/db';

export const load: LayoutServerLoad = ({ locals }) => {
  // The banner only appears for the two approver roles. Admin initiates
  // dual-approval actions but is explicitly NOT an approver — the contract's
  // dual-approval requirement (§3.7, §22.7) exists precisely so that two
  // distinct parties (Plant Mgmt + Union) sign off independently. Letting
  // Admin approve either side would defeat the design.
  let pendingForMe = 0;
  const role = locals.persona.role;
  if (role === 'union_rep') {
    pendingForMe = (
      db()
        .prepare(
          `SELECT COUNT(*) AS c FROM pending_approval
            WHERE status = 'pending' AND approved_union_user IS NULL`
        )
        .get() as { c: number }
    ).c;
  } else if (role === 'plant_manager') {
    pendingForMe = (
      db()
        .prepare(
          `SELECT COUNT(*) AS c FROM pending_approval
            WHERE status = 'pending' AND approved_company_user IS NULL`
        )
        .get() as { c: number }
    ).c;
  }
  // Admin's view of pending items lives on /admin (informational), not as a
  // banner that implies action is required from them.

  return {
    persona: locals.persona,
    personas: PERSONAS,
    pendingForMe
  };
};
