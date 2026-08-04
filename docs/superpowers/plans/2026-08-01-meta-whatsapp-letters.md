# Meta WhatsApp Letters Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Auto-send letter PDFs via Meta WhatsApp; HR can resend failures.

**Architecture:** `WhatsAppService` + `WhatsAppLetterSend` row after letter generate; HRMS Failed WhatsApp page.

**Tech Stack:** NestJS, Prisma, Meta Graph API, React HRMS.

## Global Constraints

- Letter create never fails because of WhatsApp
- Sync Meta calls only (no queue)
- Use `Employee.phone`; normalize PK formats

---

### Task 1: Prisma + env
- [x] Add enum `WhatsAppSendStatus` + model `WhatsAppLetterSend`; relation on `Letter` + `Employee`
- [x] Migration; `.env.example` WhatsApp vars

### Task 2: WhatsApp module (API)
- [x] `normalizePakistanPhone` + unit-style self-check or small util test
- [x] `WhatsAppService` (isConfigured, upload media, send template+document)
- [x] `WhatsAppController` GET failed + POST resend
- [x] Hook from `LettersService` after letter saved with `fileUrl`

### Task 3: HRMS UI
- [x] API client + sidebar + Failed WhatsApp page + resend

### Task 4: Verify
- [x] API + HRMS build
