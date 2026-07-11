-- CreateTable
CREATE TABLE "FaceSyncJob" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceSyncResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceSyncResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaceSyncResult_jobId_deviceId_key" ON "FaceSyncResult"("jobId", "deviceId");

-- AddForeignKey
ALTER TABLE "FaceSyncJob" ADD CONSTRAINT "FaceSyncJob_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSyncResult" ADD CONSTRAINT "FaceSyncResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "FaceSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSyncResult" ADD CONSTRAINT "FaceSyncResult_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
