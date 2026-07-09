-- Add optional short label for branches (used in tables)
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "abbreviation" TEXT;
