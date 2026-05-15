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
    conn.exec(`DELETE FROM sqlite_sequence`);
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
