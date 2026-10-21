-- addWithQuota counts per game inside a rolling window; this keeps that scan bounded
CREATE INDEX IF NOT EXISTS idx_game_submissions_game_created ON game_submissions(game, created_at);
