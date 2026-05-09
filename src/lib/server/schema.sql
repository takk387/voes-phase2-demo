-- VOES Phase 2 demo schema
-- Maps to Phase 1 plan §8 (Data model). Logical entities preserved; some
-- physical-layer simplifications taken for the demo (single DB, no partitioning,
-- denormalized fields where the query patterns warrant).
--
-- Conventions:
--   - Timestamps in ISO-8601 strings, UTC. Display layer converts to local time.
--   - Soft delete via active flags / effective end dates rather than row removal.
--   - Audit log entries are insert-only at the application layer.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================================
-- Equalization areas
-- ============================================================================
CREATE TABLE IF NOT EXISTS area (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  shop            TEXT NOT NULL,
  line            TEXT NOT NULL,
  shift           TEXT NOT NULL,
  posting_location TEXT NOT NULL DEFAULT 'Area whiteboard',
  status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Mode setting with effective-date history. Current mode is the row with
-- effective_end_date IS NULL. (§4.2, §8.2 Equalization Mode Setting.)
CREATE TABLE IF NOT EXISTS area_mode_setting (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id              TEXT NOT NULL REFERENCES area(id),
  mode                 TEXT NOT NULL CHECK(mode IN ('interim','final')),
  effective_begin_date TEXT NOT NULL,
  effective_end_date   TEXT,
  cutover_event_id     INTEGER,
  approving_company_user TEXT,
  approving_union_user   TEXT
);

CREATE INDEX IF NOT EXISTS idx_area_mode_current
  ON area_mode_setting(area_id) WHERE effective_end_date IS NULL;

-- ============================================================================
-- Employees (sourced from HRIS in production; seeded directly here)
-- ============================================================================
CREATE TABLE IF NOT EXISTS employee (
  id              TEXT PRIMARY KEY,                        -- e.g. emp-adams-r
  display_name    TEXT NOT NULL,                           -- e.g. "Adams, R."
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  hire_date       TEXT NOT NULL,                           -- ISO-8601 date
  last4_ssn       TEXT NOT NULL,                           -- 4 digits, tie-breaker only
  classification  TEXT NOT NULL DEFAULT 'production',
  shift           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active','on_leave','separated')),
  -- Specialty role marker (§4.8). If non-null, this employee's specialty work
  -- is logged separately; production-area work still flows through equalization.
  specialty_role  TEXT
                  CHECK(specialty_role IS NULL OR specialty_role IN ('TL','EO','ST'))
);

-- Area memberships with effective-date history.
CREATE TABLE IF NOT EXISTS area_membership (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id          TEXT NOT NULL REFERENCES employee(id),
  area_id              TEXT NOT NULL REFERENCES area(id),
  effective_begin_date TEXT NOT NULL,
  effective_end_date   TEXT,                               -- NULL = active
  membership_type      TEXT NOT NULL DEFAULT 'primary'
                       CHECK(membership_type IN ('primary','secondary'))
);

CREATE INDEX IF NOT EXISTS idx_membership_active
  ON area_membership(area_id, employee_id) WHERE effective_end_date IS NULL;

-- Approved leaves. While active, employee is skipped from offers per §10.1
-- with no charge and rotation position preserved (PS-034-035).
CREATE TABLE IF NOT EXISTS leave_period (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id          TEXT NOT NULL REFERENCES employee(id),
  leave_type           TEXT NOT NULL,                     -- PTO, FMLA, etc.
  effective_begin_date TEXT NOT NULL,
  effective_end_date   TEXT                                -- NULL = ongoing
);

-- ============================================================================
-- Qualifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS qualification (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS employee_qualification (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  qualification_id TEXT NOT NULL REFERENCES qualification(id),
  granted_date    TEXT NOT NULL,
  expiration_date TEXT,                                   -- NULL = non-expiring
  revoked_date    TEXT,                                   -- NULL = active
  source          TEXT NOT NULL DEFAULT 'lms'
);

-- ============================================================================
-- Opportunity postings
-- ============================================================================
CREATE TABLE IF NOT EXISTS posting (
  id                  TEXT PRIMARY KEY,
  area_id             TEXT NOT NULL REFERENCES area(id),
  ot_type             TEXT NOT NULL DEFAULT 'voluntary_daily'
                      CHECK(ot_type IN (
                        'voluntary_daily','voluntary_weekend','voluntary_holiday',
                        'mandatory_flex','late_add'
                      )),
  -- Critical vs. non-essential — drives escalation behavior per union
  -- feedback round 1 (§22.1). Critical → ask-high/force-low. Non-essential →
  -- ask-high then expand to adjacent units; abandon if no takers.
  criticality         TEXT NOT NULL DEFAULT 'critical'
                      CHECK(criticality IN ('critical','non_essential')),
  work_date           TEXT NOT NULL,
  start_time          TEXT NOT NULL,                     -- HH:MM local
  duration_hours      REAL NOT NULL,
  volunteers_needed   INTEGER NOT NULL,
  notes               TEXT,
  posted_by_user      TEXT NOT NULL,
  posted_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_late_add         INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK(status IN ('open','satisfied','cancelled','abandoned')),
  cancelled_at        TEXT,
  cancelled_reason    TEXT
);

CREATE TABLE IF NOT EXISTS posting_qualification (
  posting_id       TEXT NOT NULL REFERENCES posting(id),
  qualification_id TEXT NOT NULL REFERENCES qualification(id),
  PRIMARY KEY (posting_id, qualification_id)
);

CREATE INDEX IF NOT EXISTS idx_posting_area_status ON posting(area_id, status);

-- ============================================================================
-- Offers and responses
-- ============================================================================
CREATE TABLE IF NOT EXISTS offer (
  id                 TEXT PRIMARY KEY,
  posting_id         TEXT NOT NULL REFERENCES posting(id),
  employee_id        TEXT NOT NULL REFERENCES employee(id),
  rotation_position  INTEGER,                            -- position at time of offer
  offered_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  offered_by_user    TEXT NOT NULL,
  -- Phase tags for escalation flows (§9.5): null for normal voluntary, or
  -- ask_high / force_low for escalation phases.
  phase              TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','responded','expired','superseded'))
);

CREATE INDEX IF NOT EXISTS idx_offer_posting ON offer(posting_id);

CREATE TABLE IF NOT EXISTS response (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id        TEXT NOT NULL REFERENCES offer(id),
  -- Response types per §4.5 + §10:
  --   yes / no                       — first-class outcomes
  --   passed_over_unqualified         — qualification skip, no charge
  --   on_leave                        — approved leave, no charge
  --   on_the_job                      — already working OT, no charge
  --   no_contact                      — unapproved absence, no charge per
  --                                     union round 1 §22.4 default
  --   supervisor_override             — reason logged, charge per supervisor
  response_type   TEXT NOT NULL CHECK(response_type IN (
                    'yes','no','passed_over_unqualified','on_leave',
                    'on_the_job','no_contact','supervisor_override'
                  )),
  recorded_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  recorded_by_user TEXT NOT NULL,
  recorded_via    TEXT NOT NULL DEFAULT 'team_member'
                  CHECK(recorded_via IN ('team_member','supervisor_on_behalf','manual_entry')),
  reason          TEXT,
  -- If this response supersedes an earlier one (correction), point at it.
  supersedes_response_id INTEGER REFERENCES response(id)
);

CREATE INDEX IF NOT EXISTS idx_response_offer ON response(offer_id);

-- ============================================================================
-- Charges (the equalization-relevant consequences of offers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS charge (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id        TEXT NOT NULL REFERENCES offer(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  area_id         TEXT NOT NULL REFERENCES area(id),
  charge_type     TEXT NOT NULL CHECK(charge_type IN (
                    'opportunity','hours_offered','hours_accepted','hours_worked'
                  )),
  amount          REAL NOT NULL,
  mode_at_charge  TEXT NOT NULL CHECK(mode_at_charge IN ('interim','final')),
  recorded_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Reversal pointer for §22.5 cancellation handling. When a posting is
  -- cancelled, every charge for it is reversed by inserting a negation row
  -- that points back to the original via reverses_charge_id.
  reverses_charge_id INTEGER REFERENCES charge(id),
  cycle_number    INTEGER                                -- interim mode cycle context
);

CREATE INDEX IF NOT EXISTS idx_charge_employee_area ON charge(employee_id, area_id);

-- ============================================================================
-- Rotation state per area
-- ============================================================================
CREATE TABLE IF NOT EXISTS rotation_state (
  area_id                    TEXT PRIMARY KEY REFERENCES area(id),
  current_cycle              INTEGER NOT NULL DEFAULT 1,
  cycle_started_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Set true by Procedure D for the first post-cutover cycle, in which
  -- offers go in seniority order regardless of hours (§9.4 STEP 5 / §9.9).
  -- Flips to false when every active member has been offered or correctly
  -- skipped in this first cycle.
  first_cycle_after_cutover  INTEGER NOT NULL DEFAULT 0
);

-- Tracks who has been offered during the first post-cutover cycle (until the
-- flag flips to false).
CREATE TABLE IF NOT EXISTS first_cycle_offered (
  area_id     TEXT NOT NULL REFERENCES area(id),
  employee_id TEXT NOT NULL REFERENCES employee(id),
  PRIMARY KEY (area_id, employee_id)
);

-- Per-cycle bookkeeping in interim mode: who has already been charged in the
-- current cycle (so they're not offered again until cycle completes).
-- (§9.1 STEP 3, the "already offered in this cycle" check.)
CREATE TABLE IF NOT EXISTS cycle_offered (
  area_id      TEXT NOT NULL REFERENCES area(id),
  cycle_number INTEGER NOT NULL,
  employee_id  TEXT NOT NULL REFERENCES employee(id),
  PRIMARY KEY (area_id, cycle_number, employee_id)
);

-- ============================================================================
-- Audit log — append-only at the application layer
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_user    TEXT NOT NULL,
  actor_role    TEXT NOT NULL,
  action        TEXT NOT NULL,                         -- e.g. response_recorded
  area_id       TEXT,
  posting_id    TEXT,
  offer_id      TEXT,
  employee_id   TEXT,
  data_json     TEXT,                                  -- arbitrary JSON payload
  reason        TEXT,
  -- Hash chain. prev_hash points at the previous entry; entry_hash is sha256
  -- over (ts || actor_user || action || data_json || prev_hash). Slice 1
  -- writes the chain; verification view in Slice 4.
  prev_hash     TEXT,
  entry_hash    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_area_ts ON audit_log(area_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_employee_ts ON audit_log(employee_id, ts);

-- ============================================================================
-- Mode cutover and zero-out events (Slice 2 wires these up)
-- ============================================================================
CREATE TABLE IF NOT EXISTS mode_cutover_event (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  scope               TEXT NOT NULL,                   -- single area id or 'plant'
  area_id             TEXT REFERENCES area(id),
  effective_at        TEXT NOT NULL,
  initiating_admin    TEXT NOT NULL,
  approving_company_user TEXT NOT NULL,
  approving_union_user   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annual_zero_out_event (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_at        TEXT NOT NULL,
  initiating_admin    TEXT NOT NULL,
  approving_company_user TEXT NOT NULL,
  approving_union_user   TEXT NOT NULL
);

-- ============================================================================
-- Dual-approval queue (§3.7, §22.7). High-impact admin actions surface here
-- pending Company + Union sign-off, then execute when both approvals are in.
-- ============================================================================
CREATE TABLE IF NOT EXISTS pending_approval (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type        TEXT NOT NULL CHECK(action_type IN ('mode_cutover','annual_zero_out','area_split','area_merge','area_retire')),
  scope              TEXT NOT NULL,                  -- area id or 'plant'
  area_id            TEXT REFERENCES area(id),
  initiated_by_user  TEXT NOT NULL,
  initiated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  payload_json       TEXT,                           -- action-specific params
  approved_company_user TEXT,
  approved_company_at   TEXT,
  approved_union_user   TEXT,
  approved_union_at     TEXT,
  executed_at        TEXT,
  cancelled_at       TEXT,
  cancelled_reason   TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','executed','cancelled'))
);

-- ============================================================================
-- Mandatory escalation events (§9.5 Procedure E + §22.1 union round 1).
-- One row per escalation initiated for a posting.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mandatory_escalation_event (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  posting_id                    TEXT NOT NULL REFERENCES posting(id),
  -- Branch determined by posting.criticality (§22.1 union round 1):
  --   critical: ask_high then force_low (PS-035 exclusions in force phase)
  --   non_essential: cascade to adjacent units; abandon if still short
  branch                        TEXT NOT NULL CHECK(branch IN ('critical','non_essential')),
  volunteer_count_at_escalation INTEGER NOT NULL,
  required_count                INTEGER NOT NULL,
  initiated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  initiated_by_user             TEXT NOT NULL,
  -- Outcome state, updated as the escalation progresses.
  outcome                       TEXT NOT NULL DEFAULT 'in_progress'
                                CHECK(outcome IN (
                                  'in_progress',
                                  'satisfied_ask_high',
                                  'satisfied_force_low',
                                  'satisfied_cascade',
                                  'abandoned'
                                )),
  outcome_at                    TEXT,
  notes                         TEXT
);

CREATE INDEX IF NOT EXISTS idx_escalation_posting ON mandatory_escalation_event(posting_id);

-- ============================================================================
-- Bypass remedy queue (Slice 3 wires the workflow; table here for stability)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bypass_remedy (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  affected_employee_id TEXT NOT NULL REFERENCES employee(id),
  area_id           TEXT NOT NULL REFERENCES area(id),
  missed_offer_id   TEXT REFERENCES offer(id),
  cause             TEXT,
  recorded_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  recorded_by_user  TEXT NOT NULL,
  remedy_offer_id   TEXT REFERENCES offer(id),
  satisfied_at      TEXT,
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open','satisfied','escalated','closed'))
);
