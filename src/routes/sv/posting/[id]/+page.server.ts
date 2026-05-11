// SV-3: Rotation runner. (§11.2 Flow SV-3.) The supervisor sees the next
// candidate the engine has chosen, confirms contact, records the response.
// The system processes the response, applies the charge in interim mode,
// closes the posting if satisfied, and presents the next offer.

import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
  cancelPosting,
  generateNextOffer,
  recordResponse,
  type ResponseType
} from '$lib/server/offers';
import {
  abandonPosting,
  escalationFor,
  executeForceLow,
  initiateEscalation
} from '$lib/server/escalation';

export const load: PageServerLoad = ({ locals, params }) => {
  if (locals.persona.role !== 'supervisor' && locals.persona.role !== 'admin') {
    redirect(303, '/');
  }

  const conn = db();
  const posting = conn
    .prepare<[string], {
      id: string; area_id: string; area_name: string;
      work_date: string; start_time: string; duration_hours: number;
      ot_type: string; criticality: string; volunteers_needed: number;
      notes: string | null; status: string; posted_by_user: string;
      posted_at: string;
    }>(
      `SELECT p.id, p.area_id, a.name AS area_name, p.work_date, p.start_time,
              p.duration_hours, p.ot_type, p.criticality, p.volunteers_needed,
              p.notes, p.status, p.posted_by_user, p.posted_at
         FROM posting p JOIN area a ON a.id = p.area_id
        WHERE p.id = ?`
    )
    .get(params.id);
  if (!posting) error(404, 'Posting not found');

  const requiredQuals = conn
    .prepare<[string], { id: string; name: string }>(
      `SELECT q.id, q.name FROM posting_qualification pq
         JOIN qualification q ON q.id = pq.qualification_id
        WHERE pq.posting_id = ?`
    )
    .all(posting.id);

  // All offers for this posting (including skips).
  const offerLog = conn
    .prepare<[string], {
      offer_id: string;
      employee_id: string;
      employee_name: string;
      hire_date: string;
      offered_at: string;
      offer_status: string;
      phase: string | null;
      response_type: string | null;
      recorded_at: string | null;
      recorded_via: string | null;
      reason: string | null;
    }>(
      `SELECT o.id AS offer_id, o.employee_id, e.display_name AS employee_name,
              e.hire_date, o.offered_at, o.status AS offer_status, o.phase,
              r.response_type, r.recorded_at, r.recorded_via, r.reason
         FROM offer o JOIN employee e ON e.id = o.employee_id
    LEFT JOIN response r ON r.offer_id = o.id
        WHERE o.posting_id = ?
        ORDER BY o.offered_at ASC`
    )
    .all(posting.id);

  const yes_count = offerLog.filter((o) => o.response_type === 'yes').length;

  // The current pending offer (if any) is the one the supervisor is acting on.
  const pendingOffer = offerLog.find((o) => o.offer_status === 'pending');

  // Is the current pending offer a remedy offer? (bypass_remedy precedence)
  let pendingRemedy: {
    remedy_id: number;
    cause: string | null;
    recorded_at: string;
    recorded_by_user: string;
  } | null = null;
  if (pendingOffer) {
    const r = conn
      .prepare<[string], {
        id: number; cause: string | null; recorded_at: string; recorded_by_user: string;
      }>(
        `SELECT id, cause, recorded_at, recorded_by_user
           FROM bypass_remedy
          WHERE remedy_offer_id = ? AND status = 'open'`
      )
      .get(pendingOffer.offer_id);
    if (r) {
      pendingRemedy = { remedy_id: r.id, cause: r.cause, recorded_at: r.recorded_at, recorded_by_user: r.recorded_by_user };
    }
  }

  // Area's current mode (drives whether we show cycle counts or hours).
  const modeRow = conn
    .prepare<[string], { mode: 'interim' | 'final'; first_cycle: number }>(
      `SELECT ams.mode AS mode, rs.first_cycle_after_cutover AS first_cycle
         FROM area_mode_setting ams
    LEFT JOIN rotation_state rs ON rs.area_id = ams.area_id
        WHERE ams.area_id = ? AND ams.effective_end_date IS NULL`
    )
    .get(posting.area_id);
  const mode = modeRow?.mode ?? 'interim';
  const firstCycleAfterCutover = !!modeRow?.first_cycle;

  let pendingDetails: {
    offer_id: string;
    employee_id: string;
    employee_name: string;
    hire_date: string;
    qualifications: string[];
    // interim
    cycle_charges: number;
    lifetime_charges: number;
    // final
    hours_offered: number;
    hours_accepted: number;
    hours_worked: number;
    on_leave: boolean;
  } | null = null;

  if (pendingOffer) {
    const quals = conn
      .prepare<[string], { name: string }>(
        `SELECT q.name FROM employee_qualification eq
           JOIN qualification q ON q.id = eq.qualification_id
          WHERE eq.employee_id = ? AND eq.revoked_date IS NULL
            AND (eq.expiration_date IS NULL OR eq.expiration_date >= date('now'))`
      )
      .all(pendingOffer.employee_id);

    const cycleRow = conn
      .prepare<[string, string, string], { c: number }>(
        `SELECT COUNT(*) AS c FROM charge c
          WHERE c.area_id = ? AND c.employee_id = ?
            AND c.charge_type = 'opportunity'
            AND c.cycle_number = (SELECT current_cycle FROM rotation_state WHERE area_id = ?)`
      )
      .get(posting.area_id, pendingOffer.employee_id, posting.area_id);
    const lifetimeRow = conn
      .prepare<[string, string], { c: number }>(
        `SELECT COUNT(*) AS c FROM charge
          WHERE area_id = ? AND employee_id = ? AND charge_type = 'opportunity'`
      )
      .get(posting.area_id, pendingOffer.employee_id);

    const hoursRows = conn
      .prepare<[string, string], { charge_type: string; total: number }>(
        `SELECT charge_type, COALESCE(SUM(amount),0) AS total FROM charge
          WHERE area_id = ? AND employee_id = ?
            AND charge_type IN ('hours_offered','hours_accepted','hours_worked')
          GROUP BY charge_type`
      )
      .all(posting.area_id, pendingOffer.employee_id);
    let hOffered = 0, hAccepted = 0, hWorked = 0;
    for (const r of hoursRows) {
      if (r.charge_type === 'hours_offered') hOffered = r.total;
      else if (r.charge_type === 'hours_accepted') hAccepted = r.total;
      else if (r.charge_type === 'hours_worked') hWorked = r.total;
    }

    pendingDetails = {
      offer_id: pendingOffer.offer_id,
      employee_id: pendingOffer.employee_id,
      employee_name: pendingOffer.employee_name,
      hire_date: pendingOffer.hire_date,
      qualifications: quals.map((q) => q.name),
      cycle_charges: cycleRow?.c ?? 0,
      lifetime_charges: lifetimeRow?.c ?? 0,
      hours_offered: hOffered,
      hours_accepted: hAccepted,
      hours_worked: hWorked,
      on_leave: false
    };
  }

  // Escalation state.
  const escalation = escalationFor(posting.id);
  const hasPendingOffer = offerLog.some((o) => o.offer_status === 'pending');
  const eligiblePoolExhausted = posting.status === 'open' && !pendingDetails && !hasPendingOffer;

  return {
    posting, requiredQuals, offerLog, yes_count, pendingDetails, mode,
    firstCycleAfterCutover, pendingRemedy, escalation, eligiblePoolExhausted
  };
};

export const actions: Actions = {
  respond: async ({ request, params, locals }) => {
    if (locals.persona.role !== 'supervisor' && locals.persona.role !== 'admin') {
      return fail(403, { error: 'Not authorized' });
    }
    const form = await request.formData();
    const offerId = String(form.get('offer_id') ?? '');
    const response = String(form.get('response') ?? '') as ResponseType;
    const reason = String(form.get('reason') ?? '');
    const valid: ResponseType[] = [
      'yes', 'no', 'on_the_job', 'on_leave', 'no_contact', 'passed_over_unqualified'
    ];
    if (!valid.includes(response)) return fail(400, { error: 'Invalid response' });

    try {
      recordResponse({
        offer_id: offerId,
        response_type: response,
        recorded_by_user: locals.persona.id,
        recorded_by_role: locals.persona.role,
        recorded_via: 'supervisor_on_behalf',
        reason: reason.length > 0 ? reason : undefined
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }

    // Generate next offer if the posting is still open AND no pending
    // offers remain. (During escalation, ask-high or cascade phases
    // batch-create pending offers; we don't want to layer another normal
    // rotation offer on top.)
    const conn = db();
    const status = conn
      .prepare<[string], { status: string }>(`SELECT status FROM posting WHERE id = ?`)
      .get(params.id);
    const hasPending = (
      conn
        .prepare<[string], { c: number }>(
          `SELECT COUNT(*) AS c FROM offer WHERE posting_id = ? AND status = 'pending'`
        )
        .get(params.id) ?? { c: 0 }
    ).c > 0;
    if (status?.status === 'open' && !hasPending) {
      try {
        generateNextOffer(params.id, locals.persona.id, locals.persona.role);
      } catch (e) {
        // Non-fatal: if next-offer generation fails (e.g. pool exhausted,
        // duplicate key edge case), the page reload will show the
        // "eligible pool exhausted" state and let the supervisor escalate.
        console.error('generateNextOffer failed (non-fatal):', (e as Error).message);
      }
    }
    redirect(303, `/sv/posting/${params.id}`);
  },

  cancel: async ({ request, params, locals }) => {
    if (locals.persona.role !== 'supervisor' && locals.persona.role !== 'admin') {
      return fail(403, { error: 'Not authorized' });
    }
    const form = await request.formData();
    const reason = String(form.get('reason') ?? 'no reason given');
    cancelPosting(params.id, locals.persona.id, locals.persona.role, reason);
    redirect(303, `/sv/posting/${params.id}`);
  },

  escalate: async ({ params, locals }) => {
    if (locals.persona.role !== 'supervisor' && locals.persona.role !== 'admin') {
      return fail(403, { error: 'Not authorized' });
    }
    try {
      initiateEscalation(params.id, locals.persona.id, locals.persona.role);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    redirect(303, `/sv/posting/${params.id}`);
  },

  force_low: async ({ request, params, locals }) => {
    if (locals.persona.role !== 'supervisor' && locals.persona.role !== 'admin') {
      return fail(403, { error: 'Not authorized' });
    }
    const form = await request.formData();
    const reason = String(form.get('reason') ?? 'voluntary shortfall');
    try {
      executeForceLow(params.id, locals.persona.id, locals.persona.role, reason);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    redirect(303, `/sv/posting/${params.id}`);
  },

  abandon: async ({ request, params, locals }) => {
    if (locals.persona.role !== 'supervisor' && locals.persona.role !== 'admin') {
      return fail(403, { error: 'Not authorized' });
    }
    const form = await request.formData();
    const reason = String(form.get('reason') ?? 'no takers from area or adjacent units');
    try {
      abandonPosting(params.id, locals.persona.id, locals.persona.role, reason);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    redirect(303, `/sv/posting/${params.id}`);
  }
};
