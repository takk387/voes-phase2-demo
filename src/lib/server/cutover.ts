// Mode cutover and annual zero-out. High-impact admin actions per Phase 1
// plan §14.1, §14.2; both require dual approval per §3.7.
//
// Flow for each:
//   1. Admin initiates  -> pending_approval row created (status: pending)
//   2. Plant Mgmt approves company side
//   3. Union Rep approves union side
//   4. When both approvals are in, the action executes automatically
//      (Procedure D for cutover; analog for zero-out).
//
// All steps land in the audit log.

import { db, withTransaction } from './db.js';
import { writeAudit } from './audit.js';
import { executeAreaSplit, executeAreaMerge, executeAreaRetire } from './structural.js';

// ---------------------------------------------------------------------------
// Initiate
// ---------------------------------------------------------------------------
export type DualApprovalActionType =
  | 'mode_cutover'
  | 'annual_zero_out'
  | 'area_split'
  | 'area_merge'
  | 'area_retire';

export interface InitiateInput {
  action_type: DualApprovalActionType;
  scope: string;            // 'plant' or area id
  area_id?: string;
  initiated_by_user: string;
  initiated_by_role: string;
  payload?: Record<string, unknown>;
}

export function initiateApproval(input: InitiateInput): number {
  return withTransaction((conn): number => {
    const result = conn
      .prepare(
        `INSERT INTO pending_approval
           (action_type, scope, area_id, initiated_by_user, payload_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.action_type,
        input.scope,
        input.area_id ?? null,
        input.initiated_by_user,
        input.payload ? JSON.stringify(input.payload) : null
      );
    const id = Number(result.lastInsertRowid);

    writeAudit({
      actor_user: input.initiated_by_user,
      actor_role: input.initiated_by_role,
      action: input.action_type + '_initiated',
      area_id: input.area_id ?? null,
      data: {
        approval_id: id,
        scope: input.scope,
        payload: input.payload ?? {}
      }
    });

    return id;
  });
}

// ---------------------------------------------------------------------------
// Approve (one side at a time)
// ---------------------------------------------------------------------------
export type ApprovalSide = 'company' | 'union';

export function recordApproval(
  approval_id: number,
  side: ApprovalSide,
  user: string,
  role: string
): { executed: boolean } {
  return withTransaction((conn): { executed: boolean } => {
    const row = conn
      .prepare<[number], {
        id: number;
        action_type: string;
        scope: string;
        area_id: string | null;
        approved_company_user: string | null;
        approved_union_user: string | null;
        status: string;
        payload_json: string | null;
      }>(
        `SELECT * FROM pending_approval WHERE id = ?`
      )
      .get(approval_id);
    if (!row) throw new Error('approval not found');
    if (row.status !== 'pending') throw new Error('approval already resolved');

    const now = new Date().toISOString();
    if (side === 'company') {
      if (row.approved_company_user) throw new Error('company side already approved');
      conn
        .prepare(
          `UPDATE pending_approval
              SET approved_company_user = ?, approved_company_at = ?
            WHERE id = ?`
        )
        .run(user, now, approval_id);
    } else {
      if (row.approved_union_user) throw new Error('union side already approved');
      conn
        .prepare(
          `UPDATE pending_approval
              SET approved_union_user = ?, approved_union_at = ?
            WHERE id = ?`
        )
        .run(user, now, approval_id);
    }

    writeAudit({
      actor_user: user,
      actor_role: role,
      action: 'approval_recorded',
      area_id: row.area_id,
      data: {
        approval_id,
        action_type: row.action_type,
        side
      }
    });

    // If both sides are now in, execute.
    const updated = conn
      .prepare<[number], {
        action_type: string; area_id: string | null; payload_json: string | null;
        approved_company_user: string | null; approved_union_user: string | null;
      }>(
        `SELECT action_type, area_id, payload_json,
                approved_company_user, approved_union_user
           FROM pending_approval WHERE id = ?`
      )
      .get(approval_id);
    if (updated?.approved_company_user && updated?.approved_union_user) {
      const payload = updated.payload_json ? JSON.parse(updated.payload_json) : {};
      executeApproval(approval_id, updated.action_type, updated.area_id, payload);
      return { executed: true };
    }
    return { executed: false };
  });
}

function executeApproval(
  approval_id: number,
  action_type: string,
  area_id: string | null,
  payload: Record<string, unknown>
) {
  if (action_type === 'mode_cutover' && area_id) {
    executeModeCutover(area_id, approval_id);
  } else if (action_type === 'annual_zero_out') {
    if (area_id) executeAnnualZeroOut(area_id, approval_id);
    else {
      // Plant-wide: zero out every active area
      const conn = db();
      const areas = conn
        .prepare(`SELECT id FROM area WHERE status = 'active'`)
        .all() as { id: string }[];
      for (const a of areas) executeAnnualZeroOut(a.id, approval_id);
    }
  } else if (action_type === 'area_split') {
    executeAreaSplit(approval_id, payload as { source_area_id: string; new_area_a_name: string; new_area_b_name: string });
  } else if (action_type === 'area_merge') {
    executeAreaMerge(approval_id, payload as { source_a_id: string; source_b_id: string; new_area_name: string });
  } else if (action_type === 'area_retire') {
    executeAreaRetire(approval_id, payload as { area_id: string });
  } else {
    throw new Error('unknown action_type for execution: ' + action_type);
  }

  const conn = db();
  conn
    .prepare(
      `UPDATE pending_approval SET status = 'executed', executed_at = ?
        WHERE id = ?`
    )
    .run(new Date().toISOString(), approval_id);
}

// ---------------------------------------------------------------------------
// Procedure D — Mode cutover
// ---------------------------------------------------------------------------
function executeModeCutover(area_id: string, approval_id: number) {
  const conn = db();

  // 1. Snapshot pre-cutover state into audit log.
  const preState = conn
    .prepare<[string, string], {
      employee_id: string; offered: number; accepted: number; worked: number;
    }>(
      `SELECT e.id AS employee_id,
              COALESCE(SUM(CASE WHEN c.charge_type='hours_offered'  THEN c.amount END),0) AS offered,
              COALESCE(SUM(CASE WHEN c.charge_type='hours_accepted' THEN c.amount END),0) AS accepted,
              COALESCE(SUM(CASE WHEN c.charge_type='hours_worked'   THEN c.amount END),0) AS worked
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
    LEFT JOIN charge c ON c.employee_id = e.id AND c.area_id = ?
        WHERE m.area_id = ? AND m.effective_end_date IS NULL
        GROUP BY e.id`
    )
    .all(area_id, area_id);

  writeAudit({
    actor_user: 'system',
    actor_role: 'system',
    action: 'mode_cutover_pre_snapshot',
    area_id,
    data: { approval_id, pre_state: preState }
  });

  // 2. Zero out by inserting reversal charges for each TM's running totals.
  for (const r of preState) {
    if (r.offered > 0)  insertZeroOutReversal(area_id, r.employee_id, 'hours_offered',  -r.offered,  approval_id);
    if (r.accepted > 0) insertZeroOutReversal(area_id, r.employee_id, 'hours_accepted', -r.accepted, approval_id);
    if (r.worked > 0)   insertZeroOutReversal(area_id, r.employee_id, 'hours_worked',   -r.worked,   approval_id);
  }

  // 3. End the current mode setting and insert a new 'final' one.
  const now = new Date().toISOString();
  conn
    .prepare(
      `UPDATE area_mode_setting SET effective_end_date = ?
        WHERE area_id = ? AND effective_end_date IS NULL`
    )
    .run(now, area_id);
  conn
    .prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES (?, 'final', ?)`
    )
    .run(area_id, now);

  // 4. Set first_cycle_after_cutover and clear any prior first-cycle bookkeeping.
  conn
    .prepare(`DELETE FROM first_cycle_offered WHERE area_id = ?`)
    .run(area_id);
  conn
    .prepare(
      `UPDATE rotation_state
          SET first_cycle_after_cutover = 1, current_cycle = 1, cycle_started_at = ?
        WHERE area_id = ?`
    )
    .run(now, area_id);

  // 5. Record the cutover event.
  const [initAdmin, companyUser, unionUser] = resolveApprovalActors(approval_id);
  conn
    .prepare(
      `INSERT INTO mode_cutover_event
         (scope, area_id, effective_at, initiating_admin,
          approving_company_user, approving_union_user)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(area_id, area_id, now, initAdmin, companyUser, unionUser);

  writeAudit({
    actor_user: 'system',
    actor_role: 'system',
    action: 'mode_cutover_executed',
    area_id,
    data: {
      approval_id,
      effective_at: now,
      mode: 'final',
      first_cycle_after_cutover: true,
      tm_count: preState.length
    }
  });
}

function insertZeroOutReversal(
  area_id: string,
  employee_id: string,
  charge_type: 'hours_offered' | 'hours_accepted' | 'hours_worked',
  amount: number,
  approval_id: number
) {
  const conn = db();
  // We don't have an offer to point at. The schema requires offer_id, so
  // we use the most recent offer for the area for that employee as the
  // anchor. If none, create a synthetic anchor offer.
  let anchorId = conn
    .prepare<[string, string], { id: string }>(
      `SELECT o.id FROM offer o
         JOIN posting p ON p.id = o.posting_id
        WHERE p.area_id = ? AND o.employee_id = ?
        ORDER BY o.offered_at DESC LIMIT 1`
    )
    .get(area_id, employee_id)?.id;
  if (!anchorId) {
    // Create a posting + offer pair to anchor the zero-out reversal.
    const synthPostingId = `post-zeroout-${approval_id}-${employee_id.split('-')[1]}`;
    conn
      .prepare(
        `INSERT INTO posting
           (id, area_id, ot_type, criticality, work_date, start_time,
            duration_hours, volunteers_needed, posted_by_user, status)
         VALUES (?, ?, 'voluntary_daily', 'critical', date('now'), '00:00',
                 0, 0, 'system', 'satisfied')`
      )
      .run(synthPostingId, area_id);
    anchorId = `ofr-zeroout-${approval_id}-${employee_id.split('-')[1]}`;
    conn
      .prepare(
        `INSERT INTO offer
           (id, posting_id, employee_id, offered_by_user, status)
         VALUES (?, ?, ?, 'system', 'responded')`
      )
      .run(anchorId, synthPostingId, employee_id);
  }

  conn
    .prepare(
      `INSERT INTO charge
         (offer_id, employee_id, area_id, charge_type, amount,
          mode_at_charge)
       VALUES (?, ?, ?, ?, ?, 'final')`
    )
    .run(anchorId, employee_id, area_id, charge_type, amount);

  writeAudit({
    actor_user: 'system',
    actor_role: 'system',
    action: 'hours_zeroed',
    area_id,
    employee_id,
    data: { approval_id, charge_type, amount }
  });
}

function resolveApprovalActors(approval_id: number): [string, string, string] {
  const conn = db();
  const row = conn
    .prepare<[number], {
      initiated_by_user: string;
      approved_company_user: string;
      approved_union_user: string;
    }>(
      `SELECT initiated_by_user, approved_company_user, approved_union_user
         FROM pending_approval WHERE id = ?`
    )
    .get(approval_id);
  if (!row) throw new Error('approval not found');
  return [row.initiated_by_user, row.approved_company_user, row.approved_union_user];
}

// ---------------------------------------------------------------------------
// Annual zero-out (§14.1)
//   - In final mode: zero hours counters.
//   - In interim mode: clear cycle bookkeeping, reset to cycle 1, and reverse
//     opportunity charges (so lifetime tallies reset for the new period).
// ---------------------------------------------------------------------------
function executeAnnualZeroOut(area_id: string, approval_id: number) {
  const conn = db();
  const mode = conn
    .prepare<[string], { mode: 'interim' | 'final' }>(
      `SELECT mode FROM area_mode_setting
        WHERE area_id = ? AND effective_end_date IS NULL`
    )
    .get(area_id);
  const now = new Date().toISOString();

  if (mode?.mode === 'final') {
    // Same shape as cutover zero-out, minus the mode change.
    const preState = conn
      .prepare<[string, string], {
        employee_id: string; offered: number; accepted: number; worked: number;
      }>(
        `SELECT e.id AS employee_id,
                COALESCE(SUM(CASE WHEN c.charge_type='hours_offered'  THEN c.amount END),0) AS offered,
                COALESCE(SUM(CASE WHEN c.charge_type='hours_accepted' THEN c.amount END),0) AS accepted,
                COALESCE(SUM(CASE WHEN c.charge_type='hours_worked'   THEN c.amount END),0) AS worked
           FROM area_membership m
           JOIN employee e ON e.id = m.employee_id
      LEFT JOIN charge c ON c.employee_id = e.id AND c.area_id = ?
          WHERE m.area_id = ? AND m.effective_end_date IS NULL
          GROUP BY e.id`
      )
      .all(area_id, area_id);

    writeAudit({
      actor_user: 'system',
      actor_role: 'system',
      action: 'annual_zero_out_pre_snapshot',
      area_id,
      data: { approval_id, mode: 'final', pre_state: preState }
    });

    for (const r of preState) {
      if (r.offered > 0)  insertZeroOutReversal(area_id, r.employee_id, 'hours_offered',  -r.offered,  approval_id);
      if (r.accepted > 0) insertZeroOutReversal(area_id, r.employee_id, 'hours_accepted', -r.accepted, approval_id);
      if (r.worked > 0)   insertZeroOutReversal(area_id, r.employee_id, 'hours_worked',   -r.worked,   approval_id);
    }
  } else {
    // Interim: snapshot lifetime opportunity counts, reverse them, reset cycle.
    const preState = conn
      .prepare<[string], { employee_id: string; opps: number }>(
        `SELECT employee_id, COUNT(*) AS opps FROM charge
          WHERE area_id = ? AND charge_type = 'opportunity'
          GROUP BY employee_id`
      )
      .all(area_id);
    writeAudit({
      actor_user: 'system',
      actor_role: 'system',
      action: 'annual_zero_out_pre_snapshot',
      area_id,
      data: { approval_id, mode: 'interim', pre_state: preState }
    });

    // Insert one reversal opportunity charge per existing opportunity charge
    // (so SUM(amount) grouped reflects 0). Easier: insert N negative-1 rows
    // per TM equal to current count.
    for (const r of preState) {
      for (let i = 0; i < r.opps; i++) {
        // Anchor against most recent offer for that employee in the area.
        const anchorRow = conn
          .prepare<[string, string], { id: string }>(
            `SELECT o.id FROM offer o
               JOIN posting p ON p.id = o.posting_id
              WHERE p.area_id = ? AND o.employee_id = ?
              ORDER BY o.offered_at DESC LIMIT 1`
          )
          .get(area_id, r.employee_id);
        if (!anchorRow) continue;
        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge, cycle_number)
             VALUES (?, ?, ?, 'opportunity', -1, 'interim', 0)`
          )
          .run(anchorRow.id, r.employee_id, area_id);
      }
    }
    conn
      .prepare(`DELETE FROM cycle_offered WHERE area_id = ?`)
      .run(area_id);
    conn
      .prepare(
        `UPDATE rotation_state
            SET current_cycle = 1, cycle_started_at = ?,
                first_cycle_after_cutover = 0
          WHERE area_id = ?`
      )
      .run(now, area_id);
  }

  const [zInitAdmin, zCompanyUser, zUnionUser] = resolveApprovalActors(approval_id);
  conn
    .prepare(
      `INSERT INTO annual_zero_out_event
         (effective_at, initiating_admin,
          approving_company_user, approving_union_user)
       VALUES (?, ?, ?, ?)`
    )
    .run(now, zInitAdmin, zCompanyUser, zUnionUser);

  writeAudit({
    actor_user: 'system',
    actor_role: 'system',
    action: 'annual_zero_out_executed',
    area_id,
    data: { approval_id, effective_at: now, mode: mode?.mode }
  });
}

// ---------------------------------------------------------------------------
// Read helpers for the UI
// ---------------------------------------------------------------------------
export interface PendingApprovalRow {
  id: number;
  action_type: string;
  scope: string;
  area_id: string | null;
  initiated_by_user: string;
  initiated_at: string;
  approved_company_user: string | null;
  approved_company_at: string | null;
  approved_union_user: string | null;
  approved_union_at: string | null;
  executed_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  status: string;
  payload_json: string | null;
}

export function listPendingApprovals(): PendingApprovalRow[] {
  return db()
    .prepare(`SELECT * FROM pending_approval WHERE status = 'pending' ORDER BY id ASC`)
    .all() as PendingApprovalRow[];
}

export function listAllApprovals(): PendingApprovalRow[] {
  return db()
    .prepare(`SELECT * FROM pending_approval ORDER BY id DESC LIMIT 50`)
    .all() as PendingApprovalRow[];
}
