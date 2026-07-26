CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (length(trim(action)) BETWEEN 1 AND 80),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) BETWEEN 1 AND 40),
  entity_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'no_change', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_audit_school_status_update
AFTER UPDATE OF verification_status ON schools
WHEN OLD.verification_status <> NEW.verification_status
BEGIN
  INSERT INTO audit_logs (
    action,
    entity_type,
    entity_id,
    result,
    metadata_json
  ) VALUES (
    'school_status_changed',
    'school',
    CAST(NEW.id AS TEXT),
    'success',
    '{"previous_status":"' || OLD.verification_status ||
      '","new_status":"' || NEW.verification_status || '"}'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_school_delete
BEFORE DELETE ON schools
BEGIN
  INSERT INTO audit_logs (
    action,
    entity_type,
    entity_id,
    result,
    metadata_json
  ) VALUES (
    'school_deleted',
    'school',
    CAST(OLD.id AS TEXT),
    'success',
    '{"verification_status":"' || OLD.verification_status || '"}'
  );
END;
