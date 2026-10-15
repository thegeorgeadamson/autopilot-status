-- Additional diagnostics; existing raw history and percentages remain intact.
CREATE TABLE IF NOT EXISTS monitor_evidence (
  minute INTEGER NOT NULL, target_id TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (minute, target_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS monitor_independent (
  id INTEGER PRIMARY KEY CHECK (id = 1), checked_at TEXT NOT NULL, payload TEXT NOT NULL
) WITHOUT ROWID;
