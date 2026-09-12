-- عدادات إساءة استخدام التحقق. لا يخزن الجدول IP خامًا أو OTP.
CREATE TABLE IF NOT EXISTS phone_verification_abuse_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN ('send_attempt', 'verify_failure')),
  phone_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ip_phone_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_verification_abuse_phone
  ON phone_verification_abuse_events (event_type, phone_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_phone_verification_abuse_ip
  ON phone_verification_abuse_events (event_type, ip_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_phone_verification_abuse_ip_phone
  ON phone_verification_abuse_events (event_type, ip_phone_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_phone_verification_abuse_global
  ON phone_verification_abuse_events (event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_phone_verification_abuse_expiry
  ON phone_verification_abuse_events (expires_at);

ALTER TABLE phone_verifications ADD COLUMN send_hold_until TEXT;
