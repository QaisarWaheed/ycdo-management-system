-- Free-text inquiry officer (name already existed) plus contact, so Chairman
-- Admin or anyone not in the user list can still be appointed.
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "inquiryOfficerDesignation" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "inquiryOfficerPhone" TEXT;
