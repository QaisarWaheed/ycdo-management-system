-- Phase 2 Req 7/8: suggested incentives / allowances with executive approval.
CREATE TYPE "PaySuggestionKind" AS ENUM ('INCENTIVE', 'ALLOWANCE');
CREATE TYPE "PaySuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'AMENDED', 'REJECTED');
CREATE TABLE "IncentiveSuggestion" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "PaySuggestionKind" NOT NULL,
    "typeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "suggestedAmount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "suggestedById" TEXT NOT NULL,
    "status" "PaySuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAmount" DECIMAL(10,2),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IncentiveSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IncentiveSuggestion_employeeId_kind_typeId_month_year_key" ON "IncentiveSuggestion"("employeeId", "kind", "typeId", "month", "year");
CREATE INDEX "IncentiveSuggestion_year_month_status_idx" ON "IncentiveSuggestion"("year", "month", "status");
ALTER TABLE "IncentiveSuggestion" ADD CONSTRAINT "IncentiveSuggestion_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
