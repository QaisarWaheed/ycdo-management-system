# Monthly payroll day-1 + aggregate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force salary increments to month day 1, and show one Monthly Payroll row per employee with totals matching profile history.

**Architecture:** Normalize `effectiveFrom` in `salaryIncrement`. Reuse the same keep/sum rules as `aggregatePayrollHistoryByMonth`, but keyed by employee within a month, inside `findAll` after attendance attach. HRMS Edit Payroll defaults/enforces the 1st for increments; print uses aggregated API data.

**Tech Stack:** NestJS / Prisma payroll service, Jest, React EditPayrollDialog + PayrollPage.

## Global Constraints

- No bulk rewrite of historical stipend dates.
- UTC date-only for stipend boundaries (existing convention).
- Do not change attendance earning rules.

---

## Task 1: Day-1 snap on salaryIncrement (TDD)

**Files:**
- `apps/api/src/modules/payroll/payroll.service.ts`
- `apps/api/src/modules/payroll/payroll.service.active-stipend.spec.ts` (or new increment snap spec)

- [x] Write failing test: increment with `effectiveFrom: 2026-08-28` stores `2026-08-01` and closes prior on that date
- [x] Implement snap helper used by `salaryIncrement`
- [x] Run test green

## Task 2: Aggregate findAll by employee for a month (TDD)

**Files:**
- `apps/api/src/modules/payroll/payroll.service.ts`
- New or existing payroll service spec

- [x] Write failing test: two August entries same employee → one row with summed basic/net
- [x] Extract/reuse aggregation keyed by `stipendRecord.employeeId` (or employee.id)
- [x] Call after `attachPayrollAttendanceReport` when `query.month` set
- [x] Run test green

## Task 3: HRMS Edit Payroll increment UX

**Files:**
- `apps/hrms/src/components/employees/EditPayrollDialog.tsx`

- [x] When increment checked, default `effectiveFrom` to 1st of current month
- [x] On save, snap non-1st dates to 1st (client) matching API
- [x] Copy explains raises always start on the 1st

## Task 4: Verify Monthly table / print

**Files:**
- `apps/hrms/src/pages/payroll/PayrollPage.tsx` (only if client-side changes needed — prefer API-only)
- Rebuild `apps/api.tar.gz` and `apps/hrms.tar.gz` when shipping

- [x] Confirm print uses `entries` from API (already aggregated)
- [x] Manual check: no client double-count
- [x] Stipend Increment tab also snaps to 1st

## Task 5: Docs already written

- Spec: `docs/superpowers/specs/2026-09-04-monthly-payroll-day1-aggregate-design.md`
- This plan
