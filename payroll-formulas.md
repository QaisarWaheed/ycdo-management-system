# Payroll Formulas — Source Map

Generated 2026-09-05. Verified against current code in `apps/api` and the YCDO Master Payroll Rulebook (see project memory `payroll_rulebook.md`, `payroll_calc_flow.md`).

| # | Value | Formula | Source (file:line) |
|---|---|---|---|
| 1 | Daily Duty Hours | Shift window (start/end) if resolvable → else `employee.dutyTotalHours` → else `8` | `apps/api/src/modules/payroll/payroll-hours.util.ts:73` `resolveDailyDutyHours()` |
| 2 | Hourly Rate | `contractualBasic / (dailyDutyHours × daysInMonth)` | `apps/api/src/modules/payroll/payroll-hours.util.ts:91` `computeHourlyRate()` |
| 3 | Daily Rate | `contractualBasic / daysInMonth` (date-effective, not retroactive) | `apps/api/src/common/stipend.util.ts:162` `dailyStipendRate()` |
| 4 | Payable Days (full-month) | Count of PRESENT/SWAP_COVERED/LATE/HALF_DAY/UNMARKED(elapsed)/ABSENT/UNINFORMED_ABSENT/SHORT_LEAVE(quota)/paid ON_LEAVE(quota)/Weekly Off/Holiday | `apps/api/src/modules/payroll/payroll.service.ts` `computeHourlyBreakdown()` loop, ~L3376–3805 (gap-day pass ~L3694) |
| 5 | Payable Days (segment/join-leave) | Calendar days within employment bounds for the segment | `apps/api/src/common/stipend.util.ts:54` `payrollSegmentPayableDays()` |
| 6 | Prorated Basic (join/leave segment) | `contractualBasic × (payable segment days / daysInMonth)` | `apps/api/src/common/stipend.util.ts:111` `prorateContractualBasicForPayrollSegment()` |
| 7 | Basic Stipend (full month, capped) | `min(1, payableDays/daysInMonth) × contractualBasic` | `apps/api/src/common/stipend.util.ts:170` `basicStipendFromCreditedDays()`; assembled in `payroll-hours.util.ts:311` `buildHourlyPayrollBreakdown()`, day-ratio ~L359–364 |
| 8 | Leave credit minutes (ON_LEAVE / short-leave HALF_DAY) | Full `dailyDutyMinutes` for ON_LEAVE; half for short-leave-noted HALF_DAY | `apps/api/src/modules/payroll/payroll-hours.util.ts:146` `leaveCreditMinutes()` |
| 9 | Paid vs Unpaid leave split | First N (monthly allowance, default 2) of sorted ON_LEAVE dates = paid; rest = unpaid | `apps/api/src/modules/payroll/payroll-hours.util.ts:186` `splitPaidUnpaidLeaveDays()` |
| 10 | Unpaid leave beyond quota | No separate deduction — day excluded from `payableDays` (old fn deprecated) | `apps/api/src/modules/payroll/payroll-hours.util.ts:266` `unpaidLeaveDeductionAmount()` (`@deprecated`, not called) |
| 11 | Reliever payable minutes | `sessionMinutes − overlapWithOwnDutyWindow` (0 if relieverOnly or no window) | `apps/api/src/modules/payroll/payroll-hours.util.ts:233` `computeRelieverPayableMinutes()` |
| 12 | OT / Manual allowance amount | `hours × hourlyRate` (no multiplier); or fixed lump-sum amount if hours not given | `apps/api/src/modules/payroll/payroll-hours.util.ts:282` `resolveManualAllowancePay()` |
| 13 | ABSENT / UNINFORMED_ABSENT deduction | `2 × Daily Rate` | `apps/api/src/modules/attendance/discipline.helper.ts` |
| 14 | HALF_DAY deduction | `0.5 × Daily Rate` | `apps/api/src/modules/attendance/discipline.helper.ts` |
| 15 | UNMARKED (elapsed) deduction | `1 × Daily Rate` | `apps/api/src/modules/attendance/discipline.helper.ts` |
| 16 | Late escalation (>120min) → HALF_DAY | Trigger check | `apps/api/src/modules/attendance/attendance-late.util.ts:37` `computeLateMinutesFromCheckIn()`; escalation in `discipline.helper.ts` ~L136-148 |
| 17 | Late/missing-checkout 3rd & 6th occurrence fine | `1 × Daily Rate` each | `discipline.helper.ts` ~L243, L285 |
| 18 | Additional Working Day | `1 × Daily Rate` | `discipline.helper.ts` / payroll.service allowance path |
| 19 | Money rounding | `Math.round(value × 100) / 100` | `apps/api/src/modules/payroll/payroll-hours.util.ts:277` `roundMoney()` |
| 20 | Final clamp / Net | `Basic = max(0, basic)`, `Deductions = max(0, ded)`, `Allowances = max(0, allow)`, `Net = max(0, basic+allow-ded)` | `apps/api/src/modules/payroll/payroll.service.ts:967` `clampPayrollTotals()` (used at L1412, L1537); monthly-aggregate variant ~L4239-4243 |
| 21 | Segment/day accounting building block | Assembler tying rows 1–7, 12 together into one breakdown | `apps/api/src/modules/payroll/payroll-hours.util.ts:311` `buildHourlyPayrollBreakdown()` |
| 22 | Monthly aggregation across segments | Merges multiple `PayrollEntry` rows for a mid-month package change into one monthly view | `apps/api/src/modules/payroll/payroll-aggregate.util.ts` `mergePayrollSegments()`, `aggregateMonthlyPayrollByEmployee()` |

**Note:** rows 13–18 are documented rulebook rules confirmed in an earlier session (see project memory `payroll_calc_flow.md`) — not re-grepped line-by-line in this pass. Re-verify against `discipline.helper.ts` current line numbers if making changes there.
