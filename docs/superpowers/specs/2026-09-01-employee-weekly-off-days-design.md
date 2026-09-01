# Employee weekly off days (paid rest)

Date: 2026-09-01  
Status: approved

## Goal

HR can mark which weekdays an employee does not work (e.g. doctors off Friday or Sunday). Those days are **paid weekly rest**: no auto-absence, no salary cut. Monthly basic still uses the full calendar month. Empty list = seven-day week (current behaviour).

## Decisions

| Topic | Choice |
|-------|--------|
| Meaning of an off weekday | Paid rest (not unpaid) |
| Empty checklist | No weekly off; work all 7 days |
| Mid-month change | Current list applies from that day forward; do not rewrite old attendance |
| Storage | `Employee.weeklyOffWeekdays Int[]`, default `[]` |
| Encoding | `0` = Sunday … `6` = Saturday, Pakistan calendar date |
| Scope | All employees, not doctors-only |
| Shift-level offs | No — two staff on the same shift can differ |
| History table | No — “forward only” is just the current field + existing logs left alone |
| Punch on an off day | Allowed; normal present. Extra pay only if HR adds an additional working day |
| Payroll denominator | Unchanged: full calendar days in the month |
| Auto HOLIDAY rows | No. Off days simply have no UNMARKED placeholder |

## Why not a child table or shift field

Seven checkboxes do not need a join table. Off days are a person rule, not a shift template.

## Data

```prisma
weeklyOffWeekdays Int[] @default([])
```

Validate on write: unique values, each in `0..6`. Order does not matter; persist sorted.

One helper (Pakistan date → weekday) used by attendance cron, unmarked backfill, and discipline:

```ts
isWeeklyOffDate(weeklyOffWeekdays: number[], date: Date): boolean
```

`relieverOnly` staff are already skipped by auto-unmarked; offs are still stored if HR sets them.

## HRMS UI

- **Create employee:** optional checklist Sun–Sat next to duty times. None checked = `[]`.
- **Edit / profile:** same checklist. Changing it does not delete or create past `AttendanceLog` rows.
- Existing employees remain `[]` until HR ticks days.

## Attendance

Skip creating `UNMARKED` when the Pakistan date’s weekday is in `weeklyOffWeekdays`:

- `ShiftAbsentScheduler.markShiftStartAbsent` (including 24h path)
- `ensureUnmarkedForActiveShiftsOnDate` (and any sibling backfill)

Do not run late / UA / absence discipline for that employee+date when it is a weekly off.

If a biometric/manual punch exists on an off day, keep existing present/late logic. Do not auto-create `AdditionalWorkingDay`.

## Payroll

No new payroll rows. Off days are paid because they never become unpaid UNMARKED. Working-day UNMARKED/absent deductions stay as they are.

`computeRelieverPayableMinutes` can later treat a weekly off as “no own paid duty that day”; out of scope for this change.

## Out of scope

- Unpaid weekly offs
- Default Sunday for new hires
- Rewriting historical UNMARKED when offs change
- Remote biometric device config
- Auto extra-duty pay for working a rest day

## Tests

- `[]` → unmarked still created on Friday and Sunday
- `[5]` → Friday Pakistan date skipped; Saturday still unmarked
- `[0]` → Sunday skipped
- Invalid weekday rejected on create/update
- Mid-month field change does not mutate older logs
- Payroll still uses full `daysInMonth` with offs set
