// Step 5 seed tests — Skilled Trades areas, employees, personas, engineered
// DEMO_TODAY designations.
//
// Each test stands up a fresh in-memory DB, mocks the db() singleton so
// seed.ts writes to it instead of the on-disk file, and then runs the full
// seed pipeline. Assertions cover:
//   - 3 ST areas, 19 ST employees, 7 total areas (4 production + 3 ST)
//   - Apprentice flags, expertise grouping, soft-qual distribution
//   - Bootstrap charges multiplier-weighted with ≥ 2 at 1.5×
//   - Each Battery rotating persona's engineered DEMO_TODAY designation
//   - Fixed-day ST employees land on 'D' Mon-Fri / 'RDO' Sat-Sun
//   - Hours ordering: apprentices > journeys in same expertise; one journey
//     is lowest-hours in each area
//   - Persona scopes: production SVs see NO ST areas; Rodriguez (Union Rep)
//     sees all 7 areas; ST SVs are scoped to single ST area each
//   - Production seed unchanged (4 production areas + 44 employees)

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schemaSql } from './schema.js';
import { runMigrations } from './db.js';
import {
  _resetPatternCacheForTests,
  getDesignation,
  type ShiftDesignation
} from './schedule_eligibility.js';
import { DEMO_TODAY } from './demo_clock.js';
import { PERSONAS } from '../personas.js';

let conn: Database.Database;

beforeEach(async () => {
  conn = new Database(':memory:');
  conn.pragma('foreign_keys = ON');
  conn.exec(schemaSql);
  runMigrations(conn);

  const dbModule = await import('./db.js');
  vi.spyOn(dbModule, 'db').mockReturnValue(conn);
  vi.spyOn(dbModule, 'withTransaction').mockImplementation((fn) => {
    const tx = conn.transaction(fn);
    return tx(conn);
  });
  _resetPatternCacheForTests();

  const { runSeed } = await import('./seed.js');
  runSeed();
});

afterEach(() => {
  vi.restoreAllMocks();
  conn.close();
});

// ============================================================================
// Helpers
// ============================================================================

interface EmpRow {
  id: string;
  display_name: string;
  classification: string;
  area_of_expertise: 'Electrical' | 'Mechanical' | null;
  is_apprentice: number;
  shift_pattern_id: number | null;
  crew_position: number | null;
  cycle_anchor_date: string | null;
}

function getEmployee(id: string): EmpRow {
  const row = conn
    .prepare(
      `SELECT id, display_name, classification, area_of_expertise,
              is_apprentice, shift_pattern_id, crew_position, cycle_anchor_date
         FROM employee WHERE id = ?`
    )
    .get(id) as EmpRow | undefined;
  if (!row) throw new Error(`employee ${id} not seeded`);
  return row;
}

function hoursOffered(employee_id: string, area_id: string): number {
  const row = conn
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM charge
        WHERE employee_id = ? AND area_id = ? AND charge_type = 'hours_offered'`
    )
    .get(employee_id, area_id) as { total: number };
  return row.total;
}

// ============================================================================
// Area + employee counts
// ============================================================================

describe('seed — ST areas and counts (Step 5)', () => {
  it('creates 3 ST areas with type=skilled_trades', () => {
    const rows = conn
      .prepare(`SELECT id, name, shop FROM area WHERE type = 'skilled_trades' ORDER BY id`)
      .all() as { id: string; name: string; shop: string }[];
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.id).sort()).toEqual([
      'area-battery-st-rot', 'area-body-st-1st', 'area-paint-st-1st'
    ]);
  });

  it('total area count is 7 (4 production + 3 ST)', () => {
    const row = conn.prepare(`SELECT COUNT(*) AS n FROM area`).get() as { n: number };
    expect(row.n).toBe(7);
  });

  it('production areas remain unchanged (4 with type=production)', () => {
    const row = conn
      .prepare(`SELECT COUNT(*) AS n FROM area WHERE type = 'production'`)
      .get() as { n: number };
    expect(row.n).toBe(4);
  });

  it('seeds 19 ST employees (8 Body + 5 Paint + 6 Battery)', () => {
    const row = conn
      .prepare(
        `SELECT COUNT(*) AS n FROM employee WHERE shift_pattern_id IS NOT NULL`
      )
      .get() as { n: number };
    expect(row.n).toBe(19);
  });

  it('ST area memberships match per-area expected counts', () => {
    const rows = conn
      .prepare(
        `SELECT m.area_id, COUNT(*) AS n
           FROM area_membership m
           JOIN area a ON a.id = m.area_id
          WHERE a.type = 'skilled_trades'
          GROUP BY m.area_id`
      )
      .all() as { area_id: string; n: number }[];
    const byArea = Object.fromEntries(rows.map((r) => [r.area_id, r.n]));
    expect(byArea['area-body-st-1st']).toBe(8);
    expect(byArea['area-paint-st-1st']).toBe(5);
    expect(byArea['area-battery-st-rot']).toBe(6);
  });

  it('production employee count unchanged at 44 (BA2 14 + Paint 12 + Battery 10 + Finish 8)', () => {
    const row = conn
      .prepare(
        `SELECT COUNT(*) AS n FROM employee WHERE shift_pattern_id IS NULL`
      )
      .get() as { n: number };
    expect(row.n).toBe(44);
  });

  it('seeds 5 apprentices (E:2 + M:3) with is_apprentice=1', () => {
    const rows = conn
      .prepare(
        `SELECT id, area_of_expertise FROM employee WHERE is_apprentice = 1
         ORDER BY id`
      )
      .all() as { id: string; area_of_expertise: string }[];
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.id)).toEqual([
      'emp-davies-r', 'emp-mahmoud-k', 'emp-okonkwo-j', 'emp-stein-m', 'emp-yoon-s'
    ]);
    const electrical = rows.filter((r) => r.area_of_expertise === 'Electrical');
    const mechanical = rows.filter((r) => r.area_of_expertise === 'Mechanical');
    expect(electrical.length).toBe(2);  // Okonkwo-J, Mahmoud-K
    expect(mechanical.length).toBe(3);  // Davies-R, Stein-M, Yoon-S
  });
});

// ============================================================================
// ST qualifications
// ============================================================================

describe('seed — ST qualifications (Step 5)', () => {
  it('adds 4 hard journey quals + 2 new soft quals (welding reused)', () => {
    const ids = (
      conn
        .prepare(
          `SELECT id FROM qualification WHERE id IN
            ('qual-electrician-cert','qual-millwright-cert','qual-toolmaker-cert',
             'qual-pipefitter-cert','qual-high-lift','qual-confined-space','qual-welding')`
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
    expect(new Set(ids).size).toBe(7);
  });

  it('each journeyperson holds their classification cert; apprentices hold none', () => {
    const rowsByEmp = (
      conn
        .prepare(
          `SELECT employee_id, qualification_id FROM employee_qualification
            WHERE qualification_id IN
              ('qual-electrician-cert','qual-millwright-cert',
               'qual-toolmaker-cert','qual-pipefitter-cert')`
        )
        .all() as { employee_id: string; qualification_id: string }[]
    );

    // Spot-check the 4 named TM personas in Body that map to journey roles
    const vasquez = rowsByEmp.find((r) => r.employee_id === 'emp-vasquez');
    expect(vasquez?.qualification_id).toBe('qual-electrician-cert');
    const bradley = rowsByEmp.find((r) => r.employee_id === 'emp-bradley');
    expect(bradley?.qualification_id).toBe('qual-millwright-cert');
    const park = rowsByEmp.find((r) => r.employee_id === 'emp-park-r');
    expect(park?.qualification_id).toBe('qual-pipefitter-cert');

    // Apprentices hold no journey cert
    const okonkwo = rowsByEmp.find((r) => r.employee_id === 'emp-okonkwo-j');
    expect(okonkwo).toBeUndefined();
  });

  it('soft quals distributed to named persona TMs', () => {
    const get = (emp: string, qual: string) =>
      conn
        .prepare(
          `SELECT 1 AS hit FROM employee_qualification
            WHERE employee_id = ? AND qualification_id = ?`
        )
        .get(emp, qual);
    expect(get('emp-collins-e', 'qual-welding')).toBeDefined();
    expect(get('emp-singh-e', 'qual-welding')).toBeDefined();
    expect(get('emp-bradley', 'qual-high-lift')).toBeDefined();
    expect(get('emp-larsen-w', 'qual-high-lift')).toBeDefined();
    expect(get('emp-park-r', 'qual-confined-space')).toBeDefined();
    expect(get('emp-murphy-s', 'qual-confined-space')).toBeDefined();
  });
});

// ============================================================================
// Bootstrap charges with multipliers
// ============================================================================

describe('seed — ST bootstrap charges (Step 5)', () => {
  it('inserts at least 2 charges with charge_multiplier = 1.5', () => {
    const row = conn
      .prepare(`SELECT COUNT(*) AS n FROM charge WHERE charge_multiplier = 1.5`)
      .get() as { n: number };
    expect(row.n).toBeGreaterThanOrEqual(2);
  });

  it('inserts at least one charge with charge_multiplier = 2.0 (Battery Larsen-W holiday)', () => {
    const row = conn
      .prepare(`SELECT COUNT(*) AS n FROM charge WHERE charge_multiplier = 2.0`)
      .get() as { n: number };
    expect(row.n).toBeGreaterThanOrEqual(1);
  });

  it('multiplier-weighted amount = raw_hours * multiplier', () => {
    // Larsen-W's 4 × 2.0 holiday charge should appear as amount=8 on the
    // hours_offered row tied to a multiplier=2.0 bootstrap posting.
    const row = conn
      .prepare(
        `SELECT amount FROM charge
          WHERE employee_id = 'emp-larsen-w'
            AND charge_multiplier = 2.0
            AND charge_type = 'hours_offered'`
      )
      .get() as { amount: number } | undefined;
    expect(row?.amount).toBe(8);
  });

  it('apprentices land HIGHER hours than journeys in same area + expertise', () => {
    // Body Electrical: Okonkwo-J (app) > Vasquez & Collins-E
    expect(hoursOffered('emp-okonkwo-j', 'area-body-st-1st'))
      .toBeGreaterThan(hoursOffered('emp-vasquez', 'area-body-st-1st'));
    expect(hoursOffered('emp-okonkwo-j', 'area-body-st-1st'))
      .toBeGreaterThan(hoursOffered('emp-collins-e', 'area-body-st-1st'));

    // Body Mechanical: Davies-R (app) > Bradley, Hassan-W, Tang-T, Park-R
    const daviesH = hoursOffered('emp-davies-r', 'area-body-st-1st');
    for (const j of ['emp-bradley', 'emp-hassan-w', 'emp-tang-t', 'emp-park-r']) {
      expect(daviesH).toBeGreaterThan(hoursOffered(j, 'area-body-st-1st'));
    }

    // Paint Mechanical: Stein-M (app) > Patel-K, Murphy-S, Vincenzo
    const steinH = hoursOffered('emp-stein-m', 'area-paint-st-1st');
    for (const j of ['emp-patel-k', 'emp-murphy-s', 'emp-vincenzo']) {
      expect(steinH).toBeGreaterThan(hoursOffered(j, 'area-paint-st-1st'));
    }

    // Battery Electrical: Mahmoud-K (app) > Singh-E, Iqbal-S
    expect(hoursOffered('emp-mahmoud-k', 'area-battery-st-rot'))
      .toBeGreaterThan(hoursOffered('emp-singh-e', 'area-battery-st-rot'));
    expect(hoursOffered('emp-mahmoud-k', 'area-battery-st-rot'))
      .toBeGreaterThan(hoursOffered('emp-iqbal-s', 'area-battery-st-rot'));

    // Battery Mechanical: Yoon-S (app) > Mwangi-R, Larsen-W
    expect(hoursOffered('emp-yoon-s', 'area-battery-st-rot'))
      .toBeGreaterThan(hoursOffered('emp-mwangi-r', 'area-battery-st-rot'));
    expect(hoursOffered('emp-yoon-s', 'area-battery-st-rot'))
      .toBeGreaterThan(hoursOffered('emp-larsen-w', 'area-battery-st-rot'));
  });

  it('one journeyperson is lowest-hours next-up per area', () => {
    // Vasquez is the lowest journey in Body, Coleman in Paint, Singh-E in
    // Battery. (Mwangi-R is the lowest Mechanical journey in Battery, but
    // Singh-E is lower overall — both work as next-up candidates depending
    // on posting classification.)
    const bodyJourneys = ['emp-vasquez', 'emp-collins-e', 'emp-bradley',
      'emp-hassan-w', 'emp-tang-t', 'emp-park-r'];
    const bodyLow = Math.min(...bodyJourneys.map((e) => hoursOffered(e, 'area-body-st-1st')));
    expect(hoursOffered('emp-vasquez', 'area-body-st-1st')).toBe(bodyLow);

    const paintJourneys = ['emp-coleman', 'emp-patel-k', 'emp-murphy-s', 'emp-vincenzo'];
    const paintLow = Math.min(...paintJourneys.map((e) => hoursOffered(e, 'area-paint-st-1st')));
    expect(hoursOffered('emp-coleman', 'area-paint-st-1st')).toBe(paintLow);

    const batteryJourneys = ['emp-singh-e', 'emp-iqbal-s', 'emp-mwangi-r', 'emp-larsen-w'];
    const batteryLow = Math.min(...batteryJourneys.map((e) => hoursOffered(e, 'area-battery-st-rot')));
    expect(hoursOffered('emp-singh-e', 'area-battery-st-rot')).toBe(batteryLow);
  });
});

// ============================================================================
// Engineered DEMO_TODAY designations
// ============================================================================

describe('seed — Battery rotating crew designations on DEMO_TODAY (Step 5)', () => {
  // Pull a designation through the same cycle math the rotation engine uses.
  function designationFor(emp_id: string, date: string): ShiftDesignation | null {
    const emp = getEmployee(emp_id);
    return getDesignation(
      {
        shift_pattern_id: emp.shift_pattern_id,
        crew_position: emp.crew_position,
        cycle_anchor_date: emp.cycle_anchor_date ?? null
      },
      date
    );
  }

  it("Singh-E (Electrician, crew 1) on DEMO_TODAY = 'D'", () => {
    expect(designationFor('emp-singh-e', DEMO_TODAY)).toBe('D');
  });
  it("Mwangi-R (Millwright, crew 1) on DEMO_TODAY = 'D'", () => {
    expect(designationFor('emp-mwangi-r', DEMO_TODAY)).toBe('D');
  });
  it("Iqbal-S (Electrician, crew 3) on DEMO_TODAY = 'N'", () => {
    expect(designationFor('emp-iqbal-s', DEMO_TODAY)).toBe('N');
  });
  it("Yoon-S (Mechanical apprentice, crew 3) on DEMO_TODAY = 'N'", () => {
    expect(designationFor('emp-yoon-s', DEMO_TODAY)).toBe('N');
  });
  it("Larsen-W (ToolMaker, crew 2) on DEMO_TODAY = 'RDO'", () => {
    expect(designationFor('emp-larsen-w', DEMO_TODAY)).toBe('RDO');
  });
  it("Mahmoud-K (Electrical apprentice, crew 4) on DEMO_TODAY = 'RDO'", () => {
    expect(designationFor('emp-mahmoud-k', DEMO_TODAY)).toBe('RDO');
  });

  it('all 6 Battery rotating employees share the same anchor and pattern', () => {
    const rows = conn
      .prepare(
        `SELECT e.shift_pattern_id, e.cycle_anchor_date, sp.name
           FROM employee e
           JOIN area_membership m ON m.employee_id = e.id
           JOIN shift_pattern sp ON sp.id = e.shift_pattern_id
          WHERE m.area_id = 'area-battery-st-rot'`
      )
      .all() as { shift_pattern_id: number; cycle_anchor_date: string; name: string }[];
    expect(rows.length).toBe(6);
    const uniqueAnchors = new Set(rows.map((r) => r.cycle_anchor_date));
    expect(uniqueAnchors.size).toBe(1);
    expect([...uniqueAnchors][0]).toBe('2026-05-11');
    expect(new Set(rows.map((r) => r.name))).toEqual(new Set(['4_crew_12h_rotating']));
  });
});

describe('seed — Body / Paint fixed_day designations on DEMO_TODAY (Step 5)', () => {
  function designationFor(emp_id: string, date: string): ShiftDesignation | null {
    const emp = getEmployee(emp_id);
    return getDesignation(
      {
        shift_pattern_id: emp.shift_pattern_id,
        crew_position: emp.crew_position,
        cycle_anchor_date: emp.cycle_anchor_date ?? null
      },
      date
    );
  }

  it("every Body ST employee returns 'D' on DEMO_TODAY (Thursday)", () => {
    const ids = (conn.prepare(
      `SELECT e.id FROM employee e
         JOIN area_membership m ON m.employee_id = e.id
        WHERE m.area_id = 'area-body-st-1st'`
    ).all() as { id: string }[]).map((r) => r.id);
    expect(ids.length).toBe(8);
    for (const id of ids) {
      expect(designationFor(id, DEMO_TODAY)).toBe('D');
    }
  });

  it("every Paint ST employee returns 'D' on DEMO_TODAY (Thursday)", () => {
    const ids = (conn.prepare(
      `SELECT e.id FROM employee e
         JOIN area_membership m ON m.employee_id = e.id
        WHERE m.area_id = 'area-paint-st-1st'`
    ).all() as { id: string }[]).map((r) => r.id);
    expect(ids.length).toBe(5);
    for (const id of ids) {
      expect(designationFor(id, DEMO_TODAY)).toBe('D');
    }
  });

  it("Body ST employees return 'RDO' on Saturday and Sunday", () => {
    // 2026-05-16 = Sat, 2026-05-17 = Sun (DEMO_TODAY is Thu 2026-05-14)
    expect(designationFor('emp-vasquez', '2026-05-16')).toBe('RDO');
    expect(designationFor('emp-vasquez', '2026-05-17')).toBe('RDO');
    expect(designationFor('emp-park-r', '2026-05-16')).toBe('RDO');
  });
});

// ============================================================================
// Personas — scopes
// ============================================================================

describe('seed / personas — scope rules (Step 5)', () => {
  it('production supervisors (Garcia, Liu) have NO ST areas in scope', () => {
    const stAreas = ['area-body-st-1st', 'area-paint-st-1st', 'area-battery-st-rot'];
    for (const pid of ['sv-garcia', 'sv-liu']) {
      const p = PERSONAS.find((x) => x.id === pid);
      expect(p).toBeDefined();
      for (const stArea of stAreas) {
        expect(p?.area_scope?.includes(stArea) ?? false).toBe(false);
      }
    }
  });

  it('Rodriguez (Union Rep) sees all 7 areas', () => {
    const rod = PERSONAS.find((p) => p.id === 'ur-rodriguez');
    expect(rod?.area_scope?.length).toBe(7);
    expect(rod?.area_scope).toEqual(expect.arrayContaining([
      'area-ba2-1st', 'area-paint-2nd', 'area-battery-1st', 'area-finish-2nd',
      'area-body-st-1st', 'area-paint-st-1st', 'area-battery-st-rot'
    ]));
  });

  it('each ST SV is scoped to a single ST area', () => {
    const map: Record<string, string> = {
      'sv-body-1st-st':    'area-body-st-1st',
      'sv-paint-1st-st':   'area-paint-st-1st',
      'sv-battery-rot-st': 'area-battery-st-rot'
    };
    for (const [pid, areaId] of Object.entries(map)) {
      const p = PERSONAS.find((x) => x.id === pid);
      expect(p?.role).toBe('st_supervisor');
      expect(p?.area_scope).toEqual([areaId]);
    }
  });

  it('STAC Coordinator Davis covers all 3 ST areas', () => {
    const davis = PERSONAS.find((p) => p.id === 'coord-davis');
    expect(davis?.role).toBe('skt_coordinator');
    expect(davis?.area_scope?.sort()).toEqual([
      'area-battery-st-rot', 'area-body-st-1st', 'area-paint-st-1st'
    ]);
  });

  it('SKT TL Rodriguez-ST is scoped to Body ST 1st only', () => {
    const tl = PERSONAS.find((p) => p.id === 'tl-rodriguez-st');
    expect(tl?.role).toBe('skt_tl');
    expect(tl?.area_scope).toEqual(['area-body-st-1st']);
  });

  it('14 new personas added (8 TMs + STAC + SKT TL + 3 ST SVs + Rodriguez scope extended)', () => {
    // 8 TM personas pointing at the new ST employees
    const stEmployeeIds = new Set([
      'emp-vasquez', 'emp-okonkwo-j', 'emp-bradley', 'emp-park-r',
      'emp-singh-e', 'emp-iqbal-s', 'emp-mwangi-r', 'emp-larsen-w'
    ]);
    const stTMs = PERSONAS.filter(
      (p) => p.role === 'team_member' && p.employee_id && stEmployeeIds.has(p.employee_id)
    );
    expect(stTMs.length).toBe(8);

    expect(PERSONAS.filter((p) => p.role === 'skt_coordinator').length).toBe(1);
    expect(PERSONAS.filter((p) => p.role === 'skt_tl').length).toBe(1);
    expect(PERSONAS.filter((p) => p.role === 'st_supervisor').length).toBe(3);
  });

  it('every TM persona references an existing employee row', () => {
    for (const p of PERSONAS) {
      if (p.role === 'team_member' && p.employee_id) {
        const row = conn
          .prepare(`SELECT id FROM employee WHERE id = ?`)
          .get(p.employee_id);
        expect(row, `persona ${p.id} -> ${p.employee_id} not in employee table`).toBeDefined();
      }
    }
  });
});
