-- Punch time is receive time; the learned device clock error only flags offline dumps.
ALTER TABLE "BiometricDevice" ADD COLUMN "clockOffsetSec" INTEGER;
ALTER TABLE "BiometricDevice" ADD COLUMN "clockCandidateSec" INTEGER;
ALTER TABLE "BiometricDevice" ADD COLUMN "clockCandidateAt" TIMESTAMP(3);
