-- Add UNMARKED attendance status (no check-in recorded yet)
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'UNMARKED';
