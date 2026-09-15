CREATE TABLE IF NOT EXISTS targets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT 'PATIENTS' CHECK(metric='PATIENTS'),
  target_value REAL NOT NULL CHECK(target_value>0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,period_start,period_end,metric),
  CHECK(period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND period_start<=period_end)
);
CREATE INDEX IF NOT EXISTS idx_targets_user_period ON targets(user_id,period_start,period_end,active);
CREATE INDEX IF NOT EXISTS idx_targets_period ON targets(period_start,period_end,active);
