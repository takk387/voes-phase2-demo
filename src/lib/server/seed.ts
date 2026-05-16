// Synthetic data seed for the VOES Phase 2 demo.
//
// Per the round-2 spec (§22.2: hours-from-day-1, no interim period), the
// demo now leads with final-mode areas. Interim is shown as the contract-
// anticipated alternative, not the operating expectation.
//
//   Paint 2nd shift — FINAL mode, 12 TMs, with realistic hours data
//                     (default persona Newman opens the walkthrough here)
//   Battery 1st     — FINAL mode, 10 TMs, with realistic hours data
//   BA2 1st shift   — interim mode, 14 TMs (Adams ... Jones) — shown as
//                     the contract-anticipated interim pathway, which
//                     §22.2 has the parties skipping in production
//   Finish 2nd      — interim mode, 8 TMs, smaller area; doubles as the
//                     escalation-demo area AND the cutover-demo target
//
// Specific hire dates the plan calls out are honored:
//   Khan 2014-03-01, Hansen 2020-02-26, Jones 2023-06-07
//
// Run:   npm run seed   (idempotent — wipes and re-creates)

import { db, withTransaction } from './db.js';
import { writeAudit } from './audit.js';
import { randomUUID } from 'node:crypto';
import { seedShiftPatterns } from './shift_patterns.js';
import { _resetPatternCacheForTests } from './schedule_eligibility.js';
import { DEMO_TODAY } from './demo_clock.js';

// ============================================================================
// Type
// ============================================================================
interface EmployeeSeed {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  hire_date: string;
  last4_ssn: string;
  shift: string;
  qualifications: string[];
}

interface AreaSeed {
  id: string;
  name: string;
  shop: string;
  line: string;
  shift: string;
  posting_location: string;
  mode: 'interim' | 'final';
  members: EmployeeSeed[];
}

// ============================================================================
// BA2 1st shift — Appendix C cast
// ============================================================================
const BA2_TMS: EmployeeSeed[] = [
  { id: 'emp-adams-r',  display_name: 'Adams, R.',  first_name: 'Renee',   last_name: 'Adams',  hire_date: '2008-03-15', last4_ssn: '4421', shift: '1st', qualifications: ['qual-welding', 'qual-forklift'] },
  { id: 'emp-brown-j',  display_name: 'Brown, J.',  first_name: 'James',   last_name: 'Brown',  hire_date: '2010-07-22', last4_ssn: '1856', shift: '1st', qualifications: [] },
  { id: 'emp-chen-l',   display_name: 'Chen, L.',   first_name: 'Lily',    last_name: 'Chen',   hire_date: '2012-09-04', last4_ssn: '7203', shift: '1st', qualifications: ['qual-welding'] },
  { id: 'emp-davis-m',  display_name: 'Davis, M.',  first_name: 'Marcus',  last_name: 'Davis',  hire_date: '2013-05-30', last4_ssn: '3091', shift: '1st', qualifications: ['qual-forklift'] },
  { id: 'emp-khan-a',   display_name: 'Khan, A.',   first_name: 'Aisha',   last_name: 'Khan',   hire_date: '2014-03-01', last4_ssn: '6517', shift: '1st', qualifications: ['qual-forklift'] },
  { id: 'emp-evans-t',  display_name: 'Evans, T.',  first_name: 'Tomás',   last_name: 'Evans',  hire_date: '2015-11-12', last4_ssn: '8842', shift: '1st', qualifications: ['qual-welding'] },
  { id: 'emp-foster-d', display_name: 'Foster, D.', first_name: 'Dawn',    last_name: 'Foster', hire_date: '2016-08-19', last4_ssn: '0274', shift: '1st', qualifications: [] },
  { id: 'emp-lopez-c',  display_name: 'Lopez, C.',  first_name: 'Carlos',  last_name: 'Lopez',  hire_date: '2017-04-27', last4_ssn: '5639', shift: '1st', qualifications: [] },
  { id: 'emp-garcia-a', display_name: 'Garcia, A.', first_name: 'Ana',     last_name: 'Garcia', hire_date: '2018-01-15', last4_ssn: '1182', shift: '1st', qualifications: ['qual-forklift'] },
  { id: 'emp-martin-s', display_name: 'Martin, S.', first_name: 'Sofia',   last_name: 'Martin', hire_date: '2019-09-03', last4_ssn: '4960', shift: '1st', qualifications: ['qual-welding'] },
  { id: 'emp-hansen-k', display_name: 'Hansen, K.', first_name: 'Kyle',    last_name: 'Hansen', hire_date: '2020-02-26', last4_ssn: '7715', shift: '1st', qualifications: ['qual-forklift'] },
  { id: 'emp-iqbal-r',  display_name: 'Iqbal, R.',  first_name: 'Reza',    last_name: 'Iqbal',  hire_date: '2021-06-14', last4_ssn: '2308', shift: '1st', qualifications: ['qual-welding'] },
  { id: 'emp-nguyen-h', display_name: 'Nguyen, H.', first_name: 'Hoa',     last_name: 'Nguyen', hire_date: '2022-08-08', last4_ssn: '9047', shift: '1st', qualifications: ['qual-forklift'] },
  { id: 'emp-jones-t',  display_name: 'Jones, T.',  first_name: 'Tyler',   last_name: 'Jones',  hire_date: '2023-06-07', last4_ssn: '5523', shift: '1st', qualifications: [] }
];

// ============================================================================
// Paint 2nd shift — final mode, with seeded hours
// ============================================================================
const PAINT_TMS: EmployeeSeed[] = [
  { id: 'emp-walker-d',     display_name: 'Walker, D.',    first_name: 'Diane',   last_name: 'Walker',     hire_date: '2007-09-12', last4_ssn: '6612', shift: '2nd', qualifications: ['qual-spray-paint', 'qual-paint-robot'] },
  { id: 'emp-patel-n',      display_name: 'Patel, N.',     first_name: 'Nikhil',  last_name: 'Patel',      hire_date: '2009-04-23', last4_ssn: '0418', shift: '2nd', qualifications: ['qual-spray-paint'] },
  { id: 'emp-okafor-c',     display_name: 'Okafor, C.',    first_name: 'Chinwe',  last_name: 'Okafor',     hire_date: '2011-11-08', last4_ssn: '7344', shift: '2nd', qualifications: ['qual-spray-paint', 'qual-paint-robot'] },
  { id: 'emp-rivera-j',     display_name: 'Rivera, J.',    first_name: 'Jorge',   last_name: 'Rivera',     hire_date: '2013-02-14', last4_ssn: '2299', shift: '2nd', qualifications: ['qual-spray-paint'] },
  { id: 'emp-wong-t',       display_name: 'Wong, T.',      first_name: 'Tessa',   last_name: 'Wong',       hire_date: '2014-08-29', last4_ssn: '1907', shift: '2nd', qualifications: ['qual-spray-paint', 'qual-paint-robot'] },
  { id: 'emp-baker-s',      display_name: 'Baker, S.',     first_name: 'Shane',   last_name: 'Baker',      hire_date: '2015-12-03', last4_ssn: '5076', shift: '2nd', qualifications: ['qual-spray-paint'] },
  { id: 'emp-yamamoto-r',   display_name: 'Yamamoto, R.',  first_name: 'Ren',     last_name: 'Yamamoto',   hire_date: '2017-06-19', last4_ssn: '8821', shift: '2nd', qualifications: ['qual-spray-paint'] },
  { id: 'emp-osullivan-k',  display_name: "O'Sullivan, K.",first_name: 'Kieran',  last_name: "O'Sullivan", hire_date: '2018-10-02', last4_ssn: '4453', shift: '2nd', qualifications: ['qual-spray-paint', 'qual-paint-robot'] },
  { id: 'emp-grant-m',      display_name: 'Grant, M.',     first_name: 'Maya',    last_name: 'Grant',      hire_date: '2019-05-21', last4_ssn: '6168', shift: '2nd', qualifications: ['qual-spray-paint'] },
  { id: 'emp-castillo-a',   display_name: 'Castillo, A.',  first_name: 'Antonio', last_name: 'Castillo',   hire_date: '2020-08-14', last4_ssn: '3320', shift: '2nd', qualifications: ['qual-spray-paint'] },
  { id: 'emp-park-h',       display_name: 'Park, H.',      first_name: 'Hye-jin', last_name: 'Park',       hire_date: '2022-01-10', last4_ssn: '7785', shift: '2nd', qualifications: ['qual-spray-paint'] },
  { id: 'emp-newman-l',     display_name: 'Newman, L.',    first_name: 'Logan',   last_name: 'Newman',     hire_date: '2024-03-04', last4_ssn: '9914', shift: '2nd', qualifications: ['qual-spray-paint'] }
];

// Hours-state for Paint 2nd. After ~8 weeks of final-mode operation. Newman
// is genuinely lowest at 32 — they'll be next-up under Procedure B.
const PAINT_HOURS: Record<string, { offered: number; accepted: number; worked: number }> = {
  'emp-walker-d':    { offered: 56, accepted: 48, worked: 48 },
  'emp-patel-n':     { offered: 52, accepted: 36, worked: 36 },
  'emp-okafor-c':    { offered: 48, accepted: 48, worked: 48 },
  'emp-rivera-j':    { offered: 48, accepted: 32, worked: 32 },
  'emp-wong-t':      { offered: 44, accepted: 40, worked: 40 },
  'emp-baker-s':     { offered: 44, accepted: 28, worked: 28 },
  'emp-yamamoto-r':  { offered: 40, accepted: 36, worked: 36 },
  'emp-osullivan-k': { offered: 40, accepted: 24, worked: 24 },
  'emp-grant-m':     { offered: 36, accepted: 32, worked: 32 },
  'emp-castillo-a':  { offered: 36, accepted: 16, worked: 16 },
  'emp-park-h':      { offered: 36, accepted: 28, worked: 28 },
  'emp-newman-l':    { offered: 32, accepted: 16, worked: 16 }
};

// ============================================================================
// Battery 1st shift — final mode, with seeded hours
// ============================================================================
const BATTERY_TMS: EmployeeSeed[] = [
  { id: 'emp-thornton-r',  display_name: 'Thornton, R.', first_name: 'Rita',     last_name: 'Thornton', hire_date: '2010-02-15', last4_ssn: '8801', shift: '1st', qualifications: ['qual-high-voltage', 'qual-module-assembly'] },
  { id: 'emp-velasquez-d', display_name: 'Velasquez, D.',first_name: 'Diego',    last_name: 'Velasquez',hire_date: '2012-06-04', last4_ssn: '4490', shift: '1st', qualifications: ['qual-high-voltage'] },
  { id: 'emp-kovac-i',     display_name: 'Kovac, I.',    first_name: 'Ivana',    last_name: 'Kovac',    hire_date: '2014-09-22', last4_ssn: '0015', shift: '1st', qualifications: ['qual-high-voltage', 'qual-module-assembly'] },
  { id: 'emp-singh-r',     display_name: 'Singh, R.',    first_name: 'Ravi',     last_name: 'Singh',    hire_date: '2016-04-11', last4_ssn: '3367', shift: '1st', qualifications: ['qual-high-voltage'] },
  { id: 'emp-bauer-w',     display_name: 'Bauer, W.',    first_name: 'Wendy',    last_name: 'Bauer',    hire_date: '2017-08-29', last4_ssn: '7152', shift: '1st', qualifications: ['qual-module-assembly'] },
  { id: 'emp-mensah-k',    display_name: 'Mensah, K.',   first_name: 'Kofi',     last_name: 'Mensah',   hire_date: '2019-01-07', last4_ssn: '2048', shift: '1st', qualifications: ['qual-high-voltage'] },
  { id: 'emp-doyle-p',     display_name: 'Doyle, P.',    first_name: 'Padraic',  last_name: 'Doyle',    hire_date: '2020-11-19', last4_ssn: '5589', shift: '1st', qualifications: [] },
  { id: 'emp-rao-s',       display_name: 'Rao, S.',      first_name: 'Sneha',    last_name: 'Rao',      hire_date: '2021-09-13', last4_ssn: '6620', shift: '1st', qualifications: ['qual-module-assembly'] },
  { id: 'emp-ortiz-l',     display_name: 'Ortiz, L.',    first_name: 'Lucia',    last_name: 'Ortiz',    hire_date: '2022-05-26', last4_ssn: '1094', shift: '1st', qualifications: [] },
  { id: 'emp-fischer-t',   display_name: 'Fischer, T.',  first_name: 'Theo',     last_name: 'Fischer',  hire_date: '2023-12-08', last4_ssn: '8836', shift: '1st', qualifications: [] }
];

// Hours-state for Battery 1st. After ~8 weeks of final-mode operation.
// Fischer is lowest offered at 30 — they'll be next-up under Procedure B.
const BATTERY_HOURS: Record<string, { offered: number; accepted: number; worked: number }> = {
  'emp-thornton-r':  { offered: 60, accepted: 48, worked: 48 },
  'emp-velasquez-d': { offered: 52, accepted: 36, worked: 36 },
  'emp-kovac-i':     { offered: 52, accepted: 44, worked: 44 },
  'emp-singh-r':     { offered: 48, accepted: 24, worked: 24 },
  'emp-bauer-w':     { offered: 44, accepted: 40, worked: 40 },
  'emp-mensah-k':    { offered: 40, accepted: 28, worked: 28 },
  'emp-doyle-p':     { offered: 40, accepted: 24, worked: 24 },
  'emp-rao-s':       { offered: 36, accepted: 28, worked: 28 },
  'emp-ortiz-l':     { offered: 32, accepted: 16, worked: 16 },
  'emp-fischer-t':   { offered: 30, accepted: 16, worked: 16 }
};

// ============================================================================
// Finish 2nd shift — small area, interim mode, escalation demo material
// ============================================================================
const FINISH_TMS: EmployeeSeed[] = [
  { id: 'emp-howard-c',   display_name: 'Howard, C.',  first_name: 'Connor',  last_name: 'Howard',  hire_date: '2011-03-05', last4_ssn: '9237', shift: '2nd', qualifications: ['qual-final-inspect'] },
  { id: 'emp-amari-s',    display_name: 'Amari, S.',   first_name: 'Selam',   last_name: 'Amari',   hire_date: '2013-10-17', last4_ssn: '4421', shift: '2nd', qualifications: ['qual-final-inspect', 'qual-rework'] },
  { id: 'emp-chen-w',     display_name: 'Chen, W.',    first_name: 'Wei',     last_name: 'Chen',    hire_date: '2015-07-23', last4_ssn: '1108', shift: '2nd', qualifications: ['qual-rework'] },
  { id: 'emp-blake-r',    display_name: 'Blake, R.',   first_name: 'Riley',   last_name: 'Blake',   hire_date: '2017-11-30', last4_ssn: '6053', shift: '2nd', qualifications: [] },
  { id: 'emp-larsen-e',   display_name: 'Larsen, E.',  first_name: 'Erik',    last_name: 'Larsen',  hire_date: '2019-06-15', last4_ssn: '3344', shift: '2nd', qualifications: ['qual-final-inspect'] },
  { id: 'emp-mwangi-j',   display_name: 'Mwangi, J.',  first_name: 'Joyce',   last_name: 'Mwangi',  hire_date: '2020-12-02', last4_ssn: '7727', shift: '2nd', qualifications: ['qual-rework'] },
  { id: 'emp-tran-d',     display_name: 'Tran, D.',    first_name: 'Duc',     last_name: 'Tran',    hire_date: '2022-04-19', last4_ssn: '0872', shift: '2nd', qualifications: [] },
  { id: 'emp-pope-a',     display_name: 'Pope, A.',    first_name: 'Avery',   last_name: 'Pope',    hire_date: '2023-08-11', last4_ssn: '4965', shift: '2nd', qualifications: [] }
];

// ============================================================================
// Areas
// ============================================================================
const AREAS: AreaSeed[] = [
  { id: 'area-ba2-1st',    name: 'BA2 1st shift',         shop: 'Body',    line: 'BA2',         shift: '1st', posting_location: 'Break room board, north wall',  mode: 'interim', members: BA2_TMS },
  { id: 'area-paint-2nd',  name: 'Paint 2nd shift',       shop: 'Paint',   line: 'Top coat',    shift: '2nd', posting_location: 'Spray booth bulletin board',     mode: 'final',   members: PAINT_TMS },
  { id: 'area-battery-1st',name: 'Battery 1st shift',     shop: 'Battery', line: 'Module asm',  shift: '1st', posting_location: 'Module assembly area kiosk',     mode: 'final',   members: BATTERY_TMS },
  { id: 'area-finish-2nd', name: 'Finish 2nd shift',      shop: 'Finish',  line: 'Final/rework',shift: '2nd', posting_location: 'Finish line podium',             mode: 'interim', members: FINISH_TMS }
];

// ============================================================================
// Wipe + seed
// ============================================================================
// Wipe must run OUTSIDE a transaction. SQLite's `PRAGMA foreign_keys` cannot
// be changed inside a transaction, and we need it off here — otherwise any
// child→parent reference (e.g. bypass_remedy → offer, mandatory_escalation_event
// → posting) blocks the cascade. We re-enable FKs immediately and seed inside
// a transaction with FKs back on, so the seeded state is fully consistent.
function wipe() {
  const conn = db();
  conn.pragma('foreign_keys = OFF');
  try {
    const tables = [
      'cycle_offered',
      'first_cycle_offered',
      'rotation_state',
      'charge',
      'response',
      'offer',
      'posting_qualification',
      'posting_preferred_qualification',
      'posting',
      'employee_qualification',
      'qualification',
      'leave_period',
      'area_membership',
      'employee',
      'area_mode_setting',
      'area',
      'audit_log',
      'mode_cutover_event',
      'annual_zero_out_event',
      'bypass_remedy',
      'mandatory_escalation_event',
      'pending_approval'
    ];
    for (const t of tables) conn.exec(`DELETE FROM ${t}`);
    // sqlite_sequence is only created after the first INSERT into an
    // AUTOINCREMENT table. On a fresh in-memory DB (e.g. test setup) the
    // table doesn't exist yet — skip the reset rather than throw.
    try {
      conn.exec(`DELETE FROM sqlite_sequence`);
    } catch {
      // no-op
    }
  } finally {
    conn.pragma('foreign_keys = ON');
  }
}

function seedQualifications() {
  const conn = db();
  const insert = conn.prepare(
    `INSERT INTO qualification (id, name, description) VALUES (?, ?, ?)`
  );
  insert.run('qual-welding',          'Welding certification',           'MIG/TIG weld-prep tasks');
  insert.run('qual-forklift',         'Forklift certification',          'Powered industrial truck operation');
  insert.run('qual-spray-paint',      'Spray paint certification',       'Paint application — booth and spray gun');
  insert.run('qual-paint-robot',      'Paint robot operator',            'Robot programming + recovery');
  insert.run('qual-high-voltage',     'High-voltage handling',           'Battery module electrical work');
  insert.run('qual-module-assembly',  'Module assembly cert',            'Battery cell-to-module assembly');
  insert.run('qual-final-inspect',    'Final inspection cert',           'Vehicle quality check sign-off');
  insert.run('qual-rework',           'Rework cert',                     'Authorized rework operations');

  // Skilled Trades hard quals (journeyperson certifications). Step 3's
  // rotation engine uses these as required_qualifications on ST postings —
  // an Electrician posting requires qual-electrician-cert, etc.
  insert.run('qual-electrician-cert', 'Electrician journeyperson card',  'SKT-04A Electrical group journey credential');
  insert.run('qual-millwright-cert',  'Millwright journeyperson card',   'SKT-04A Mechanical group — Millwright credential');
  insert.run('qual-toolmaker-cert',   'ToolMaker journeyperson card',    'SKT-04A Mechanical group — ToolMaker credential');
  insert.run('qual-pipefitter-cert',  'PipeFitter journeyperson card',   'SKT-04A Mechanical group — PipeFitter credential');

  // Skilled Trades soft quals — peripheral certs used as sort preference on
  // posting_preferred_qualification rows. NEVER hard-excludes a candidate
  // who lacks them (Step 3 logic). qual-welding above is also a soft qual
  // for ST postings; reused, not duplicated.
  insert.run('qual-high-lift',        'High-lift operator',              'Scissor / boom lift (>32 ft) operator cert. ST soft qual.');
  insert.run('qual-confined-space',   'Confined space entry',            'OSHA confined-space entry cert. ST soft qual.');
}

// ============================================================================
// Skilled Trades seed types
// ============================================================================
interface STEmployeeSeed {
  id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  hire_date: string;
  last4_ssn: string;
  classification: string;     // 'Electrician' | 'Millwright' | 'ToolMaker' | 'PipeFitter'
                              //  | 'ApprenticeElectrical' | 'ApprenticeMechanical'
  area_of_expertise: 'Electrical' | 'Mechanical';
  is_apprentice: 0 | 1;
  shift: string;              // legacy field (still NOT NULL on employee)
  shift_pattern_name: string;
  crew_position: number | null;
  cycle_anchor_date: string;
  hard_qualifications: string[];
  soft_qualifications: string[];
}

interface STAreaSeed {
  id: string;
  name: string;
  shop: string;
  line: string;
  shift: string;
  posting_location: string;
  no_show_penalty_hours: number;
  allow_inter_shop_canvass: 0 | 1;
  members: STEmployeeSeed[];
}

// Bootstrap charge row — one per (employee, multiplier). Each row produces
// one bootstrap posting/offer/response and the matching hours_offered +
// (optional) hours_accepted + hours_worked charges. amount = raw_hours ×
// multiplier (Step 3 charge convention).
interface STBootstrapCharge {
  employee_id: string;
  raw_hours_offered: number;
  raw_hours_accepted: number;  // 0 = no-response (treated as a "no" for charging)
  multiplier: 1.0 | 1.5 | 2.0;
}

// ============================================================================
// ST cycle anchor — DEMO_TODAY rounded back to most recent Monday
// ============================================================================
// DEMO_TODAY = 2026-05-14 (Thursday). Most recent Monday = 2026-05-11.
// Both Body and Paint fixed_day employees anchor here:
//   dayDelta = 3 → dayInCycle = 3 → calendar[0][3] = 'D' (Thu = day shift).
//
// For the Battery 4_crew_12h_rotating area, the SAME anchor produces
// DIFFERENT designations based on crew_position (calendar[crew_idx][3]):
//   Crew 1 (idx 0): 'D'   — Week 1 Mon-Thu D block
//   Crew 2 (idx 1): 'RDO' — Week 1: N RDO RDO RDO D D D  → Thu = RDO
//   Crew 3 (idx 2): 'N'   — Week 1: RDO N N N RDO RDO RDO → Thu = N
//   Crew 4 (idx 3): 'RDO' — Week 1 Mon-Thu RDO block
//
// So the Battery personas vary by crew_position to hit the engineered
// narrative on DEMO_TODAY:
//   Singh-E (Electrician)    → crew 1 → D    (this-week day shift, eligible)
//   Mwangi-R (Millwright)    → crew 1 → D    (this-week day shift, eligible)
//   Iqbal-S (Electrician)    → crew 3 → N    (this-week night shift, day-OT conflict)
//   Mechanical apprentice    → crew 3 → N    (also nights)
//   Larsen-W (ToolMaker)     → crew 2 → RDO  (this-week RDO, RDO-volunteer eligible)
//   Electrical apprentice    → crew 4 → RDO  (this-week RDO)
//
// If a future maintainer advances DEMO_TODAY past 2026-05-17, the calendar
// dayInCycle will shift and these designations move with it. Re-engineer
// anchors at that point or accept the rotation. The compliance check
// "ST personas land on their engineered designation" in seed_st.test.ts is
// the safety net.
const ST_CYCLE_ANCHOR = '2026-05-11';

// ============================================================================
// Body Shop Skilled Trades — 1st Shift
// ============================================================================
// 8 employees, all fixed_day. Electrical group: 2 journeys + 1 apprentice.
// Mechanical group: 4 journeys (2 Millwright, 1 ToolMaker, 1 PipeFitter)
// + 1 apprentice. Soft-qual distribution per the plan:
//   Collins-E (Electrician) has welding; Bradley (Millwright) has high-lift;
//   Park-R (PipeFitter) has confined-space.
const BODY_ST_TMS: STEmployeeSeed[] = [
  { id: 'emp-vasquez', display_name: 'Vasquez, R.', first_name: 'Ricardo', last_name: 'Vasquez',
    hire_date: '2009-04-12', last4_ssn: '3344',
    classification: 'Electrician', area_of_expertise: 'Electrical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-electrician-cert'], soft_qualifications: [] },
  { id: 'emp-collins-e', display_name: 'Collins, E.', first_name: 'Evan', last_name: 'Collins',
    hire_date: '2011-09-08', last4_ssn: '5072',
    classification: 'Electrician', area_of_expertise: 'Electrical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-electrician-cert'], soft_qualifications: ['qual-welding'] },
  { id: 'emp-okonkwo-j', display_name: 'Okonkwo, J.', first_name: 'Jamal', last_name: 'Okonkwo',
    hire_date: '2023-01-09', last4_ssn: '8821',
    classification: 'ApprenticeElectrical', area_of_expertise: 'Electrical', is_apprentice: 1,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: [], soft_qualifications: [] },
  { id: 'emp-bradley', display_name: 'Bradley, M.', first_name: 'Marcus', last_name: 'Bradley',
    hire_date: '2010-06-20', last4_ssn: '6633',
    classification: 'Millwright', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-millwright-cert'], soft_qualifications: ['qual-high-lift'] },
  { id: 'emp-hassan-w', display_name: 'Hassan, W.', first_name: 'Walid', last_name: 'Hassan',
    hire_date: '2013-11-04', last4_ssn: '2918',
    classification: 'Millwright', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-millwright-cert'], soft_qualifications: [] },
  { id: 'emp-tang-t', display_name: 'Tang, T.', first_name: 'Tao', last_name: 'Tang',
    hire_date: '2015-02-17', last4_ssn: '4407',
    classification: 'ToolMaker', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-toolmaker-cert'], soft_qualifications: [] },
  { id: 'emp-park-r', display_name: 'Park, R.', first_name: 'Reagan', last_name: 'Park',
    hire_date: '2014-07-29', last4_ssn: '7081',
    classification: 'PipeFitter', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-pipefitter-cert'], soft_qualifications: ['qual-confined-space'] },
  { id: 'emp-davies-r', display_name: 'Davies, R.', first_name: 'Riya', last_name: 'Davies',
    hire_date: '2022-08-22', last4_ssn: '9265',
    classification: 'ApprenticeMechanical', area_of_expertise: 'Mechanical', is_apprentice: 1,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: [], soft_qualifications: [] }
];

// Bootstrap charges Body ST. Apprentices land above every journey in their
// own expertise. Vasquez is the lowest Electrical journey, Bradley is the
// lowest Mechanical journey. Collins-E and Park-R also each pick up a 1.5×
// weekend posting on top of their base, demonstrating multiplier-weighted
// charges in the standing view.
//
// Final amounts (sum of hours_offered after multiplier):
//   Electrical:  Vasquez=8 < Collins-E=14+(4×1.5)=20 < Okonkwo-J=24 (app)
//   Mechanical:  Bradley=10 < Hassan-W=16 < Tang-T=18 < Park-R=14+(4×1.5)=20 < Davies-R=32 (app)
const BODY_ST_BOOTSTRAP: STBootstrapCharge[] = [
  { employee_id: 'emp-vasquez',   raw_hours_offered: 8,  raw_hours_accepted: 6,  multiplier: 1.0 },
  { employee_id: 'emp-collins-e', raw_hours_offered: 14, raw_hours_accepted: 10, multiplier: 1.0 },
  { employee_id: 'emp-collins-e', raw_hours_offered: 4,  raw_hours_accepted: 4,  multiplier: 1.5 },
  { employee_id: 'emp-okonkwo-j', raw_hours_offered: 24, raw_hours_accepted: 18, multiplier: 1.0 },
  { employee_id: 'emp-bradley',   raw_hours_offered: 10, raw_hours_accepted: 8,  multiplier: 1.0 },
  { employee_id: 'emp-hassan-w',  raw_hours_offered: 16, raw_hours_accepted: 12, multiplier: 1.0 },
  { employee_id: 'emp-tang-t',    raw_hours_offered: 18, raw_hours_accepted: 14, multiplier: 1.0 },
  { employee_id: 'emp-park-r',    raw_hours_offered: 14, raw_hours_accepted: 10, multiplier: 1.0 },
  { employee_id: 'emp-park-r',    raw_hours_offered: 4,  raw_hours_accepted: 4,  multiplier: 1.5 },
  { employee_id: 'emp-davies-r',  raw_hours_offered: 32, raw_hours_accepted: 24, multiplier: 1.0 }
];

// ============================================================================
// Paint Shop Skilled Trades — 1st Shift
// ============================================================================
// 5 employees, all fixed_day. Pool is intentionally thin in Paint so that
// inter-shop canvass (allow_inter_shop_canvass=1) has a reason to fire — the
// walkthrough Step 8 § 6 demos Davis posting a PipeFitter need where Paint's
// only PipeFitter (Murphy) is unavailable, extending the canvass to Body.
const PAINT_ST_TMS: STEmployeeSeed[] = [
  { id: 'emp-coleman', display_name: 'Coleman, T.', first_name: 'Trevor', last_name: 'Coleman',
    hire_date: '2012-03-14', last4_ssn: '4815',
    classification: 'Electrician', area_of_expertise: 'Electrical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-electrician-cert'], soft_qualifications: [] },
  { id: 'emp-patel-k', display_name: 'Patel, K.', first_name: 'Kavita', last_name: 'Patel',
    hire_date: '2011-08-27', last4_ssn: '3360',
    classification: 'Millwright', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-millwright-cert'], soft_qualifications: [] },
  { id: 'emp-murphy-s', display_name: 'Murphy, S.', first_name: 'Sean', last_name: 'Murphy',
    hire_date: '2013-12-05', last4_ssn: '7194',
    classification: 'PipeFitter', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-pipefitter-cert'], soft_qualifications: ['qual-confined-space'] },
  { id: 'emp-vincenzo', display_name: 'Vincenzo, A.', first_name: 'Alessio', last_name: 'Vincenzo',
    hire_date: '2016-10-11', last4_ssn: '5523',
    classification: 'ToolMaker', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-toolmaker-cert'], soft_qualifications: [] },
  { id: 'emp-stein-m', display_name: 'Stein, M.', first_name: 'Mira', last_name: 'Stein',
    hire_date: '2023-04-18', last4_ssn: '8607',
    classification: 'ApprenticeMechanical', area_of_expertise: 'Mechanical', is_apprentice: 1,
    shift: '1st', shift_pattern_name: 'fixed_day', crew_position: null, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: [], soft_qualifications: [] }
];

// Final amounts in Paint after multipliers:
//   Electrical:  Coleman=6 (sole Electrical, no apprentice in Paint)
//   Mechanical:  Patel-K=8 < Vincenzo=10 < Murphy-S=12+(4×1.5)=18 < Stein-M=20 (app)
const PAINT_ST_BOOTSTRAP: STBootstrapCharge[] = [
  { employee_id: 'emp-coleman',  raw_hours_offered: 6,  raw_hours_accepted: 4,  multiplier: 1.0 },
  { employee_id: 'emp-patel-k',  raw_hours_offered: 8,  raw_hours_accepted: 6,  multiplier: 1.0 },
  { employee_id: 'emp-murphy-s', raw_hours_offered: 12, raw_hours_accepted: 8,  multiplier: 1.0 },
  { employee_id: 'emp-murphy-s', raw_hours_offered: 4,  raw_hours_accepted: 4,  multiplier: 1.5 },
  { employee_id: 'emp-vincenzo', raw_hours_offered: 10, raw_hours_accepted: 8,  multiplier: 1.0 },
  { employee_id: 'emp-stein-m',  raw_hours_offered: 20, raw_hours_accepted: 16, multiplier: 1.0 }
];

// ============================================================================
// Battery Shop Skilled Trades — 4-crew 12h Rotating
// ============================================================================
// 6 employees, all on 4_crew_12h_rotating with the same cycle_anchor_date.
// Crew positions are engineered so each persona's DEMO_TODAY designation
// matches the narrative — see the comment block above ST_CYCLE_ANCHOR.
//
// `shift` legacy field is set to '1st' across the board so inter-shop canvass
// matching (which uses area.shift) keeps Battery aligned with Body / Paint
// for cross-shop pulls. The actual on-duty time of day comes from the
// shift_pattern + cycle math, not this legacy field, for ST employees.
const BATTERY_ST_TMS: STEmployeeSeed[] = [
  { id: 'emp-singh-e', display_name: 'Singh, E.', first_name: 'Esha', last_name: 'Singh',
    hire_date: '2011-05-23', last4_ssn: '1402',
    classification: 'Electrician', area_of_expertise: 'Electrical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: '4_crew_12h_rotating', crew_position: 1, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-electrician-cert'], soft_qualifications: ['qual-welding'] },
  { id: 'emp-iqbal-s', display_name: 'Iqbal, S.', first_name: 'Saira', last_name: 'Iqbal',
    hire_date: '2013-02-09', last4_ssn: '2630',
    classification: 'Electrician', area_of_expertise: 'Electrical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: '4_crew_12h_rotating', crew_position: 3, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-electrician-cert'], soft_qualifications: [] },
  { id: 'emp-mahmoud-k', display_name: 'Mahmoud, K.', first_name: 'Karim', last_name: 'Mahmoud',
    hire_date: '2023-10-02', last4_ssn: '7341',
    classification: 'ApprenticeElectrical', area_of_expertise: 'Electrical', is_apprentice: 1,
    shift: '1st', shift_pattern_name: '4_crew_12h_rotating', crew_position: 4, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: [], soft_qualifications: [] },
  { id: 'emp-mwangi-r', display_name: 'Mwangi, R.', first_name: 'Ruth', last_name: 'Mwangi',
    hire_date: '2012-11-30', last4_ssn: '5188',
    classification: 'Millwright', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: '4_crew_12h_rotating', crew_position: 1, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-millwright-cert'], soft_qualifications: [] },
  { id: 'emp-larsen-w', display_name: 'Larsen, W.', first_name: 'Wren', last_name: 'Larsen',
    hire_date: '2014-09-15', last4_ssn: '4956',
    classification: 'ToolMaker', area_of_expertise: 'Mechanical', is_apprentice: 0,
    shift: '1st', shift_pattern_name: '4_crew_12h_rotating', crew_position: 2, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: ['qual-toolmaker-cert'], soft_qualifications: ['qual-high-lift'] },
  { id: 'emp-yoon-s', display_name: 'Yoon, S.', first_name: 'Sun-hee', last_name: 'Yoon',
    hire_date: '2022-12-04', last4_ssn: '8870',
    classification: 'ApprenticeMechanical', area_of_expertise: 'Mechanical', is_apprentice: 1,
    shift: '1st', shift_pattern_name: '4_crew_12h_rotating', crew_position: 3, cycle_anchor_date: ST_CYCLE_ANCHOR,
    hard_qualifications: [], soft_qualifications: [] }
];

// Battery final amounts after multipliers:
//   Electrical:  Singh-E=8 < Iqbal-S=14 < Mahmoud-K=20 (app)
//   Mechanical:  Mwangi-R=10 < Larsen-W=12+(4×2.0)=20 < Yoon-S=26 (app)
// Larsen's 4h × 2.0 holiday charge demonstrates the double-time multiplier
// in addition to the 1.5× rows in Body and Paint.
const BATTERY_ST_BOOTSTRAP: STBootstrapCharge[] = [
  { employee_id: 'emp-singh-e',   raw_hours_offered: 8,  raw_hours_accepted: 6,  multiplier: 1.0 },
  { employee_id: 'emp-iqbal-s',   raw_hours_offered: 14, raw_hours_accepted: 10, multiplier: 1.0 },
  { employee_id: 'emp-mahmoud-k', raw_hours_offered: 20, raw_hours_accepted: 16, multiplier: 1.0 },
  { employee_id: 'emp-mwangi-r',  raw_hours_offered: 10, raw_hours_accepted: 8,  multiplier: 1.0 },
  { employee_id: 'emp-larsen-w',  raw_hours_offered: 12, raw_hours_accepted: 8,  multiplier: 1.0 },
  { employee_id: 'emp-larsen-w',  raw_hours_offered: 4,  raw_hours_accepted: 4,  multiplier: 2.0 },
  { employee_id: 'emp-yoon-s',    raw_hours_offered: 26, raw_hours_accepted: 20, multiplier: 1.0 }
];

// ============================================================================
// ST Areas — area config per round-2 union meeting clarifications
// ============================================================================
const ST_AREAS: STAreaSeed[] = [
  {
    id: 'area-body-st-1st',
    name: 'Body Shop Skilled Trades — 1st Shift',
    shop: 'Body', line: 'Trades crew', shift: '1st',
    posting_location: 'Trades shop board, mezzanine',
    no_show_penalty_hours: 1,
    allow_inter_shop_canvass: 1,
    members: BODY_ST_TMS
  },
  {
    id: 'area-paint-st-1st',
    name: 'Paint Shop Skilled Trades — 1st Shift',
    shop: 'Paint', line: 'Trades crew', shift: '1st',
    posting_location: 'Paint trades shop board',
    no_show_penalty_hours: 1,
    allow_inter_shop_canvass: 1,
    members: PAINT_ST_TMS
  },
  {
    id: 'area-battery-st-rot',
    name: 'Battery Shop Skilled Trades — 4-Crew Rotating',
    // Legacy area.shift kept aligned with Body / Paint ('1st') so inter-shop
    // canvass treats this area as part of the same shift bucket for cross-
    // shop pulls. Schedule eligibility per individual employee comes from
    // their crew_position + cycle_anchor_date via the rotation cycle math.
    shop: 'Battery', line: 'Trades crew', shift: '1st',
    posting_location: 'Battery trades shop board',
    no_show_penalty_hours: 1,
    allow_inter_shop_canvass: 1,
    members: BATTERY_ST_TMS
  }
];

const ST_BOOTSTRAP_BY_AREA: Record<string, STBootstrapCharge[]> = {
  'area-body-st-1st':    BODY_ST_BOOTSTRAP,
  'area-paint-st-1st':   PAINT_ST_BOOTSTRAP,
  'area-battery-st-rot': BATTERY_ST_BOOTSTRAP
};

function seedSTArea(area: STAreaSeed) {
  const conn = db();

  conn
    .prepare(
      `INSERT INTO area
         (id, name, shop, line, shift, posting_location,
          type, zero_out_month, challenge_window_days,
          no_show_penalty_hours, notification_policy, allow_inter_shop_canvass)
       VALUES (?, ?, ?, ?, ?, ?, 'skilled_trades', '01', 30, ?,
               'in_app_only_no_home_except_emergency', ?)`
    )
    .run(
      area.id, area.name, area.shop, area.line, area.shift, area.posting_location,
      area.no_show_penalty_hours, area.allow_inter_shop_canvass
    );

  // ST areas operate in final mode from day 1 — SKT-04A has no interim phase.
  conn
    .prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES (?, 'final', '2025-01-01T00:00:00Z')`
    )
    .run(area.id);

  const patternIdByName = (name: string): number => {
    const row = conn
      .prepare(`SELECT id FROM shift_pattern WHERE name = ?`)
      .get(name) as { id: number } | undefined;
    if (!row) throw new Error(`shift_pattern '${name}' not seeded — call seedShiftPatterns first`);
    return row.id;
  };

  const insertEmp = conn.prepare(
    `INSERT INTO employee
       (id, display_name, first_name, last_name, hire_date, last4_ssn,
        classification, area_of_expertise, is_apprentice,
        shift, shift_pattern_id, crew_position, cycle_anchor_date,
        status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  );
  const insertMembership = conn.prepare(
    `INSERT INTO area_membership
       (employee_id, area_id, effective_begin_date) VALUES (?, ?, ?)`
  );
  const insertEmpQual = conn.prepare(
    `INSERT INTO employee_qualification
       (employee_id, qualification_id, granted_date, source)
     VALUES (?, ?, ?, 'lms')`
  );

  for (const tm of area.members) {
    const patternId = patternIdByName(tm.shift_pattern_name);
    insertEmp.run(
      tm.id, tm.display_name, tm.first_name, tm.last_name, tm.hire_date, tm.last4_ssn,
      tm.classification, tm.area_of_expertise, tm.is_apprentice,
      tm.shift, patternId, tm.crew_position, tm.cycle_anchor_date
    );
    insertMembership.run(tm.id, area.id, tm.hire_date);
    for (const qid of [...tm.hard_qualifications, ...tm.soft_qualifications]) {
      insertEmpQual.run(tm.id, qid, tm.hire_date);
    }
  }

  conn
    .prepare(`INSERT INTO rotation_state (area_id, current_cycle) VALUES (?, 1)`)
    .run(area.id);
}

// Bootstrap ST hours. One synthetic "historical" posting per (area, multiplier)
// bucket — keeps the audit trail clean while still letting standing views
// show realistic weighted hours. The amount written to each charge row is
// raw_hours × multiplier (Step 3 charge convention), and the offer's
// posting carries the corresponding pay_multiplier so any compliance check
// joining charge.multiplier ↔ posting.multiplier sees a match.
function seedSTHoursBootstrap(area_id: string, charges: STBootstrapCharge[]) {
  if (charges.length === 0) return;
  const conn = db();
  const eightWeeksAgo = new Date(
    new Date(DEMO_TODAY + 'T00:00:00Z').getTime() - 56 * 24 * 3600 * 1000
  );
  const wIso = eightWeeksAgo.toISOString().slice(0, 10);
  const wTs = eightWeeksAgo.toISOString();

  // Group by multiplier so we end up with one bootstrap posting per rate.
  const byMultiplier = new Map<number, STBootstrapCharge[]>();
  for (const c of charges) {
    const arr = byMultiplier.get(c.multiplier);
    if (arr) arr.push(c);
    else byMultiplier.set(c.multiplier, [c]);
  }

  for (const [multiplier, rows] of byMultiplier.entries()) {
    const postingId = `post-${area_id}-bootstrap-${multiplier.toString().replace('.', '_')}`;
    const rateLabel =
      multiplier === 1.0 ? 'straight time'
      : multiplier === 1.5 ? 'time-and-a-half'
      : 'double time';

    conn
      .prepare(
        `INSERT INTO posting
           (id, area_id, ot_type, criticality, work_date, start_time,
            duration_hours, volunteers_needed, notes, posted_by_user,
            posted_at, status, pay_multiplier)
         VALUES (?, ?, 'voluntary_daily', 'critical', ?, ?,
                 0, 0, ?, 'system-bootstrap', ?, 'satisfied', ?)`
      )
      .run(
        postingId, area_id, wIso, '08:00',
        `Bootstrap entry — collapsed historical ${rateLabel} hours for demo. ` +
          'Production would record each posting individually.',
        wTs, multiplier
      );

    writeAudit({
      actor_user: 'system-bootstrap',
      actor_role: 'system',
      action: 'st_history_bootstrap',
      area_id,
      posting_id: postingId,
      data: { multiplier, tm_count: rows.length, rate_label: rateLabel }
    });

    // Step 7 compliance check 12 expects every ST posting whose offers
    // produced responses to have an 'sv_approved_st_posting' audit entry
    // in its history. Bootstrap postings represent historical record — by
    // definition they went through the proper approval chain at the time.
    // Recording a synthetic approval here keeps check 12 uniform across
    // runtime-generated postings and seeded ones.
    writeAudit({
      actor_user: 'system-bootstrap',
      actor_role: 'system',
      action: 'sv_approved_st_posting',
      area_id,
      posting_id: postingId,
      data: { synthetic: true, source: 'st_history_bootstrap' }
    });

    let idx = 0;
    for (const r of rows) {
      const offerId = `ofr-${area_id}-bootstrap-${multiplier.toString().replace('.', '_')}-${idx++}-${r.employee_id}`;
      const accepted = r.raw_hours_accepted > 0;

      conn
        .prepare(
          `INSERT INTO offer
             (id, posting_id, employee_id, offered_by_user, status,
              eligibility_at_offer)
           VALUES (?, ?, ?, 'system-bootstrap', 'responded', 'on_normal_shift')`
        )
        .run(offerId, postingId, r.employee_id);

      conn
        .prepare(
          `INSERT INTO response
             (offer_id, response_type, recorded_by_user, recorded_via)
           VALUES (?, ?, 'system-bootstrap', 'manual_entry')`
        )
        .run(offerId, accepted ? 'yes' : 'no');

      // hours_offered always — every entry was an offered opportunity.
      conn
        .prepare(
          `INSERT INTO charge
             (offer_id, employee_id, area_id, charge_type, amount,
              mode_at_charge, charge_multiplier)
           VALUES (?, ?, ?, 'hours_offered', ?, 'final', ?)`
        )
        .run(offerId, r.employee_id, area_id,
             r.raw_hours_offered * multiplier, multiplier);

      if (accepted) {
        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge, charge_multiplier)
             VALUES (?, ?, ?, 'hours_accepted', ?, 'final', ?)`
          )
          .run(offerId, r.employee_id, area_id,
               r.raw_hours_accepted * multiplier, multiplier);

        conn
          .prepare(
            `INSERT INTO charge
               (offer_id, employee_id, area_id, charge_type, amount,
                mode_at_charge, charge_multiplier)
             VALUES (?, ?, ?, 'hours_worked', ?, 'final', ?)`
          )
          .run(offerId, r.employee_id, area_id,
               r.raw_hours_accepted * multiplier, multiplier);
      }
    }
  }
}

function seedArea(area: AreaSeed) {
  const conn = db();

  conn
    .prepare(
      `INSERT INTO area (id, name, shop, line, shift, posting_location)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(area.id, area.name, area.shop, area.line, area.shift, area.posting_location);

  conn
    .prepare(
      `INSERT INTO area_mode_setting (area_id, mode, effective_begin_date)
       VALUES (?, ?, ?)`
    )
    .run(area.id, area.mode, '2025-01-01T00:00:00Z');

  const insertEmp = conn.prepare(
    `INSERT INTO employee
       (id, display_name, first_name, last_name, hire_date, last4_ssn,
        classification, shift, status)
     VALUES (?, ?, ?, ?, ?, ?, 'production', ?, 'active')`
  );
  const insertMembership = conn.prepare(
    `INSERT INTO area_membership
       (employee_id, area_id, effective_begin_date) VALUES (?, ?, ?)`
  );
  const insertEmpQual = conn.prepare(
    `INSERT INTO employee_qualification
       (employee_id, qualification_id, granted_date, source)
     VALUES (?, ?, ?, 'lms')`
  );

  for (const tm of area.members) {
    insertEmp.run(tm.id, tm.display_name, tm.first_name, tm.last_name, tm.hire_date, tm.last4_ssn, tm.shift);
    insertMembership.run(tm.id, area.id, tm.hire_date);
    for (const qid of tm.qualifications) {
      insertEmpQual.run(tm.id, qid, tm.hire_date);
    }
  }

  conn
    .prepare(`INSERT INTO rotation_state (area_id, current_cycle) VALUES (?, 1)`)
    .run(area.id);
}

// One historical posting per area in BA2's case (showing rotation already in
// motion); for Paint 2nd we instead seed bootstrap hours via a single
// "history" posting. Battery and Finish start clean.
function seedBA2History() {
  const conn = db();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const yIso = (d: Date) => d.toISOString().slice(0, 10);

  const postingId = 'post-2026-05-07-001';

  conn
    .prepare(
      `INSERT INTO posting
         (id, area_id, ot_type, criticality, work_date, start_time,
          duration_hours, volunteers_needed, notes, posted_by_user,
          posted_at, status)
       VALUES (?, 'area-ba2-1st', 'voluntary_daily', 'critical', ?, ?,
               4.0, 2, ?, 'sv-garcia', ?, 'satisfied')`
    )
    .run(
      postingId,
      yIso(yesterday),
      '15:30',
      'Stay-over for line balance recovery',
      new Date(yesterday.getTime() - 4 * 3600 * 1000).toISOString()
    );

  writeAudit({
    actor_user: 'sv-garcia',
    actor_role: 'supervisor',
    action: 'posting_created',
    area_id: 'area-ba2-1st',
    posting_id: postingId,
    data: { ot_type: 'voluntary_daily', volunteers_needed: 2, duration_hours: 4.0 }
  });

  const offers: { id: string; emp: string; resp: 'yes' | 'no' }[] = [
    { id: 'ofr-2026-05-07-001-adams', emp: 'emp-adams-r', resp: 'yes' },
    { id: 'ofr-2026-05-07-001-brown', emp: 'emp-brown-j', resp: 'no'  },
    { id: 'ofr-2026-05-07-001-chen',  emp: 'emp-chen-l',  resp: 'yes' }
  ];

  let pos = 1;
  for (const o of offers) {
    conn
      .prepare(
        `INSERT INTO offer
           (id, posting_id, employee_id, rotation_position, offered_by_user, status)
         VALUES (?, ?, ?, ?, 'sv-garcia', 'responded')`
      )
      .run(o.id, postingId, o.emp, pos);

    writeAudit({
      actor_user: 'sv-garcia',
      actor_role: 'supervisor',
      action: 'offer_made',
      area_id: 'area-ba2-1st',
      posting_id: postingId,
      offer_id: o.id,
      employee_id: o.emp,
      data: { rotation_position: pos }
    });

    conn
      .prepare(
        `INSERT INTO response
           (offer_id, response_type, recorded_by_user, recorded_via)
         VALUES (?, ?, 'sv-garcia', 'supervisor_on_behalf')`
      )
      .run(o.id, o.resp);

    writeAudit({
      actor_user: 'sv-garcia',
      actor_role: 'supervisor',
      action: 'response_recorded',
      area_id: 'area-ba2-1st',
      posting_id: postingId,
      offer_id: o.id,
      employee_id: o.emp,
      data: { response_type: o.resp, recorded_via: 'supervisor_on_behalf' }
    });

    conn
      .prepare(
        `INSERT INTO charge
           (offer_id, employee_id, area_id, charge_type, amount,
            mode_at_charge, cycle_number)
         VALUES (?, ?, 'area-ba2-1st', 'opportunity', 1, 'interim', 1)`
      )
      .run(o.id, o.emp);

    conn
      .prepare(
        `INSERT INTO cycle_offered (area_id, cycle_number, employee_id)
         VALUES ('area-ba2-1st', 1, ?)`
      )
      .run(o.emp);

    writeAudit({
      actor_user: 'system',
      actor_role: 'system',
      action: 'charge_applied',
      area_id: 'area-ba2-1st',
      posting_id: postingId,
      offer_id: o.id,
      employee_id: o.emp,
      data: { charge_type: 'opportunity', amount: 1, cycle_number: 1 }
    });

    pos++;
  }

  writeAudit({
    actor_user: 'sv-garcia',
    actor_role: 'supervisor',
    action: 'posting_satisfied',
    area_id: 'area-ba2-1st',
    posting_id: postingId,
    data: { yes_count: 2, volunteers_needed: 2 }
  });
}

// Final-mode hours bootstrap. Insert one "historical" satisfied posting plus,
// for each TM, a recorded yes/no offer carrying their pre-seeded hours_offered
// and (where accepted) hours_accepted as a single charge per type. In real
// operation these would accumulate from many postings; for the demo we
// collapse them into one bootstrap posting so the area standing renders
// realistically without flooding the audit log.
function seedFinalHoursBootstrap(opts: {
  area_id: string;
  bootstrap_posting_id: string;
  tms: EmployeeSeed[];
  hours: Record<string, { offered: number; accepted: number; worked: number }>;
  audit_action: string;
}) {
  const conn = db();
  const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 3600 * 1000);
  const wIso = eightWeeksAgo.toISOString().slice(0, 10);

  conn
    .prepare(
      `INSERT INTO posting
         (id, area_id, ot_type, criticality, work_date, start_time,
          duration_hours, volunteers_needed, notes, posted_by_user,
          posted_at, status)
       VALUES (?, ?, 'voluntary_daily', 'critical', ?, ?,
               0, 0, ?, 'system-bootstrap', ?, 'satisfied')`
    )
    .run(
      opts.bootstrap_posting_id,
      opts.area_id,
      wIso,
      '14:00',
      'Bootstrap entry — collapsed historical hours for demo. In production each posting would be recorded individually.',
      eightWeeksAgo.toISOString()
    );

  writeAudit({
    actor_user: 'system-bootstrap',
    actor_role: 'system',
    action: opts.audit_action,
    area_id: opts.area_id,
    posting_id: opts.bootstrap_posting_id,
    data: {
      note: 'Final-mode hours bootstrap for demo. See seed.ts.',
      tm_count: opts.tms.length
    }
  });

  for (const tm of opts.tms) {
    const h = opts.hours[tm.id];
    if (!h) continue;
    const offerId = `ofr-${opts.area_id}-bootstrap-${tm.last_name.toLowerCase().replace(/[^a-z]/g, '')}`;

    conn
      .prepare(
        `INSERT INTO offer
           (id, posting_id, employee_id, offered_by_user, status)
         VALUES (?, ?, ?, 'system-bootstrap', 'responded')`
      )
      .run(offerId, opts.bootstrap_posting_id, tm.id);

    conn
      .prepare(
        `INSERT INTO response
           (offer_id, response_type, recorded_by_user, recorded_via)
         VALUES (?, ?, 'system-bootstrap', 'manual_entry')`
      )
      .run(offerId, h.accepted > 0 ? 'yes' : 'no');

    conn
      .prepare(
        `INSERT INTO charge
           (offer_id, employee_id, area_id, charge_type, amount, mode_at_charge)
         VALUES (?, ?, ?, 'hours_offered', ?, 'final')`
      )
      .run(offerId, tm.id, opts.area_id, h.offered);

    if (h.accepted > 0) {
      conn
        .prepare(
          `INSERT INTO charge
             (offer_id, employee_id, area_id, charge_type, amount, mode_at_charge)
           VALUES (?, ?, ?, 'hours_accepted', ?, 'final')`
        )
        .run(offerId, tm.id, opts.area_id, h.accepted);
    }

    if (h.worked > 0) {
      conn
        .prepare(
          `INSERT INTO charge
             (offer_id, employee_id, area_id, charge_type, amount, mode_at_charge)
           VALUES (?, ?, ?, 'hours_worked', ?, 'final')`
        )
        .run(offerId, tm.id, opts.area_id, h.worked);
    }
  }
}

// Auto-seed on first boot when the DB is empty. Used by hooks.server.ts so
// a fresh Railway deploy with an empty volume comes up populated, with no
// extra "first-time setup" step. Idempotent: runs only when `area` is empty.
export function ensureSeeded(): { seeded: boolean; counts?: Record<string, number> } {
  const conn = db();
  const row = conn.prepare(`SELECT COUNT(*) AS n FROM area`).get() as { n: number };
  if (row.n > 0) return { seeded: false };
  const counts = runSeed();
  return { seeded: true, counts };
}

// Exported so server actions (e.g. /demo/reset) can re-seed in-process. The
// `tsx src/lib/server/seed.ts` script entry point at the bottom of this file
// calls runSeed() and prints counts.
export function runSeed(): Record<string, number> {
  // Wipe runs outside the transaction so FK pragma can flip off/on.
  wipe();
  // Seeding runs in a single transaction for atomicity, with FKs back on.
  withTransaction(() => {
    seedQualifications();
    // SKT-04A shift patterns. Idempotent — re-running is a no-op for any
    // pattern already in the table. Production-only fresh DBs still get
    // them inserted so Step 5's ST personas can reference them by id.
    seedShiftPatterns(db());
    _resetPatternCacheForTests();
    for (const area of AREAS) seedArea(area);
    seedBA2History();
    seedFinalHoursBootstrap({
      area_id: 'area-paint-2nd',
      bootstrap_posting_id: 'post-paint-bootstrap-001',
      tms: PAINT_TMS,
      hours: PAINT_HOURS,
      audit_action: 'paint_2nd_history_bootstrap'
    });
    seedFinalHoursBootstrap({
      area_id: 'area-battery-1st',
      bootstrap_posting_id: 'post-battery-bootstrap-001',
      tms: BATTERY_TMS,
      hours: BATTERY_HOURS,
      audit_action: 'battery_1st_history_bootstrap'
    });

    // Skilled Trades (Step 5): 3 areas, 19 employees, multiplier-weighted
    // bootstrap charges. Areas and employees only — postings + offers come
    // through the bootstrap helper.
    for (const stArea of ST_AREAS) seedSTArea(stArea);
    for (const [areaId, charges] of Object.entries(ST_BOOTSTRAP_BY_AREA)) {
      seedSTHoursBootstrap(areaId, charges);
    }
  });

  const conn = db();
  const counts: Record<string, number> = {};
  const tables = [
    'area', 'employee', 'area_membership', 'qualification',
    'employee_qualification', 'posting', 'offer', 'response',
    'charge', 'audit_log', 'shift_pattern'
  ];
  for (const t of tables) {
    counts[t] = (conn.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return counts;
}

// Run as a script via `npm run seed` / `tsx src/lib/server/seed.ts`.
// (When this file is imported as a module — e.g. by the /demo/reset route —
// import.meta.url won't match the entry, so this block is skipped.)
const isEntry = import.meta.url.endsWith('/seed.ts') &&
  process.argv[1] && process.argv[1].endsWith('seed.ts');
if (isEntry) {
  const counts = runSeed();
  console.log('Seed complete:');
  for (const [t, n] of Object.entries(counts)) {
    console.log(`  ${t.padEnd(24)} ${n}`);
  }
}
