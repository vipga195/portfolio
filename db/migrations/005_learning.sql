CREATE TABLE IF NOT EXISTS game_submissions (
  id BIGSERIAL PRIMARY KEY,
  game TEXT NOT NULL,
  variant TEXT NOT NULL,
  seed BIGINT NOT NULL CHECK (seed >= 0 AND seed < 4294967296),
  moves TEXT NOT NULL CHECK (char_length(moves) BETWEEN 1 AND 40000 AND moves ~ '^[udlr]+$'),
  source_hash CHAR(16) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'rejected')),
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game, seed)
);

CREATE INDEX IF NOT EXISTS idx_game_submissions_status_created ON game_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_game_submissions_source_created ON game_submissions(source_hash, created_at);

CREATE TABLE IF NOT EXISTS brain_publications (
  id BIGSERIAL PRIMARY KEY,
  game TEXT NOT NULL,
  brain_id BIGINT REFERENCES brains(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN ('generation', 'rollback')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- brain_id NULL = built-in brain shipped with the app. Append-only log: the newest row per game is the published brain.
CREATE INDEX IF NOT EXISTS idx_brain_publications_game_id ON brain_publications(game, id DESC);
