-- Monthly "allowance not applicable" check for additional duties, with reason.
CREATE TABLE "AdditionalDutyMonthCheck" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdditionalDutyMonthCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdditionalDutyMonthCheck_dutyId_year_month_key" ON "AdditionalDutyMonthCheck"("dutyId", "year", "month");
