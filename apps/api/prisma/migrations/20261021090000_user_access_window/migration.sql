-- Phase 3 Req 20: per-user access window (executives exempt).
ALTER TABLE "User" ADD COLUMN "accessFrom" TIMESTAMP(3), ADD COLUMN "accessUntil" TIMESTAMP(3);
