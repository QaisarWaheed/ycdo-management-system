-- CreateEnum
CREATE TYPE "WhatsAppSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "WhatsAppLetterSend" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "status" "WhatsAppSendStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "metaMessageId" TEXT,
    "lastTriedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppLetterSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppLetterSend_letterId_key" ON "WhatsAppLetterSend"("letterId");

-- CreateIndex
CREATE INDEX "WhatsAppLetterSend_status_idx" ON "WhatsAppLetterSend"("status");

-- AddForeignKey
ALTER TABLE "WhatsAppLetterSend" ADD CONSTRAINT "WhatsAppLetterSend_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppLetterSend" ADD CONSTRAINT "WhatsAppLetterSend_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
