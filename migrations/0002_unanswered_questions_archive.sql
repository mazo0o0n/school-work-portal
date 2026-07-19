-- Future archive support for unanswered questions.
-- Prepare only: apply this migration before changing the application from delete to archive.
ALTER TABLE unanswered_questions ADD COLUMN archived_at TEXT;

-- Supports status filtering with stable keyset pagination.
CREATE INDEX IF NOT EXISTS idx_unanswered_questions_status_updated_id
  ON unanswered_questions(status, updated_at DESC, id DESC);

-- Supports future active/archive filtering and archive review.
CREATE INDEX IF NOT EXISTS idx_unanswered_questions_archived_at
  ON unanswered_questions(archived_at);
