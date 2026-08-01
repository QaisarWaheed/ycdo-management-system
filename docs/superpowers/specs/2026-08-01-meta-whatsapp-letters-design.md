# Meta WhatsApp letter delivery

Date: 2026-08-01  
Status: approved for planning

## Goal

After any letter PDF is generated, auto-send that PDF to the employee’s WhatsApp via Meta Cloud API when the employee has a phone and Meta is configured. Letter create never blocks on WhatsApp. Failed sends appear in an HR sidebar list with Resend.

## Decisions

| Topic | Choice |
|-------|--------|
| Trigger | Always auto-send if phone + Meta configured |
| Payload | Approved template + PDF document attached |
| Failure | Letter saves; WhatsApp marked FAILED |
| Phone | Normalize mixed formats (`03…` → `923…`, keep `92…` / `+92…`) |
| Architecture | Sync Meta call, no queue (v1) |
| Provider | Meta Cloud API direct (no Twilio) |

## Flow

1. `LettersService` generates letter → PDF → public HTTPS `fileUrl` (prefer Cloudinary / `persistPdf`).
2. If Meta env incomplete or no phone → create `WhatsAppLetterSend` with `SKIPPED` (or omit row only when Meta off globally — prefer row with `SKIPPED` + reason for audit).
3. Else create/update row `PENDING` → upload PDF to Meta media → send template message with document → `SENT` (+ `metaMessageId`) or `FAILED` (+ `error`).
4. Hook at end of both generate paths (selection + legacy) so disciplinary/onboarding/auto letters also send.
5. Letters with `fileUrl: null` (e.g. late-warning stub) → skip WhatsApp until a real PDF exists.

## Data model

`WhatsAppLetterSend`

- `id`
- `letterId` (unique FK → Letter)
- `employeeId`
- `phoneE164`
- `status`: `PENDING` | `SENT` | `FAILED` | `SKIPPED`
- `error` (optional string)
- `attempts` (int, default 0)
- `metaMessageId` (optional)
- `lastTriedAt`, `createdAt`, `updatedAt`

One row per letter; Resend updates the same row (bump `attempts`, refresh status/error).

## Env (API)

- `WHATSAPP_TOKEN` — permanent System User token
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TEMPLATE_NAME` — default `employee_letter_issued`
- `WHATSAPP_TEMPLATE_LANG` — default `en`

Any missing → Meta treated as off → `SKIPPED`.

## Meta template (ops, outside code)

Create utility template e.g. `employee_letter_issued` with document header + body vars:

- `{{1}}` employee name
- `{{2}}` letter type label

Must be **Approved** before production sends work.

## API

- `GET /whatsapp/letter-sends?status=FAILED` — HR (and letter-capable roles)
- `POST /whatsapp/letter-sends/:id/resend` — same auth; re-upload/send using current letter `fileUrl`

`WhatsAppService`:

- `isConfigured()`
- `normalizePakistanPhone(raw)` → E.164 digits without `+` for Graph API
- `sendLetterDocument({ phone, pdfUrl, employeeName, letterType, filename })`

## HRMS UI

- Sidebar item **Failed WhatsApp**
- Table: employee, letter type, phone, error, last tried, Resend button
- Toast on resend success/fail

## Out of scope (v1)

- Delivery/read webhooks
- Job queue / Redis
- Per-letter-type templates
- SMS / email fallback
- Separate WhatsApp number field (use `Employee.phone`)

## Success criteria

- Generating any letter with phone + Meta env sends PDF on WhatsApp when template approved.
- WhatsApp failure does not roll back letter.
- HR can list FAILED rows and resend successfully after fixing phone/template/Meta.
