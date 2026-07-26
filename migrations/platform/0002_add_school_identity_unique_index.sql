-- Prevent duplicate schools without rewriting existing production rows.
-- This migration intentionally fails if duplicate identities already exist,
-- so they can be reviewed explicitly instead of deleting data automatically.
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_identity_unique
  ON schools (
    lower(trim(school_name)),
    school_stage,
    lower(trim(education_department))
  );
