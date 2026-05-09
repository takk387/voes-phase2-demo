// TM-1: Team Member dashboard. Shows the TM's current standing, any pending
// offer, and recent history. (§11.1, Flow TM-1.)

import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { areaStanding, getCurrentCycle } from '$lib/server/rotation';
import { listRemediesByEmployee } from '$lib/server/remedies';

export const load: PageServerLoad = ({ locals }) => {
  const persona = locals.persona;
  if (persona.role !== 'team_member' || !persona.employee_id) {
    redirect(303, '/');
  }
  const conn = db();

  const employee = conn
    .prepare<[string], { id: string; display_name: string; hire_date: string; status: string }>(
      `SELECT id, display_name, hire_date, status FROM employee WHERE id = ?`
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
    openRemedies
  };
};
