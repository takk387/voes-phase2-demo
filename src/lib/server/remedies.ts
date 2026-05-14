// Bypass remedy workflow.
//
// Per Phase 1 plan §4.6, §5.14, §10.17: when an offer is made to the wrong
// Team Member (a bypass), the contract's remedy is to offer the next
// available comparable assignment to the affected TM, NOT to pay the missed
// hours. Errors that aren't bypasses (calculation errors, qualification
// status drift) follow the same workflow.
//
// Per the round-2 spec, remedies have NO time-based expiration. They
// persist until satisfied (the affected TM is offered a next eligible
// opportunity) or until the TM becomes ineligible (separation, permanent
// transfer out of the area, permanent qual loss). Administrative closure
// for ineligible TMs is a Joint Committee decision, not automatic.
//
// Slice 3 implementation:
//   1. Supervisor flags a bypass — opens a bypass_remedy row, status='open'.
//   2. Next eligible offer in the area where the affected TM is qualified
//      and available is queued for THAT TM, ahead of normal rotation.
//   3. Once the remedy offer's response is recorded, the bypass_remedy is
//      marked status='satisfied'.

import { db } from './db.js';
import { writeAudit } from './audit.js';
import {
  holdsAllQualifications,
  isOnApprovedLeave
} from './rotation.js';

export interface BypassRemedyRow {
  id: number;
  affected_employee_id: string;
  area_id: string;
  missed_offer_id: string | null;
  cause: string | null;
  recorded_at: string;
  recorded_by_user: string;
  remedy_offer_id: string | null;
  satisfied_at: string | null;
  status: 'open' | 'satisfied' | 'escalated' | 'closed';
}

export interface InitiateBypassRemedyInput {
  affected_employee_id: string;
  area_id: string;
  missed_offer_id?: string;
  cause: string;
  recorded_by_user: string;
  recorded_by_role: string;
}

export function initiateBypassRemedy(input: InitiateBypassRemedyInput): number {
  const conn = db();
  const result = conn
    .prepare(
      `INSERT INTO bypass_remedy
         (affected_employee_id, area_id, missed_offer_id, cause,
          recorded_by_user, status)
       VALUES (?, ?, ?, ?, ?, 'open')`
    )
    .run(
      input.affected_employee_id,
      input.area_id,
      input.missed_offer_id ?? null,
      input.cause,
      input.recorded_by_user
    );
  const id = Number(result.lastInsertRowid);

  writeAudit({
    actor_user: input.recorded_by_user,
    actor_role: input.recorded_by_role,
    action: 'bypass_remedy_initiated',
    area_id: input.area_id,
    employee_id: input.affected_employee_id,
    offer_id: input.missed_offer_id ?? null,
    data: { remedy_id: id, cause: input.cause }
  });

  return id;
}

/**
 * Find the oldest open bypass remedy in an area whose affected TM is
 * eligible to receive this posting (qualified, not on leave). Returns null
 * if none.
 *
 * Called from generateNextOffer BEFORE normal rotation. If a remedy is
 * returned, the offer goes to its affected TM ahead of the rotation; the
 * remedy is then linked to the offer and pending until the response is
 * recorded.
 */
export function dequeueRemedyForPosting(opts: {
  area_id: string;
  work_date: string;
  required_qualifications: string[];
}): { remedy_id: number; affected_employee_id: string } | null {
  const conn = db();
  const open = conn
    .prepare<[string], BypassRemedyRow>(
      `SELECT * FROM bypass_remedy
        WHERE area_id = ? AND status = 'open' AND remedy_offer_id IS NULL
        ORDER BY recorded_at ASC, id ASC`
    )
    .all(opts.area_id);

  for (const r of open) {
    // The affected TM must still be a member of the area on work_date.
    const isMember = conn
      .prepare<[string, string, string, string], { c: number }>(
        `SELECT COUNT(*) AS c FROM area_membership
          WHERE area_id = ? AND employee_id = ?
            AND effective_begin_date <= ?
            AND (effective_end_date IS NULL OR effective_end_date > ?)`
      )
      .get(opts.area_id, r.affected_employee_id, opts.work_date, opts.work_date);
    if ((isMember?.c ?? 0) === 0) continue;

    // Qualifications must match.
    if (!holdsAllQualifications(r.affected_employee_id, opts.required_qualifications, opts.work_date)) {
      continue;
    }
    // Approved leave excludes from the remedy too — system would not
    // contact at home.
    if (isOnApprovedLeave(r.affected_employee_id, opts.work_date)) {
      continue;
    }
    return { remedy_id: r.id, affected_employee_id: r.affected_employee_id };
  }
  return null;
}

/**
 * Link a remedy to the offer that satisfies it. Called when generateNextOffer
 * creates the remedy offer.
 */
export function linkRemedyOffer(remedy_id: number, offer_id: string) {
  db()
    .prepare(`UPDATE bypass_remedy SET remedy_offer_id = ? WHERE id = ?`)
    .run(offer_id, remedy_id);
}

/**
 * Mark a remedy satisfied. Called from recordResponse after a remedy's
 * offer receives a response (yes / no / a no-charge skip). Per the contract
 * the remedy is "the next available assignment" — so once the affected TM
 * is offered, the remedy is satisfied regardless of the response itself.
 */
export function markRemedySatisfiedByOffer(offer_id: string) {
  const conn = db();
  const row = conn
    .prepare<[string], { id: number; affected_employee_id: string; area_id: string }>(
      `SELECT id, affected_employee_id, area_id
         FROM bypass_remedy
        WHERE remedy_offer_id = ? AND status = 'open'`
    )
    .get(offer_id);
  if (!row) return;

  conn
    .prepare(
      `UPDATE bypass_remedy
          SET status = 'satisfied', satisfied_at = ?
        WHERE id = ?`
    )
    .run(new Date().toISOString(), row.id);

  writeAudit({
    actor_user: 'system',
    actor_role: 'system',
    action: 'bypass_remedy_satisfied',
    area_id: row.area_id,
    employee_id: row.affected_employee_id,
    offer_id,
    data: { remedy_id: row.id }
  });
}

// ---------------------------------------------------------------------------
// Read helpers for views
// ---------------------------------------------------------------------------
export interface BypassRemedyView extends BypassRemedyRow {
  affected_employee_name: string;
  area_name: string;
}

export function listOpenRemedies(area_ids?: string[]): BypassRemedyView[] {
  const conn = db();
  if (area_ids && area_ids.length > 0) {
    const placeholders = area_ids.map(() => '?').join(',');
    return conn
      .prepare(
        `SELECT br.*, e.display_name AS affected_employee_name, a.name AS area_name
           FROM bypass_remedy br
           JOIN employee e ON e.id = br.affected_employee_id
           JOIN area a ON a.id = br.area_id
          WHERE br.status = 'open' AND br.area_id IN (${placeholders})
          ORDER BY br.recorded_at ASC`
      )
      .all(...area_ids) as BypassRemedyView[];
  }
  return conn
    .prepare(
      `SELECT br.*, e.display_name AS affected_employee_name, a.name AS area_name
         FROM bypass_remedy br
         JOIN employee e ON e.id = br.affected_employee_id
         JOIN area a ON a.id = br.area_id
        WHERE br.status = 'open'
        ORDER BY br.recorded_at ASC`
    )
    .all() as BypassRemedyView[];
}

export function listRemediesByEmployee(employee_id: string): BypassRemedyView[] {
  return db()
    .prepare(
      `SELECT br.*, e.display_name AS affected_employee_name, a.name AS area_name
         FROM bypass_remedy br
         JOIN employee e ON e.id = br.affected_employee_id
         JOIN area a ON a.id = br.area_id
        WHERE br.affected_employee_id = ?
        ORDER BY br.recorded_at DESC
        LIMIT 50`
    )
    .all(employee_id) as BypassRemedyView[];
}

/**
 * Days since a remedy was recorded — for display only. Remedies have no
 * time-based expiration per the round-2 spec.
 */
export function ageDays(recorded_at: string): number {
  const ms = Date.now() - new Date(recorded_at).getTime();
  return Math.floor(ms / (24 * 3600 * 1000));
}
