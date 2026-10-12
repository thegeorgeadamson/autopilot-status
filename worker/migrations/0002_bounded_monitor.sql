-- Additive replacement. The historical checks table remains untouched.
CREATE TABLE IF NOT EXISTS monitor_current (
  target_id TEXT PRIMARY KEY, minute INTEGER NOT NULL, ok INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL, status_code INTEGER, failure_streak INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS monitor_recent (
  minute INTEGER NOT NULL, target_id TEXT NOT NULL, ok INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL, PRIMARY KEY (minute, target_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS monitor_hourly (
  bucket INTEGER NOT NULL, target_id TEXT NOT NULL, up INTEGER NOT NULL,
  total INTEGER NOT NULL, latency_sum INTEGER NOT NULL, PRIMARY KEY (bucket, target_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS monitor_daily (
  bucket INTEGER NOT NULL, target_id TEXT NOT NULL, up INTEGER NOT NULL,
  total INTEGER NOT NULL, PRIMARY KEY (bucket, target_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS monitor_published (
  id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL
) WITHOUT ROWID;
