// CSV export for grievance support per §11.4 Flow UR-3.
//
// Returns the filtered audit log as CSV with content-disposition: attachment.
// Each export is itself logged in the audit trail with the filter parameters
// and a SHA-256 of the response body — so a grievance package can be matched
// back against the source data later (§11.4: "the grievance package's
// integrity can be verified against the system later").

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { db } from '$lib/server/db';
import { writeAudit } from '$lib/server/audit';

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const persona = locals.persona;
  if (!['union_rep', 'supervisor', 'plant_manager', 'admin'].includes(persona.role)) {
    error(403, 'Not authorized to export audit data');
  }

  const conn = db();
  const filterArea = url.searchParams.get('area') ?? undefined;
  const filterEmp = url.searchParams.get('employee') ?? undefined;
  const filterAction = url.searchParams.get('action') ?? undefined;

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (persona.role === 'team_member' && persona.employee_id) {
    where.push('(employee_id = ? OR actor_user = ?)');
    params.push(persona.employee_id, persona.id);
  } else if ((persona.role === 'supervisor' || persona.role === 'union_rep') && persona.area_scope?.length) {
    const placeholders = persona.area_scope.map(() => '?').join(',');
    where.push(`(area_id IN (${placeholders}) OR area_id IS NULL)`);
    params.push(...persona.area_scope);
  }
  if (filterArea) { where.push('area_id = ?'); params.push(filterArea); }
  if (filterEmp)  { where.push('employee_id = ?'); params.push(filterEmp); }
  if (filterAction) { where.push('action = ?'); params.push(filterAction); }

  const sql =
    `SELECT id, ts, actor_user, actor_role, action, area_id, posting_id,
            offer_id, employee_id, data_json, reason, prev_hash, entry_hash
       FROM audit_log` +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY id ASC';

  const rows = conn.prepare(sql).all(...params) as Array<{
    id: number; ts: string; actor_user: string; actor_role: string;
    action: string; area_id: string | null; posting_id: string | null;
    offer_id: string | null; employee_id: string | null;
    data_json: string | null; reason: string | null;
    prev_hash: string | null; entry_hash: string | null;
  }>;

  const headers = [
    'id', 'ts', 'actor_user', 'actor_role', 'action', 'area_id',
    'posting_id', 'offer_id', 'employee_id', 'data_json', 'reason',
    'prev_hash', 'entry_hash'
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id, r.ts, r.actor_user, r.actor_role, r.action,
        r.area_id, r.posting_id, r.offer_id, r.employee_id,
        r.data_json, r.reason, r.prev_hash, r.entry_hash
      ].map(csvEscape).join(',')
    );
  }
  const body = lines.join('\n') + '\n';

  // Hash the body for verification.
  const bodyHash = 'sha256:' + createHash('sha256').update(body).digest('hex');

  // Log the export itself.
  writeAudit({
    actor_user: persona.id,
    actor_role: persona.role,
    action: 'audit_export',
    area_id: filterArea ?? null,
    employee_id: filterEmp ?? null,
    data: {
      filters: {
        area: filterArea ?? null,
        employee: filterEmp ?? null,
        action: filterAction ?? null
      },
      row_count: rows.length,
      body_hash: bodyHash
    }
  });

  const filename = `voes-audit-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Body-Hash': bodyHash,
      'X-Row-Count': String(rows.length)
    }
  });
};
