-- رموز تحقق جوال تسجيل المدارس. لا يحتوي الجدول على رمز OTP الصريح.
CREATE TABLE IF NOT EXISTS phone_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose = 'school_registration'),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_sent_at TEXT NOT NULL,
  verified_at TEXT,
  verification_token_hash TEXT,
  token_expires_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (phone, purpose)
);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_expiry
  ON phone_verifications (expires_at);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_token
  ON phone_verifications (verification_token_hash, token_expires_at);
