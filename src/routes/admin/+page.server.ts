// Admin dashboard. Initiates dual-approval actions (mode cutover, annual
// zero-out). Lists current areas with their mode and TM counts.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { initiateApproval, listPendingApprovals } from '$lib/server/cutover';

export const load: PageServerLoad = ({ locals }) => {
  if (locals.persona.role !== 'admin') redirect(303, '/');
  const conn = db();

  const areas = conn
    .prepare<[], {
      id: string; name: string; mode: 'interim' | 'final'; tm_count: number;
      first_cycle: number; current_cycle: number;
    }>(
      `SELECT a.id, a.name, ams.mode,
              (SELECT COUNT(*) FROM area_membership m
                 WHERE m.area_id = a.id AND m.effective_end_date IS NULL) AS tm_count,
              rs.first_cycle_after_cutover AS first_cycle,
              rs.current_cycle AS current_cycle
         FROM area a
         JOIN area_mode_setting ams
           ON ams.area_id = a.id AND ams.effective_end_date IS NULL
    LEFT JOIN rotation_state rs ON rs.area_id = a.id
        WHERE a.status = 'active'
        ORDER BY a.shop, a.shift`
    )
    .all();

  const pending = listPendingApprovals();

  return { areas, pending };
};

export const actions: Actions = {
  initiate_cutover: async ({ request, locals }) => {
    if (locals.persona.role !== 'admin') return fail(403, { error: 'Not authorized' });
    const form = await request.formData();
    const areaId = String(form.get('area_id') ?? '');
    if (!areaId) return fail(400, { error: 'Missing area' });

    // Sanity: don't initiate if already in final mode.
    const conn = db();
    const mode = conn
      .prepare<[string], { mode: string }>(
        `SELECT mode FROM area_mode_setting
          WHERE area_id = ? AND effective_end_date IS NULL`
      )
      .get(areaId);
    if (mode?.mode === 'final') {
      return fail(400, { error: 'Area is already in final mode' });
    }

    initiateApproval({
      action_type: 'mode_cutover',
      scope: areaId,
      area_id: areaId,
      initiated_by_user: locals.persona.id,
      initiated_by_role: locals.persona.role,
      payload: { from_mode: 'interim', to_mode: 'final' }
    });
    redirect(303, '/approvals');
  },

  initiate_zero_out: async ({ request, locals }) => {
    if (locals.persona.role !== 'admin') return fail(403, { error: 'Not authorized' });
    const form = await request.formData();
    const areaId = String(form.get('area_id') ?? '');
    initiateApproval({
      action_type: 'annual_zero_out',
      scope: areaId || 'plant',
      area_id: areaId || undefined,
      initiated_by_user: locals.persona.id,
      initiated_by_role: locals.persona.role,
      payload: areaId ? { scope: 'area' } : { scope: 'plant_wide' }
    });
    redirect(303, '/approvals');
  },

  initiate_split: async ({ request, locals }) => {
    if (locals.persona.role !== 'admin') return fail(403, { error: 'Not authorized' });
    const form = await request.formData();
    const source_area_id = String(form.get('source_area_id') ?? '');
    const new_area_a_name = String(form.get('new_area_a_name') ?? '').trim();
    const new_area_b_name = String(form.get('new_area_b_name') ?? '').trim();
    if (!source_area_id || !new_area_a_name || !new_area_b_name) {
      return fail(400, { error: 'Source area + both new area names required' });
    }
    initiateApproval({
      action_type: 'area_split',
      scope: source_area_id,
      area_id: source_area_id,
      initiated_by_user: locals.persona.id,
      initiated_by_role: locals.persona.role,
      payload: { source_area_id, new_area_a_name, new_area_b_name }
    });
    redirect(303, '/approvals');
  },

  initiate_merge: async ({ request, locals }) => {
    if (locals.persona.role !== 'admin') return fail(403, { error: 'Not authorized' });
    const form = await request.formData();
    const source_a_id = String(form.get('source_a_id') ?? '');
    const source_b_id = String(form.get('source_b_id') ?? '');
    const new_area_name = String(form.get('new_area_name') ?? '').trim();
    if (!source_a_id || !source_b_id || source_a_id === source_b_id || !new_area_name) {
      return fail(400, { error: 'Two distinct source areas + a new name required' });
    }
    initiateApproval({
      action_type: 'area_merge',
      scope: `${source_a_id}+${source_b_id}`,
      area_id: source_a_id,
      initiated_by_user: locals.persona.id,
      initiated_by_role: locals.persona.role,
      payload: { source_a_id, source_b_id, new_area_name }
    });
    redirect(303, '/approvals');
  },

  initiate_retire: async ({ request, locals }) => {
    if (locals.persona.role !== 'admin') return fail(403, { error: 'Not authorized' });
    const form = await request.formData();
    const area_id = String(form.get('area_id') ?? '');
    if (!area_id) return fail(400, { error: 'Area required' });
    initiateApproval({
      action_type: 'area_retire',
      scope: area_id,
      area_id,
      initiated_by_user: locals.persona.id,
      initiated_by_role: locals.persona.role,
      payload: { area_id }
    });
    redirect(303, '/approvals');
  }
};
