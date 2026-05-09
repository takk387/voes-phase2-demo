// Qualification gap report (§15.4). Per area, shows the ratio of qualified
// TMs to the volume of qualification-required postings observed.
// Intended for Joint Training Committee planning use — surfaces capacity
// constraints without naming individuals.

import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';

interface QualGapRow {
  qualification_id: string;
  qualification_name: string;
  qualified_count: number;
  required_postings_30d: number;
  required_postings_lifetime: number;
  ratio_30d: number | null;          // qualified / required_30d
  flag: 'tight' | 'ok' | 'no_demand';
}

interface AreaQualGap {
  area_id: string;
  area_name: string;
  member_count: number;
  rows: QualGapRow[];
}

export const load: PageServerLoad = ({ locals }) => {
  const role = locals.persona.role;
  if (!['supervisor', 'union_rep', 'plant_manager', 'admin'].includes(role)) {
    redirect(303, '/');
  }

  const conn = db();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  let areaIds: string[];
  if (role === 'admin' || role === 'plant_manager') {
    areaIds = (
      conn.prepare(`SELECT id FROM area WHERE status = 'active' ORDER BY name`).all() as { id: string }[]
    ).map((r) => r.id);
  } else {
    areaIds = locals.persona.area_scope ?? [];
  }

  const quals = conn.prepare(`SELECT id, name FROM qualification ORDER BY name`).all() as { id: string; name: string }[];

  const result: AreaQualGap[] = [];

  for (const areaId of areaIds) {
    const area = conn.prepare(`SELECT id, name FROM area WHERE id = ?`).get(areaId) as { id: string; name: string } | undefined;
    if (!area) continue;

    const memberCount = (
      conn
        .prepare(
          `SELECT COUNT(*) AS c FROM area_membership
            WHERE area_id = ? AND effective_end_date IS NULL`
        )
        .get(area.id) as { c: number }
    ).c;

    const rows: QualGapRow[] = [];
    for (const q of quals) {
      const qualifiedCount = (
        conn
          .prepare(
            `SELECT COUNT(DISTINCT eq.employee_id) AS c
               FROM employee_qualification eq
               JOIN area_membership m
                 ON m.employee_id = eq.employee_id
                AND m.area_id = ?
                AND m.effective_end_date IS NULL
              WHERE eq.qualification_id = ?
                AND eq.revoked_date IS NULL
                AND (eq.expiration_date IS NULL OR eq.expiration_date >= ?)`
          )
          .get(area.id, q.id, today) as { c: number }
      ).c;
      const required30d = (
        conn
          .prepare(
            `SELECT COUNT(*) AS c
               FROM posting_qualification pq
               JOIN posting p ON p.id = pq.posting_id
              WHERE pq.qualification_id = ?
                AND p.area_id = ?
                AND p.work_date >= ?`
          )
          .get(q.id, area.id, thirtyDaysAgo) as { c: number }
      ).c;
      const requiredLifetime = (
        conn
          .prepare(
            `SELECT COUNT(*) AS c
               FROM posting_qualification pq
               JOIN posting p ON p.id = pq.posting_id
              WHERE pq.qualification_id = ? AND p.area_id = ?`
          )
          .get(q.id, area.id) as { c: number }
      ).c;

      const ratio = required30d === 0 ? null : qualifiedCount / required30d;
      let flag: QualGapRow['flag'];
      if (required30d === 0) flag = 'no_demand';
      else if (qualifiedCount === 0) flag = 'tight';
      else if (ratio !== null && ratio < 1) flag = 'tight';
      else flag = 'ok';

      // Only surface qualifications that have either members or demand.
      if (qualifiedCount > 0 || requiredLifetime > 0) {
        rows.push({
          qualification_id: q.id,
          qualification_name: q.name,
          qualified_count: qualifiedCount,
          required_postings_30d: required30d,
          required_postings_lifetime: requiredLifetime,
          ratio_30d: ratio,
          flag
        });
      }
    }

    result.push({
      area_id: area.id,
      area_name: area.name,
      member_count: memberCount,
      rows
    });
  }

  return { areas: result };
};
