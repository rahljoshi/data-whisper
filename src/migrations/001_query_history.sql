CREATE TABLE IF NOT EXISTS query_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nl_query TEXT NOT NULL,
  generated_sql TEXT NOT NULL,
  mode VARCHAR(20) NOT NULL,
  type VARCHAR(10) NOT NULL,
  execution_time_ms INTEGER NOT NULL,
  row_count INTEGER,
  affected_rows INTEGER,
  status VARCHAR(20) NOT NULL,
  error_code VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_history_created_at ON query_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_history_mode ON query_history (mode);
CREATE INDEX IF NOT EXISTS idx_query_history_status ON query_history (status);
