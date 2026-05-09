// Dual-approval queue. Admin initiates from /admin; Plant Mgmt and Union Rep
// approve here. Once both approvals land, the action executes.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listPendingApprovals, listAllApprovals, recordApproval } from '$lib/server/cutover';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (!['plant_manager', 'union_rep', 'admin'].includes(persona.role)) {
    redirect(303, '/');
  }

  const conn = db();
  const pending = listPendingApprovals().map((p) => {
    const area = p.area_id
      ? (conn.prepare('SELECT name FROM area WHERE id = ?').get(p.area_id) as { name: string } | undefined)
      : null;
    return {
      ...p,
      area_name: area?.name ?? null,
      payload: p.payload_json ? JSON.parse(p.payload_json) : null
    };
  });

  const recent = listAllApprovals().filter((a) => a.status !== 'pending').slice(0, 10).map((p) => {
    const area = p.area_id
      ? (conn.prepare('SELECT name FROM area WHERE id = ?').get(p.area_id) as { name: string } | undefined)
      : null;
    return { ...p, area_name: area?.name ?? null };
  });

  return { pending, recent, role: persona.role };
};

export const actions: Actions = {
  approve: async ({ request, locals }) => {
    const persona = locals.persona;
    const form = await request.formData();
    const approvalId = Number(form.get('approval_id'));
    const side = String(form.get('side')) as 'company' | 'union';

    if (!approvalId || (side !== 'company' && side !== 'union')) {
      return fail(400, { error: 'Invalid approval request' });
    }

    // Admin initiates but cannot approve — dual approval requires two
    // distinct institutional parties per §3.7 / §22.7.
    if (side === 'company' && persona.role !== 'plant_manager') {
      return fail(403, { error: 'Only Plant Management can approve the company side' });
    }
    if (side === 'union' && persona.role !== 'union_rep') {
      return fail(403, { error: 'Only a Union Representative can approve the union side' });
    }

    try {
      recordApproval(approvalId, side, persona.id, persona.role);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    redirect(303, '/approvals');
  }
};
