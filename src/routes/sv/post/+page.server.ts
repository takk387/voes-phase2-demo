// SV-2: Post a voluntary opportunity. (§11.2 Flow SV-2.)

import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { writeAudit } from '$lib/server/audit';
import { generateNextOffer } from '$lib/server/offers';
import { randomUUID } from 'node:crypto';

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.persona.role !== 'supervisor') redirect(303, '/');
  const areaId = url.searchParams.get('area') ?? locals.persona.area_scope?.[0];
  if (!areaId) error(400, 'No area specified');

  const conn = db();
  const area = conn
    .prepare<[string], { id: string; name: string; mode: string }>(
      `SELECT a.id, a.name, ams.mode FROM area a
         JOIN area_mode_setting ams
           ON ams.area_id = a.id AND ams.effective_end_date IS NULL
        WHERE a.id = ?`
    )
    .get(areaId);
  if (!area) error(404, 'Area not found');

  const qualifications = conn
    .prepare<[], { id: string; name: string }>(
      `SELECT id, name FROM qualification ORDER BY name`
    )
    .all();

  return { area, qualifications };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (locals.persona.role !== 'supervisor') return fail(403, { error: 'Not authorized' });
    const form = await request.formData();

    const area_id = String(form.get('area_id') ?? '');
    const ot_type = String(form.get('ot_type') ?? 'voluntary_daily');
    const criticality = String(form.get('criticality') ?? 'critical');
    const work_date = String(form.get('work_date') ?? '');
    const start_time = String(form.get('start_time') ?? '');
    const duration_hours = Number(form.get('duration_hours') ?? 0);
    const volunteers_needed = Number(form.get('volunteers_needed') ?? 1);
    const notes = String(form.get('notes') ?? '');
    const qualIds = form.getAll('qualifications').map(String);

    if (!area_id || !work_date || !start_time || !duration_hours || !volunteers_needed) {
      return fail(400, { error: 'All required fields must be filled.' });
    }
    if (criticality !== 'critical' && criticality !== 'non_essential') {
      return fail(400, { error: 'Invalid criticality.' });
    }

    const conn = db();
    const postingId = 'post-' + work_date + '-' + randomUUID().slice(0, 6);

    conn
      .prepare(
        `INSERT INTO posting
           (id, area_id, ot_type, criticality, work_date, start_time,
            duration_hours, volunteers_needed, notes, posted_by_user, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
      )
      .run(
        postingId,
        area_id,
        ot_type,
        criticality,
        work_date,
        start_time,
        duration_hours,
        volunteers_needed,
        notes || null,
        locals.persona.id
      );

    for (const qid of qualIds) {
      conn
        .prepare(
          `INSERT INTO posting_qualification (posting_id, qualification_id)
           VALUES (?, ?)`
        )
        .run(postingId, qid);
    }

    writeAudit({
      actor_user: locals.persona.id,
      actor_role: locals.persona.role,
      action: 'posting_created',
      area_id,
      posting_id: postingId,
      data: {
        ot_type,
        criticality,
        work_date,
        start_time,
        duration_hours,
        volunteers_needed,
        required_qualifications: qualIds
      }
    });

    // Generate the first offer immediately so the supervisor can run the
    // rotation right away.
    generateNextOffer(postingId, locals.persona.id, locals.persona.role);

    redirect(303, `/sv/posting/${postingId}`);
  }
};
