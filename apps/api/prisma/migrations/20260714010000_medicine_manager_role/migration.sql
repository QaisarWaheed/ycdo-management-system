-- Add MEDICINE_MANAGER role for attendance scoped to medicine dept/designations

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEDICINE_MANAGER';
ALTER TYPE "BroadcastTarget" ADD VALUE IF NOT EXISTS 'MEDICINE_MANAGER';
