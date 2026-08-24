# Discipline Letters UX (Phase 2) Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** Draft → edit → send → IT-reverse lifecycle for Advice/Warning/Fine/Suspension letters; portal shows SENT only.

**Architecture:** Add `LetterStatus` (`DRAFT`/`SENT`/`REVERSED`) plus reverse audit columns. Create stays draft (no portal notify). New send/patch/reverse endpoints. HRMS Letters + watchlist UI; portal filters SENT.

**Tech Stack:** NestJS, Prisma, existing letters PDF/template pipeline, React HRMS/portal.

**Spec:** `docs/superpowers/specs/2026-08-25-discipline-letters-ux-design.md`

## Global Constraints

- Reverse: IT_ADMIN + SUPER_ADMIN only
- Delete: DRAFT only
- Edit: DRAFT or SENT without acknowledgement
- No EmployeeStatus.SUSPENDED in this phase
- Auto discipline letters remain off (phase 1)

## Files

| File | Responsibility |
|------|----------------|
| `apps/api/prisma/schema.prisma` + migration | status + reverse columns |
| `apps/api/src/modules/letters/*` | draft create, patch, send, reverse, list filters |
| `apps/api/src/modules/letters/auto-letter.helper.ts` | auto-issued letters → SENT (legacy path if re-enabled) |
| `apps/hrms/src/pages/letters/LettersPage.tsx` + API client | tabs + actions |
| `apps/hrms/.../SuspensionWatchlistPage.tsx` | Issue letter → prefilled generate |
| `apps/portal` letters list / acknowledgements | SENT only |

---

### Task 1: Schema + migration

- [x] Add `enum LetterStatus { DRAFT SENT REVERSED }`
- [x] Add `status LetterStatus @default(SENT)`, `reversedAt`, `reversedById`, `reversalReason`
- [x] Migration SQL: default SENT; backfill REVERSED where variables has soft-reverse flags
- [x] `prisma generate`

### Task 2: API lifecycle

- [x] `generate` → DRAFT for Advice/Warning/Fine/Suspension; skip notification until send
- [x] `POST /letters/:id/send` → SENT + notify + ack
- [x] `PATCH /letters/:id` → regenerate if editable
- [x] `POST /letters/:id/reverse` → IT only; unwind pending fine + discipline events where safe
- [x] `deleteLetterr` → DRAFT only
- [x] Portal/employee `findAll` → status SENT
- [x] HRMS list supports `?status=`

### Task 3: HRMS Letters UI

- [x] Draft / Sent / Reversed tabs
- [x] Send, Reverse (IT) actions per spec

### Task 4: Watchlist + Portal

- [x] Issue letter → `/letters` with query prefills
- [x] Portal lists SENT only; pending ack ignores non-SENT

### Task 5: Verify

- [x] API/HRMS tsc (letter paths clean)
