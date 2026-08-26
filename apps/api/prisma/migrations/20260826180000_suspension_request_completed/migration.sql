-- Successful inquiry close. Do not reuse CANCELLED (that is an aborted request).
ALTER TYPE "SuspensionRequestStatus" ADD VALUE 'COMPLETED';
