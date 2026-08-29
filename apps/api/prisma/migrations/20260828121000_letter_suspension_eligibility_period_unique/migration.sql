-- One eligibility notice per employee per qualifying PKT month (non-reversed).
CREATE UNIQUE INDEX "Letter_suspension_eligibility_period_key"
ON "Letter" ("employeeId", ((variables->>'eligibilityPeriod')))
WHERE "letterType" = 'SUSPENSION_ELIGIBILITY' AND "status" <> 'REVERSED';
