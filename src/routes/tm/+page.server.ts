// TM-1: Team Member dashboard. Shows the TM's current standing, any pending
// offer, and recent history. (§11.1, Flow TM-1.)

import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { writeAudit } from '$lib/server/audit';
import { areaStanding, getCurrentCycle } from '$lib/server/rotation';
import { listRemediesByEmployee } from '$lib/server/remedies';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (persona.role !== 'team_member' || !persona.employee_id) {
    redirect(303, '/');
  }
  const conn = db();

  const employee = conn
    .prepare<[string], {
      id: string; display_name: string; hire_date: string; status: string;
      notif_in_app: number; notif_sms: number; notif_email: number;
      notif_preferences_set_at: string | null;
    }>(
      `SELECT id, display_name, hire_date, status,
              notif_in_app, notif_sms, notif_email, notif_preferences_set_at
         FROM employee WHERE id = ?`
    )
    .get(persona.employee_id);
  if (!employee) error(404, 'Employee not found');

  const memberships = conn
    .prepare<[string], { area_id: string; area_name: string; mode: string }>(
      `SELECT m.area_id, a.name AS area_name, ams.mode
         FROM area_membership m
         JOIN area a ON a.id = m.area_id
         JOIN area_mode_setting ams
           ON ams.area_id = a.id AND ams.effective_end_date IS NULL
        WHERE m.employee_id = ?
          AND m.effective_end_date IS NULL`
    )
    .all(employee.id);

  // Slice 1: each TM has at most one active membership.
  const primaryArea = memberships[0];
  if (!primaryArea) error(404, 'No active area membership');

  const today = new Date().toISOString().slice(0, 10);
  const standing = areaStanding(primaryArea.area_id, today);
  const myStanding = standing.find((s) => s.employee_id === employee.id);
  const cycle = getCurrentCycle(primaryArea.area_id);

  const pendingOffers = conn
    .prepare<[string], {
      offer_id: string;
      posting_id: string;
      work_date: string;
      start_time: string;
      duration_hours: number;
      ot_type: string;
      criticality: string;
      notes: string | null;
      area_name: string;
      offered_at: string;
    }>(
      `SELECT o.id AS offer_id, o.offered_at, p.id AS posting_id, p.work_date,
              p.start_time, p.duration_hours, p.ot_type, p.criticality, p.notes,
              a.name AS area_name
         FROM offer o
         JOIN posting p ON p.id = o.posting_id
         JOIN area a ON a.id = p.area_id
        WHERE o.employee_id = ?
          AND o.status = 'pending'
        ORDER BY o.offered_at DESC`
    )
    .all(employee.id);

  const history = conn
    .prepare<[string], {
      offer_id: string;
      posting_id: string;
      work_date: string;
      start_time: string;
      duration_hours: number;
      ot_type: string;
      response_type: string | null;
      recorded_at: string | null;
    }>(
      `SELECT o.id AS offer_id, p.id AS posting_id, p.work_date, p.start_time,
              p.duration_hours, p.ot_type,
              r.response_type, r.recorded_at
         FROM offer o
         JOIN posting p ON p.id = o.posting_id
    LEFT JOIN response r ON r.offer_id = o.id
        WHERE o.employee_id = ?
          AND o.status = 'responded'
        ORDER BY r.recorded_at DESC
        LIMIT 10`
    )
    .all(employee.id);

  const myRemedies = listRemediesByEmployee(employee.id);
  const openRemedies = myRemedies.filter((r) => r.status === 'open');

  return {
    employee,
    area: primaryArea,
    cycle,
    myStanding,
    pendingOffers,
    history,
    teamSize: standing.length,
    openRemedies,
    needsNotifPrefs: !employee.notif_preferences_set_at
  };
};

// Notification preferences (first-login modal). In-app is required and
// cannot be disabled — the system never sends offers off-site by default.
// SMS / email are opt-in, surfaced as greyed-out checkboxes because no
// off-site channel is wired in the demo; the row carries the preference
// regardless so production rollout can pick it up without backfilling.
export const actions: Actions = {
  save_notif_prefs: async ({ request, locals }) => {
    if (locals.persona.role !== 'team_member' || !locals.persona.employee_id) {
      return fail(403, { error: 'Only team members can save notification preferences.' });
    }
    const form = await request.formData();
    const sms = form.get('notif_sms') === 'on' ? 1 : 0;
    const email = form.get('notif_email') === 'on' ? 1 : 0;
    const now = new Date().toISOString();

    db()
      .prepare(
        `UPDATE employee
            SET notif_in_app = 1,
                notif_sms = ?,
                notif_email = ?,
                notif_preferences_set_at = ?
          WHERE id = ?`
      )
      .run(sms, email, now, locals.persona.employee_id);

    writeAudit({
      actor_user: locals.persona.id,
      actor_role: 'team_member',
      action: 'notification_preferences_set',
      employee_id: locals.persona.employee_id,
      data: { notif_in_app: 1, notif_sms: sms, notif_email: email }
    });

    return { saved: true };
  }
};
