-- Idempotency for Hikvision gateway raw-scan deliveries (deviceId + serialNo)

CREATE TABLE "BiometricDeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "employeeId" TEXT,
    "accepted" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricDeviceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BiometricDeviceEvent_deviceId_serialNo_key" ON "BiometricDeviceEvent"("deviceId", "serialNo");
