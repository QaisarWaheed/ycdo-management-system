# Separate Check-In / Check-Out Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and display independent BIOMETRIC/MANUAL sources for check-in and check-out on every attendance surface, while keeping legacy `source` as a compatibility summary.

**Architecture:** Add nullable `checkInSource` / `checkOutSource` on `AttendanceLog`. Centralize punch-source write + legacy-summary rules in a small helper used by biometric, manual, and HR update paths. HRMS shows In/Out sources with null→legacy `source` fallback; no historical backfill.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Jest, React (HRMS Vite), existing `AttendanceSource` enum.

**Spec:** `docs/superpowers/specs/2026-09-09-checkin-checkout-source-design.md`

## Global Constraints

- Two new nullable columns; keep legacy `source`
- No backfill of existing rows
- HR edits check-in only → `checkInSource=MANUAL`, `checkOutSource` unchanged
- HR edits check-out only → `checkOutSource=MANUAL`, `checkInSource` unchanged
- Clear punch → that punch’s source becomes `null`
- Status/note/OT-only edits do not force punch sources to MANUAL
- Display: if punch time null → `—`; else `punchSource ?? legacy source ?? '—'`
- Legacy `source`: MANUAL if either punch source is MANUAL; else BIOMETRIC if any set punch source is BIOMETRIC; else unchanged
- Discipline/letters behaviour unchanged

## File map

| File | Responsibility |
|------|----------------|
| `apps/api/prisma/schema.prisma` | Add `checkInSource`, `checkOutSource` |
| `apps/api/prisma/migrations/<ts>_attendance_punch_sources/` | Nullable columns only |
| `apps/api/src/modules/attendance/punch-source.util.ts` | Write + legacy summary helpers |
| `apps/api/src/modules/attendance/punch-source.util.spec.ts` | Unit tests for helper |
| `apps/api/src/modules/attendance/attendance.service.ts` | Biometric / manual / update / trail wiring |
| `apps/hrms/src/types/index.ts` | `AttendanceLog` fields |
| `apps/hrms/src/lib/attendanceSourceDisplay.ts` | Display helpers |
| `apps/hrms/src/pages/attendance/AttendancePage.tsx` | List Source column |
| `apps/hrms/src/pages/employees/EmployeeProfilePage.tsx` | Profile Source column |
| `apps/hrms/src/components/attendance/UpdateAttendanceDialog.tsx` | Read-only In/Out sources |
| `apps/hrms/src/components/attendance/AttendanceTrailDialog.tsx` | Current + history fields |

---

### Task 1: Schema — nullable punch sources

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`AttendanceLog` model ~402–438)
- Create: `apps/api/prisma/migrations/20260909130000_attendance_punch_sources/migration.sql`

**Interfaces:**
- Produces: `AttendanceLog.checkInSource: AttendanceSource | null`, `AttendanceLog.checkOutSource: AttendanceSource | null`

- [ ] **Step 1: Add fields to Prisma schema**

Inside `model AttendanceLog`, after `source`:

```prisma
  source                AttendanceSource  @default(BIOMETRIC)
  /// Null until a write under the punch-source model sets it (no backfill).
  checkInSource         AttendanceSource?
  checkOutSource        AttendanceSource?
```

- [ ] **Step 2: Add migration SQL**

`apps/api/prisma/migrations/20260909130000_attendance_punch_sources/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "AttendanceLog" ADD COLUMN "checkInSource" "AttendanceSource",
ADD COLUMN "checkOutSource" "AttendanceSource";
```

- [ ] **Step 3: Generate client**

Run: `cd apps/api && npx prisma generate`

Expected: client includes `checkInSource` / `checkOutSource` with no error.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260909130000_attendance_punch_sources
git commit -m "feat(attendance): add nullable checkIn/checkOut source columns"
```

---

### Task 2: Punch-source helper + unit tests (TDD)

**Files:**
- Create: `apps/api/src/modules/attendance/punch-source.util.ts`
- Create: `apps/api/src/modules/attendance/punch-source.util.spec.ts`

**Interfaces:**
- Produces:
  - `summarizeLegacySource(checkInSource, checkOutSource, previousSource): AttendanceSource`
  - `punchSourcesForBiometricCheckIn(): { checkInSource; source }`
  - `punchSourcesForBiometricCheckOut(): { checkOutSource }`
  - `punchSourcesForManualCheckIn(hasCheckOut: boolean): { checkInSource; checkOutSource?; source }`
  - `punchSourcesForHrUpdate(args): Partial<{ checkInSource; checkOutSource; source }>`

- [ ] **Step 1: Write failing tests**

Create `punch-source.util.spec.ts`:

```ts
import { AttendanceSource } from '@prisma/client';
import {
  summarizeLegacySource,
  punchSourcesForBiometricCheckIn,
  punchSourcesForBiometricCheckOut,
  punchSourcesForManualCheckIn,
  punchSourcesForHrUpdate,
} from './punch-source.util';

describe('punch-source.util', () => {
  describe('summarizeLegacySource', () => {
    it('returns MANUAL if either punch source is MANUAL', () => {
      expect(
        summarizeLegacySource(
          AttendanceSource.MANUAL,
          AttendanceSource.BIOMETRIC,
          AttendanceSource.BIOMETRIC,
        ),
      ).toBe(AttendanceSource.MANUAL);
    });

    it('returns BIOMETRIC when punch sources are biometric/null', () => {
      expect(
        summarizeLegacySource(
          AttendanceSource.BIOMETRIC,
          null,
          AttendanceSource.MANUAL,
        ),
      ).toBe(AttendanceSource.BIOMETRIC);
    });

    it('keeps previous when both punch sources null', () => {
      expect(
        summarizeLegacySource(null, null, AttendanceSource.MANUAL),
      ).toBe(AttendanceSource.MANUAL);
    });
  });

  describe('punchSourcesForHrUpdate', () => {
    it('sets only checkInSource MANUAL when check-in changes', () => {
      expect(
        punchSourcesForHrUpdate({
          previousCheckIn: new Date('2026-09-08T04:33:00.000Z'),
          previousCheckOut: null,
          previousCheckInSource: AttendanceSource.BIOMETRIC,
          previousCheckOutSource: null,
          previousSource: AttendanceSource.BIOMETRIC,
          nextCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          nextCheckOut: null,
          checkInProvided: true,
          checkOutProvided: false,
        }),
      ).toEqual({
        checkInSource: AttendanceSource.MANUAL,
        source: AttendanceSource.MANUAL,
      });
    });

    it('clears checkOutSource when checkout cleared', () => {
      expect(
        punchSourcesForHrUpdate({
          previousCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          previousCheckOut: new Date('2026-09-08T15:00:00.000Z'),
          previousCheckInSource: AttendanceSource.BIOMETRIC,
          previousCheckOutSource: AttendanceSource.BIOMETRIC,
          previousSource: AttendanceSource.BIOMETRIC,
          nextCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          nextCheckOut: null,
          checkInProvided: false,
          checkOutProvided: true,
        }),
      ).toEqual({
        checkOutSource: null,
        source: AttendanceSource.BIOMETRIC,
      });
    });

    it('does nothing for status-only updates', () => {
      expect(
        punchSourcesForHrUpdate({
          previousCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          previousCheckOut: null,
          previousCheckInSource: AttendanceSource.BIOMETRIC,
          previousCheckOutSource: null,
          previousSource: AttendanceSource.BIOMETRIC,
          nextCheckIn: new Date('2026-09-08T03:00:00.000Z'),
          nextCheckOut: null,
          checkInProvided: false,
          checkOutProvided: false,
        }),
      ).toEqual({});
    });
  });

  it('biometric helpers set expected fields', () => {
    expect(punchSourcesForBiometricCheckIn()).toEqual({
      checkInSource: AttendanceSource.BIOMETRIC,
      source: AttendanceSource.BIOMETRIC,
    });
    expect(punchSourcesForBiometricCheckOut()).toEqual({
      checkOutSource: AttendanceSource.BIOMETRIC,
    });
  });

  it('manual check-in helper sets MANUAL sources', () => {
    expect(punchSourcesForManualCheckIn(false)).toEqual({
      checkInSource: AttendanceSource.MANUAL,
      source: AttendanceSource.MANUAL,
    });
    expect(punchSourcesForManualCheckIn(true)).toEqual({
      checkInSource: AttendanceSource.MANUAL,
      checkOutSource: AttendanceSource.MANUAL,
      source: AttendanceSource.MANUAL,
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd apps/api && npx jest src/modules/attendance/punch-source.util.spec.ts --no-coverage`

Expected: FAIL (module / exports missing).

- [ ] **Step 3: Implement helper**

Create `punch-source.util.ts`:

```ts
import { AttendanceSource } from '@prisma/client';

export function summarizeLegacySource(
  checkInSource: AttendanceSource | null | undefined,
  checkOutSource: AttendanceSource | null | undefined,
  previousSource: AttendanceSource,
): AttendanceSource {
  if (
    checkInSource === AttendanceSource.MANUAL ||
    checkOutSource === AttendanceSource.MANUAL
  ) {
    return AttendanceSource.MANUAL;
  }
  if (
    checkInSource === AttendanceSource.BIOMETRIC ||
    checkOutSource === AttendanceSource.BIOMETRIC
  ) {
    return AttendanceSource.BIOMETRIC;
  }
  return previousSource;
}

export function punchSourcesForBiometricCheckIn() {
  return {
    checkInSource: AttendanceSource.BIOMETRIC,
    source: AttendanceSource.BIOMETRIC,
  } as const;
}

export function punchSourcesForBiometricCheckOut() {
  return {
    checkOutSource: AttendanceSource.BIOMETRIC,
  } as const;
}

export function punchSourcesForManualCheckIn(hasCheckOut: boolean) {
  if (hasCheckOut) {
    return {
      checkInSource: AttendanceSource.MANUAL,
      checkOutSource: AttendanceSource.MANUAL,
      source: AttendanceSource.MANUAL,
    } as const;
  }
  return {
    checkInSource: AttendanceSource.MANUAL,
    source: AttendanceSource.MANUAL,
  } as const;
}

export function punchSourcesForHrUpdate(args: {
  previousCheckIn: Date | null;
  previousCheckOut: Date | null;
  previousCheckInSource: AttendanceSource | null;
  previousCheckOutSource: AttendanceSource | null;
  previousSource: AttendanceSource;
  nextCheckIn: Date | null;
  nextCheckOut: Date | null;
  checkInProvided: boolean;
  checkOutProvided: boolean;
}): Partial<{
  checkInSource: AttendanceSource | null;
  checkOutSource: AttendanceSource | null;
  source: AttendanceSource;
}> {
  const out: Partial<{
    checkInSource: AttendanceSource | null;
    checkOutSource: AttendanceSource | null;
    source: AttendanceSource;
  }> = {};

  let nextInSrc = args.previousCheckInSource;
  let nextOutSrc = args.previousCheckOutSource;
  let touched = false;

  if (args.checkInProvided) {
    touched = true;
    if (args.nextCheckIn == null) {
      nextInSrc = null;
      out.checkInSource = null;
    } else {
      const changed =
        args.previousCheckIn?.getTime() !== args.nextCheckIn.getTime();
      if (changed || args.previousCheckIn == null) {
        nextInSrc = AttendanceSource.MANUAL;
        out.checkInSource = AttendanceSource.MANUAL;
      }
    }
  }

  if (args.checkOutProvided) {
    touched = true;
    if (args.nextCheckOut == null) {
      nextOutSrc = null;
      out.checkOutSource = null;
    } else {
      const changed =
        args.previousCheckOut?.getTime() !== args.nextCheckOut.getTime();
      if (changed || args.previousCheckOut == null) {
        nextOutSrc = AttendanceSource.MANUAL;
        out.checkOutSource = AttendanceSource.MANUAL;
      }
    }
  }

  // Clearing check-in also clears checkout in updateAttendance — mirror sources.
  if (args.checkInProvided && args.nextCheckIn == null) {
    nextOutSrc = null;
    out.checkOutSource = null;
  }

  if (touched) {
    out.source = summarizeLegacySource(
      nextInSrc,
      nextOutSrc,
      args.previousSource,
    );
  }

  return out;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd apps/api && npx jest src/modules/attendance/punch-source.util.spec.ts --no-coverage`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/attendance/punch-source.util.ts apps/api/src/modules/attendance/punch-source.util.spec.ts
git commit -m "feat(attendance): add punch source write helpers"
```

---

### Task 3: Wire biometric + manual create paths

**Files:**
- Modify: `apps/api/src/modules/attendance/attendance.service.ts`
  - biometric check-in create/update (~920–963)
  - biometric checkout (~1008–1016)
  - `markManual` create/update paths that set `source: MANUAL` (~1350–1375, ~3520–3540, and other MANUAL creates listed in grep)
- Test: extend or add focused service/unit coverage via helper (already covered); optionally assert create data in an existing biometric spec if one mocks prisma create

**Interfaces:**
- Consumes: helpers from Task 2
- Produces: DB rows with punch sources set on new writes

- [ ] **Step 1: Import helpers**

At top of `attendance.service.ts` with other attendance util imports:

```ts
import {
  punchSourcesForBiometricCheckIn,
  punchSourcesForBiometricCheckOut,
  punchSourcesForManualCheckIn,
  punchSourcesForHrUpdate,
} from './punch-source.util';
```

- [ ] **Step 2: Biometric check-in writes**

On both `attendanceLog.update` (existing UNMARKED/UA row) and `attendanceLog.create` for check-in, spread:

```ts
...punchSourcesForBiometricCheckIn(),
```

instead of only `source: AttendanceSource.BIOMETRIC`.

- [ ] **Step 3: Biometric checkout write**

In `biometricRegularCheckout` update `data`:

```ts
data: {
  checkOut: checkTime,
  ...classification,
  sessionClosedAt: null,
  ...punchSourcesForBiometricCheckOut(),
},
```

- [ ] **Step 4: Manual mark paths**

Wherever a REGULAR log is created/updated with an actual check-in and `source: AttendanceSource.MANUAL`, also set:

```ts
...punchSourcesForManualCheckIn(Boolean(checkOutValue)),
```

Do **not** set punch sources on scheduler placeholders that have null check-in (UNMARKED / HOLIDAY / auto-absent) — leave `checkInSource`/`checkOutSource` null per spec.

- [ ] **Step 5: Smoke existing attendance jest suites that still apply**

Run: `cd apps/api && npx jest src/modules/attendance/attendance-biometric-holiday.spec.ts src/modules/attendance/attendance-update-status-change.spec.ts --no-coverage`

Expected: PASS (or fix only breakage caused by this wiring).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/attendance/attendance.service.ts
git commit -m "feat(attendance): set punch sources on biometric and manual writes"
```

---

### Task 4: HR updateAttendance + trail payload + audit diffs

**Files:**
- Modify: `apps/api/src/modules/attendance/attendance.service.ts` (`updateAttendance` ~1590–1894, `getAttendanceTrail` ~1436–1514)
- Test: `apps/api/src/modules/attendance/attendance-update-status-change.spec.ts` (extend) **or** new `punch-source-update-wiring.spec.ts` if update path is hard to mock — prefer extending existing update spec if fixtures already exist

**Interfaces:**
- Consumes: `punchSourcesForHrUpdate`
- Produces: update writes punch sources; trail returns `checkInSource`/`checkOutSource`; audit `previous`/`updated` include them

- [ ] **Step 1: Extend `previous` snapshot in `updateAttendance`**

```ts
const previous = {
  status: log.status,
  checkIn: log.checkIn,
  checkOut: log.checkOut,
  lateMinutes: log.lateMinutes,
  overtimeMinutes: log.overtimeMinutes,
  note: log.note,
  source: log.source,
  checkInSource: log.checkInSource,
  checkOutSource: log.checkOutSource,
};
```

Ensure the `findUnique` for `log` selects / includes these fields (default model select already returns all scalar fields).

- [ ] **Step 2: After computing `effectiveCheckIn` / `effectiveCheckOut`, merge punch sources into `data`**

```ts
Object.assign(
  data,
  punchSourcesForHrUpdate({
    previousCheckIn: log.checkIn,
    previousCheckOut: log.checkOut,
    previousCheckInSource: log.checkInSource,
    previousCheckOutSource: log.checkOutSource,
    previousSource: log.source,
    nextCheckIn: effectiveCheckIn,
    nextCheckOut: effectiveCheckOut,
    checkInProvided: dto.checkIn !== undefined,
    checkOutProvided: dto.checkOut !== undefined,
  }),
);
```

Place this **after** the block that clears checkout when check-in is null so `effectiveCheckOut` already reflects that rule (recompute effectiveCheckOut if that clear mutates `data` only — if effective vars are computed before clear, recompute nextCheckOut as `data.checkOut === null ? null : effectiveCheckOut` when check-in cleared).

- [ ] **Step 3: Include punch sources in audit `updated`**

```ts
updated: {
  status: result.status,
  checkIn: result.checkIn,
  checkOut: result.checkOut,
  lateMinutes: result.lateMinutes,
  overtimeMinutes: result.overtimeMinutes,
  note: result.note,
  source: result.source,
  checkInSource: result.checkInSource,
  checkOutSource: result.checkOutSource,
},
```

- [ ] **Step 4: Trail API return**

In `getAttendanceTrail` select + `attendance` object, add:

```ts
checkInSource: log.checkInSource,
checkOutSource: log.checkOutSource,
```

Keep `source: log.source`.

- [ ] **Step 5: Run update-related tests**

Run: `cd apps/api && npx jest src/modules/attendance/attendance-update-status-change.spec.ts src/modules/attendance/punch-source.util.spec.ts --no-coverage`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/attendance/attendance.service.ts apps/api/src/modules/attendance/attendance-update-status-change.spec.ts
git commit -m "feat(attendance): punch sources on HR update and trail"
```

---

### Task 5: HRMS types + display helper

**Files:**
- Modify: `apps/hrms/src/types/index.ts` (`AttendanceLog` ~636–650)
- Create: `apps/hrms/src/lib/attendanceSourceDisplay.ts`

**Interfaces:**
- Produces:
  - `AttendanceLog.checkInSource?: string | null`
  - `AttendanceLog.checkOutSource?: string | null`
  - `displayCheckInSource(log)`, `displayCheckOutSource(log)`, `formatPunchSourcesLabel(log)`

- [ ] **Step 1: Extend type**

```ts
  source?: string
  checkInSource?: string | null
  checkOutSource?: string | null
```

- [ ] **Step 2: Add display helpers**

```ts
type PunchSourceLog = {
  checkIn?: string | null
  checkOut?: string | null
  source?: string | null
  checkInSource?: string | null
  checkOutSource?: string | null
}

export function displayCheckInSource(log: PunchSourceLog): string {
  if (log.checkIn == null || log.checkIn === '') return '—'
  return log.checkInSource ?? log.source ?? '—'
}

export function displayCheckOutSource(log: PunchSourceLog): string {
  if (log.checkOut == null || log.checkOut === '') return '—'
  return log.checkOutSource ?? log.source ?? '—'
}

export function formatPunchSourcesLabel(log: PunchSourceLog): string {
  return `In: ${displayCheckInSource(log)} · Out: ${displayCheckOutSource(log)}`
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/hrms/src/types/index.ts apps/hrms/src/lib/attendanceSourceDisplay.ts
git commit -m "feat(hrms): types and display helpers for punch sources"
```

---

### Task 6: HRMS UI — lists, profile, edit dialog, trail

**Files:**
- Modify: `apps/hrms/src/pages/attendance/AttendancePage.tsx` (~480, ~576–583)
- Modify: `apps/hrms/src/pages/employees/EmployeeProfilePage.tsx` (~1953, ~1995)
- Modify: `apps/hrms/src/components/attendance/UpdateAttendanceDialog.tsx`
- Modify: `apps/hrms/src/components/attendance/AttendanceTrailDialog.tsx` (~118–154)

**Interfaces:**
- Consumes: `formatPunchSourcesLabel`, `displayCheckInSource`, `displayCheckOutSource`

- [ ] **Step 1: Attendance list Source column**

Replace single BIOMETRIC/MANUAL badge with compact text/chips:

```tsx
<TableCell>
  <div className="flex flex-col gap-0.5 text-xs">
    <span>In: {displayCheckInSource(log)}</span>
    <span>Out: {displayCheckOutSource(log)}</span>
  </div>
</TableCell>
```

Import helpers from `@/lib/attendanceSourceDisplay`. Optional: keep badge colour by mapping BIOMETRIC→blue / MANUAL→outline per line.

- [ ] **Step 2: Employee profile attendance Source column**

Replace `{log.source ?? '—'}` with the same In/Out two-line display (or `formatPunchSourcesLabel(log)`).

- [ ] **Step 3: UpdateAttendanceDialog read-only sources**

Near check-in / check-out fields, show:

```tsx
<p className="text-xs text-text-secondary">
  Check-in source: {displayCheckInSource(log)} · Check-out source:{' '}
  {displayCheckOutSource(log)}
</p>
```

Do not add editable source controls (system-set only per spec).

- [ ] **Step 4: AttendanceTrailDialog**

Current box — replace single Source line:

```tsx
<div>
  <span className="text-text-secondary">Check-in source: </span>
  {displayCheckInSource(data?.attendance ?? log ?? {})}
  {' · '}
  <span className="text-text-secondary">Check-out source: </span>
  {displayCheckOutSource(data?.attendance ?? log ?? {})}
</div>
```

Ensure trail API typing includes the new fields (inline on the query result / attendance object).

History key filter — add `'checkInSource'`, `'checkOutSource'` (keep `'source'`).

- [ ] **Step 5: Manual visual check**

Run HRMS locally if convenient: `cd apps/hrms && npm run build`  
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/hrms/src/pages/attendance/AttendancePage.tsx \
  apps/hrms/src/pages/employees/EmployeeProfilePage.tsx \
  apps/hrms/src/components/attendance/UpdateAttendanceDialog.tsx \
  apps/hrms/src/components/attendance/AttendanceTrailDialog.tsx
git commit -m "feat(hrms): show separate check-in and check-out sources"
```

---

### Task 7: Deploy artifacts

**Files:**
- Regenerate (gitignored): `apps/api.tar.gz`, `apps/hrms.tar.gz`

- [ ] **Step 1: Rebuild API tar**

```bash
cd <repo-root>
tar -czf apps/api.tar.gz captain-definition apps/api/Dockerfile apps/api/package.json \
  apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json \
  apps/api/prisma apps/api/src
ls -lh apps/api.tar.gz
```

- [ ] **Step 2: Rebuild HRMS tar**

```bash
cd apps/hrms
tar --exclude=node_modules --exclude=dist --exclude=android --exclude=ios \
  --exclude='*.tar.gz' --exclude=.env --exclude=.env.local --exclude='.env.*' \
  --format=gnu -czf ../hrms.tar.gz \
  captain-definition Dockerfile nginx.conf package.json package-lock.json \
  vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json \
  index.html postcss.config.js tailwind.config.js components.json \
  .dockerignore public src
ls -lh ../hrms.tar.gz
```

- [ ] **Step 3: Push commits (if not already)**

```bash
git push origin main
```

Deploy CapRover: **API first** (migration on boot), then **HRMS**.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Nullable `checkInSource` / `checkOutSource` | 1 |
| Keep legacy `source` | 1–4 |
| No backfill | 1 (SQL add only) |
| Biometric in/out write rules | 2–3 |
| Manual create write rules | 2–3 |
| HR update punch rules + clear → null | 2, 4 |
| Status-only leaves punch sources | 2, 4 |
| Legacy summary MANUAL/BIOMETRIC rules | 2 |
| Audit includes punch sources | 4 |
| Trail returns punch sources | 4 |
| API/types expose fields | 4–5 |
| Display fallback | 5–6 |
| Lists / profile / edit / trail UI | 6 |
| Schedulers leave null when no punches | 3 |
| Portal out of scope | — |
| Discipline unchanged | — (no discipline edits) |

## Placeholder / consistency review

- Helper names are stable across tasks: `punchSourcesForHrUpdate`, `displayCheckInSource`, `displayCheckOutSource`
- Field names match schema: `checkInSource`, `checkOutSource`
- No TBD steps
