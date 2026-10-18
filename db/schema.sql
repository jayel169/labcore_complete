-- ============================================================
-- LabCore LIS schema
-- ============================================================
PRAGMA foreign_keys = ON;

-- ---------- USERS / STAFF ----------
CREATE TABLE IF NOT EXISTS staff (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT UNIQUE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,
  department      TEXT,
  ward_ids        TEXT,           -- JSON array
  email           TEXT UNIQUE,
  phone           TEXT,
  pin_hash        TEXT NOT NULL,
  password_hash   TEXT,
  totp_secret     TEXT,
  totp_enabled    INTEGER NOT NULL DEFAULT 0,
  last_totp_step  INTEGER,
  status          TEXT NOT NULL DEFAULT 'active',
  notes           TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  last_login_at   TEXT,
  login_count     INTEGER DEFAULT 0
);

-- ---------- SESSIONS (audit-friendly) ----------
CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  staff_id      TEXT NOT NULL,
  issued_at     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked       INTEGER DEFAULT 0,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- ---------- PATIENTS ----------
CREATE TABLE IF NOT EXISTS patients (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  preferred_name  TEXT,
  dob             TEXT,
  sex             TEXT,
  national_id     TEXT,
  mobile          TEXT,
  email           TEXT,
  address         TEXT,
  emg_name        TEXT,
  emg_relation    TEXT,
  emg_mobile      TEXT,
  alt_phone       TEXT,
  allergies       TEXT,
  chronic         TEXT,
  blood_group     TEXT,
  payment_type    TEXT,
  ins_name        TEXT,
  ins_number      TEXT,
  status          TEXT DEFAULT 'active',
  merged_into     TEXT,
  merged_at       TEXT,
  merged_by       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  data_json       TEXT            -- full snapshot for forward-compat
);

CREATE INDEX IF NOT EXISTS idx_patients_name   ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients(mobile);

-- ---------- ENCOUNTERS ----------
CREATE TABLE IF NOT EXISTS encounters (
  visit_id        TEXT PRIMARY KEY,
  patient_id      TEXT NOT NULL,
  date            TEXT,
  service         TEXT,
  department      TEXT,
  consultant      TEXT,
  chief_complaint TEXT,
  priority        TEXT,
  status          TEXT,
  location_type   TEXT,
  triage_level    INTEGER,
  triage_note     TEXT,
  created_at      TEXT,
  closed_at       TEXT,
  data_json       TEXT,          -- full snapshot
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_enc_patient ON encounters(patient_id);

-- ---------- APPOINTMENTS ----------
CREATE TABLE IF NOT EXISTS appointments (
  id              TEXT PRIMARY KEY,
  patient_id      TEXT NOT NULL,
  staff_id        TEXT NOT NULL,
  appointment_at  TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  type            TEXT NOT NULL DEFAULT 'Consultation',
  status          TEXT NOT NULL DEFAULT 'Scheduled',
  reason          TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  data_json       TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_appointments_at ON appointments(appointment_at, status);
CREATE INDEX IF NOT EXISTS idx_appointments_staff ON appointments(staff_id, appointment_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, appointment_at);

-- ---------- ADMISSIONS ----------
CREATE TABLE IF NOT EXISTS admissions (
  admission_id       TEXT PRIMARY KEY,
  patient_id         TEXT NOT NULL,
  admitted_at        TEXT,
  admitted_by        TEXT,
  ward               TEXT,
  ward_id            TEXT,
  bed                TEXT,
  location_type      TEXT,
  status             TEXT,
  discharged_at      TEXT,
  discharge_diagnosis TEXT,
  data_json          TEXT,       -- vitals, MAR, notes, fluids, etc.
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- ---------- ORDERS (lab/imaging/pharmacy) ----------
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  encounter_id    TEXT NOT NULL,
  patient_id      TEXT NOT NULL,
  type            TEXT NOT NULL,   -- Laboratory | Radiology | Pharmacy
  item            TEXT,
  priority        TEXT,
  status          TEXT,
  result_status   TEXT,
  requested_by_staff_id TEXT,
  specimen_id     TEXT,
  ordered_at      TEXT,
  entered_at      TEXT,
  entered_by      TEXT,
  validated_at    TEXT,
  validated_by    TEXT,
  data_json       TEXT,            -- results{}, panelComment, auditTrail, etc.
  FOREIGN KEY (encounter_id) REFERENCES encounters(visit_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_patient ON orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_orders_spec    ON orders(specimen_id);

-- ---------- SPECIMENS ----------
CREATE TABLE IF NOT EXISTS specimens (
  specimen_id   TEXT PRIMARY KEY,
  patient_id    TEXT,
  patient_name  TEXT,
  visit_id      TEXT,
  tests         TEXT,             -- JSON array
  container     TEXT,
  specimen_type TEXT,
  priority      TEXT,
  received_at   TEXT,
  received_by   TEXT,
  label_printed INTEGER DEFAULT 0,
  label_printed_at TEXT,
  label_printed_by TEXT
);

CREATE TABLE IF NOT EXISTS specimen_events (
  id          TEXT PRIMARY KEY,
  specimen_id TEXT NOT NULL,
  status      TEXT NOT NULL,
  at          TEXT NOT NULL,
  by_name     TEXT NOT NULL,
  note        TEXT,
  FOREIGN KEY (specimen_id) REFERENCES specimens(specimen_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_specimen_events_specimen ON specimen_events(specimen_id, at);
INSERT INTO specimen_events (id, specimen_id, status, at, by_name, note)
SELECT 'legacy-received-' || lower(hex(randomblob(16))), s.specimen_id, 'received',
       COALESCE(s.received_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       COALESCE(s.received_by, 'Legacy record'), 'Initial status imported from specimen record'
FROM specimens s
WHERE NOT EXISTS (
  SELECT 1 FROM specimen_events e WHERE e.specimen_id = s.specimen_id
);

-- QC limits are configured by laboratory staff and never inferred from patient ranges.
CREATE TABLE IF NOT EXISTS qc_controls (
  id          TEXT PRIMARY KEY,
  panel       TEXT NOT NULL,
  test        TEXT NOT NULL,
  instrument  TEXT NOT NULL,
  lot         TEXT NOT NULL,
  level       TEXT NOT NULL,
  target      REAL NOT NULL,
  lower_limit REAL NOT NULL,
  upper_limit REAL NOT NULL,
  expires_on  TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qc_controls_scope ON qc_controls(active, panel, test, instrument);

CREATE TABLE IF NOT EXISTS qc_runs (
  id          TEXT PRIMARY KEY,
  control_id  TEXT NOT NULL,
  value       REAL NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('Pass', 'Fail')),
  run_at      TEXT NOT NULL,
  run_by      TEXT NOT NULL,
  note        TEXT,
  FOREIGN KEY (control_id) REFERENCES qc_controls(id)
);
CREATE INDEX IF NOT EXISTS idx_qc_runs_control_at ON qc_runs(control_id, run_at DESC);

CREATE TABLE IF NOT EXISTS critical_alerts (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL,
  patient_id          TEXT NOT NULL,
  patient_name        TEXT NOT NULL,
  visit_id            TEXT NOT NULL,
  specimen_id         TEXT,
  panel               TEXT NOT NULL,
  test                TEXT NOT NULL,
  result_value        TEXT NOT NULL,
  result_unit         TEXT,
  result_flag         TEXT NOT NULL,
  requesting_staff_id TEXT,
  requesting_name     TEXT,
  created_at          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'acknowledged', 'unassigned')),
  acknowledged_at     TEXT,
  acknowledged_by     TEXT,
  contacted_at        TEXT,
  contacted_by        TEXT,
  contact_method      TEXT,
  contact_note        TEXT,
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_critical_alerts_assignee ON critical_alerts(requesting_staff_id, status, created_at);

CREATE TABLE IF NOT EXISTS tat_targets (
  panel       TEXT PRIMARY KEY COLLATE NOCASE,
  target_hours REAL NOT NULL CHECK (target_hours > 0 AND target_hours <= 720),
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);

-- ---------- AUDIT LOG ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id       TEXT,
  event          TEXT NOT NULL,
  at             TEXT NOT NULL,
  by_name        TEXT,
  role           TEXT,
  role_label     TEXT,
  entity         TEXT,
  entity_id      TEXT,
  patient_id     TEXT,
  patient_name   TEXT,
  visit_id       TEXT,
  specimen_id    TEXT,
  panel          TEXT,
  test           TEXT,
  department     TEXT,
  before_json    TEXT,
  after_json     TEXT,
  note           TEXT,
  duration_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_at   ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_by   ON audit_log(by_name);
CREATE INDEX IF NOT EXISTS idx_audit_evt  ON audit_log(event);

-- ---------- SETTINGS (single-row key/value) ----------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------- PRICES ----------
CREATE TABLE IF NOT EXISTS prices (
  category  TEXT NOT NULL,        -- services | labTests | imaging | pharmacy
  key       TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (category, key)
);

-- ---------- DELIVERIES ----------
CREATE TABLE IF NOT EXISTS deliveries (
  id              TEXT PRIMARY KEY,
  report_ref      TEXT,
  patient_id      TEXT,
  visit_id        TEXT,
  channel         TEXT,
  recipient       TEXT,
  recipient_name  TEXT,
  ttl_hours       INTEGER,
  pin             TEXT,
  download_limit  INTEGER,
  downloads       INTEGER DEFAULT 0,
  opened          INTEGER DEFAULT 0,
  revoked         INTEGER DEFAULT 0,
  created_at      TEXT,
  expires_at      TEXT,
  created_by      TEXT,
  open_log_json   TEXT,
  meta_json       TEXT
);

-- ---------- NOTIFICATIONS ----------
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  staff_name TEXT,           -- NULL = broadcast
  kind       TEXT,
  type       TEXT,
  title      TEXT,
  body       TEXT,
  link       TEXT,
  icon       TEXT,
  read       INTEGER DEFAULT 0,
  at         TEXT NOT NULL,
  meta_json  TEXT
);

-- ---------- TEST PANELS / CONFIG ----------
CREATE TABLE IF NOT EXISTS panels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT UNIQUE,
  data_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_ranges (
  panel_id   TEXT PRIMARY KEY,
  data_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id       TEXT PRIMARY KEY,
  symbol   TEXT UNIQUE,
  name     TEXT,
  category TEXT
);

-- ---------- RECEIPTS ----------
CREATE TABLE IF NOT EXISTS receipts (
  receipt_number TEXT PRIMARY KEY,
  patient_id     TEXT,
  patient_name   TEXT,
  visit_id       TEXT,
  amount_paid    REAL,
  balance_remaining REAL,
  payment_method TEXT,
  printed_at     TEXT,
  printed_by     TEXT,
  data_json      TEXT
);

-- ---------- BILLING PAYMENTS ----------
CREATE TABLE IF NOT EXISTS billing_payments (
  id                 TEXT PRIMARY KEY,
  patient_id         TEXT NOT NULL,
  visit_id           TEXT NOT NULL,
  amount             REAL NOT NULL,
  method             TEXT NOT NULL,
  status             TEXT NOT NULL,
  reference          TEXT,
  provider_reference TEXT UNIQUE,
  received_at        TEXT,
  received_by        TEXT,
  created_at         TEXT NOT NULL,
  data_json          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status ON billing_payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_payments_visit ON billing_payments(visit_id, created_at);

-- ---------- INSURANCE CLAIMS ----------
CREATE TABLE IF NOT EXISTS insurance_claims (
  id             TEXT PRIMARY KEY,
  patient_id     TEXT NOT NULL,
  visit_id       TEXT NOT NULL,
  payer          TEXT NOT NULL,
  member_number  TEXT NOT NULL,
  claim_number   TEXT,
  amount         REAL NOT NULL,
  status         TEXT NOT NULL DEFAULT 'submitted',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  created_by     TEXT,
  data_json      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON insurance_claims(status, created_at);