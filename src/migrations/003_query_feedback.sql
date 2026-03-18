CREATE TABLE IF NOT EXISTS query_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  history_id UUID REFERENCES query_history(id),
  user_id VARCHAR(100),
  feedback VARCHAR(10) CHECK (feedback IN ('up', 'down')),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_query_feedback_user_history
  ON query_feedback (user_id, history_id);

CREATE INDEX IF NOT EXISTS idx_query_feedback_history_id
  ON query_feedback (history_id);

CREATE INDEX IF NOT EXISTS idx_query_feedback_feedback
  ON query_feedback (feedback);
