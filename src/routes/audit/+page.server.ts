// Audit log view. Available to all roles, with jurisdiction-aware filtering:
//   - Team Member: only their own entries
//   - Supervisor / ST Supervisor / STAC Coordinator / Skilled Trades TL /
//     Union Rep: their area scope
//   - Plant Manager / Admin: everything
//
// (§11.4 Flows UR-1, UR-2; §16.3 audit log access.)

import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: PageServerLoad = ({ locals, url }) => {
  const persona = locals.persona;
  const conn = db();

  const filterArea = url.searchParams.get('area') ?? undefined;
  const filterEmp = url.searchParams.get('employee') ?? undefined;
  const filterAction = url.searchParams.get('action') ?? undefined;

  const where: string[] = [];
  const params: (string | number)[] = [];

  // Jurisdiction filtering. The 3 new ST roles (st_supervisor,
  // skt_coordinator, skt_tl) share the area-scope filter with production
  // supervisor + union_rep — they each have an area_scope array on their
  // persona definition. Union read-equity for ST areas is upheld via
  // Rodriguez's scope extension (covers all 7 areas).
  const AREA_SCOPED_ROLES = new Set([
    'supervisor', 'union_rep', 'st_supervisor', 'skt_coordinator', 'skt_tl'
  ]);
  if (persona.role === 'team_member' && persona.employee_id) {
    where.push('(employee_id = ? OR actor_user = ?)');
    params.push(persona.employee_id, persona.id);
  } else if (AREA_SCOPED_ROLES.has(persona.role) && persona.area_scope?.length) {
    const placeholders = persona.area_scope.map(() => '?').join(',');
    where.push(`(area_id IN (${placeholders}) OR area_id IS NULL)`);
    params.push(...persona.area_scope);
  }
  // plant_manager and admin see everything (no additional filter).

  if (filterArea) { where.push('area_id = ?'); params.push(filterArea); }
  if (filterEmp)  { where.push('employee_id = ?'); params.push(filterEmp); }
  if (filterAction) { where.push('action = ?'); params.push(filterAction); }

  const sql =
    `SELECT * FROM audit_log` +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY id DESC LIMIT 500';

  const entries = conn.prepare(sql).all(...params) as Array<{
    id: number;
    ts: string;
    actor_user: string;
    actor_role: string;
    action: string;
    area_id: string | null;
    posting_id: string | null;
    offer_id: string | null;
    employee_id: string | null;
    data_json: string | null;
    reason: string | null;
    prev_hash: string | null;
    entry_hash: string | null;
  }>;

  // Action types found in the log, for the filter dropdown.
  const actionTypes = (
    conn.prepare(`SELECT DISTINCT action FROM audit_log ORDER BY action`).all() as { action: string }[]
  ).map((r) => r.action);

  // Areas the persona can see for the area filter.
  const visibleAreas = (
    persona.role === 'admin'
      ? conn.prepare(`SELECT id, name FROM area`).all() as { id: string; name: string }[]
      : persona.area_scope?.length
        ? conn.prepare(`SELECT id, name FROM area WHERE id IN (${persona.area_scope.map(() => '?').join(',')})`).all(...persona.area_scope) as { id: string; name: string }[]
        : []
  );

  return { entries, actionTypes, visibleAreas, filterArea, filterEmp, filterAction };
};
