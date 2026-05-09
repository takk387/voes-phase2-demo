// Flag a bypass error. Supervisor (or Admin) records that a TM should have
// been offered earlier and didn't. The system queues a remedy: the next
// eligible offer in the area for which the affected TM qualifies will go to
// them ahead of normal rotation.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { initiateBypassRemedy, listOpenRemedies } from '$lib/server/remedies';

export const load: PageServerLoad = ({ locals, url }) => {
  const persona = locals.persona;
  if (persona.role !== 'supervisor' && persona.role !== 'admin') redirect(303, '/');

  const conn = db();
  const areaIds = persona.role === 'admin'
    ? (conn.prepare(`SELECT id FROM area WHERE status = 'active'`).all() as { id: string }[]).map((r) => r.id)
    : (persona.area_scope ?? []);

  const areas = areaIds.length > 0
    ? conn.prepare(`SELECT id, name FROM area WHERE id IN (${areaIds.map(() => '?').join(',')}) ORDER BY name`).all(...areaIds) as { id: string; name: string }[]
    : [];

  const preselectedArea = url.searchParams.get('area') ?? areaIds[0] ?? '';
  const preselectedPosting = url.searchParams.get('posting') ?? '';

  // Members of the preselected area, for the affected-TM picker.
  const members = preselectedArea
    ? conn
        .prepare(
          `SELECT e.id, e.display_name, e.hire_date
             FROM area_membership m
             JOIN employee e ON e.id = m.employee_id
            WHERE m.area_id = ? AND m.effective_end_date IS NULL
            ORDER BY e.hire_date ASC`
        )
        .all(preselectedArea) as { id: string; display_name: string; hire_date: string }[]
    : [];

  // Recent postings in the area for the missed-posting picker.
  const recentPostings = preselectedArea
    ? conn
        .prepare(
          `SELECT id, work_date, start_time, duration_hours, status
             FROM posting
            WHERE area_id = ?
            ORDER BY posted_at DESC
            LIMIT 15`
        )
        .all(preselectedArea) as { id: string; work_date: string; start_time: string; duration_hours: number; status: string }[]
    : [];

  // Existing open remedies, scoped.
  const openRemedies = listOpenRemedies(areaIds);

  return {
    areas,
    members,
    recentPostings,
    preselectedArea,
    preselectedPosting,
    openRemedies
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (locals.persona.role !== 'supervisor' && locals.persona.role !== 'admin') {
      return fail(403, { error: 'Not authorized' });
    }
    const form = await request.formData();
    const area_id = String(form.get('area_id') ?? '');
    const affected_employee_id = String(form.get('affected_employee_id') ?? '');
    const missed_offer_id = String(form.get('missed_offer_id') ?? '').trim();
    const cause = String(form.get('cause') ?? '').trim();

    if (!area_id || !affected_employee_id || !cause) {
      return fail(400, { error: 'Area, affected TM, and cause are required.' });
    }

    initiateBypassRemedy({
      area_id,
      affected_employee_id,
      missed_offer_id: missed_offer_id || undefined,
      cause,
      recorded_by_user: locals.persona.id,
      recorded_by_role: locals.persona.role
    });

    redirect(303, `/sv/bypass?area=${area_id}`);
  }
};
