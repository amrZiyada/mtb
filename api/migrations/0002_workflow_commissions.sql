-- v1.3.0 workflow, users, commissions, extra tests and payments
ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE bookings ADD COLUMN original_total REAL;
ALTER TABLE bookings ADD COLUMN created_by_user_id INTEGER;
ALTER TABLE bookings ADD COLUMN created_by_type TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE bookings ADD COLUMN assigned_to_user_id INTEGER;
ALTER TABLE bookings ADD COLUMN assigned_at TEXT;
ALTER TABLE bookings ADD COLUMN assigned_by_user_id INTEGER;
ALTER TABLE bookings ADD COLUMN accepted_at TEXT;
ALTER TABLE bookings ADD COLUMN confirmed_at TEXT;
ALTER TABLE bookings ADD COLUMN done_at TEXT;
ALTER TABLE bookings ADD COLUMN commission_owner_user_id INTEGER;
ALTER TABLE bookings ADD COLUMN commission_owner_type TEXT;
ALTER TABLE bookings ADD COLUMN commission_base_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN commission_bonus_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN commission_threshold INTEGER NOT NULL DEFAULT 10;
ALTER TABLE bookings ADD COLUMN commission_base_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN commission_bonus_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN commission_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN daily_patient_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN visit_fee_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN visit_fee_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN visit_fee_earned_at TEXT;
ALTER TABLE bookings ADD COLUMN extra_tests_commission_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN edit_deadline TEXT;
ALTER TABLE bookings ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 mobile TEXT NOT NULL DEFAULT '',
 user_type TEXT NOT NULL CHECK(user_type IN ('DOCTOR','REP','SALESMAN')),
 active INTEGER NOT NULL DEFAULT 1,
 permissions_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_status_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 booking_reference TEXT NOT NULL,
 from_status TEXT,
 to_status TEXT NOT NULL,
 changed_by_user_id INTEGER,
 changed_by_type TEXT NOT NULL DEFAULT 'ADMIN',
 note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bsh_booking ON booking_status_history(booking_reference, created_at);

CREATE TABLE IF NOT EXISTS booking_assignment_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 booking_reference TEXT NOT NULL,
 from_user_id INTEGER,
 to_user_id INTEGER,
 assigned_by_user_id INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bah_booking ON booking_assignment_history(booking_reference, created_at);

CREATE TABLE IF NOT EXISTS booking_extra_tests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 booking_reference TEXT NOT NULL,
 test_no TEXT NOT NULL,
 analysis_name TEXT NOT NULL,
 specimen TEXT NOT NULL DEFAULT '',
 price REAL NOT NULL,
 commission_rate REAL NOT NULL,
 commission_amount REAL NOT NULL,
 added_by_user_id INTEGER NOT NULL,
 added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bet_booking ON booking_extra_tests(booking_reference, added_at);

CREATE TABLE IF NOT EXISTS commission_payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 paid_by_user_id INTEGER,
 note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cp_user ON commission_payments(user_id, paid_at);

CREATE TABLE IF NOT EXISTS visit_fee_payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 paid_by_user_id INTEGER,
 note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_vfp_user ON visit_fee_payments(user_id, paid_at);

CREATE TABLE IF NOT EXISTS commission_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 salesman_base_rate REAL NOT NULL DEFAULT 0.01,
 salesman_bonus_rate REAL NOT NULL DEFAULT 0.005,
 doctor_base_rate REAL NOT NULL DEFAULT 0.01,
 doctor_bonus_rate REAL NOT NULL DEFAULT 0.005,
 rep_base_rate REAL NOT NULL DEFAULT 0.01,
 rep_bonus_rate REAL NOT NULL DEFAULT 0.005,
 extra_tests_rate REAL NOT NULL DEFAULT 0.05,
 daily_patient_threshold INTEGER NOT NULL DEFAULT 10,
 doctor_visit_fee REAL NOT NULL DEFAULT 0,
 rep_visit_fee REAL NOT NULL DEFAULT 0,
 edit_pending_hours REAL NOT NULL DEFAULT 24,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO commission_settings(id) VALUES(1);

CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_creator ON bookings(created_by_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned ON bookings(assigned_to_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_patient_phone ON bookings(phone, patient_name);

UPDATE bookings SET original_total=total WHERE original_total IS NULL;
