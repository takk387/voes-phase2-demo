// Shared posting-create handler used by /coord/post and /skt-tl/post.
// Lives in $lib/server so SvelteKit's +page.server export validation doesn't
// reject it (page modules can only export load / actions / etc., not
// arbitrary helpers).

import { fail, redirect } from '@sveltejs/kit';
import { db } from './db.js';
import { writeAudit } from './audit.js';
import { generateNextOffer } from './offers.js';
import { randomUUID } from 'node:crypto';

export async function createSTPosting(
  request: Request,
  locals: App.Locals,
  required_role: 'skt_coordinator' | 'skt_tl'
) {
  const form = await request.formData();
  const area_id = String(form.get('area_id') ?? '');
  const ot_type = String(form.get('ot_type') ?? 'voluntary_daily');
  const criticality = String(form.get('criticality') ?? 'critical');
  const work_date = String(form.get('work_date') ?? '');
  const start_time = String(form.get('start_time') ?? '');
  const duration_hours = Number(form.get('duration_hours') ?? 0);
  const volunteers_needed = Number(form.get('volunteers_needed') ?? 1);
  const pay_multiplier = Number(form.get('pay_multiplier') ?? 1.0);
  const required_expertise = String(form.get('required_expertise') ?? '') || null;
  const required_classification = String(form.get('required_classification') ?? '') || null;
  const notes = String(form.get('notes') ?? '');
  const hardQuals = form.getAll('hard_qualifications').map(String);
  const softQuals = form.getAll('soft_qualifications').map(String);

  if (!area_id || !work_date || !start_time || !duration_hours || !volunteers_needed) {
    return fail(400, { error: 'All required fields must be filled.' });
  }
  if (![1.0, 1.5, 2.0].includes(pay_multiplier)) {
    return fail(400, { error: 'Pay multiplier must be 1.0, 1.5, or 2.0.' });
  }
  const scope = locals.persona.area_scope ?? [];
  if (!scope.includes(area_id)) {
    return fail(403, { error: 'Area out of scope.' });
  }

  const conn = db();
  const areaRow = conn
    .prepare<[string], { type: string }>(`SELECT type FROM area WHERE id = ?`)
    .get(area_id);
  if (areaRow?.type !== 'skilled_trades') {
    return fail(400, { error: 'Area is not a Skilled Trades area.' });
  }
  if (required_expertise !== null && !['Electrical', 'Mechanical'].includes(required_expertise)) {
    return fail(400, { error: 'Invalid expertise group.' });
  }

  const postingId = 'post-' + work_date + '-' + randomUUID().slice(0, 6);

  conn
    .prepare(
      `INSERT INTO posting
         (id, area_id, ot_type, criticality, work_date, start_time,
          duration_hours, volunteers_needed, notes, posted_by_user,
          pay_multiplier, required_expertise, required_classification,
          pending_sv_approval, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open')`
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
      locals.persona.id,
      pay_multiplier,
      required_expertise,
      required_classification
    );

  for (const qid of hardQuals) {
    conn
      .prepare(
        `INSERT INTO posting_qualification (posting_id, qualification_id)
         VALUES (?, ?)`
      )
      .run(postingId, qid);
  }
  for (const qid of softQuals) {
    conn
      .prepare(
        `INSERT INTO posting_preferred_qualification (posting_id, qualification_id)
         VALUES (?, ?)`
      )
      .run(postingId, qid);
  }

  writeAudit({
    actor_user: locals.persona.id,
    actor_role: required_role,
    action: 'st_posting_created',
    area_id,
    posting_id: postingId,
    data: {
      ot_type,
      criticality,
      work_date,
      start_time,
      duration_hours,
      volunteers_needed,
      pay_multiplier,
      required_expertise,
      required_classification,
      hard_qualifications: hardQuals,
      soft_qualifications: softQuals,
      pending_sv_approval: true
    }
  });

  // Run the rotation engine — the candidate is recorded as a *proposed*
  // offer because pending_sv_approval=1 on the parent posting.
  try {
    generateNextOffer(postingId, locals.persona.id, required_role);
  } catch (e) {
    console.error('generateNextOffer failed (ST proposed):', (e as Error).message);
  }

  redirect(303, `/coord/posting/${postingId}`);
}
