-- Finance verifies an employee's pay package; later package changes need Founder approval.
ALTER TABLE "Employee" ADD COLUMN "payPackageVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "payPackageVerifiedById" TEXT;
