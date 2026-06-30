-- Remove duplicate active shifts (keep oldest per branch + name)
DELETE FROM "Shift" a
USING "Shift" b
WHERE a."branchId" = b."branchId"
  AND a.name = b.name
  AND a."createdAt" > b."createdAt";

CREATE UNIQUE INDEX "Shift_branchId_name_key" ON "Shift"("branchId", "name");
