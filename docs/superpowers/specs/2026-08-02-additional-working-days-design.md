# Additional working days

Date: 2026-08-02  
Status: approved for implementation

## Goal

HR adds per-date **Additional working days** on the employee profile. Portal shows the same list read-only. Payroll pays those days as a **separate slip line**: `dayCount × dailyDutyHours × hourlyRate`.

## Decisions

| Topic | Choice |
|-------|--------|
| Entry | Per calendar date (+ optional note), like OT-by-date |
| UI | New profile tab (HRMS edit, portal view-only) |
| Payroll | Separate line, not mixed into basic hours or OT |
| Mutual swap | Unchanged (stays OT); no auto-create additional days |
| Hours | Not stored on row; computed from employee daily duty hours |

## Data

`AdditionalWorkingDay`: employeeId, date (unique per employee), note?, addedById, timestamps.

## Flow

1. HR opens employee profile → Additional working days → add date/note.
2. Portal employee opens same tab → view list only.
3. Payroll generation for month N: count rows in month → hours → allowance/line “Additional working days”.

## Out of scope

- Auto from mutual swap
- Bulk month day-count without dates
- Editing hours per day
