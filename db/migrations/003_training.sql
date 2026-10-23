CREATE TABLE IF NOT EXISTS training_runs (
  id BIGSERIAL PRIMARY KEY,
  game TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  episodes_total INTEGER NOT NULL CHECK (episodes_total > 0 AND episodes_total <= 1000000),
  episodes_done INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  trusted BOOLEAN NOT NULL DEFAULT false,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  ip_hash CHAR(64),
  worker_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_training_runs_queued ON training_runs(created_at, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_training_runs_ip_hash ON training_runs(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_training_runs_status ON training_runs(status);

CREATE TABLE IF NOT EXISTS training_metrics (
  run_id BIGINT NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
  episode INTEGER NOT NULL,
  avg REAL NOT NULL,
  best REAL NOT NULL,
  loss REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, episode)
);

CREATE TABLE IF NOT EXISTS brains (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL UNIQUE REFERENCES training_runs(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  features_version INTEGER NOT NULL,
  episodes INTEGER NOT NULL,
  data JSONB NOT NULL CHECK (octet_length(data::text) <= 8388608),
  eval JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
