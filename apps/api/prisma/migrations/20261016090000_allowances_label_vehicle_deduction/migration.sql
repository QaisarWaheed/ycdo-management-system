-- AlterEnum
ALTER TYPE "DeductionType" ADD VALUE 'VEHICLE_INSTALLMENT';

-- The old package lump-sum "Allowances" field was named "Travelling Exp"; YCDO pays no travelling allowance.
UPDATE "PayAllowanceType" SET "name" = 'Allowances'
WHERE "legacyField" = 'allowances' AND "name" = 'Travelling Exp'
  AND NOT EXISTS (SELECT 1 FROM "PayAllowanceType" WHERE "name" = 'Allowances');
