-- Exactly one row per strategy slot (BUY | SELL).
CREATE TABLE IF NOT EXISTS strategies (
  slot TEXT PRIMARY KEY CHECK (slot IN ('BUY', 'SELL')),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'error', 'completed')),
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lp_levels (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL REFERENCES strategies(slot),
  lower_price REAL NOT NULL,
  upper_price REAL NOT NULL,
  lower_bin_id INTEGER,
  upper_bin_id INTEGER,
  budget REAL NOT NULL,
  position_object_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  UNIQUE (slot, id)
);

CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  digest TEXT UNIQUE,
  request_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operations_slot ON operations(slot, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('runtime_mode', 'MONITOR_ONLY');
INSERT OR IGNORE INTO settings(key, value) VALUES ('emergency_stop', '0');
