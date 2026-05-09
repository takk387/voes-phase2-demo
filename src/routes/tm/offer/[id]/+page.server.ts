// TM-3: Receive and respond to an offer.

import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { recordResponse } from '$lib/server/offers';

export const load: PageServerLoad = ({ locals, params }) => {
  const persona = locals.persona;
  if (persona.role !== 'team_member' || !persona.employee_id) {
    redirect(303, '/');
  }
  const conn = db();

  const offer = conn
    .prepare<[string], {
      offer_id: string;
      posting_id: string;
      employee_id: string;
      offered_at: string;
      offered_by_user: string;
      offer_status: string;
      work_date: string;
      start_time: string;
      duration_hours: number;
      ot_type: string;
      criticality: string;
      notes: string | null;
      area_name: string;
      area_id: string;
    }>(
      `SELECT o.id AS offer_id, o.posting_id, o.employee_id, o.offered_at,
              o.offered_by_user, o.status AS offer_status,
              p.work_date, p.start_time, p.duration_hours, p.ot_type,
              p.criticality, p.notes,
              a.id AS area_id, a.name AS area_name
         FROM offer o
         JOIN posting p ON p.id = o.posting_id
         JOIN area a ON a.id = p.area_id
        WHERE o.id = ?`
    )
    .get(params.id);
  if (!offer) error(404, 'Offer not found');

  if (offer.employee_id !== persona.employee_id) {
    error(403, 'This offer is for a different Team Member');
  }

  const requiredQuals = conn
    .prepare<[string], { name: string }>(
      `SELECT q.name FROM posting_qualification pq
         JOIN qualification q ON q.id = pq.qualification_id
        WHERE pq.posting_id = ?`
    )
    .all(offer.posting_id);

  return { offer, requiredQuals: requiredQuals.map((r) => r.name) };
};

export const actions: Actions = {
  respond: async ({ request, params, locals }) => {
    const persona = locals.persona;
    if (persona.role !== 'team_member' || !persona.employee_id) {
      return fail(403, { error: 'Not authorized' });
    }
    const form = await request.formData();
    const response = form.get('response');
    const note = form.get('note');

    if (response !== 'yes' && response !== 'no') {
      return fail(400, { error: 'Invalid response' });
    }

    try {
      recordResponse({
        offer_id: params.id,
        response_type: response,
        recorded_by_user: persona.id,
        recorded_by_role: persona.role,
        recorded_via: 'team_member',
        reason: typeof note === 'string' && note.length > 0 ? note : undefined
      });
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }

    redirect(303, '/tm');
  }
};
