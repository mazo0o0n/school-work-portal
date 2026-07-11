CREATE TABLE IF NOT EXISTS unanswered_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  normalized_question TEXT,
  reason TEXT NOT NULL DEFAULT 'unknown',
  page_path TEXT,
  source TEXT NOT NULL DEFAULT 'unanswered_auto',
  status TEXT NOT NULL DEFAULT 'new',
  repeat_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_unanswered_questions_status
  ON unanswered_questions (status);

CREATE INDEX IF NOT EXISTS idx_unanswered_questions_created_at
  ON unanswered_questions (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unanswered_questions_normalized_question
  ON unanswered_questions (normalized_question)
  WHERE normalized_question IS NOT NULL AND normalized_question != '';
