-- CreateEnum
CREATE TYPE "PunchReviewStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED');

-- AlterTable
ALTER TABLE "ProcessedDeviceEvent" ADD COLUMN     "deviceTime" TIMESTAMP(3),
ADD COLUMN     "rejectReason" TEXT;

-- CreateTable
CREATE TABLE "PunchReview" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "biometricId" TEXT NOT NULL,
    "employeeId" TEXT,
    "punchType" TEXT,
    "rawStatus" TEXT,
    "deviceTime" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "status" "PunchReviewStatus" NOT NULL DEFAULT 'PENDING',
    "appliedTime" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "PunchReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PunchReview_status_idx" ON "PunchReview"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PunchReview_deviceId_serialNo_key" ON "PunchReview"("deviceId", "serialNo");

