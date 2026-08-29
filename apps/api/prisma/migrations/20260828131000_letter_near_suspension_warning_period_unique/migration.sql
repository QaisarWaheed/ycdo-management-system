-- One near-suspension warning per employee per qualifying PKT month (non-reversed).
CREATE UNIQUE INDEX "Letter_near_suspension_warning_period_key"
ON "Letter" ("employeeId", ((variables->>'warningPeriod')))
WHERE "letterType" = 'NEAR_SUSPENSION_WARNING' AND "status" <> 'REVERSED';
