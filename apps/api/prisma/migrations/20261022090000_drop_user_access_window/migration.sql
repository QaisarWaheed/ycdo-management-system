-- Req 20 is per-activity time windows, not a login expiry: drop the login window.
ALTER TABLE "User" DROP COLUMN IF EXISTS "accessFrom", DROP COLUMN IF EXISTS "accessUntil";
