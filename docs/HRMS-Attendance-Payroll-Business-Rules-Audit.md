# HRMS Attendance, Leave, Reliever, Payroll & Biometric — Business Rules Audit

**Scope:** Compare the current YCDO HRMS implementation (`c:\Users\Dell\ycdo-management-system`) against the eleven business rules supplied for this audit. **Analysis only — no code was modified, no fixes were implemented, and no new architecture is proposed.** Every finding below is backed by direct citation of the current source (file path, and line numbers where the finding is narrow enough to pin down); nothing here is inferred from documentation, comments claiming intended behavior, or assumption.

---

## PART 1 — Business Rule Comparison

| # | Business Rule | Current Behavior | Required Behavior | Match? |
|---|---|---|---|---|
| 1 | Early check-in (prior time): up to 1 hour before shift start = PRESENT, real time stored, no late/OT/deduction | `assessCheckIn()` (`apps/api/src/common/duty.util.ts:118-142`): when the punch is before duty start, `earlyMinutes = -offset`; `preDutyOvertimeMinutes` is only set if `earlyMinutes > EARLY_OVERTIME_THRESHOLD_MINUTES` (= **60**, line 85). Within 60 minutes early, `lateMinutes = 0`, `preDutyOvertimeMinutes = 0` → status resolves to `PRESENT`. The real `checkIn` timestamp is always stored (`AttendanceLog.checkIn`). | Same | ✅ **Match** — confirmed for all four given examples (07:10/07:25/07:40/07:50 against an 08:00 shift, all ≤60 min early → PRESENT, no OT, no deduction). Applies identically on the biometric and manual-mark paths. |
| 2 | Grace period = 15 min; `Late Minutes = CheckIn − (ShiftStart + 15)` | `LATE_GRACE_MINUTES = 15` (`duty.util.ts:78`); `assessCheckIn()`: `late = offset − graceMinutes` where `offset = checkIn − dutyStart`. Exactly the required formula. | Same | ✅ **Match** |
| 3 | Late escalation, repeating 3-cycle (Advice→Warning→Fine, ×3) ending in Suspension at the 9th: 1=Advice/no ded, 2=Warning/no ded, 3=Fine letter/1-day ded, 4=Advice, 5=Warning, 6=1-day ded, 7=Advice, 8=Warning, 9=Suspension letter+suspend. Attendance must stay marked (never becomes absent). Deductions visible in portal with Date/Reason/Calculation/Amount. | `applyLateDiscipline()` (`apps/api/src/modules/attendance/discipline.helper.ts:124-225`) only acts on occurrences **3, 6, and 9** in a calendar month. Occurrences 1, 2, 4, 5, 7, 8 produce **only an in-app `LATE_WARNING` notification** — no letter of any kind, `ADVICE` or otherwise. At occurrence 3: issues a `LetterType.WARNING` letter (labelled "Warning Letter 1" in code) + 1-day deduction. At occurrence 6: **also `LetterType.WARNING`** ("Warning Letter 2") + 1-day deduction — not a distinct "Fine" letter type. At occurrence 9: `LetterType.SUSPENSION` + `Employee.status = SUSPENDED` + linked `User.isActive = false` (`discipline.helper.ts:201-215`, `375-426`). The attendance `status` itself is never demoted to `ABSENT` by this logic (confirmed — no `ABSENT` write exists anywhere in `applyLateDiscipline`). `PayrollDeduction` has **no `date` column at all** (schema: `id, payrollEntryId, reason, amount, description` only) — only a free-text `description` string (e.g. `"Late arrival deduction (3 lates this month)"`) carries any explanatory detail; there is no structured "calculation" field. | Repeating 3-step cadence with three distinct letter types (Advice/Warning/Fine) firing at **every** occurrence 1-8, escalating to Suspension only at 9; full deduction audit trail (date/reason/calculation/amount) visible to the employee | 🔴 **No Match** — this is the single largest divergence in the whole audit. Current cadence (silent at 6 of 9 occurrences, only two letter types ever used, both milestone-gated at 3/6/9) is structurally different from the required cadence (a letter at every occurrence, three distinct letter types cycling every 3 occurrences). "Attendance must remain marked / never absent" **is** satisfied. Portal deduction visibility is only partially satisfiable — Reason (via `description`) and Amount exist; a true per-line "Date" and a structured "Calculation" do not exist in the schema. |
| 4 | Half-day threshold = 15 min grace + 60 additional minutes = 75 min after shift start | `determineBiometricCheckInStatus()`/`statusFromLateMinutes()` escalate to `HALF_DAY` when `lateMinutes > 60`, and `lateMinutes` is already net of the 15-minute grace (`lateMinutes = rawOffset − 15`). So `lateMinutes > 60` ⇔ `rawOffset > 75`. Boundary-checked exactly against the required examples: 09:15 (raw offset 75) → `lateMinutes = 60` → **not** `>60` → stays `LATE`; 09:16 (raw offset 76) → `lateMinutes = 61` → `HALF_DAY`. Enforced via `applyDisciplineRules()` (`discipline.helper.ts:28-31`), which unconditionally converts `LATE` with `lateMinutes > 60` to `HALF_DAY` in the same transaction as the attendance write. | Same | ✅ **Match** — precise, including the exact minute boundary. |
| 5 | UNMARKED as soon as a shift starts; check-in updates the *same* record to PRESENT/LATE/HALF_DAY; never a second record | `markShiftStartAbsent()` cron (`apps/api/src/modules/attendance/shift-absent.scheduler.ts:30-69`, every 15 min) creates the `UNMARKED` placeholder only once `nowMinutes` is between `shiftStart` and `shiftStart+15` — i.e. up to a 15-minute delay after the shift actually starts, not instantaneous, plus the additional lazy on-read backfill (`ensureUnmarkedForActiveShiftsOnDate`, confirmed in prior audit) which can create it sooner if HR views the attendance screen first. On check-in, `biometricRegularCheckIn()` (`attendance.service.ts:254-301`) looks up `anyExisting` by the composite key `[employeeId, date, type]`; if found with no `checkIn` yet, it **updates that same row** (line 284-297) rather than inserting a new one — enforced further by the DB's `@@unique([employeeId, date, type])` constraint, which would reject a true duplicate insert outright. | Same | 🟡 **Partial Match** — the "never a second record" and "update the same record" guarantees are correctly enforced (schema-level, not just application-level). The "as soon as a shift starts" timing is not instantaneous — there is up to a 15-minute cron-driven delay unless something else (a page view) triggers the lazy backfill first. |
| 6 | Uninformed absence: wait **2 hours**, then UNMARKED → UNINFORMED_ABSENT, deduct 2 days' pay | `markUninformedAbsent()` cron (`shift-absent.scheduler.ts:71-158`): `if (minutesSince < 180) continue;` (line 125) — waits **3 hours (180 minutes)**, not 2. Deduction amount: `(basicStipend / 30) * 2` (`discipline.helper.ts:255`, `applyUninformedAbsentDeduction`) — exactly 2 days' pay, correct. Status conversion `UNMARKED → UNINFORMED_ABSENT` on the *same* row via `tx.attendanceLog.update` — correct, no duplicate row. | Wait exactly 2 hours (120 min); 2-day deduction | 🔴 **No Match on timing** — the wait threshold is hardcoded to 180 minutes, a full hour later than required. The deduction amount, and the in-place status conversion, otherwise match exactly. |
| 7 | Missing checkout: 1st = Advice, 2nd = Warning, 3rd = Fine letter; tracked and visible in portal history | **No such feature exists anywhere in the codebase.** Confirmed by an exhaustive search for "missing checkout" and related terms across `apps/api/src` — zero matches. The only related scheduled job, `notifyShiftEndForOvertime()` (`shift-checkout.scheduler.ts:28-30`, every minute), only fires a one-time "start overtime?" notification for employees who **already** checked in and out — it has no concept of counting or escalating missed checkouts, and issues no letters. Open (un-checked-out) sessions are only ever surfaced to HR as a manual worklist in the HRMS "Check-Out Manual" tab, with no occurrence counter and no letter automation. | Full 3-tier letter escalation + portal-visible history | 🔴 **No Match — feature does not exist.** |
| 8 | Short Leave conversion: HR converts a lateness-driven HALF_DAY into SHORT_LEAVE, which must remove the late penalty/deduction, recalculate payroll, and reverse disciplinary actions | HR's closest available action is `markVerifiedLeave()` (`apps/api/src/modules/leave/leave.service.ts:791+`), which creates a **new** `LeaveRecord(leaveType: SHORT_LEAVE)` and, via `markLeaveAttendance()`, **upserts** the existing `AttendanceLog.status` back to `HALF_DAY` (short leave's status is `HALF_DAY` by definition — confirmed `leave.service.ts:1501-1503`) with an updated `note`. This overwrite touches **only the `status`/`note` fields on `AttendanceLog`.** Read the full body of both `markVerifiedLeave()` and `updateAttendance()` (`attendance.service.ts:745-952`) — **neither function contains a single `payrollDeduction.delete`, `.update`, or any decrement call.** If a `LATE_ARRIVAL` deduction was already posted for that day as part of that month's 3rd/6th/9th late-occurrence milestone (`discipline.helper.ts:161-199`), it is **never removed, and `PayrollEntry.netStipend` is never recalculated** to add it back. Worse: if HR instead uses `updateAttendance()` to directly re-set the status to `LATE`/`HALF_DAY` after this conversion (or the record is edited again for any reason), `applyDisciplineRules()` runs **again** (`attendance.service.ts:902-915`), relying solely on a fragile description-string match (`description: { contains: "${lateCount} late" }`, `discipline.helper.ts:172-180`) to avoid a second deduction — there is no explicit link between a `LeaveRecord` and the `PayrollDeduction` row it should have reversed. | Deduction and any associated disciplinary letter must be reversed, and payroll recalculated | 🔴 **No Match — reversal logic does not exist.** The status can be changed; nothing downstream (payroll, letters) is ever unwound. |
| 9 | Leave: each employee gets 2 paid leaves/month; 3rd+ leave in the month is unpaid | Two entirely separate, uncoordinated mechanisms exist. (a) **Application-time gate** (`leave.service.ts:42`): `MAX_LEAVES_PER_YEAR = 24`, checked against a running **yearly** total, with no monthly 2-leave concept at all. (b) **Payroll-time paid/unpaid split** (`apps/api/src/modules/payroll/payroll-hours.util.ts`, `splitPaidUnpaidLeaveDays`): the first `Employee.monthlyAllowedLeaves` leave-**days** in a calendar month are paid, the rest unpaid — this *can* implement a "2 per month" policy, but only if HR manually types `2` into that specific employee's record. Confirmed directly in the schema (`monthlyAllowedLeaves Int?`, no `@default`) and in `employees.service.ts`/`employees.dto.ts` — **the field is optional and has no system-wide default; if left blank it means "unlimited paid leave"** per the schema's own comment. `SHORT_LEAVE` requests always have `totalDays = 0` (`leave.service.ts:152`), so they never consume this allowance at all, paid or unpaid. | A guaranteed, system-enforced 2-paid-leaves-per-month rule for every employee, unpaid from the 3rd | 🔴 **No Match** — the mechanism that *could* express "2 per month" exists but is opt-in per employee (and defaults to the opposite: unlimited-paid), and is entirely disconnected from the separate 24-day/year application gate. |
| 10.1 | Reliever, Scenario 1 (own duty 08:00-16:00, reliever duty 08:00-16:00 = same window) → Reliever=Yes, Extra pay=No | `relieverCheckIn()`/`relieverCheckOut()` (`attendance.service.ts:1508-1643`) record whatever `checkIn`/`checkOut` timestamps are submitted with **zero comparison against the reliever's own `dutyStartTime`/`dutyEndTime` or their own `AttendanceLog` for that date** — confirmed by reading the full body of both functions; no such lookup exists. Closing the session **unconditionally** upserts an `AdditionalWorkingDay` row (`attendance.service.ts:1620-1637`), which Payroll (`payroll.service.ts:307-342`) converts to pay as `hours = dayCount × employee's normal dailyDutyHours` — a **flat, full daily-hour figure per calendar day**, not derived from the session's actual duration at all (`RelieverSession.totalMinutes` is computed and stored but never read by payroll). | No extra pay when the reliever window matches the employee's own duty window | 🔴 **No Match** — the system would pay a full extra day's rate for this scenario; there is no overlap check against the reliever's own shift anywhere in the code. |
| 10.2 | Scenario 2 (own duty 08:00-16:00, reliever duty 16:00-20:00, fully outside own shift) → all 4 hours = extra pay | Same code path as above — pays a **flat full day** (`dailyDutyHours`, e.g. 8h) regardless of the session only being 4 hours. | Extra pay proportional to the actual 4 non-overlapping hours | 🔴 **No Match on amount** — direction (some extra pay) is correct, but the amount is a flat day's rate rather than the actual worked/non-overlapping hours. |
| 10.3 | Scenario 3 (employee is OFF, works entirely as reliever) → full extra pay | Same code path — pays a flat full day regardless of actual reliever session length, and regardless of whether the employee's own shift record shows them off that day (there is no "employee is off" flag/check anywhere in this path either — see Part 13 of the prior conversation's audit: no weekly-off concept exists in the system at all). | Extra pay for the full reliever duty period | 🟡 **Partial Match on direction, No Match on precision** — pays something, but not calculated from actual hours, and the system has no way to represent "employee was off" in the first place. |
| 10.4 | Scenario 4 (own duty 08:00-16:00, reliever duty 14:00-18:00) → 14:00-16:00 = no extra pay (overlap), 16:00-18:00 = extra pay (2 hrs) | **No overlap-splitting logic of any kind exists.** `AdditionalWorkingDay` (`additional-working-days.service.ts` / schema) has only `employeeId`, `date`, `note` — there is no `hours`/`startTime`/`endTime` field capable of representing a partial-day, split-rate scenario. The system logs a single flat day regardless. | A split calculation: partial hours unpaid (overlap), partial hours paid (non-overlap) | 🔴 **No Match — structurally unimplementable with the current data model**, not just unimplemented logic. |
| 11 | Biometric "duplicate entry" investigation | See Part 3 (Investigation) below for the full trace. **Root cause identified with high confidence.** | Determine the exact cause (no fix required) | See investigation — root cause found, not a match/no-match item. |

---

## PART 2 — Conflicts, Classified by Severity

| ID | Conflict | Severity |
|---|---|---|
| C1 | **Biometric false-positive "duplicate" rejection** — a genuinely fresh CHECKIN can be rejected with 409 "already checked in" while today's actual attendance record stays unmarked, whenever the employee has an unclosed prior-day session (see Part 3 investigation). This directly produces daily-operations pain (staff unable to check in) and silently under-records attendance. | **Critical** |
| C2 | **Late-escalation policy does not implement the required cadence at all** — 6 of the 9 required letter-issuing occurrences (1,2,4,5,7,8) currently issue no letter whatsoever; the letter *types* used (WARNING at both 3rd and 6th) don't match the required distinct Advice/Warning/Fine progression; there is no `ADVICE` letter ever auto-issued for lateness despite `LetterType.ADVICE` existing in the schema. | **Critical** |
| C3 | **Reliever "extra pay" calculation has no time-overlap logic and no proportional-hours logic** — every closed reliever session is paid as one flat full day at the employee's normal daily rate, regardless of actual duration or overlap with the reliever's own shift. All four required scenarios (own-shift overlap = no pay; after-hours = pay; day-off = pay; partial overlap = split pay) resolve identically today: one flat day's extra pay, always. Scenario 4 in particular cannot even be *represented* with the current `AdditionalWorkingDay` schema (no hours/time-window fields). | **Critical** |
| C4 | **Short Leave conversion does not reverse any prior deduction, letter, or disciplinary consequence** — HR can change an attendance record's status, but nothing downstream (payroll deductions already posted, warning/fine letters already issued, the late-occurrence counter itself) is ever recalculated or unwound. | **Critical** |
| C5 | **"2 paid leaves per month" is not a guaranteed system rule** — the only field capable of expressing it (`Employee.monthlyAllowedLeaves`) is optional, has no default, and defaults to *unlimited paid leave* when unset; it is also completely disconnected from the separate 24-days/year application-time cap. | **High** |
| C6 | **Missing-checkout tracking/escalation does not exist** — no counting, no Advice/Warning/Fine letter tiers, no portal-visible history for this specific scenario. | **High** |
| C7 | **Uninformed-absence wait threshold is 3 hours, not the required 2 hours.** | **Medium** |
| C8 | **`PayrollDeduction` has no `date` field and no structured "calculation" field** — only `reason` (enum) and free-text `description`; the portal cannot show a true per-deduction date or a machine-readable calculation breakdown even for the deductions that *do* get created correctly (uninformed absence, plain absence, the 3rd/6th/9th late milestones). | **Medium** |
| C9 | **Discipline-rule idempotency relies on a fragile description-substring match** (`description: { contains: "${lateCount} late" }`) rather than a structured link between the triggering event and the deduction row — this is what makes reversal (C4) and safe re-editing both unreliable. | **Medium** |
| C10 | **UNMARKED placeholder creation is cron-cadence-bound (up to 15 min lag), not instantaneous** at shift start, unless a page view triggers the lazy backfill first. | **Low** |

---

## PART 3 — Affected Files, APIs, Services, and the Biometric Investigation

### C1 — Biometric duplicate / not-actually-marked (Rule 11 investigation)

**The exact mechanism, traced end to end:**

1. `POST /attendance/biometric-push` → `AttendanceController.biometricPush` → `AttendanceService.biometricPush()` (`apps/api/src/modules/attendance/attendance.service.ts:104-229`).
2. Line 141-142: `checkTime = new Date(); dateOnly = toPakistanDateOnly(checkTime);` — the date used for **everything downstream in this request** is always today's raw calendar date. It is **not** run through `getShiftAttendanceDate()` (the shift-aware, overnight-rollback date resolver used elsewhere in the same file for the *scheduler's* placeholder creation).
3. For an explicit `CHECKIN` (and for `AUTO` resolving to `CHECKIN`), the **hard duplicate guard** at line 155-162 runs:
   ```
   const openRegular = await this.findOpenRegularLog(employee.id, dateOnly);
   if (openRegular?.checkIn) throw new ConflictException('Employee already checked in. Duplicate CHECKIN rejected.');
   ```
4. `findOpenRegularLog()` (`attendance.service.ts:2131-2154`) is defined to search **today's date first, and if nothing open is found there, fall back to yesterday's date** — a `checkIn`-set/`checkOut`-null row on *either* date satisfies it.
5. **This is the root cause.** If the employee has *any* still-open session from **yesterday** — for any reason: a missed checkout (Rule 7's exact scenario, which the system has no mechanism to prevent or resolve, C6), an overnight shift not yet closed out, a device/agent outage that swallowed the checkout punch — then a brand-new, entirely legitimate CHECKIN attempt **today** is intercepted by step 3's guard, which finds yesterday's stale open row via the fallback, sees `openRegular.checkIn` is truthy, and rejects the request with the exact "already checked in / duplicate" message reported in production.
6. Because the rejection happens in `biometricPush()` itself, **before** `biometricRegularCheckIn()` is ever called, **no write of any kind happens for today** — today's row is never created, or stays `UNMARKED` if a scheduler/lazy-backfill placeholder already exists for it. This exactly matches the reported symptom: the agent is told "duplicate," but the actual (today's) attendance record shows no mark at all.
7. This is **not** a transaction-rollback or a race-condition artifact — it reproduces deterministically and synchronously for any employee with an open prior-day session, with no concurrency required. (A genuine concurrent-request race was also examined — see below — but does not by itself explain a false-positive 409 with no committed write; the yesterday-fallback mechanism above does, on its own, fully and directly explain it.)
8. Contributing design gaps that make this common in practice rather than a rare edge case: (a) checkout is always manual and never auto-closed (`shift-checkout.scheduler.ts` only sends an overtime-prompt notification, confirmed no auto-checkout logic exists); (b) Rule 7's "missing checkout" tracking/escalation doesn't exist (C6), so there is no system pressure or reminder mechanism pushing employees/HR to close out every session promptly, meaning stale open sessions are left to accumulate; (c) the guard's yesterday-lookback has no age limit — an open session from many days ago would trigger the same false rejection just as readily as one from yesterday.
9. Secondary, related but distinct observation (not the primary cause, flagged for completeness): `biometricRegularCheckIn()`'s own internal duplicate check (`anyExisting`, line 254-267) is scoped to **today only** (`date: dateOnly`, no yesterday fallback) — i.e. the guard at step 3 and the write-path's own internal check use **two different date scopes for what is nominally the same "is this a duplicate?" question**. This asymmetry is what allows the guard to reject on behalf of a record the write path itself would never have found or touched.

**Files involved in this investigation:**
- `apps/api/src/modules/attendance/attendance.service.ts` — `biometricPush` (104-229), `biometricRegularCheckIn` (231-336), `biometricRegularCheckout` (338-396), `findOpenRegularLog` (2131-2154)
- `apps/api/src/modules/attendance/attendance.controller.ts` — route binding, `x-device-key` guard only (no JWT)
- `apps/api/src/modules/attendance/shift-time.util.ts` — `toPakistanDateOnly`, `getShiftAttendanceDate` (the shift-aware resolver that is *not* used in the biometric push's own date computation)
- `apps/api/src/modules/attendance/shift-checkout.scheduler.ts` — confirms no auto-checkout exists
- `apps/api/prisma/schema.prisma` — `AttendanceLog` model, `@@unique([employeeId, date, type])`
- `biometric_script/agent.py` — the on-site Python relay; confirmed it performs **no local business logic or retry-suppression around a 409** ("every scan is forwarded to the API; the server is the single source of truth"), so a false 409 is surfaced to the device/log verbatim, with no client-side masking or smoothing.

### C2 — Late escalation cadence
- `apps/api/src/modules/attendance/discipline.helper.ts` — `applyDisciplineRules`, `applyLateDiscipline`, `autoGenerateLateWarningLetter` (whole file, esp. lines 124-426)
- `apps/api/src/modules/attendance/attendance.service.ts` — every call site of `applyDisciplineRules` (`biometricRegularCheckIn`, `updateAttendance`, portal check-in path)
- `apps/api/src/modules/attendance/shift-absent.scheduler.ts` — `markUninformedAbsent` (separate discipline entry point, unaffected by this specific conflict but shares the helper)
- `apps/api/src/modules/letters/letters.service.ts`, `apps/api/src/modules/letters/auto-letter.helper.ts` — `issueAutoTemplatedLetter`, the actual letter-generation call
- `apps/api/prisma/schema.prisma` — `LetterType` enum (`ADVICE`, `WARNING`, `FINE`, `SUSPENSION` all exist but `ADVICE`/`FINE` are never auto-triggered by this flow), `DeductionType.LATE_ARRIVAL`
- Frontend: `apps/hrms/src/pages/letters/LettersPage.tsx` (manual Advice/Fine letters *can* be issued by HR by hand, just not automatically from this policy), `apps/portal/src/pages/payroll/MyPayrollPage.tsx` / `PayslipDocument.tsx` (deduction visibility — folds `LATE_ARRIVAL` into a combined "Fine" line on the printed payslip per the payroll module's own mapping, not a discrete per-occurrence list)
- Database: `PayrollDeduction` model (no `date` column — schema-level gap for the portal-visibility requirement)

### C3 — Reliever extra-pay overlap logic
- `apps/api/src/modules/attendance/attendance.service.ts` — `relieverCheckIn` (1508-1577), `relieverCheckOut` (1579-1643), `findRelieverAssignment` (1645-1663)
- `apps/api/src/modules/additional-working-days/additional-working-days.service.ts` — `AdditionalWorkingDay` model has no hours/time fields at all
- `apps/api/src/modules/payroll/payroll.service.ts` — `upsertAdditionalWorkingDaysAllowanceRow` (307-342, the exact `hours = dayCount × dailyHours` flat-rate calculation)
- `apps/api/prisma/schema.prisma` — `RelieverSession` (has `checkIn`/`checkOut`/`totalMinutes` — the real duration data exists here but is never read by payroll), `AdditionalWorkingDay` (no hours field), `AllowanceType.RELIEVER` (defined, never used anywhere — a second, independent gap already noted in the prior full audit)
- Frontend: `apps/hrms/src/pages/attendance/AttendancePage.tsx` (`RelieverSessionsTab` — the manual check-in/out UI that produces the session), `apps/hrms/src/pages/payroll/PayrollPage.tsx` (`EmployeePayrollTab` shows `totalRelieverHours` read-only — confirms the hours are visible to HR but not used in calculation)

### C4 — Short Leave reversal
- `apps/api/src/modules/leave/leave.service.ts` — `markVerifiedLeave` (791+), `markLeaveAttendance` (private, ~1491+)
- `apps/api/src/modules/attendance/attendance.service.ts` — `updateAttendance` (745-952, confirmed no deduction-reversal call anywhere in its body)
- `apps/api/src/modules/attendance/discipline.helper.ts` — the deduction-creation functions that would need a corresponding reversal counterpart
- Database: `LeaveRecord`, `AttendanceLog`, `PayrollDeduction`, `PayrollEntry` — no foreign-key or other linkage exists between a `LeaveRecord` and any `PayrollDeduction` it should logically reverse
- Frontend: `apps/hrms/src/pages/attendance/AttendancePage.tsx` (`AssignAbsentRelieverDialog`, the actual caller of `markVerifiedLeave` from the Attendance screen), `apps/hrms/src/pages/leave/LeavePage.tsx`

### C5 — 2 paid leaves/month
- `apps/api/src/modules/leave/leave.service.ts` — `MAX_LEAVES_PER_YEAR = 24` (line 42), `apply()`, `getLeaveBalance()`
- `apps/api/src/modules/payroll/payroll-hours.util.ts` — `splitPaidUnpaidLeaveDays`, `unpaidLeaveDeductionAmount`
- `apps/api/src/modules/payroll/payroll.service.ts` — `upsertUnpaidLeaveDeductionRow`
- `apps/api/src/modules/employees/employees.service.ts`, `employees.dto.ts` — `monthlyAllowedLeaves` accepted as optional input, no default assigned
- `apps/api/prisma/schema.prisma` — `Employee.monthlyAllowedLeaves Int?` (no `@default`)
- Frontend: `apps/hrms/src/pages/employees/EmployeeCreatePage.tsx` (where, if at all, HR would set this per employee — no evidence of a default value being pre-filled), `apps/portal/src/pages/leave/MyLeavePage.tsx` (shows only the yearly balance from `getLeaveBalance`, never `monthlyAllowedLeaves`)

### C6 — Missing checkout tracking
- No backend files implement this at all. Nearest existing infrastructure: `apps/api/src/modules/attendance/shift-checkout.scheduler.ts` (`notifyShiftEndForOvertime`), `apps/hrms/src/components/attendance/ManualAttendanceTabs.tsx` (`CheckOutManualTab`, the manual worklist of open sessions HR currently uses, with a 30-day lookback and no counting).

### C7 — Uninformed absence timing
- `apps/api/src/modules/attendance/shift-absent.scheduler.ts` — line 125, `if (minutesSince < 180) continue;`

### C8 — PayrollDeduction schema gap
- `apps/api/prisma/schema.prisma` — `PayrollDeduction` model definition
- All creation sites: `apps/api/src/modules/attendance/discipline.helper.ts` (three sites), `apps/api/src/modules/payroll/payroll.service.ts` (`upsertUnpaidLeaveDeductionRow`, and the generic manual "Add Deduction" endpoint)
- Frontend: `apps/hrms/src/pages/payroll/PayrollPage.tsx`, `apps/hrms/src/components/payroll/PayslipDocument.tsx`, `apps/portal/src/components/payroll/PayslipDocument.tsx` — all consume whatever `PayrollDeduction` rows exist; none can display a date because none exists to display.

### C9 — Idempotency string-matching
- `apps/api/src/modules/attendance/discipline.helper.ts` — lines 172-180 (`alreadyDeducted` lookup by `description: { contains: ... } }`), and the equivalent letter-dedup check at lines 384-393 (`existingLetter` lookup by `letterType` + `generatedAt` within the current calendar month — also string/date-window based, not a structured link to the triggering occurrence count).

---

## PART 4 — Dependency Map

```
Biometric Push (attendance.service.ts: biometricPush)
   │  writes/blocks
   ▼
Attendance Engine (AttendanceLog: status, lateMinutes, checkIn/checkOut)
   │
   ├──▶ Discipline Rules (discipline.helper.ts)
   │        │
   │        ├──▶ Payroll Deductions (PayrollDeduction, PayrollEntry.netStipend)
   │        │
   │        └──▶ Letters (Warning / Suspension auto-issue → Letter, WhatsAppLetterSend)
   │                 │
   │                 └──▶ Employee.status / User.isActive (auto-suspension)
   │
   ├──▶ Leave (LeaveRecord)
   │        │  approval → writes ON_LEAVE/HALF_DAY back into AttendanceLog
   │        │  (Short Leave conversion path: Leave → Attendance, one-directional,
   │        │   does NOT reach back into Discipline/Payroll to reverse — this is the C4 gap)
   │        │
   │        └──▶ Reliever (RelieverRequest, tied to a specific LeaveRecord)
   │                 │
   │                 └──▶ RelieverSession (attendance.service.ts: relieverCheckIn/Out)
   │                          │
   │                          └──▶ AdditionalWorkingDay ──▶ Payroll Allowance
   │                                   (flat-day conversion — the C3 gap; RelieverSession.totalMinutes
   │                                    is computed but this is the only place it is NOT consumed)
   │
   └──▶ Scheduled Jobs (cron)
            ├─ shift-absent.scheduler.ts   → UNMARKED / UNINFORMED_ABSENT → Discipline Rules
            ├─ shift-checkout.scheduler.ts → overtime prompt only (no missing-checkout logic — C6)
            └─ reliever.scheduler.ts       → auto-reject stale RelieverRequest (unaffected by this audit's rules)
```

**Why the order matters:** Attendance is the root of every dependency chain in this system — Discipline, Letters, Leave-driven attendance overwrites, Reliever sessions, and every payroll deduction/allowance examined in this audit all either read `AttendanceLog` directly or are triggered from inside the same transaction as an attendance write. Payroll and Reliever pay are the two leaf nodes: they consume the *output* of Attendance/Discipline/Leave but nothing reads *from* them upstream (aside from the `PayrollDeduction`-reversal gap in C4, which would need to flow leave-side back down into an already-computed deduction).

---

## PART 5 — Implementation Order (Roadmap)

This is a sequencing recommendation only — **no implementation work was performed or should be inferred from this ordering.**

**Phase 1 — Biometric (C1)**
Fix the duplicate-detection root cause first. Every other phase depends on attendance being *reliably created* in the first place; if employees can be falsely blocked from checking in, every downstream policy (late calculation, discipline, payroll) is operating on incomplete data. This is also the phase with the clearest, most isolated blast radius (one guard clause in one function) and the highest day-to-day operational pain reported.

**Phase 2 — Attendance engine timing constants (C6, C7, C10)**
Missing-checkout tracking (C6) and the uninformed-absence wait threshold (C7) both live in the same scheduler files touched conceptually by Phase 1, and both are prerequisites for Phase 3 (the late/absence discipline engine needs a correct, complete picture of "what actually happened today" — including missing checkouts — before its escalation policy can be trusted). Handling these together avoids re-touching the same scheduler twice.

**Phase 3 — Discipline and letters (C2, C8, C9)**
The late-escalation cadence (C2) is the largest single conflict in this audit and structurally touches the same helper (`discipline.helper.ts`) as the deduction-schema gap (C8, since a redesigned cadence will need a structured way to record "which occurrence, on which date, was this") and the idempotency mechanism (C9, since a correct 9-step repeating cycle needs a reliable way to know exactly which of the 9 slots has already fired — the current string-matching approach could not safely support the required cadence even if the cadence itself were corrected). These three should be addressed as one unit because C8 and C9 are effectively *prerequisites* for implementing C2 correctly and durably, not independent follow-ups.

**Phase 4 — Leave (C4, C5)**
Leave policy correctness (C5, the 2-paid-leaves rule) and the Short Leave reversal flow (C4) both depend on Phase 3 being settled first — you cannot correctly "reverse a late-occurrence deduction" (C4) until the late-occurrence tracking itself (Phase 3) has a structured, reversible representation instead of the current string-matched one. Sequencing Leave after Discipline avoids building a reversal mechanism against a discipline engine that is about to change shape.

**Phase 5 — Reliever (C3)**
The reliever pay/overlap logic depends on Leave (Phase 4) being stable, since every `RelieverSession` traces back to an approved `LeaveRecord` via `RelieverRequest`. It is sequenced after Leave rather than before it for that reason, and before Payroll because Payroll is the consumer of whatever `AdditionalWorkingDay`/allowance representation Reliever produces.

**Phase 6 — Payroll**
Payroll is last because it is a pure consumer of every upstream system examined in this audit: it reads `AttendanceLog` (worked/leave/late minutes), `PayrollDeduction` rows created by Discipline, `AdditionalWorkingDay` rows created by Reliever, and `LeaveRecord`/`monthlyAllowedLeaves` for the paid/unpaid split. Any change to Phases 1-5 changes payroll's *inputs*; sequencing Payroll last avoids reworking its calculation logic more than once as upstream data shapes change.

---

*This audit is analysis only. No files were modified. No code was generated. No fixes were implemented, and this roadmap is a sequencing opinion, not an implementation plan.*
