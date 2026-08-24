# Discipline letters UX (phase 2)

Date: 2026-08-25  
Status: approved for implementation (phase 2)  
Depends on: `docs/superpowers/specs/2026-08-24-suspension-watchlist-design.md` (phase 1)

## Goal

Replace auto-issued attendance discipline letters with a controlled HR draft → edit → send flow for **Advice, Warning, Fine, and Suspension**. Employees see letters on the portal only after explicit send. **IT only** can reverse a sent letter, with full unwind of related side effects where safe.

## Decisions

| Topic | Choice |
|-------|--------|
| Letter types in scope | Advice, Warning, Fine, Suspension |
| Entry points | Letters page **and** suspension watchlist |
| Publish model | **Draft first** — portal only after **Send to portal** |
| Edit after send | Allowed only if **not yet acknowledged** |
| Reverse authority | **IT only** (`IT_ADMIN`, `SUPER_ADMIN`) — HR cannot reverse |
| Reverse depth | Full unwind where safe (letter + pending fine + related attendance discipline side effects) |
| Employee status → SUSPENDED | **Out of scope** (phase 3) |
| Inquiry / leadership approval / portal red warning / branch lock | **Out of scope** (phases 3–5) |
| Status model | First-class `Letter.status`: `DRAFT` \| `SENT` \| `REVERSED` |

## Letter lifecycle

| Status | Meaning |
|--------|---------|
| `DRAFT` | Created by HR; PDF may exist; **not** listed on portal; no acknowledgement required yet; no “letter issued” portal notification |
| `SENT` | Published; portal-visible; notification; acknowledgement required for these four types |
| `REVERSED` | Voided by IT; kept for audit; not shown as active on portal; no ack |

**Transitions**

- Create (Letters wizard or watchlist) → `DRAFT`
- **Send to portal** → `DRAFT` → `SENT` (idempotent if already `SENT`)
- **Edit** → allowed when `DRAFT`, or `SENT` with no `AllegationAcknowledgement`; regenerates PDF and updates `variables` / `content`
- **Delete** → allowed for `DRAFT` only (existing hard-delete roles); do not hard-delete `SENT` / `REVERSED` in this phase
- **Reverse** → `SENT` → `REVERSED` (IT only); drafts are deleted, not reversed

**Migration note:** Add `Letter.status` with default `SENT` so existing employee-visible letters keep working. In the same migration, set `REVERSED` where `variables` already has a known soft-reverse flag (`reversed`, `reversedDueToShortLeave`, or equivalent). New creates in this phase use `DRAFT`.

## APIs

| Method | Path | Roles | Behavior |
|--------|------|-------|----------|
| `POST` | `/letters` | existing generate roles | Create letter as `DRAFT`; **do not** create portal notification / pending ack until send |
| `POST` | `/letters/preview` | unchanged | HTML preview before/during draft |
| `PATCH` | `/letters/:id` | HR generate roles | Edit draft, or sent+unacked; regenerate PDF; reject if acked or reversed |
| `POST` | `/letters/:id/send` | HR generate roles | `DRAFT` → `SENT`; create in-app notification; set `requiresAcknowledgement` for Advice/Warning/Fine/Suspension |
| `POST` | `/letters/:id/reverse` | `IT_ADMIN`, `SUPER_ADMIN` only | Body: `{ reason: string }`; `SENT` → `REVERSED`; run unwind (below) |
| `GET` | `/letters` (portal / employee) | portal | Return only `status = SENT` for the employee |
| `DELETE` | `/letters/:id` | existing delete roles | **Draft only** — reject delete of `SENT` / `REVERSED` |

Audit: reverse and send should write `AuditLog` (actor, letter id, reason).

### Reverse unwind

On IT reverse of a discipline letter:

1. Set `status = REVERSED`; store `reversedAt`, `reversedById`, `reversalReason` (columns or structured fields — prefer columns for queryability).
2. Clear active ack: `requiresAcknowledgement = false`; do not delete historical ack rows if already acknowledged (letter is still reversed).
3. **Fine:** if a linked payroll deduction exists and the payroll entry is still `PENDING`, remove/adjust that deduction (reuse existing reverse fine helpers where possible). If `PROCESSED` / `PAID`, leave money as-is; API response / UI should note “letter reversed; fine not undone (payroll finalized).”
4. **Attendance discipline:** where the letter is tied to late / missing-checkout / UA discipline events, call or mirror existing safe reverse helpers so duplicate re-issue and stale side effects do not stick. Do **not** change `EmployeeStatus` in this phase.
5. Idempotent: reversing an already `REVERSED` letter is a no-op success or clear 409 — pick **409 Conflict**.

## HRMS UI

### Letters page

- Filters/tabs: **Draft** | **Sent** | **Reversed** (WhatsApp-pending can remain as an additional filter on Sent if useful).
- Status badges on rows.
- **Draft:** Preview, Edit, Send to portal, Delete.
- **Sent (unacked):** Preview, Edit; no Reverse for HR.
- **Sent (acked):** Preview only for HR.
- **IT:** Reverse action on Sent (reason required dialog).

### Suspension watchlist

- Row action **Issue letter** → draft generate flow prefilled with employee + late/UA counts + suggested reason text.
- HR chooses type among Advice / Warning / Fine / Suspension (suggested default: Near → Advice or Warning; Due → Suspension — suggestion only, not forced).
- After create, land on draft preview with Send available.

## Portal

- My Letters lists only `SENT`.
- No ack prompts for draft or reversed.
- Reversed letters do not appear in the active list (optional “history” out of scope unless already present).

## Out of scope (later phases)

- Setting `EmployeeStatus.SUSPENDED` / account disable on send of Suspension letter (phase 3)
- Inquiry officer / guilty–not guilty
- Founder / President / Chairman WhatsApp approval
- Branch lock after suspension
- Profile discipline trail card
- Portal red warning banner

## Success criteria

- New Advice/Warning/Fine/Suspension creates are `DRAFT` until Send
- Portal never shows draft or reversed letters as active
- HR cannot call reverse; IT can, with reason
- Edit blocked after acknowledgement
- Pending fine undone on reverse when payroll allows; finalized payroll fines left intact with clear messaging
- Watchlist can open a prefilled draft letter flow
- Phase 1 watchlist counts and auto-letter kill switch remain unchanged

## Follow-on

3. Suspension case + inquiry (status flip on approved suspension flow)  
4. Leadership approval  
5. Profile trail + branch lock + portal warning  
