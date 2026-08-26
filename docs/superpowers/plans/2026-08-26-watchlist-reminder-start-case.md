# Watchlist Reminder + Start Case Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Near reminder (ADVICE + WhatsApp), Due start-case (SUSPENSION disciplinary), show phone, hide due when case open.

**Architecture:** Extend `buildSuspensionWatchlist` + attendance endpoints; reuse `LettersService` send and `DisciplinaryService.create`.

**Tech stack:** NestJS API, React HRMS watchlist page.

## File map

- `apps/api/src/modules/attendance/suspension-watchlist.ts` — phone + filter active SUSPENSION
- `apps/api/src/modules/attendance/attendance.service.ts` — reminder + startCase methods
- `apps/api/src/modules/attendance/attendance.controller.ts` — POST routes
- `apps/api/src/modules/attendance/attendance.module.ts` — inject letters/disciplinary if needed
- `apps/hrms/src/api/endpoints/attendance.ts` — types + API calls
- `apps/hrms/src/pages/disciplinary/SuspensionWatchlistPage.tsx` — phone + buttons

## Tasks

1. API: phone on entries + exclude active SUSPENSION from near/due.
2. API: `reminder` and `start-case` endpoints.
3. HRMS: wire API + UI actions + phone display.
4. Smoke: unit/spec for filter if quick; otherwise manual check.
