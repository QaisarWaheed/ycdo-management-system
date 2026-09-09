# Separate check-in / check-out attendance source

Date: 2026-09-09  
Status: approved

## Goal

Show **how check-in was set** and **how check-out was set** independently (BIOMETRIC vs MANUAL) everywhere attendance source appears today: lists, profile, edit dialog, trail (and reports if they surface source). A single whole-row `source` hides cases like Rubab: HR corrected check-in to MANUAL while evening check-out stayed BIOMETRIC.

## Decisions

| Topic | Choice |
|-------|--------|
| Approach | Two new nullable columns; keep legacy `source` |
| Scope of UI | Everywhere source appears (lists, reports, edit dialog, trail) |
| HR edits check-in only | `checkInSource = MANUAL`; `checkOutSource` unchanged |
| HR edits check-out only | `checkOutSource = MANUAL`; `checkInSource` unchanged |
| HR edits both times | Both punch sources = MANUAL |
| Status-only edit (no time change) | Do not force punch sources to MANUAL unless a punch time is written/changed |
| Existing rows | **No backfill** — new fields null until a new write touches that punch |
| Display when new field null | Fall back to legacy `source` for that punch if the time exists; else `—` |
| Legacy `source` going forward | Keep updated as a coarse row label (see rules below) for old consumers |

## Why not replace `source` yet

Many API/UI paths still read one field. Keeping `source` avoids a hard cutover. New fields are the source of truth for punch-level display; `source` remains a compatibility summary.

## Data

```prisma
model AttendanceLog {
  // existing
  source         AttendanceSource  @default(BIOMETRIC)

  /// Null = unknown / never set under the new model (pre-migration rows).
  checkInSource  AttendanceSource?
  checkOutSource AttendanceSource?
}
```

Same enum: `BIOMETRIC | MANUAL`.

Migration: add two nullable columns only. No data UPDATE/backfill.

## Write rules

### Biometric / device punch

| Event | Sets |
|-------|------|
| First check-in of the day | `checkIn = …`, `checkInSource = BIOMETRIC`, `source = BIOMETRIC` |
| Check-out punch | `checkOut = …`, `checkOutSource = BIOMETRIC` (do not clear/change `checkInSource`) |
| Biometric overwrite of an existing punch time | Update that punch’s source to `BIOMETRIC` |

### Manual mark / HR create

| Event | Sets |
|-------|------|
| Manual check-in created | `checkInSource = MANUAL`, `source = MANUAL` |
| Manual check-out set | `checkOutSource = MANUAL` |
| Manual create with both times | Both punch sources = MANUAL, `source = MANUAL` |

### HR update (`PATCH` / Update Attendance)

| Change | Punch source effect |
|--------|---------------------|
| `checkIn` written or changed | `checkInSource = MANUAL` |
| `checkOut` written or changed | `checkOutSource = MANUAL` |
| Clear check-out (`null`) | `checkOutSource = null` |
| Clear check-in (`null`) | `checkInSource = null` |
| Only status / late / OT / note | Leave punch sources as-is |

Also update legacy `source` when a punch source changes:

- If either punch source is `MANUAL` → `source = MANUAL`
- Else if any set punch source is `BIOMETRIC` → `source = BIOMETRIC`
- Else leave `source` unchanged

### Schedulers / auto rows (UNMARKED, HOLIDAY, absence placeholders)

No real punches → leave `checkInSource` / `checkOutSource` null. Keep existing `source = MANUAL` behaviour for those system rows.

### Audit trail (`ATTENDANCE_UPDATED` / related)

Include `checkInSource` and `checkOutSource` in `changes.previous` / `changes.updated` whenever they change (same pattern as status/checkIn today).

## API / types

Return on attendance payloads (list, get, update, trail summary):

- `source` (unchanged)
- `checkInSource: AttendanceSource | null`
- `checkOutSource: AttendanceSource | null`

HRMS `AttendanceLog` type and trail `attendance` object gain the same fields.

## Display rules (HRMS)

Helper (conceptual):

```ts
displayCheckInSource(log) =
  log.checkIn == null ? '—' : (log.checkInSource ?? log.source ?? '—')

displayCheckOutSource(log) =
  log.checkOut == null ? '—' : (log.checkOutSource ?? log.source ?? '—')
```

### Surfaces

| Place | Change |
|-------|--------|
| Attendance list / page | Replace single source badge with In / Out sources (compact: `In: BIOMETRIC · Out: MANUAL` or two chips) |
| Employee profile attendance log | Same |
| Update / edit attendance dialog | Show current In/Out sources (read-only unless we later allow override; v1 = system-set only) |
| Attendance Trail | Current box: show In source + Out source separately; history diffs include the new fields |
| Reports | If a report column shows source, split or show both; if reports never show source today, no change |

Portal: out of scope unless it already shows attendance source (it does not today).

## Rubab-style example (after this change)

1. Morning biometric late check-in → `checkInSource=BIOMETRIC`  
2. HR edits check-in 09:33 → 08:00 → `checkInSource=MANUAL`, `checkOutSource` still null  
3. Evening biometric check-out → `checkOutSource=BIOMETRIC`  
4. UI: **In: MANUAL · Out: BIOMETRIC** (legacy `source` becomes MANUAL because check-in was manual)

## Out of scope

- Backfilling historical punch sources from audit logs  
- Removing legacy `source` column  
- New source enum values (e.g. IMPORT)  
- Portal UI  
- Forcing a trail event for every biometric check-out (optional follow-up)

## Success criteria

- New biometric / manual / HR-edit paths set punch sources per rules above  
- Lists, profile, edit dialog, and trail show separate In/Out sources with null→legacy fallback  
- Old rows without the new fields still render via fallback without migration  
- Existing discipline / letter behaviour unchanged (sources are informational for HR audit)
