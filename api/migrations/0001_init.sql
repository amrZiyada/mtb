CREATE TABLE IF NOT EXISTS tests(
  test_no TEXT PRIMARY KEY,
  analysis_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  ref_range TEXT NOT NULL DEFAULT '',
  specimen TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  contract_price REAL NOT NULL DEFAULT 0,
  patient_price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tests_active ON tests(active);
CREATE INDEX IF NOT EXISTS idx_tests_name ON tests(analysis_name);
CREATE INDEX IF NOT EXISTS idx_tests_specimen ON tests(specimen);

CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  patient_name TEXT NOT NULL,
  age INTEGER,
  gender TEXT,
  phone TEXT NOT NULL,
  preferred_at TEXT,
  address TEXT,
  tests_json TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC);
