// Step 7: ST SV approval queue. Lists postings where pending_sv_approval=1
// scoped to the dedicated ST supervisor's areas, with Approve / Reject
// actions per posting. Production supervisors and other roles are redirected
// out — production OT does not pass through this gate.
//
// Approve promotes the proposed offer to pending and notifies per the area's
// notification_policy (Critical Rule #5: SV approval gate non-bypassable).
// Reject is terminal — the originator can post a new opportunity, but
// rejection-revision in place is a Phase 3 polish item.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
  approveProposedSTPosting,
  rejectProposedSTPosting
} from '$lib/server/offers';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  // Only dedicated ST supervisors and admin reach the queue. Production
  // supervisors don't see ST postings; coordinators and TLs originate
  // postings but cannot self-approve.
  if (persona.role !== 'st_supervisor' && persona.role !== 'admin') {
    redirect(303, '/');
  }
  const conn = db();
  const scope = persona.area_scope ?? null;

  // Pending queue. Admin sees all ST areas; ST supervisor sees their scope.
  let pendingRows: Array<{
    id: string;
    area_id: string;
    area_name: string;
    work_date: string;
    start_time: string;
    duration_hours: number;
    pay_multiplier: number;
    ot_type: string;
    criticality: string;
    notes: string | null;
    posted_by_user: string;
    posted_at: string;
    required_classification: string | null;
    required_expertise: string | null;
  }>;
  if (persona.role === 'admin' || scope === null) {
    pendingRows = conn
      .prepare(
        `SELECT p.id, p.area_id, a.name AS area_name, p.work_date, p.start_time,
                p.duration_hours, p.pay_multiplier, p.ot_type, p.criticality,
                p.notes, p.posted_by_user, p.posted_at,
                p.required_classification, p.required_expertise
           FROM posting p
           JOIN area a ON a.id = p.area_id
          WHERE p.pending_sv_approval = 1
            AND a.type = 'skilled_trades'
          ORDER BY p.posted_at DESC`
      )
      .all() as typeof pendingRows;
  } else if (scope.length === 0) {
    pendingRows = [];
  } else {
    pendingRows = conn
      .prepare(
        `SELECT p.id, p.area_id, a.name AS area_name, p.work_date, p.start_time,
                p.duration_hours, p.pay_multiplier, p.ot_type, p.criticality,
                p.notes, p.posted_by_user, p.posted_at,
                p.required_classification, p.required_expertise
           FROM posting p
           JOIN area a ON a.id = p.area_id
          WHERE p.pending_sv_approval = 1
            AND a.type = 'skilled_trades'
            AND p.area_id IN (${scope.map(() => '?').join(',')})
          ORDER BY p.posted_at DESC`
      )
      .all(...scope) as typeof pendingRows;
  }

  // For each pending posting, surface the proposed offer + the candidate's
  // standing in the area, so the SV can make an informed approve / reject
  // decision without clicking through.
  const pending = pendingRows.map((p) => {
    const proposed = conn
      .prepare<[string], {
        offer_id: string;
        employee_id: string;
        employee_name: string;
        classification: string | null;
        is_apprentice: number;
        phase: string | null;
        eligibility_at_offer: string | null;
      }>(
        `SELECT o.id AS offer_id, o.employee_id, e.display_name AS employee_name,
                e.classification, e.is_apprentice, o.phase, o.eligibility_at_offer
           FROM offer o
           JOIN employee e ON e.id = o.employee_id
          WHERE o.posting_id = ? AND o.status = 'proposed'
          ORDER BY o.offered_at ASC
          LIMIT 1`
      )
      .get(p.id);

    let candidateHours: { hours_offered: number; hours_accepted: number } | null = null;
    if (proposed) {
      const rows = conn
        .prepare<[string, string], { charge_type: string; total: number }>(
          `SELECT charge_type, COALESCE(SUM(amount),0) AS total FROM charge
            WHERE area_id = ? AND employee_id = ?
              AND charge_type IN ('hours_offered','hours_accepted')
            GROUP BY charge_type`
        )
        .all(p.area_id, proposed.employee_id);
      let hOffered = 0, hAccepted = 0;
      for (const r of rows) {
        if (r.charge_type === 'hours_offered') hOffered = r.total;
        else if (r.charge_type === 'hours_accepted') hAccepted = r.total;
      }
      candidateHours = { hours_offered: hOffered, hours_accepted: hAccepted };
    }

    const requiredQuals = conn
      .prepare<[string], { name: string }>(
        `SELECT q.name FROM posting_qualification pq
           JOIN qualification q ON q.id = pq.qualification_id
          WHERE pq.posting_id = ?`
      )
      .all(p.id)
      .map((r) => r.name);
    const preferredQuals = conn
      .prepare<[string], { name: string }>(
        `SELECT q.name FROM posting_preferred_qualification pq
           JOIN qualification q ON q.id = pq.qualification_id
          WHERE pq.posting_id = ?`
      )
      .all(p.id)
      .map((r) => r.name);

    return {
      ...p,
      proposed: proposed
        ? {
            offer_id: proposed.offer_id,
            employee_id: proposed.employee_id,
            employee_name: proposed.employee_name,
            classification: proposed.classification,
            is_apprentice: !!proposed.is_apprentice,
            phase: proposed.phase,
            eligibility_at_offer: proposed.eligibility_at_offer
          }
        : null,
      candidateHours,
      requiredQuals,
      preferredQuals
    };
  });

  // Recent approvals + rejections (last 10) for the same scope. Read from the
  // audit log so this naturally includes both runtime decisions and the
  // bootstrap-synthetic approval entries (filtered out via actor_role).
  let recentRows: Array<{
    posting_id: string;
    area_id: string;
    area_name: string;
    action: string;
    ts: string;
    actor_user: string;
    reason: string | null;
  }>;
  if (persona.role === 'admin' || scope === null) {
    recentRows = conn
      .prepare(
        `SELECT al.posting_id, al.area_id, a.name AS area_name, al.action,
                al.ts, al.actor_user, al.reason
           FROM audit_log al
           JOIN area a ON a.id = al.area_id
          WHERE al.action IN ('sv_approved_st_posting', 'sv_rejected_st_posting')
            AND al.actor_role != 'system'
            AND a.type = 'skilled_trades'
          ORDER BY al.id DESC
          LIMIT 10`
      )
      .all() as typeof recentRows;
  } else if (scope.length === 0) {
    recentRows = [];
  } else {
    recentRows = conn
      .prepare(
        `SELECT al.posting_id, al.area_id, a.name AS area_name, al.action,
                al.ts, al.actor_user, al.reason
           FROM audit_log al
           JOIN area a ON a.id = al.area_id
          WHERE al.action IN ('sv_approved_st_posting', 'sv_rejected_st_posting')
            AND al.actor_role != 'system'
            AND a.type = 'skilled_trades'
            AND al.area_id IN (${scope.map(() => '?').join(',')})
          ORDER BY al.id DESC
          LIMIT 10`
      )
      .all(...scope) as typeof recentRows;
  }

  return { pending, recent: recentRows, role: persona.role };
};

export const actions: Actions = {
  approve: async ({ request, locals }) => {
    const persona = locals.persona;
    if (persona.role !== 'st_supervisor' && persona.role !== 'admin') {
      return fail(403, { error: 'Only the dedicated ST supervisor can approve.' });
    }
    const form = await request.formData();
    const posting_id = String(form.get('posting_id') ?? '');
    if (!posting_id) return fail(400, { error: 'posting_id required' });

    // Scope check — the SV must own this area. Admin bypasses.
    if (persona.role === 'st_supervisor') {
      const conn = db();
      const areaRow = conn
        .prepare<[string], { area_id: string }>(`SELECT area_id FROM posting WHERE id = ?`)
        .get(posting_id);
      if (!areaRow || !(persona.area_scope ?? []).includes(areaRow.area_id)) {
        return fail(403, { error: 'Posting outside your area scope.' });
      }
    }

    try {
      approveProposedSTPosting(posting_id, persona.id, persona.role);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    redirect(303, '/sv/approvals');
  },

  reject: async ({ request, locals }) => {
    const persona = locals.persona;
    if (persona.role !== 'st_supervisor' && persona.role !== 'admin') {
      return fail(403, { error: 'Only the dedicated ST supervisor can reject.' });
    }
    const form = await request.formData();
    const posting_id = String(form.get('posting_id') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (!posting_id) return fail(400, { error: 'posting_id required' });
    if (!reason) return fail(400, { error: 'A reason is required to reject.' });

    if (persona.role === 'st_supervisor') {
      const conn = db();
      const areaRow = conn
        .prepare<[string], { area_id: string }>(`SELECT area_id FROM posting WHERE id = ?`)
        .get(posting_id);
      if (!areaRow || !(persona.area_scope ?? []).includes(areaRow.area_id)) {
        return fail(403, { error: 'Posting outside your area scope.' });
      }
    }

    try {
      rejectProposedSTPosting(posting_id, persona.id, persona.role, reason);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    redirect(303, '/sv/approvals');
  }
};
