-- منصة التنظيم المدرسي: جدول ملفات المدارس
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  edit_token_hash TEXT NOT NULL,
  school_name TEXT NOT NULL CHECK (length(trim(school_name)) BETWEEN 2 AND 120),
  school_stage TEXT NOT NULL CHECK (school_stage IN ('ابتدائية', 'متوسطة', 'ثانوية')),
  education_department TEXT NOT NULL CHECK (length(trim(education_department)) BETWEEN 3 AND 160),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schools_stage
  ON schools (school_stage);

CREATE INDEX IF NOT EXISTS idx_schools_education_department
  ON schools (education_department);

CREATE INDEX IF NOT EXISTS idx_schools_verification_status
  ON schools (verification_status);
