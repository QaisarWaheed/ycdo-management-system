-- Allow half-hour daily duty lengths (e.g. 6.5). Existing whole-hour values are unchanged.
ALTER TABLE "Employee" ALTER COLUMN "dutyTotalHours" TYPE DOUBLE PRECISION;
