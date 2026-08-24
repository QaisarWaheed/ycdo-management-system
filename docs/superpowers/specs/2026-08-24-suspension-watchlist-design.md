# Suspension watchlist (phase 1)

Date: 2026-08-24  
Status: approved for implementation (phase 1 only)

## Goal

Stop all automatic disciplinary letters and automatic suspension from attendance. Give HR a dashboard entry and page listing employees who are **near** suspension or **due** for suspension, based on monthly late and uninformed-absent counts. HR will suspend and issue letters manually in later phases; this phase only surfaces risk.

## Context

Today `applyDisciplineRules` / `applyLateDiscipline` in `apps/api/src/modules/attendance/discipline.helper.ts` auto-issues Advice / Warning / Fine / Suspension letters and can set `EmployeeStatus.SUSPENDED` (e.g. 9 lates or uninformed absence above threshold). That conflicts with the new policy: **nothing auto**.

## Decisions

| Topic | Choice |
|-------|--------|
| Auto letters (Advice/Warning/Fine/Suspension) | **Off** — no auto issue |
| Auto status → SUSPENDED | **Off** |
| Approach | **B** — remove/disable auto issue paths; lists from attendance counts |
| Near list | Late days **6–8** OR uninformed absent days **= 2** (PKT calendar month) |
| Due list | Late days **≥ 9** OR uninformed absent days **≥ 3** |
| Portal red warning | **Out of scope** for phase 1 |
| Suspend / inquiry / letter send / approval | Later phases |

## Behavior change (API)

1. Attendance check-in / edit paths that call `applyDisciplineRules` must **not**:
   - Call `issueAutoTemplatedLetter` / `issueLateLetterIfNotAlready` (or equivalent)
   - Set `EmployeeStatus.SUSPENDED` from late or uninformed-absent rules
2. Prefer a clear early return or feature kill in the discipline helper so no letter and no status mutation run for LATE / UNINFORMED_ABSENT auto tracks. Missing-checkout auto letter paths that issue employee-facing letters should also stop if they auto-issue today (same “stop everything auto” policy).
3. Existing historical `Letter` / `DisciplineEvent` rows stay; no mass delete required for phase 1.
4. Manual HR Disciplinary / Letters flows unchanged in this phase.

## New API

Suggested (fit existing Nest patterns):

- `GET /attendance/suspension-watchlist` (or `/discipline/suspension-watchlist`)
  - Auth: same roles as HR attendance/dashboard (HR Admin Manager, HR Manager, HR Ops, HR Executive, Super Admin — mirror Open Disciplinary Cases card roles)
  - Query: optional `month` / `year` (default current PKT month)
  - Response shape:

```json
{
  "month": "2026-08",
  "near": [
    {
      "employeeId": "...",
      "fullName": "...",
      "biometricId": "...",
      "branchId": "...",
      "branchName": "...",
      "lateDays": 6,
      "uninformedAbsentDays": 0,
      "reasons": ["LATE_NEAR"]
    }
  ],
  "due": [ /* same fields; reasons e.g. LATE_DUE, UA_DUE */ ],
  "counts": { "near": 12, "due": 3 }
}
```

### Counting rules

Reuse the same definitions already used for late discipline (unique LATE / late-driven HALF_DAY calendar days in the Pakistan month; uninformed absent day counts as used today for UA discipline). Document the exact helper reuse in the implementation plan so counts match payroll/attendance screens.

Priority if both apply: employee appears in **due** only (not also near).

## HRMS UI

1. **Dashboard** (`DashboardPage.tsx`, and Executive dashboard if it already shows open disciplinary): add StatCard(s) for suspension watchlist — e.g. “Near suspension” + “Due for suspension”, or one card with combined count that links to the page.
2. **New page** e.g. `/discipline/suspension-watchlist` (or under attendance):
   - Two tabs/sections: **Near suspension** | **Due for suspension**
   - Table: name, branch, late days, UA days, reason badges
   - Link to employee profile
   - No Suspend / Send letter actions in phase 1
3. Nav entry under Attendance or Disciplinary, consistent with existing HR nav.

## Out of scope (later phases)

- Portal red warning box  
- Letter preview / edit / send to portal / IT reverse  
- Suspension duration, inquiry officer, guilty/not guilty outcomes  
- Founder / President / Chairman approval via WhatsApp  
- Branch lock until transfer after suspension  
- Profile discipline trail card under Edit Branch & Duty  

## Success criteria

- Punching late or UA no longer creates Advice/Warning/Fine/Suspension letters or flips status to SUSPENDED  
- HR sees accurate Near / Due lists for the current month  
- Dashboard card count matches list totals  
- Manual letter generation and existing Disciplinary UI still work  

## Follow-on phases (order)

2. Letters UX (preview/edit, send to portal, IT reverse)  
3. Suspension case + inquiry  
4. Leadership approval  
5. Profile trail + branch lock + portal warning  
