-- Req 20.7: payroll activity time windows and IT extensions.
CREATE TYPE "PayrollActivity" AS ENUM ('EMPLOYEE_SALARY_REVIEW', 'HR_SALARY_CORRECTIONS', 'DEPT_INCHARGE_SUGGESTIONS', 'FINANCE_VERIFICATION', 'PC_PROOF_READING');
CREATE TABLE "ActivityExtension" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activity" "PayrollActivity" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityExtension_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityExtension_userId_activity_idx" ON "ActivityExtension"("userId", "activity");
ALTER TABLE "ActivityExtension" ADD CONSTRAINT "ActivityExtension_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
