// Per-area summary stats for the ST coordinator and SKT TL dashboards.
//
// Each ST area-card on /coord and /skt-tl renders the same shape: expertise
// group counts, apprentice counts, current lowest-hours-next-up per expertise.
// Centralising the queries here keeps the two dashboards in sync.
//
// Note: this is informational only — the rotation_st engine remains the
// source of truth for actual eligibility (it factors in schedule eligibility,
// hard quals, apprentice gating). The "next-up" surfaced here is a quick
// hint for the coordinator, not a binding pick.

import { db } from './db.js';

export interface STExpertiseSummary {
  expertise: 'Electrical' | 'Mechanical';
  journey_count: number;
  apprentice_count: number;
  // Lowest-hours_offered journey TM in this expertise group (ignoring
  // schedule eligibility — that's a per-posting check).
  next_up_name: string | null;
  next_up_hours_offered: number | null;
}

export interface STAreaSummary {
  id: string;
  name: string;
  shop: string;
  shift: string;
  type: 'skilled_trades';
  allow_inter_shop_canvass: boolean;
  notification_policy: string;
  no_show_penalty_hours: number;
  total_members: number;
  expertise: STExpertiseSummary[];
  recent_postings: STRecentPosting[];
}

export interface STRecentPosting {
  id: string;
  work_date: string;
  start_time: string;
  duration_hours: number;
  pay_multiplier: number;
  status: string;
  pending_sv_approval: boolean;
  required_classification: string | null;
  required_expertise: string | null;
  yes_count: number;
  volunteers_needed: number;
}

/** Loads summary stats for a single ST area. Returns null if the area is not skilled_trades. */
export function summarizeSTArea(area_id: string): STAreaSummary | null {
  const conn = db();
  const area = conn
    .prepare<[string], {
      id: string; name: string; shop: string; shift: string; type: string;
      allow_inter_shop_canvass: number;
      notification_policy: string;
      no_show_penalty_hours: number;
    }>(
      `SELECT id, name, shop, shift, type, allow_inter_shop_canvass,
              notification_policy, no_show_penalty_hours
         FROM area WHERE id = ?`
    )
    .get(area_id);
  if (!area || area.type !== 'skilled_trades') return null;

  const memberRows = conn
    .prepare<[string], {
      employee_id: string; display_name: string;
      area_of_expertise: string | null; is_apprentice: number;
    }>(
      `SELECT e.id AS employee_id, e.display_name,
              e.area_of_expertise, e.is_apprentice
         FROM area_membership m
         JOIN employee e ON e.id = m.employee_id
        WHERE m.area_id = ? AND m.effective_end_date IS NULL
          AND e.status = 'active'`
    )
    .all(area_id);

  // Hours-offered per employee in this area, for "next-up" computation.
  const hoursRows = conn
    .prepare<[string], { employee_id: string; total: number }>(
      `SELECT employee_id, COALESCE(SUM(amount), 0) AS total
         FROM charge
        WHERE area_id = ? AND charge_type = 'hours_offered'
        GROUP BY employee_id`
    )
    .all(area_id);
  const hoursByEmployee = new Map<string, number>();
  for (const r of hoursRows) hoursByEmployee.set(r.employee_id, r.total);

  const buckets: Record<'Electrical' | 'Mechanical', {
    journey: typeof memberRows;
    apprentice: typeof memberRows;
  }> = {
    Electrical: { journey: [], apprentice: [] },
    Mechanical: { journey: [], apprentice: [] }
  };
  for (const m of memberRows) {
    if (m.area_of_expertise !== 'Electrical' && m.area_of_expertise !== 'Mechanical') continue;
    if (m.is_apprentice) buckets[m.area_of_expertise].apprentice.push(m);
    else buckets[m.area_of_expertise].journey.push(m);
  }

  const expertise: STExpertiseSummary[] = (['Electrical', 'Mechanical'] as const).map((exp) => {
    const b = buckets[exp];
    if (b.journey.length === 0 && b.apprentice.length === 0) {
      return {
        expertise: exp,
        journey_count: 0,
        apprentice_count: 0,
        next_up_name: null,
        next_up_hours_offered: null
      };
    }
    // Lowest-hours journey TM (apprentices are gated until journeypersons
    // are offered, so they're not "next-up" in normal operation).
    let lowest: { name: string; hours: number } | null = null;
    for (const j of b.journey) {
      const h = hoursByEmployee.get(j.employee_id) ?? 0;
      if (!lowest || h < lowest.hours) lowest = { name: j.display_name, hours: h };
    }
    return {
      expertise: exp,
      journey_count: b.journey.length,
      apprentice_count: b.apprentice.length,
      next_up_name: lowest?.name ?? null,
      next_up_hours_offered: lowest?.hours ?? null
    };
  }).filter((row) => row.journey_count > 0 || row.apprentice_count > 0);

  const recentRows = conn
    .prepare<[string], {
      id: string; work_date: string; start_time: string;
      duration_hours: number; pay_multiplier: number; status: string;
      pending_sv_approval: number;
      required_classification: string | null;
      required_expertise: string | null;
      volunteers_needed: number;
      yes_count: number;
    }>(
      `SELECT p.id, p.work_date, p.start_time, p.duration_hours,
              p.pay_multiplier, p.status, p.pending_sv_approval,
              p.required_classification, p.required_expertise,
              p.volunteers_needed,
              (SELECT COUNT(*) FROM offer o JOIN response r
                 ON r.offer_id = o.id
                WHERE o.posting_id = p.id AND r.response_type = 'yes') AS yes_count
         FROM posting p
        WHERE p.area_id = ?
        ORDER BY p.posted_at DESC
        LIMIT 8`
    )
    .all(area_id);

  return {
    id: area.id,
    name: area.name,
    shop: area.shop,
    shift: area.shift,
    type: 'skilled_trades',
    allow_inter_shop_canvass: !!area.allow_inter_shop_canvass,
    notification_policy: area.notification_policy,
    no_show_penalty_hours: area.no_show_penalty_hours,
    total_members: memberRows.length,
    expertise,
    recent_postings: recentRows.map((r) => ({
      id: r.id,
      work_date: r.work_date,
      start_time: r.start_time,
      duration_hours: r.duration_hours,
      pay_multiplier: r.pay_multiplier,
      status: r.status,
      pending_sv_approval: !!r.pending_sv_approval,
      required_classification: r.required_classification,
      required_expertise: r.required_expertise,
      yes_count: r.yes_count,
      volunteers_needed: r.volunteers_needed
    }))
  };
}
