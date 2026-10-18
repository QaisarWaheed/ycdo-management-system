-- Phase 3 Req 13: signed appointment form scan on the letter.
ALTER TABLE "Letter" ADD COLUMN "signedScanUrl" TEXT, ADD COLUMN "signedScanMimeType" TEXT, ADD COLUMN "signedScanFileName" TEXT, ADD COLUMN "signedScanUploadedAt" TIMESTAMP(3);
