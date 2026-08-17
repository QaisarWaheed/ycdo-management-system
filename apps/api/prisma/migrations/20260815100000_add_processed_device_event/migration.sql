-- CreateTable
CREATE TABLE "ProcessedDeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "biometricId" TEXT,
    "employeeId" TEXT,
    "punchType" TEXT,
    "rawStatus" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedDeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedDeviceEvent_deviceId_serialNo_key" ON "ProcessedDeviceEvent"("deviceId", "serialNo");

-- CreateIndex
CREATE INDEX "ProcessedDeviceEvent_deviceId_idx" ON "ProcessedDeviceEvent"("deviceId");
