// Area structural actions (§10.22, §10.24, §14.4): split, merge, retire.
// All gate through the dual-approval queue established in Slice 2.
//
// Slice 3 implementations:
//
//   SPLIT  — one area becomes two. The simplest demo split uses a
//     "by-seniority half" rule: the more-senior half goes to new area A,
//     the less-senior half to new area B. The Joint Committee can refine
//     splits per-area in production. Hours / opportunity charges follow
//     each member to their new area (we re-point the area_id on existing
//     charges; this is a Joint-Committee decision per §10.22's "default
//     hours follow TM, alternative each starts at zero").
//
//   MERGE  — two areas combine into one new area. All active TMs become
//     members of the new area. Charges follow each member.
//
//   RETIRE — area marked retired. Active memberships ended. Pending
//     postings cancelled. (No automatic reassignment in the demo —
//     production would gate this on having reassignment targets.)

import { db } from './db.js';
import { writeAudit } from './audit.js';
import { randomUUID } from 'node:crypto';

interface SplitPayload {
  source_area_id: string;
  new_area_a_name: string;
  new_area_b_name: string;
}

interface MergePayload {
  source_a_id: string;
  source_b_id: string;
  new_area_name: string;
}

interface RetirePayload {
  area_id: string;
}

// ---------------------------------------------------------------------------
// SPLIT
// ---------------------------------------------------------------------------
export function executeAreaSplit(approval_id: number, payload: SplitPayload) {
  const conn = db();
  const source = conn
    .prepare<[string], { id: string; shop: string; line: string; shift: string; status: string }>(
      `SELECT id, shop, line, shift, status FROM area WHERE id = ?`
    )
    .get(payload.source_area_id);
  if (!source) throw new Error('source area not found');

  // Compute split: seniority half. More-senior to A, less-senior to B.
  const today = new Date().toISOString().slice(0, 10);
  const members = conn
    .prepare(
      `SELECT e.id, e.hire_date, e.last4_ssn
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
        WHERE m.area_id = ? AND m.effective_end_date IS NULL
        ORDER BY e.hire_date ASC, e.last4_ssn ASC`
    )
    .all(payload.source_area_id) as { id: string; hire_date: string; last4_ssn: string }[];

  const half = Math.ceil(members.length / 2);
  const groupA = members.slice(0, half);
  const groupB = members.slice(half);

  const newAId = `${payload.source_area_id}-a-${randomUUID().slice(0, 6)}`;
  const newBId = `${payload.source_area_id}-b-${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();

  // Snapshot pre-state.
  writeAudit({
    actor_user: 'system', actor_role: 'system',
    action: 'area_split_pre_snapshot',
    area_id: payload.source_area_id,
    data: {
      approval_id,
      source: payload.source_area_id,
      new_a: newAId, new_a_name: payload.new_area_a_name,
      new_b: newBId, new_b_name: payload.new_area_b_name,
      group_a: groupA.map((g) => g.id),
      group_b: groupB.map((g) => g.id)
    }
  });

  // Create new areas, mode settings, rotation states.
  for (const [id, name, group] of [
    [newAId, payload.new_area_a_name, groupA],
    [newBId, payload.new_area_b_name, groupB]
  ] as const) {
    conn
      .prepare(
        `INSERT INTO area (id, name, shop, line, shift, posting_location, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(id, name, source.shop, source.line + ' (split)', source.shift, 'TBD', now);

    const sourceMode = (
      conn
        .prepare(`SELECT mode FROM area_mode_setting WHERE area_id = ? AND effective_end_date IS NULL`)
        .get(payload.source_area_id) as { mode: 'interim' | 'final' } | undefined
    )?.mode ?? 'interim';
    conn
      .prepare(
        `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
         VALUES (?, ?, ?)`
      )
      .run(id, sourceMode, now);
    conn
      .prepare(`INSERT INTO rotation_state (area_id, current_cycle) VALUES (?, 1)`)
      .run(id);

    // Migrate memberships and charges for this group.
    for (const m of group) {
      // End old membership
      conn
        .prepare(
          `UPDATE area_membership
              SET effective_end_date = ?
            WHERE employee_id = ? AND area_id = ? AND effective_end_date IS NULL`
        )
        .run(now, m.id, payload.source_area_id);
      // New membership
      conn
        .prepare(
          `INSERT INTO area_membership
             (employee_id, area_id, effective_begin_date)
           VALUES (?, ?, ?)`
        )
        .run(m.id, id, now);
      // Re-point charges (hours follow TM per §10.22 default)
      conn
        .prepare(`UPDATE charge SET area_id = ? WHERE area_id = ? AND employee_id = ?`)
        .run(id, payload.source_area_id, m.id);
    }
  }

  // Retire the source area.
  conn.prepare(`UPDATE area SET status = 'retired' WHERE id = ?`).run(payload.source_area_id);
  conn
    .prepare(`UPDATE area_mode_setting SET effective_end_date = ? WHERE area_id = ? AND effective_end_date IS NULL`)
    .run(now, payload.source_area_id);

  writeAudit({
    actor_user: 'system', actor_role: 'system',
    action: 'area_split_executed',
    area_id: payload.source_area_id,
    data: { approval_id, new_a: newAId, new_b: newBId }
  });
}

// ---------------------------------------------------------------------------
// MERGE
// ---------------------------------------------------------------------------
export function executeAreaMerge(approval_id: number, payload: MergePayload) {
  const conn = db();
  const sourceA = conn.prepare(`SELECT id, shop, line, shift FROM area WHERE id = ?`).get(payload.source_a_id) as { id: string; shop: string; line: string; shift: string } | undefined;
  const sourceB = conn.prepare(`SELECT id FROM area WHERE id = ?`).get(payload.source_b_id) as { id: string } | undefined;
  if (!sourceA || !sourceB) throw new Error('source area not found');

  const newId = `merged-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  writeAudit({
    actor_user: 'system', actor_role: 'system',
    action: 'area_merge_pre_snapshot',
    data: { approval_id, source_a: payload.source_a_id, source_b: payload.source_b_id, new_id: newId, new_name: payload.new_area_name }
  });

  conn
    .prepare(
      `INSERT INTO area (id, name, shop, line, shift, posting_location, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(newId, payload.new_area_name, sourceA.shop, sourceA.line + ' (merged)', sourceA.shift, 'TBD', now);

  // Mode taken from source A as default.
  const sourceAMode = (
    conn
      .prepare(`SELECT mode FROM area_mode_setting WHERE area_id = ? AND effective_end_date IS NULL`)
      .get(payload.source_a_id) as { mode: 'interim' | 'final' } | undefined
  )?.mode ?? 'interim';
  conn
    .prepare(`INSERT INTO area_mode_setting (area_id, mode, effective_begin_date) VALUES (?, ?, ?)`)
    .run(newId, sourceAMode, now);
  conn.prepare(`INSERT INTO rotation_state (area_id, current_cycle) VALUES (?, 1)`).run(newId);

  // Migrate memberships and charges from both sources.
  for (const sourceId of [payload.source_a_id, payload.source_b_id]) {
    const members = conn
      .prepare(
        `SELECT employee_id FROM area_membership
          WHERE area_id = ? AND effective_end_date IS NULL`
      )
      .all(sourceId) as { employee_id: string }[];
    for (const m of members) {
      conn
        .prepare(
          `UPDATE area_membership
              SET effective_end_date = ?
            WHERE employee_id = ? AND area_id = ? AND effective_end_date IS NULL`
        )
        .run(now, m.employee_id, sourceId);
      conn
        .prepare(`INSERT INTO area_membership (employee_id, area_id, effective_begin_date) VALUES (?, ?, ?)`)
        .run(m.employee_id, newId, now);
    }
    conn.prepare(`UPDATE charge SET area_id = ? WHERE area_id = ?`).run(newId, sourceId);
    conn.prepare(`UPDATE area SET status = 'retired' WHERE id = ?`).run(sourceId);
    conn
      .prepare(`UPDATE area_mode_setting SET effective_end_date = ? WHERE area_id = ? AND effective_end_date IS NULL`)
      .run(now, sourceId);
  }

  writeAudit({
    actor_user: 'system', actor_role: 'system',
    action: 'area_merge_executed',
    area_id: newId,
    data: { approval_id, sources: [payload.source_a_id, payload.source_b_id] }
  });
}

// ---------------------------------------------------------------------------
// RETIRE
// ---------------------------------------------------------------------------
export function executeAreaRetire(approval_id: number, payload: RetirePayload) {
  const conn = db();
  const now = new Date().toISOString();

  conn.prepare(`UPDATE area SET status = 'retired' WHERE id = ?`).run(payload.area_id);
  conn
    .prepare(`UPDATE area_mode_setting SET effective_end_date = ? WHERE area_id = ? AND effective_end_date IS NULL`)
    .run(now, payload.area_id);
  conn
    .prepare(`UPDATE area_membership SET effective_end_date = ? WHERE area_id = ? AND effective_end_date IS NULL`)
    .run(now, payload.area_id);
  conn
    .prepare(`UPDATE posting SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ? WHERE area_id = ? AND status = 'open'`)
    .run(now, 'area retired', payload.area_id);

  writeAudit({
    actor_user: 'system', actor_role: 'system',
    action: 'area_retired',
    area_id: payload.area_id,
    data: { approval_id }
  });
}
