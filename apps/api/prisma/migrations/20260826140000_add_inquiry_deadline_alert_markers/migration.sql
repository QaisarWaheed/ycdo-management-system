-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN "deadlineReminderSentAt" TIMESTAMP(3);
ALTER TABLE "Inquiry" ADD COLUMN "overdueNotificationSentAt" TIMESTAMP(3);
