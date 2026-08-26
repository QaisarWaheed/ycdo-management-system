# Watchlist Reminder + Start Case Design

**Date:** 2026-08-26  
**Status:** Approved

## Goal

On Letters → Watchlist:

1. Show employee **phone** on Near and Due rows.
2. **Near:** Send reminder = formal **ADVICE** letter + WhatsApp (near-suspension wording).
3. **Due:** **Start inquiry** = create OPEN **SUSPENSION** disciplinary action; employee leaves Due while that case is active; appears under Disciplinary.

## Behavior

### Phone
- Include `phone` on each watchlist entry from `Employee.phone`.
- UI: show under name/code (tel: link when present).

### Near — Send reminder
- Endpoint: `POST /attendance/suspension-watchlist/:employeeId/reminder`
- Validates employee is currently on **near** list for the PKT calendar month (optional `year`/`month` query).
- Creates and **sends** an ADVICE letter with reason text covering late/UA counts and: continued violations may lead to suspension.
- WhatsApp via existing letter delivery after send.
- Does **not** remove from Near list.

### Due — Start inquiry
- Endpoint: `POST /attendance/suspension-watchlist/:employeeId/start-case`
- Validates employee is currently on **due** list.
- Creates SUSPENSION disciplinary action via existing `DisciplinaryService.create` (OPEN + draft letter path as today).
- Reason includes month + late/UA counts + watchlist reasons.
- Watchlist **Due** (and Near) exclude employees with an active SUSPENSION case: status in `OPEN`, `UNDER_INQUIRY`, or linked blocking suspension-request statuses if already used elsewhere — minimum: `OPEN` and `UNDER_INQUIRY`.

### UI
- Actions column: Near → “Send reminder”; Due → “Start inquiry”.
- Confirm or immediate with loading + toast; invalidate watchlist + disciplinary queries on success.

## Out of scope
- Auto-jump to Disciplinary after start-case.
- New WhatsApp template codes beyond existing letter delivery.
- Removing Near after reminder.
