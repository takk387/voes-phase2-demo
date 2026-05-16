// ST rotation runner (Step 6). Shared by STAC Coordinator, SKT TL, and the
// dedicated ST Supervisor for the area. The page surfaces:
//   - posting summary + ST badge + pay multiplier
//   - "Awaiting SV approval" banner when pending_sv_approval=1 (Step 7
//     handles the approval action itself; here it's visual gating)
//   - the proposed/pending offer (with shift-pattern context for the TM)
//   - offer log including phase tags (inter_shop_canvass, apprentice_escalation)
//   - response actions (only enabled when status='pending')
//   - "Release excess workers" entrypoint (Step 4 endpoint)
//   - cancel + abandonment-after-pool-exhaustion (no force-low for ST)

import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
  cancelPosting,
  generateNextOffer,
  recordResponse,
  type ResponseType
} from '$lib/server/offers';

type AllowedRole = 'skt_coordinator' | 'skt_tl' | 'st_supervisor' | 'admin';
const ALLOWED_ROLES: AllowedRole[] = ['skt_coordinator', 'skt_tl', 'st_supervisor', 'admin'];

function checkRole(role: string): role is AllowedRole {
  return (ALLOWED_ROLES as string[]).includes(role);
}

export const load: PageServerLoad = ({ locals, params }) => {
  if (!checkRole(locals.persona.role)) redirect(303, '/');

  const conn = db();
  const posting = conn
    .prepare<[string], {
      id: string; area_id: string; area_name: string; area_type: string;
      work_date: string; start_time: string; duration_hours: number;
      ot_type: string; criticality: string; volunteers_needed: number;
      notes: string | null; status: string; posted_by_user: string;
      posted_at: string; pay_multiplier: number; pending_sv_approval: number;
      required_classification: string | null; required_expertise: string | null;
      notification_policy: string;
    }>(
      `SELECT p.id, p.area_id, a.name AS area_name, a.type AS area_type,
              a.notification_policy,
              p.work_date, p.start_time, p.duration_hours, p.ot_type,
              p.criticality, p.volunteers_needed, p.notes, p.status,
              p.posted_by_user, p.posted_at, p.pay_multiplier,
              p.pending_sv_approval, p.required_classification,
              p.required_expertise
         FROM posting p JOIN area a ON a.id = p.area_id
        WHERE p.id = ?`
    )
    .get(params.id);
  if (!posting) error(404, 'Posting not found');
  if (posting.area_type !== 'skilled_trades') {
    error(400, 'This runner is for Skilled Trades postings only.');
  }

  // Scope check — coord/TL/SV must have this area in scope. Admin is global.
  const scope = locals.persona.area_scope ?? [];
  if (locals.persona.role !== 'admin' && !scope.includes(posting.area_id)) {
    error(403, 'Posting outside your scope.');
  }

  const requiredQuals = conn
    .prepare<[string], { id: string; name: string }>(
      `SELECT q.id, q.name FROM posting_qualification pq
         JOIN qualification q ON q.id = pq.qualification_id
        WHERE pq.posting_id = ?`
    )
    .all(posting.id);
  const preferredQuals = conn
    .prepare<[string], { id: string; name: string }>(
      `SELECT q.id, q.name FROM posting_preferred_qualification pq
         JOIN qualification q ON q.id = pq.qualification_id
        WHERE pq.posting_id = ?`
    )
    .all(posting.id);

  // Offer log including ST-specific phase tags + classification info.
  const offerLog = conn
    .prepare<[string], {
      offer_id: string;
      employee_id: string;
      employee_name: string;
      hire_date: string;
      classification: string | null;
      is_apprentice: number;
      offered_at: string;
      offer_status: string;
      phase: string | null;
      eligibility_at_offer: string | null;
      response_type: string | null;
      recorded_at: string | null;
      recorded_via: string | null;
      reason: string | null;
    }>(
      `SELECT o.id AS offer_id, o.employee_id, e.display_name AS employee_name,
              e.hire_date, e.classification, e.is_apprentice,
              o.offered_at, o.status AS offer_status, o.phase,
              o.eligibility_at_offer,
              r.response_type, r.recorded_at, r.recorded_via, r.reason
         FROM offer o JOIN employee e ON e.id = o.employee_id
    LEFT JOIN response r ON r.offer_id = o.id
        WHERE o.posting_id = ?
        ORDER BY o.offered_at ASC`
    )
    .all(posting.id);

  const yes_count = offerLog.filter((o) => o.response_type === 'yes').length;
  const proposedOffer = offerLog.find((o) => o.offer_status === 'proposed') ?? null;
  const pendingOffer = offerLog.find((o) => o.offer_status === 'pending') ?? null;
  const acceptedWorkers = offerLog
    .filter((o) => o.response_type === 'yes' && o.offer_status === 'responded')
    .map((o) => ({
      offer_id: o.offer_id,
      employee_id: o.employee_id,
      employee_name: o.employee_name,
      classification: o.classification
    }));

  // Active offer (proposed OR pending) details — for the right card.
  const activeOffer = pendingOffer ?? proposedOffer;
  let activeDetails: {
    offer_id: string;
    employee_id: string;
    employee_name: string;
    hire_date: string;
    classification: string | null;
    is_apprentice: boolean;
    eligibility_at_offer: string | null;
    qualifications: string[];
    soft_qual_names: string[];
    hours_offered: number;
    hours_accepted: number;
    is_proposed: boolean;
  } | null = null;

  if (activeOffer) {
    const quals = conn
      .prepare<[string], { name: string; qualification_id: string }>(
        `SELECT q.id AS qualification_id, q.name FROM employee_qualification eq
           JOIN qualification q ON q.id = eq.qualification_id
          WHERE eq.employee_id = ? AND eq.revoked_date IS NULL
            AND (eq.expiration_date IS NULL OR eq.expiration_date >= date('now'))`
      )
      .all(activeOffer.employee_id);
    const softIds = new Set(preferredQuals.map((q) => q.id));
    const softMatched = quals.filter((q) => softIds.has(q.qualification_id)).map((q) => q.name);

    const hoursRows = conn
      .prepare<[string, string], { charge_type: string; total: number }>(
        `SELECT charge_type, COALESCE(SUM(amount),0) AS total FROM charge
          WHERE area_id = ? AND employee_id = ?
            AND charge_type IN ('hours_offered','hours_accepted')
          GROUP BY charge_type`
      )
      .all(posting.area_id, activeOffer.employee_id);
    let hOffered = 0, hAccepted = 0;
    for (const r of hoursRows) {
      if (r.charge_type === 'hours_offered') hOffered = r.total;
      else if (r.charge_type === 'hours_accepted') hAccepted = r.total;
    }

    activeDetails = {
      offer_id: activeOffer.offer_id,
      employee_id: activeOffer.employee_id,
      employee_name: activeOffer.employee_name,
      hire_date: activeOffer.hire_date,
      classification: activeOffer.classification,
      is_apprentice: !!activeOffer.is_apprentice,
      eligibility_at_offer: activeOffer.eligibility_at_offer,
      qualifications: quals.map((q) => q.name),
      soft_qual_names: softMatched,
      hours_offered: hOffered,
      hours_accepted: hAccepted,
      is_proposed: activeOffer.offer_status === 'proposed'
    };
  }

  const eligiblePoolExhausted =
    posting.status === 'open' &&
    !pendingOffer && !proposedOffer &&
    yes_count < posting.volunteers_needed;

  return {
    posting,
    requiredQuals,
    preferredQuals,
    offerLog,
    yes_count,
    activeDetails,
    acceptedWorkers,
    eligiblePoolExhausted,
    canApprove: locals.persona.role === 'st_supervisor' || locals.persona.role === 'admin'
  };
};

export const actions: Actions = {
  respond: async ({ request, params, locals }) => {
    if (!checkRole(locals.persona.role)) return fail(403, { error: 'Not authorized' });
    const form = await request.formData();
    const offerId = String(form.get('offer_id') ?? '');
    const response = String(form.get('response') ?? '') as ResponseType;
    const reason = String(form.get('reason') ?? '');
    const valid: ResponseType[] = [
      'yes', 'no', 'no_show', 'on_the_job', 'on_leave', 'no_contact', 'passed_over_unqualified'
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

    // Auto-generate the next offer if the posting is still open.
    const conn = db();
    const status = conn
      .prepare<[string], { status: string }>(`SELECT status FROM posting WHERE id = ?`)
      .get(params.id);
    const hasPending = (
      conn
        .prepare<[string], { c: number }>(
          `SELECT COUNT(*) AS c FROM offer
            WHERE posting_id = ? AND status IN ('pending','proposed')`
        )
        .get(params.id) ?? { c: 0 }
    ).c > 0;
    if (status?.status === 'open' && !hasPending) {
      try {
        generateNextOffer(params.id, locals.persona.id, locals.persona.role);
      } catch (e) {
        console.error('generateNextOffer (ST) failed (non-fatal):', (e as Error).message);
      }
    }
    redirect(303, `/coord/posting/${params.id}`);
  },

  cancel: async ({ request, params, locals }) => {
    if (!checkRole(locals.persona.role)) return fail(403, { error: 'Not authorized' });
    const form = await request.formData();
    const reason = String(form.get('reason') ?? 'no reason given');
    cancelPosting(params.id, locals.persona.id, locals.persona.role, reason);
    redirect(303, `/coord/posting/${params.id}`);
  }
};
