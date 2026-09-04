# Design: Monthly payroll one-row view + day-1 increments

**Date:** 2026-09-04  
**Status:** Approved (Approach A)  
**Context:** Mid-month stipend edits created multiple Monthly Payroll rows that looked “wrong” vs employee profile Payroll History (which already sums segments).

## Goals

1. **Going forward:** salary increments apply from the **1st of the month** only (no new mid-month package splits from Edit Payroll / increment API).
2. **Monthly Payroll list + print:** show **one row per employee per month**, with totals matching profile Payroll History for that month.
3. **No bulk rewrite** of historical `StipendRecord.effectiveFrom` dates.

## Non-goals

- Auto-moving existing mid-month packages back to day 1 (option 1).
- Changing how Basic is earned from attendance.
- Hiding segment detail inside Payroll Detail / regenerate internals.

## Behavior

### Day-1 increments

- `POST /payroll/increment`: normalize `effectiveFrom` to the **1st calendar day** of the supplied month (UTC date-only, same convention as existing stipend dates).
- Edit Payroll increment mode: default and enforce the 1st; warn if user picks another day, then save as the 1st.
- In-place `PATCH /payroll/stipend` may still correct an open package’s `effectiveFrom` (already supported) when HR intentionally fixes a past mistake.

### Monthly list aggregation

- When listing payroll with a **month** filter, after loading entries (and attaching attendance), **merge** all segments for the same `employeeId` in that month into one row:
  - Sum `basicStipend`, `totalAllowances`, `totalDeductions`, `netStipend`.
  - Keep the open-package segment (or newest) as the primary row identity for actions.
  - Attendance: once (already full-month on each segment).
  - Status: highest of PENDING < PROCESSED < PAID among segments.
- Print report uses the same aggregated list.
- Profile history continues to use existing `aggregatePayrollHistoryByMonth` (already correct).

## Success criteria

- Zakir-style cases: Monthly shows **one** line whose Basic equals sum of former segment Basics (= profile August Basic).
- New increments cannot create a 28th-of-month open package via the increment API.
- Finance print matches the on-screen monthly table.

## Out of scope follow-ups

- Optional “expand segments” UI (Approach C).
- Bulk backfill of August mid-month dates.
