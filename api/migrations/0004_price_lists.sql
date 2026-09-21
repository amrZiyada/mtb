CREATE TABLE price_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_price_lists_one_active
ON price_lists(active)
WHERE active=1;

CREATE TABLE price_list_tests (
  price_list_id INTEGER NOT NULL,
  test_no TEXT NOT NULL,
  analysis_name TEXT NOT NULL,
  unit TEXT,
  ref_range TEXT,
  specimen TEXT,
  duration INTEGER,
  price REAL NOT NULL,
  contract_price REAL NOT NULL DEFAULT 0,
  patient_price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(price_list_id,test_no),
  FOREIGN KEY(price_list_id) REFERENCES price_lists(id)
);

ALTER TABLE bookings ADD COLUMN price_list_id INTEGER;

INSERT INTO price_lists(name,active)
VALUES('Legacy price list',1);

INSERT INTO price_list_tests(
  price_list_id,
  test_no,
  analysis_name,
  unit,
  ref_range,
  specimen,
  duration,
  price,
  contract_price,
  patient_price,
  active
)
SELECT
  1,
  test_no,
  analysis_name,
  unit,
  ref_range,
  specimen,
  duration,
  price,
  contract_price,
  patient_price,
  active
FROM tests
WHERE active=1;

UPDATE bookings
SET price_list_id=1
WHERE price_list_id IS NULL;
