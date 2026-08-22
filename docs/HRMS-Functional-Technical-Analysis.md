# HRMS – Complete Functional, Technical & Workflow Analysis

**Codebase analyzed:** `c:\Users\Dell\ycdo-management-system` (YCDO HRMS, Turborepo monorepo)
**Analysis basis:** direct reading of the Prisma schema, backend services/controllers, frontend pages, deployment config, and the biometric device agent — cross-verified across modules. This document describes **only what is implemented in the code today**. Nothing here is a recommendation, a fix, or an assumption about intended behavior.

**Legend used throughout:**
- ✅ **Fully implemented** — real, connected, working end‑to‑end
- 🟡 **Partially implemented** — some of the flow works, some doesn't
- 🔵 **UI only / not fully implemented** — frontend exists, no working backend connection
- 🟠 **Backend exists / frontend not connected** — API is real and complete, no UI calls it
- 🔴 **Conflict / bug** — frontend, backend, and/or database disagree, or logic is inconsistent

---

## PART 1 — Executive Summary

**What this system is.** YCDO HRMS is a purpose-built HR/workforce management platform for a Pakistani multi-project organization (project types in the database are literally `HOSPITAL`, `VTI` [vocational training institute], `KITCHEN`, and `SOFTWARE_HOUSE` — i.e., YCDO runs several different kinds of facilities under one umbrella, each with its own branches, departments, and staff). Compensation is called a **"stipend"** throughout the code, not a "salary" — this is a welfare/NGO-style pay structure, not a corporate payroll system, and the documentation below uses the code's own terminology.

**Who uses it.** There are two separate applications:
- **HRMS** (`apps/hrms`) — the internal admin web app used by HR staff, branch/department managers, IT admins, and organization executives (President, Founder, Chairman).
- **Portal** (`apps/portal`) — the employee self-service app (also packaged as an Android/iOS app via Capacitor) used by ordinary staff to view attendance, apply for leave, check payslips, and read HR letters.

**Main modules.** Employee lifecycle & onboarding, organization structure (Project→Branch→Department→Designation), attendance (biometric + manual + a now-unused GPS path), shift management, leave with a three-stage approval chain, a reliever ("who covers your duty while you're on leave") system, stipend/payroll, disciplinary actions and a bilingual (Urdu-first) HR letter system with WhatsApp delivery, recruitment, reporting, and a very granular role/permission system.

**Main workflows.** Hire → onboard (with executive approval for new joiners) → assign branch/department/shift → daily attendance via biometric device or HR manual entry → monthly stipend calculated from actual hours worked, leave, lateness, and discipline → leave requests flow through Branch Manager → Department Incharge → (optional reliever) → HR Operations → disciplinary letters auto-issue on repeated lateness/absence and can escalate to suspension.

**Architecture, in one line.** Employee/Admin browser or phone → React frontend (HRMS or Portal) → REST API (NestJS) → PostgreSQL (via Prisma) → external services (Cloudinary for files, Meta WhatsApp Cloud API for letter delivery, SMTP only for one narrow use case). A separate Python script runs on-site at each branch, talking directly to the Hikvision biometric door/face devices and relaying punches to the API.

**Implementation maturity.** The backend is unusually mature and deep — this is not a scaffold. Attendance, payroll, and the letter/disciplinary system in particular contain substantial, carefully-commented business logic (late-arrival grace periods, three-strike warning escalation, auto-suspension, bilingual PDF generation, WhatsApp delivery with retry, hourly-prorated stipend calculation). The HRMS admin frontend is described by its own reviewing agent as "overwhelmingly real, connected, working code" with no meaningful mock data found anywhere. The Employee Portal is solid for read/self-service flows (leave, payroll, letters, profile) but its headline **GPS self-attendance feature was fully built and then deliberately removed** from the UI in a recent commit (`aadfcb2`), leaving the backend, native permissions, and unused code in place.

**Major strengths found:**
- A genuinely sophisticated attendance/discipline engine: late-minute formulas, 3rd/6th/9th-occurrence escalation to auto-suspension, automatic bilingual warning/suspension letters, overnight-shift handling.
- A real hourly-prorated stipend engine with a working, unit-tested formula (not a stub).
- A bilingual (Urdu/English) letter system with a full admin-facing template designer, Puppeteer-rendered PDFs, and automatic WhatsApp delivery via Meta's Cloud API with a manual `wa.me` fallback.
- A hybrid, genuinely configurable permission system (role defaults + per-user overrides) plus a hospital-specific department/designation manager-scoping mechanism.
- Extensive, real (not decorative) reporting, filtering, and export functionality in the admin app.

**Major incomplete/inconsistent areas found (summarized; full detail in Part 29):**
- The employee Portal's GPS self check-in/out is backend-complete but has **zero UI entry points** — nothing in the shipped app can trigger it.
- **No concept of holidays or weekly-offs exists anywhere in the system** — `AttendanceStatus.HOLIDAY` is defined in the database but never set by any code path.
- Disciplinary **fines never automatically create a payroll deduction** — HR must manually re-enter the amount in Payroll.
- Approved **advance/loan requests have no automatic effect on payroll** — HR must manually mirror the deduction, and there is no admin screen to even approve/reject loan requests (only a read-only view).
- A fully-built **Separation module** (resignation/promotion with auto-generated letters and payroll linkage) has no frontend caller at all — HR uses a simpler generic status-change screen instead, which skips those side effects.
- `POST /auth/register` is a **public, unauthenticated endpoint that accepts an arbitrary role, including `SUPER_ADMIN`** — a genuine security gap (Part 29, Critical).
- Three different, slightly inconsistent formulas exist across the codebase for computing "late" and "half day" status depending on whether the punch came from the biometric device, a manual HR entry, or the (now-unused) portal check-in.

---

## PART 2 — System Architecture

### 2.1 Technology stack

| Layer | Technology |
|---|---|
| Monorepo tooling | Turborepo (`turbo.json`), npm workspaces (`apps/*`, `packages/*`) |
| Backend framework | NestJS 11 (`apps/api`), TypeScript |
| Database | PostgreSQL, accessed via Prisma ORM 6 (`apps/api/prisma/schema.prisma`, 1,190 lines, 48 migrations) |
| Auth | JWT (`@nestjs/jwt` + Passport `passport-jwt`), `bcryptjs` password hashing |
| Validation | `class-validator` / `class-transformer` on all DTOs |
| Scheduled jobs | `@nestjs/schedule` (`ScheduleModule.forRoot()` in `app.module.ts`) |
| PDF generation | Puppeteer (headless Chromium) rendering Handlebars-templated HTML to PDF |
| Excel export | `exceljs` |
| File storage | Cloudinary (photos, letter PDFs) with local-disk `/uploads` fallback |
| Outbound messaging | Meta WhatsApp Business Cloud API (letters); Nodemailer/SMTP (Super Admin login OTP **only**) |
| Admin frontend | `apps/hrms` — React 19, Vite, React Router, TanStack Query, Zustand, react-hook-form + Zod, Tailwind + Radix/shadcn UI, TipTap rich text editor |
| Employee frontend | `apps/portal` — same stack, plus Capacitor (Android/iOS native wrapper) with `@capacitor/geolocation`, `@capacitor/app`, `@capacitor/status-bar` |
| Shared packages | `packages/types`, `packages/validators` — **effectively dead** (see Part 29, Finding #1) |
| Deployment | Docker (`apps/api/Dockerfile`, Node 22 Alpine + Chromium for Puppeteer) via CapRover (`captain-definition` → `apps/api/Dockerfile`); container runs `npx prisma migrate deploy && node dist/src/main` on boot |

### 2.2 Biometric hardware integration

Attendance devices are **Hikvision** access-control/face terminals. A standalone **Python agent** (`biometric_script/agent.py`, ~1,470 lines) runs on a PC at each branch (not inside the Docker container), talking to the device over its local ISAPI HTTP interface (Digest/Basic auth) and relaying every punch to the central API. Key design points found in the script:
- Two modes: **`stream`** (modern devices — a live `alertStream` connection, reconnecting with automatic backfill on outage) and **`poll`** (older devices with no live stream — polls the `AcsEvent` log every 5 seconds).
- A **watchdog thread** force-restarts the whole process if any worker thread goes silent past its limit (handles frozen sockets, PC sleep/resume, etc. — deliberately distinguishes a real hang from the PC sleeping).
- Punches are pushed to `POST {HRMS_API}/attendance/biometric-push` with header `x-device-key: {DEVICE_KEY}` and body `{ biometricId, deviceId, punchType }`, where `punchType` is one of `CHECKIN | CHECKOUT | OVERTIME_CHECKIN | OVERTIME_CHECKOUT | AUTO`. The script explicitly does **no local business logic** — "every scan is forwarded to the API; the server is the single source of truth."
- A separate **face-sync loop** polls `GET {HRMS_API}/face-sync/pending?deviceId=X` every 60s, downloads/resizes employee photos, and enrolls them on the device via ISAPI `UserInfo/Record` + `FDSetUp`, reporting results back to `POST {HRMS_API}/face-sync/result`.
- All devices at all branches currently share **one global secret** (`x-device-key`) — device registration in the HRMS "Biometric Devices" screen is bookkeeping only (branch assignment), it does not itself gate the push endpoint.

### 2.3 Scheduled jobs (cron)

Exactly five real scheduled jobs exist in the backend (confirmed by direct code search — no other `setInterval`/queue/worker mechanism is used anywhere):

| Schedule | Job | File | What it does |
|---|---|---|---|
| `* * * * *` (every minute) | `notifyShiftEndForOvertime` | `attendance/shift-checkout.scheduler.ts` | For employees who already checked in **and** out of their regular shift and haven't started overtime, sends a one-time "start overtime?" notification right as their duty window ends. Does **not** auto-close any open session — checkout is always manual. |
| `*/15 * * * *` (every 15 min) | `markShiftStartAbsent` | `attendance/shift-absent.scheduler.ts` | Creates `UNMARKED` attendance placeholders for employees whose shift just started and who have no punch yet (skips anyone on approved leave); `ABSENT` instead for 24-hour-shift staff. |
| `*/15 * * * *` (every 15 min) | `markUninformedAbsent` | `attendance/shift-absent.scheduler.ts` | Escalates any still-unpunched `UNMARKED`/`ABSENT` row to `UNINFORMED_ABSENT` once **3 hours** have passed since shift start, and applies the associated payroll deduction / possible auto-suspension. |
| `0 * * * *` (hourly) | `autoRejectExpiredRelieverRequests` | `leave/reliever.scheduler.ts` | Auto-rejects a reliever request that's sat `PENDING` for more than 8 hours (HR-assigned requests are exempt). |
| `0 * * * *` (hourly) | `autoAcceptExpiredReceipts` | `stipend-receipts/stipend-receipt.scheduler.ts` | Auto-accepts a stipend/payslip receipt whose 48-hour employee-response deadline has passed. |
| `0 9 3 * *` (09:00 on the 3rd of each month) | `generateMonthlyStipendReceipts` | `stipend-receipts/stipend-receipt.scheduler.ts` | Creates that month's payslip-acceptance receipts for eligible employees. |
| `0 * * * *` (hourly) | `autoEscalateShowCauseLetters` | `letters/show-cause.scheduler.ts` | Auto-suspends any employee who hasn't replied to a Show Cause letter within 48 hours. |

(A grep match on `letters.service.ts` for "Cron" was verified to be a false positive — no scheduled job actually lives in that file.)

### 2.4 Key environment variables (`apps/api/.env.example`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Required at boot (no default) — token signing/expiry |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | Optional — omit to fall back to local `/uploads` disk storage |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (default `employee_letter_issued`), `WHATSAPP_TEMPLATE_LANG` | Meta WhatsApp Cloud API — omit any to disable automatic letter delivery (sends are then recorded as `SKIPPED`, not failed) |
| `SUPER_ADMIN_OTP_EMAIL` (default a fixed org inbox), `SMTP_HOST/PORT/USER/PASS/FROM` | Used **only** to email the Super Admin login OTP code — no other email is ever sent by this system |
| `ONBOARDING_WHATSAPP_FOUNDER/PRESIDENT/CHAIRMAN` | Optional override numbers for the "notify executive to review new hire" `wa.me` link |
| `LETTERHEAD_LOGO_URL`, `ORG_ADDRESS`, `ORG_PHONE`, `ORG_EMAIL`, `FOUNDER_SIGNATURE_URL` | Letterhead branding for generated PDFs |
| `PUBLIC_API_URL`, `HRMS_PUBLIC_URL`, `PORTAL_PUBLIC_URL` | Public URLs embedded in links (WhatsApp messages, face-sync photo URLs) |

### 2.5 Data flow

```
Biometric device (branch)  ──▶  Python agent (on-site PC)  ──┐
Employee / Admin browser or phone (HRMS or Portal app)  ─────┼──▶  NestJS REST API  ──▶  PostgreSQL (Prisma)
                                                               │            │
                                                               │            ├──▶ Cloudinary (photos, letter PDFs)
                                                               │            ├──▶ Meta WhatsApp Cloud API (letter delivery)
                                                               │            └──▶ SMTP (Super Admin OTP email only)
                                                               │
                                                     5 cron jobs run inside the same API process
```

All three client surfaces (HRMS, Portal, biometric agent) talk to the **same single NestJS API** — there is no separate microservice per module.

---

## PART 3 — User Roles & Permissions

### 3.1 Roles

`UserRole` enum (15 values) with observed purpose:

| Role | Purpose | Notable |
|---|---|---|
| `SUPER_ADMIN` | Full system owner | Bypasses **every** role/permission check in the code (`RolesGuard`, `PermissionsService`) |
| `IT_ADMIN` | Technical administrator | Org setup, devices, login/access management, letter template designer, master data |
| `HR_EXECUTIVE` | Senior HR | Hardcoded to behave as **near-Super-Admin** — passes every guarded route **except** the plaintext-password screen (`UserPasswordsController`) |
| `HR_OPERATIONS_MANAGER` | HR — final leave approval stage, payroll | Third/last stage of the leave approval chain |
| `HR_ADMIN_MANAGER` | HR — broad admin | Wide access across employee/leave/payroll modules |
| `HR_MANAGER` | HR — general | Also the only role besides Super Admin with employee transfer/status-change/separation access |
| `ADMIN_OFFICER` | Department Incharge (2nd leave approval stage) | Also grantable a **hospital-only** department/designation scope (`UserManagerScope`) instead of a blanket role |
| `ADMIN_MANAGER` | Branch Manager (1st leave approval stage) | Branch-scoped attendance/leave marking |
| `MEDICINE_MANAGER` | Restricted HR view scoped to the Medicine department | Frontend explicitly blocks Employee create/edit for this role |
| `PAYROLL_OFFICER` | Payroll | View-only in most modules audited |
| `DEPARTMENT_HEAD` | — | **Enum value exists but was not found referenced in any `@Roles()` guard or permission default anywhere in the codebase** — currently a non-functional role |
| `PRESIDENT` / `FOUNDER` / `CHAIRMAN` | Organization executives | Their only functional powers found: approving/rejecting new-employee onboarding (each tied to one specific `EmployeeApproverTarget`), viewing reports, and reading leave data. They use the **Portal**, not HRMS, for onboarding approvals. |
| `EMPLOYEE` | Ordinary staff | Self-service only: own profile (narrowed to phone/email edit), own attendance/leave/payroll/letters, change own password |

### 3.2 How permissions actually work

This is a **hybrid** system, not purely role-based and not purely per-user:
1. `ROLE_PERMISSION_DEFAULTS` — a hardcoded table mapping each role to a default true/false for each of the 14 `Permission` enum values (`ATTENDANCE_MARK`, `ATTENDANCE_EDIT`, `LEAVE_APPROVE`, `LEAVE_APPLY_OTHERS`, `PAYROLL_MANAGE`, `EMPLOYEES_CREATE`, `EMPLOYEES_EDIT`, `DISCIPLINARY_MANAGE`, `LETTERS_GENERATE`, `INCENTIVES_MANAGE`, `RECRUITMENT_MANAGE`, `REPORTS_VIEW`, `BROADCASTS_SEND`, `ORG_SETUP`). `SUPER_ADMIN` and `HR_EXECUTIVE` are hardcoded to `true` for everything.
2. `UserPermission` (database table) lets IT Admin/Super Admin **grant or deny one specific permission for one specific login**, overriding the role default. Exposed in the HRMS "Manage Access" dialog as a Default/Grant/Deny toggle per permission.
3. Route-level `@Roles(...)` guards (`RolesGuard`) are checked **separately** from the `Permission` system — there is no single unified `PermissionsGuard`; permission checks are done imperatively inside controller methods (e.g., `employees.controller.ts` manually calls `permissionsService.userHasPermission(...)`).
4. **Hospital-only scoping**: `UserManagerScope` (project + department + optional designation) lets a user be granted `ADMIN_OFFICER`-equivalent access to specific hospital departments without holding that role globally — enforced by `AccessScopeService`, only meaningful for `ProjectType.HOSPITAL` projects.
5. `UserAdditionalRole` lets one login carry more than one role (roles are additive/merged into an "effective roles" array used everywhere). **The write path for this table is dead** — both places that accept `additionalRoles` in a request body (`UserAccessService.update`, `EmployeesService.updateEmployeeRoles`) explicitly discard it server-side ("writes are ignored to preserve existing grants"). No endpoint anywhere creates or deletes these rows through the UI.

### 3.3 Permissions matrix (derived from actual guard/permission code — not assumed)

| Module | SUPER_ADMIN | HR_EXECUTIVE | HR_MANAGER | HR_OPERATIONS_MGR | ADMIN_MANAGER (Branch) | ADMIN_OFFICER (Dept) | IT_ADMIN | PRESIDENT/FOUNDER/CHAIRMAN | EMPLOYEE |
|---|---|---|---|---|---|---|---|---|---|
| Employees | Full | Full | Manage (create/edit/transfer/status/separation) | Manage (create/edit) | Edit only, own branch | Edit only, own scope | Manage (edit) + Delete | View | Own profile (phone/email only) |
| Org setup (Branch/Dept/Designation/Project) | Full | None (route-gated out) | None | None | None | None | Full | None | None |
| Onboarding approval | Full (any target) | None | View only | None | Physical-form upload only | Physical-form upload only | None | **Approve/Reject own target** | None |
| Attendance | Full | Full | Manage-edit | Manage-edit | Manage-mark + edit (own branch, 15-min grace window) | Manage-mark + edit | Manage-edit | None | Own (read-only + reliever timer) |
| Leave | Full | Full | Manage/Approve (any stage) | Approve (final HR stage) | Approve (1st/Branch stage) | Approve (2nd/Dept stage) | None | View | Apply for self |
| Payroll ("Stipend") | Full | Full | Manage | Manage + status transitions | None | None | Manage + status transitions | None | Own payslips (view/accept/reject) |
| Disciplinary/Letters | Full | Full | Manage | View | Manage (create) | Manage (create) | Template designer only | None | Own letters (view/reply/acknowledge) |
| Recruitment | Full | View only | Full pipeline incl. Accept | None | None | None | None | None | N/A (public apply form) |
| Login/Access management | Full | None (excluded from password screen) | None | None | None | None | Full | None | Change own password only |
| Reports | Full | Full | Manage | Manage | None | None | None | Manage (`REPORTS_VIEW`) | None |
| Broadcasts | **Not included** (only `IT_ADMIN` is in the `@Roles()` list) | None | None | None | None | None | Full (sole role) | None | Recipient only |

Notes on how to read this table: "Full"/"Manage" reflects actual route guards and permission defaults found in code, not an assumption of what *should* exist. Two specific oddities are preserved intentionally because they are real: Super Admin is **not** literally listed in the Broadcasts route's `@Roles()` decorator (though it still passes because `RolesGuard` special-cases `SUPER_ADMIN` to bypass all role checks); and Branch/Department scoping is enforced through different mechanisms per module (hard role for most, `UserManagerScope` specifically for hospital ADMIN_OFFICER-equivalent access).

---

## PART 4 — Login, Authentication & Session Flow

1. **Login** — `POST /auth/login` (`email` + `password`, plus an optional `client: 'hrms' | 'portal'` discriminator). No employee-code login option exists despite `Employee.employeeCode` being a natural identifier.
   - App-separation rule: an employee-linked login without a non-`EMPLOYEE` role is blocked from HRMS; a system login without a linked employee is blocked from the Portal **unless** its role is `PRESIDENT`/`FOUNDER`/`CHAIRMAN` (executives use the Portal for onboarding approvals).
   - Password checked via `bcrypt.compare`. `User.isActive === false` → rejected ("Account is inactive").
2. **Super Admin OTP step-up** — if the resolved role set includes `SUPER_ADMIN`, login does **not** issue a token yet. A 6-digit code is generated, bcrypt-hashed into `LoginOtpChallenge`, and emailed via SMTP to a **fixed organizational inbox** (`SUPER_ADMIN_OTP_EMAIL`) — not the Super Admin's own address — with a 10-minute expiry. `POST /auth/verify-otp` completes the login; `POST /auth/resend-otp` reuses the same challenge row. No other role ever triggers this.
3. **Token** — a single JWT (`{ sub, email, role, roles, employeeId, branchId }`), signed with `JWT_SECRET`, expiring per `JWT_EXPIRES_IN` (both required env vars, no default — the app refuses to boot without them). **There is no refresh-token mechanism anywhere in the codebase** — one long-lived token is issued and used until it naturally expires.
4. **Logout** — **no backend logout endpoint exists.** The frontend simply deletes the token from local storage; the JWT itself remains valid server-side until it expires (no blacklist/revocation).
5. **Route protection** — `JwtAuthGuard` (valid token required) + `RolesGuard` (role match, with `SUPER_ADMIN`/`HR_EXECUTIVE` bypassing role checks entirely, and a hospital-manager-scope fallback for `ADMIN_OFFICER`-gated routes). On the frontend, only a **handful** of admin pages self-guard by role client-side (Master Data, Roles Management, Letter Templates, Broadcasts, Activity Trail) — most module pages (Payroll, Disciplinary, Employee Logins, etc.) rely entirely on the backend returning 403s if an unauthorized-but-authenticated user navigates there directly by URL (see Part 29, Finding — inconsistent frontend route guarding).
6. **Password reset** — `PATCH /auth/reset-password` (`SUPER_ADMIN`/`IT_ADMIN` only, sets any user's password, audit-logged). `PATCH /auth/change-password` is self-service but is **gated to role `EMPLOYEE` only** — and is never actually called from any screen in either frontend (see Part 29).
7. **Plaintext password mirroring (by design)** — every time a login is created or reset, the plaintext password is **also** stored in a separate `UserPassword` table and surfaced in two dedicated HRMS screens (Login Access, Employee Logins) with a show/hide toggle, specifically so HR/IT can WhatsApp-share credentials to employees. This is a deliberate, audited feature (not a leak), but is a material security fact.
8. **Account disabled/suspended** — `User.isActive` is the single login gate. It is **not automatically synced** with `Employee.status = SUSPENDED` — an employee can be HR-suspended while their login remains active unless someone separately disables it in Login Access.
9. **`POST /auth/register`** — exists, is **completely unauthenticated**, and accepts `{ email, password, role: UserRole, employeeId? }` with only an `@IsEnum(UserRole)` check on `role` — meaning any caller who can reach the API can self-register an account with **any role, including `SUPER_ADMIN`**. No frontend in either app calls this route. See Part 29 (Critical).
10. **Multiple-device login** — not addressed by the code at all; a JWT can be used from any number of devices simultaneously (stateless tokens, no session table).

---

## PART 5 — Employee Management

### 5.1 Employee code & required fields
`employeeCode` is auto-generated as `YCDO-{year}-{0000}` (sequential per year, derived by scanning the latest code for that year — not a DB sequence, so theoretically race-prone under simultaneous creates, though not observed as guarded by a lock).

Required fields on create (`CreateEmployeeDto`): `fullName`, `fatherName`, `phone`, `dateOfBirth`, `gender`, `currentAddress`, `joiningDate`, `currentBranchId`, `currentDepartmentId`, `currentDesignation`, `emergencyContactName`, `emergencyContactNumber`, `bloodGroup`, `basicStipend`, `province`, `city`. `cnic` is format-validated (`\d{5}-\d{7}-\d{1}`) but **optional**; `email` is optional and auto-generated as `{code}@ycdo.org` if omitted (used as the login email).

### 5.2 What happens on create
Inside one transaction: creates the `Employee` row (status `PENDING_APPROVAL` if `staffType: NEW` and an `approverTarget` executive is chosen, else `ACTIVE`), an `EmploymentHistory` row (`JOINED`), a `StipendRecord`, a linked `User` login (password = employee code, mirrored into `UserPassword`), and — if pending — an `EmployeeOnboardingApproval` row. After the transaction: auto-assigns a sequential `biometricId`; if not `staffType: EXISTING` and the employee ended up `ACTIVE` (no approval needed), auto-generates an Appointment letter.

### 5.3 Update / Transfer / Status change / Delete
- **`PATCH /employees/:id`** explicitly refuses branch/department changes ("use the transfer endpoint"). Self-editing by role `EMPLOYEE` is silently narrowed server-side to `{ phone, email }` only.
- **`POST /employees/:id/transfer`** (`SUPER_ADMIN`/`HR_MANAGER` only) closes the current `EmploymentHistory` row and opens a new one with `changeType` ∈ `{TRANSFERRED, PROMOTED, DEMOTED}`.
- **`PATCH /employees/:id/status`** (`SUPER_ADMIN`/`HR_MANAGER` only): `DISMISSED` is a permanent dead end (never changeable again); `TRAINEE → ACTIVE` **requires an existing Appointment letter** for that employee or is rejected outright.
- **Delete** (`DELETE /employees/:id`, `SUPER_ADMIN`/`IT_ADMIN` only) is a genuine **hard delete** — a long transaction manually cascades through leave/reliever/letters/disciplinary/payroll records before removing the employee. Only reachable from the IT Admin dashboard, not the main Employees list.
- There is **no separate "deactivate"** concept — deactivation is just a status change to `SUSPENDED`/`TERMINATED`/`RESIGNED`.
- 🟠 **Backend exists / frontend not connected — the Separation module** (`POST /separation/resign`, `POST /separation/promote`) is fully built (auto-generates an Experience letter on resignation, computes tenure, and on promotion can trigger a stipend increment + Salary Increment letter) but **has zero callers in either frontend app**. HR performs resignation/promotion through the plain generic status-change/transfer screens instead, which silently skip all of that automation.

### 5.4 Biometric ID, photos, documents
- Biometric IDs are sequential integers, auto-assigned on create/recruitment-accept, with a bulk regenerate-all tool (`IT_ADMIN`/`SUPER_ADMIN`).
- Profile photo upload also creates a `FaceSyncJob` (queues the photo for enrollment on biometric devices).
- A separate **"private photo"** upload exists, restricted to **female employees only**, uploadable **only by the employee themself**, stored as an access-controlled ("authenticated") Cloudinary asset — explicitly described in the Portal UI as visible only to the employee and used solely for biometric face-sync. A companion toggle lets a female employee hide her general profile photo from other staff (shown as a placeholder instead). This is a real, working, gender-specific privacy feature, not a stub.
- Documents (`EmployeeDocument`, types `CNIC/EDUCATIONAL_CERTIFICATE/EXPERIENCE_LETTER/MEDICAL_CERTIFICATE/OTHER`) are uploaded to local disk (not Cloudinary), viewable by HR or by the employee themself (self-scoped).
- **No bank/payment fields exist anywhere** in the schema or DTOs — compensation is modeled entirely through `StipendRecord`; there is no bank account/IBAN field and no payment-method integration.

### 5.5 Onboarding approval workflow
Only triggered for `staffType: NEW` employees with an `approverTarget` chosen at creation (`PRESIDENT | FOUNDER | CHAIRMAN_ADMIN`, mapped 1:1 to the matching executive `UserRole`). The submitting HR user optionally attaches a scanned **physical form**. The targeted executive reviews and approves/rejects **from the Portal app** (not HRMS) — approval sets `Employee.status = ACTIVE`, reactivates the login, and (if not `EXISTING` staff) auto-generates the Appointment letter; rejection sets `Employee.status = TERMINATED` and deactivates the login (a rejection reason of ≥5 characters is required). A `wa.me` deep link can nudge the target executive by WhatsApp. ✅ Fully implemented end-to-end, including the physical-form upload.

---

## PART 6 — Organization Structure

```
Project (type: HOSPITAL | VTI | KITCHEN | SOFTWARE_HOUSE)
  └── Branch (belongs to one Project; can be branchless/"universal")
        └── Department (global catalog, linked to projects via ProjectDepartment; not owned by one branch)
              └── Designation (also a global catalog)
                    └── Employee (currentBranchId, currentDepartmentId, currentDesignation)
```

- **Departments and Designations are global catalogs**, not per-branch entities — `create()` for both is an **upsert-by-normalized-name** (creating "OPD" twice just reactivates it, never errors). All org names are force-uppercased on write.
- `common/org-structure.ts` defines which departments/designations make sense for which `ProjectType` (e.g., a hospital uses `OPD, INDOOR, ADMIN, PHARMACY, CONSULTANT...`; a VTI uses `TEACHER, PRINCIPAL, VTI, ADMIN...`) — but this mapping is **UI-narrowing only**, not a hard database constraint; nothing stops assigning a mismatched department via the raw field.
- 🔴 **Inconsistent delete safety model**: deactivating a **Branch** or **Project** hard-blocks if employees/branches are still linked. Deactivating a **Department** or **Designation** instead **soft-deletes it and silently nulls out `currentDepartmentId`/`currentDesignation`** on any active employees still assigned to it. Same conceptual action, two different behaviors depending on entity type.
- `sortOrder` exists on Branch/Department/Designation and drives list ordering everywhere; Branches additionally use a custom hierarchy-sort utility.
- **Managers/supervisors**: `ADMIN_MANAGER` = Branch Manager (1st leave-approval stage, branch-scoped attendance marking); `ADMIN_OFFICER` = Department Incharge (2nd stage), or hospital-specific via `UserManagerScope`; `HR_OPERATIONS_MANAGER` = final (3rd) approval stage; there is no separate "Team"/"Supervisor" model beyond these role-based org relationships.

---

## PART 7 — Attendance Module

### 7.1 How daily records come into existence
Attendance rows are **not pre-generated in advance**. They appear in one of three ways:
1. **On first punch** — biometric, manual, or (dormant) portal check-in creates/updates a row keyed by the unique constraint `[employeeId, date, type]` (`type` is `REGULAR` or `OVERTIME`).
2. **Lazily on read** — viewing a single day's attendance list back-fills `UNMARKED` placeholders for any active employee whose shift has already started and who isn't on approved leave.
3. **By the 15-minute cron** (`markShiftStartAbsent`) — same back-fill, run proactively rather than only on-demand.

Default status is `UNMARKED` (or `ABSENT` immediately for 24-hour-shift staff).

### 7.2 Biometric push — exact request trace
`POST /attendance/biometric-push` — protected only by a static shared secret header (`x-device-key`), **no JWT**. `{ biometricId, deviceId?, punchType, timestamp }`.
1. Employee looked up by unique `biometricId` — not found → **404**.
2. Employee must be `ACTIVE` or `TRAINEE` — otherwise **400** ("Employee is not active").
3. Branch resolved as `employee.currentBranchId` first, device's registered branch only as fallback (explicit fix for mis-registered/shared devices).
4. **The device's own timestamp is ignored** — the server always uses its own clock (`new Date()`) for the actual punch time.
5. `punchType: 'AUTO'` is resolved server-side: if an open `REGULAR` log exists for today, it's treated as `CHECKOUT`, otherwise `CHECKIN` (24-hour staff are always forced to `CHECKIN` on `AUTO`).
6. Hard duplicate guards: a second `CHECKIN` on an already-checked-in day → **409 Conflict**; a `CHECKOUT` with no open check-in → **400**. `CHECKIN`/`CHECKOUT` re-punches are **not silently idempotent** — a device retry surfaces a visible error rather than a silent no-op.
7. Dispatches to regular/overtime check-in or check-out logic (below).

### 7.3 Late / overtime status logic — 🔴 three inconsistent formulas coexist
| Path | Grace period | Half-day threshold | Used by |
|---|---|---|---|
| `assessCheckIn()` / `statusFromLateMinutes()` | Fixed **15 min** | Fixed **&gt;60 min late** | Biometric check-in, manual HR marking |
| `determineBiometricCheckInStatus()` | Same 15-min-derived lateness | `&gt;60 min late` **and** session ≥240 min at checkout | Biometric checkout (can retroactively escalate LATE→HALF_DAY) |
| `determineCheckInStatus()` | Fixed 15 min | **Shift midpoint** (not a fixed 60 min) — and a hardcoded 09:00–13:00 default shift if none assigned | Portal GPS check-in (currently unreachable from the UI, see §7.6) |

This means the same lateness could be classified differently depending purely on which channel recorded it — a genuine behavioral inconsistency, not just a naming difference.

**Grace period = 15 minutes** (`LATE_GRACE_MINUTES`, hardcoded, not configurable per branch/shift/DB). **Overtime grace = 60 minutes** after duty end before overtime starts accruing (`OVERTIME_GRACE_MINUTES`, hardcoded). A check-in more than 60 minutes *before* duty start earns the entire early span as pre-duty overtime; less than that is just a normal early arrival.

**Source of truth for duty times is the individual `Employee.dutyStartTime`/`dutyEndTime`, not the `Shift` record** — the `Shift` is explicitly documented in code as "template only." Editing a Shift's times **cascades and overwrites** the duty times of every employee currently assigned to it.

### 7.4 Attendance statuses (exact enum values used)
`PRESENT, ABSENT, UNMARKED, LATE, HALF_DAY, ON_LEAVE, HOLIDAY, UNINFORMED_ABSENT, SWAP_COVERED`

| Status | Set by |
|---|---|
| `UNMARKED` | Default placeholder (shift started, no punch yet, not on leave) |
| `PRESENT` | On-time punch |
| `LATE` | Late beyond the 15-min grace, ≤60 min |
| `HALF_DAY` | Late &gt;60 min (escalated by discipline rules), or a Short Leave day |
| `ON_LEAVE` | Multi-day leave approval writes this for every date in range |
| `UNINFORMED_ABSENT` | Auto-escalated by cron 3 hours after shift start with still no punch |
| `ABSENT` | 24-hour-shift auto-mark, or manual HR-set |
| `SWAP_COVERED` | The *covered* employee's day in a Mutual Swap (someone else worked their shift) |
| `HOLIDAY` | **Defined in the database enum but never set by any code path anywhere in the backend** — confirmed dead. See Part 13. |

### 7.5 24-hour shifts
Detected via `dutyTotalHours ≥ 20`, a shift name containing "24", identical start/end duty time, or a computed span ≥20 hours. These employees get **no** late/half-day/uninformed-absent logic and **no checkout requirement** — status is simply `PRESENT` (checked in) or `ABSENT` (never auto-punched).

### 7.6 Portal GPS self check-in — 🟠 backend exists / frontend not connected
The backend (`portalCheckIn`/`portalCheckOut`) is **fully implemented**: requires a `BranchLocation` (lat/lng/radius, default 200m) configured for the employee's branch, computes haversine distance, rejects out-of-radius punches, and on success writes **directly into the same `AttendanceLog` table** used everywhere else (not a disconnected shadow system) plus an audit row in `PortalAttendance`.

However: **no button, form, or geolocation call exists anywhere in the current Portal UI to trigger it.** Git history shows this was deliberately removed (commit `aadfcb2`, "Remove self check-in/check-out from employee portal" — explicit rationale: "Employees should not be able to mark their own attendance from the portal"), leaving behind: unused API client functions (`portalCheckIn`, `portalCheckOut`, `overtimePunch`), an unused native-geolocation helper, a completely unused duplicate widget component (`LiveTimerWidget.tsx`), stale claims in the app's own `MOBILE.md` build doc, and Android location permissions the app no longer exercises. There is also **no admin screen anywhere to create/configure `BranchLocation` geofences** — even if the buttons were restored, HR has no UI path to set them up today.

### 7.7 Editing, locking, approval
- Roles are split: `ADMIN_MANAGER`/`ADMIN_OFFICER`/`MEDICINE_MANAGER` can only mark a fresh check-in within a **15-minute grace window** of duty start, and once marked can only fill in the *checkout* time afterward (any other field edit is refused with 403 — "attendance already marked, contact HR"). Full HR/IT roles can edit anything on any date, with no date-based lock (a record from months ago is editable by HR/IT).
- Overtime minutes specifically require the `FULL_ATTENDANCE_EDIT_ROLES` set (Super Admin/IT Admin/the four HR manager roles) even for actors who otherwise pass the general edit-role check.
- **Overnight shifts** are correctly handled: an open check-in is looked up on *today or yesterday's* date for checkout matching, and a shift starting ≥18:00 is attributed to the previous calendar date.

---

## PART 8 — Attendance Edge Cases (code-traced, not assumed)

| Scenario | Actual behavior |
|---|---|
| Employee punches CHECKIN twice | **409 Conflict** ("Employee already checked in. Duplicate CHECKIN rejected.") on biometric; **400** ("Already checked in today") via the (unused) portal path |
| CHECKOUT with no prior CHECKIN | **400** ("No open check-in found for this employee today") |
| Duplicate/retried biometric request | **Not silently deduplicated** — a genuine retry surfaces the same 409/400 error the second time; only the exact same *device log row* re-read across overlapping polling windows is deduped locally by the Python agent |
| Missing/duplicate biometric ID | Missing → punch cannot match any employee (404-style rejection); duplicate is prevented at the database level (`biometricId` is `@unique`) |
| Inactive employee punches | **400** — but the allowed "active-enough" status set is **inconsistent across modules**: biometric push allows `ACTIVE`/`TRAINEE`; manual marking allows `ACTIVE`/`APPOINTED`; additional-working-days allows `ACTIVE`/`APPOINTED`/`TRAINEE` |
| Employee on approved leave punches | **Not blocked at all** — nothing in the punch logic checks `LeaveRecord`. A punch will create/overwrite a normal attendance row on a day the employee is also marked on leave; the two systems only reconcile at the "should we auto-mark unmarked/absent" and "should we deduct pay" checks, both of which do skip approved-leave days |
| Reliever assigned | Handled by a completely separate mechanism (`RelieverSession`, not `AttendanceLog`) — see Part 12 |
| Employee works a holiday | No effect — there is no holiday calendar in the system at all (Part 13) |
| Employee works their weekly off | No effect — there is no weekly-off concept in the system at all; every day is treated identically by the auto-absent scheduler |
| Different shift timing per employee | Fully supported — duty window comes from the individual employee's `dutyStartTime`/`dutyEndTime`, not a shared shift default |
| Check-in after midnight (overnight shift) | Correctly attributed to the shift's *start* date via `getShiftAttendanceDate()`'s pre-midnight rollback logic |
| Full overnight shift (check-in one day, check-out next) | Correctly matched — the open-session lookup checks today's date, then falls back to yesterday's |

---

## PART 9 — Shift Management

- Shift names are constrained to `Morning`, `Evening`, `Night`, `24 Hours` (auto-inferred from start time if not supplied, or inherited from a "sibling" shift sharing the same start time).
- 🔴 **All shifts created through the current API are forced to `branchId: null` (universal/global)** — the `create()` service method hardcodes this regardless of what's passed in, and both `findAll(branchId)` and `getShiftsByBranch(branchId)` **silently ignore the branch filter parameter**, always returning every active shift. Branch-specific shifts are effectively non-functional despite the schema and route surface suggesting they exist.
- Editing a shift's start/end time **cascades**: every employee currently assigned to that `shiftId` has their individual `dutyStartTime`/`dutyEndTime` bulk-overwritten in the same transaction — this immediately changes future late/overtime math for the whole group.
- Deactivating a shift is blocked if any `ACTIVE`/`TRAINEE` employee is still assigned to it.
- No department-specific shift concept exists. "Temporary shift change" is not a distinct feature — the closest equivalents are directly editing an employee's duty times, or a Mutual Swap (temporary one-day coverage, not a shift reassignment).
- 🔴 **Frontend/backend role mismatch**: the backend permits both `IT_ADMIN` and `SUPER_ADMIN` to manage shifts, but the HRMS Shifts page frontend hardcodes its guard to `SUPER_ADMIN` only and redirects `IT_ADMIN` users away.

---

## PART 10 — Late, Fine & Deduction Logic

All discipline rules run inside the same database transaction as the attendance write (`attendance/discipline.helper.ts`).

**Late arrival:**
- Formula: `Late Minutes = Check-In Time − Shift Start Time − 15-minute grace` (see the three-formula caveat in Part 7.3 — this is specifically the biometric/manual path).
- `&gt;60 minutes late` is recorded as `HALF_DAY` for **display purposes**; a straight cash penalty applies only on the **3rd, 6th, and 9th** late occurrence in a calendar month:
  - 3rd → deduct **1 day's pay** (`basicStipend / 30`) + auto-issue Warning Letter #1
  - 6th → same deduction + auto-issue Warning Letter #2
  - 9th → same deduction + **auto-suspend the employee** (`Employee.status = SUSPENDED`, linked login deactivated) + auto-issue a Suspension letter
  - Idempotency is enforced by checking for an existing deduction description string containing "{count} late" before adding another.
- Below the 3rd occurrence, only a `LATE_WARNING` in-app notification is sent — no deduction yet.

**Absence:**
- Plain `ABSENT` (no approved leave that day): **2 days' pay** deducted (`(basicStipend/30) × 2`), every occurrence, skipped entirely if an approved leave covers the date.
- `UNINFORMED_ABSENT` (auto-escalated 3 hours after shift start with no punch): same 2-day deduction **every occurrence** (not milestone-gated like lateness), and if unique uninformed-absent days **exceed 2 in a month**, the employee is **auto-suspended** with an auto-generated Urdu suspension letter requiring acknowledgement.

**Unpaid leave:** computed monthly by Payroll (not by the Leave module) — see Part 11/14.

**Manual/disciplinary fines:** a `FINE`-type disciplinary action or letter carries **no automatic payroll effect** — the auto-generated fine letter even contains a placeholder string (`fineAmount: 'As per policy'`), not a number. A payroll user must manually add the deduction via the generic "Add Deduction" form in Payroll. See Part 15/29.

**Worked example (from the codebase's own unit test):** shift 8h/day, 30-day month, `basicStipend = 30,000`; employee works 20 full days + 2 paid leave days, earns 5,000 in package allowances, has 1,000 in package deductions, 1,000 in a 3rd-late-occurrence penalty, and 500 in overtime:
```
hourlyRate = 30,000 / (8 × 30) = 125.00 PKR/hr
payableHours = (20×8 + 2×8) = 176 hours
hourlyBasicEarned = 176 × 125 = 22,000
netStipend = 22,000 + 5,000 + 500 − 1,000 − 1,000 = PKR 25,500
```

---

## PART 11 — Leave Management

### 11.1 Leave types & application
`LeaveType`: `REGULAR`, `SHORT_LEAVE` (single-day, counts as 0 "total days," max 2/month), `EMERGENCY` (1 day, HR-marked instantly-approved paths only — see below). There is **no** Sick/Casual/Annual distinction beyond these three enum values, and **no file/attachment upload field exists anywhere** in the leave DTOs — document requirements (e.g. a medical certificate) are not implemented at all, front or back.

- `REGULAR` leave must be requested **≥48 hours** before the start date.
- A **hardcoded yearly cap of 24 days** (`MAX_LEAVES_PER_YEAR`) gates normal self-service applications — this is **completely disconnected** from the per-employee `Employee.monthlyAllowedLeaves` field that Payroll separately uses to decide paid-vs-unpaid leave on a **monthly** basis (see the conflict noted in Part 14). Two uncoordinated counters govern the same concept.
- Overlap with any existing active leave request is blocked.

### 11.2 Three-stage approval chain
```
PENDING (submitted)
  → BRANCH_APPROVED   [Branch Manager / ADMIN_MANAGER approves]
  → DEPT_APPROVED  or  RELIEVER_PENDING (if a preferred reliever was picked)
       [Department Incharge / ADMIN_OFFICER approves]
  → RELIEVER_CONFIRMED  [reliever accepts, or HR force-assigns]
  → APPROVED  [HR_OPERATIONS_MANAGER — this is the ONLY point attendance actually gets updated]
```
Rejection is possible at any stage → terminal `REJECTED`. **A reliever is not actually mandatory** — nothing in the code enforces that HR's final approval requires a confirmed reliever; a leave with no reliever assigned at all can still reach full `APPROVED`.

### 11.3 Leave → Attendance linkage
Only at the moment a leave reaches `APPROVED` (or is force-marked via one of the HR bypass paths below) does the system write to `AttendanceLog`: multi-day `REGULAR`/`EMERGENCY` leave writes `ON_LEAVE` for every date in range; `SHORT_LEAVE` writes a single `HALF_DAY` row. This **overwrites** whatever attendance status already existed for that date (silent, by design, no separate reconciliation log).

### 11.4 HR bypass paths (skip the whole approval chain)
- **`markEmergencyLeave`** — instantly `APPROVED`, no reliever field supported at all.
- **`markVerifiedLeave`** — instantly `APPROVED`, **does** support assigning a mandatory (non-optional) reliever; this is the backend behind the HRMS Attendance page's "Assign Reliever for absence" dialog, letting HR retroactively convert an already-`ABSENT` day into an approved leave + reliever assignment in one step.

### 11.5 Cancellation
Only leave still in `PENDING` status can be cancelled (by the employee or HR) — once any approval stage has acted, there is no cancellation path at all, even for HR.

### 11.6 Leave and payroll
Handled entirely inside Payroll, not Leave — see Part 14. In short: the first `Employee.monthlyAllowedLeaves` leave-days *per month* are paid; any beyond that in the same month are deducted at `(dailyRate) × unpaidDays`.

---

## PART 12 — Reliever Management

**Structural note:** the *assignment* ("who covers whom") lives in the Leave module (`RelieverRequest`); the *actual clocked coverage hours* live entirely in the Attendance module (`RelieverSession`) — these are two separate tables connected only by business logic, not a foreign key chain that flows straight through.

### Direct answers to the 10 required questions

1. **What happens to Employee A's (the leaver's) attendance?** `AttendanceLog` for every date of the leave is set to `ON_LEAVE` (or `HALF_DAY` for a short leave), written only once the leave reaches full `APPROVED` status.
2. **What happens to Employee B's (the reliever's) own normal attendance?** Nothing — completely unaffected. B still punches in/out for their own regular shift exactly as normal; their reliever coverage is tracked in a wholly separate record.
3. **Is Employee B marked as "Extra Duty" anywhere?** Only as a **text label**, never as a stored attendance status. There is no `EXTRA_DUTY` value in the `AttendanceStatus` enum. The label "Extra Duty (Reliever)" appears only as the `note` on an `AdditionalWorkingDay` row and in a payroll allowance description.
4. **Does the system generate a separate attendance record?** Yes — a `RelieverSession` row (date, check-in, check-out, total minutes), created/closed manually by HR/branch-admin staff via the HRMS "Reliever" tab — **not** by the reliever's own portal check-in (that endpoint has no reliever awareness at all).
5. **Does the reliever get additional pay?** Yes, but through a workaround: closing out a `RelieverSession` upserts an `AdditionalWorkingDay` row, which Payroll converts into an `AllowanceType.ADDITIONAL_WORKING_DAYS` allowance (`hours × hourlyRate`). 🔴 The schema actually defines a dedicated `AllowanceType.RELIEVER` enum value specifically for this — but it is **never referenced anywhere in the codebase**; it's dead.
6. **Can one employee be reliever for multiple people on the same date?** 🔴 **Not prevented at the assignment layer** — no check exists when requesting/HR-assigning a reliever. It's only incidentally caught later, at *check-in* time, where a reliever can have at most one `RelieverSession` per calendar date total (blocking a second Extra-Duty *punch*, not the double *assignment* itself).
7. **Can a reliever be assigned while they're themselves absent/on leave?** 🔴 **Not checked at all** — only the candidate's employment status (`ACTIVE`/`APPOINTED`) is validated, never their own leave records for that date.
8. **Does check-in/check-out work normally for the reliever?** Yes, completely independently and with zero special-casing — their normal duty punch and their reliever coverage session are two entirely unrelated code paths.
9. **Is the reliever visible on attendance screens?** Yes, on two HRMS-only screens: the Attendance page's dedicated "Reliever" tab, and a "Today's Relievers" modal on the Leave page. It is **not** shown inline on the regular daily attendance grid — a reliever's normal `PRESENT` day looks identical to any other employee's normal day there. The employee themself sees only a passive read-only "Reliever Session Active" timer banner in the Portal, with no self-service action.
10. **Bugs/missing links found:** the dead `AllowanceType.RELIEVER` enum (#5); no double-booking prevention (#6); no own-leave-conflict check (#7); a `@deprecated` `PATCH /leave/:id/status` route that's still live and reachable by `ADMIN_MANAGER` (who should only be able to act at the Branch stage) to force full HR approval directly, bypassing the stage chain; the auto-reject scheduler runs hourly against an 8-hour SLA, so real enforcement can lag up to ~1 hour past the stated deadline.

**Auto-rejection:** a `PENDING` reliever request older than 8 hours is auto-rejected by the hourly cron (HR-assigned requests are exempt, since they're mandatory, not a request).

---

## PART 13 — Holiday & Weekly Off Management

**This entire feature area does not exist in the system.**
- There is **no `Holiday` model** anywhere in the database schema.
- `AttendanceStatus.HOLIDAY` is defined in the schema's enum but is **never set by any code path in the backend** — confirmed by an exhaustive search of the whole API source tree. It is also **missing from the HRMS frontend's own TypeScript `AttendanceStatus` type** (8 of the schema's 9 values are listed there; `HOLIDAY` is the omitted one), so even if it were ever written directly to the database, the admin UI has no badge style or filter for it.
- There is **no weekly-off / rest-day concept at all** — no field on `Employee` or `Branch` designates a non-working day of the week. The attendance schedulers treat every calendar day identically: an employee on a shift will be auto-marked `UNMARKED` → `UNINFORMED_ABSENT` on what should be their day off, unless someone manually pre-marks that date as leave.
- Consequently: "what happens if someone works on a holiday," "extra duty on a holiday," "holiday payroll effect," and "reliever behavior on a holiday" are all **not applicable** — the system has no way to know a given date is a holiday in the first place.

---

## PART 14 — Payroll ("Stipend") Module

### 14.1 What triggers generation
There is **no automatic cron that generates `PayrollEntry` rows.** Generation is always: (a) HR's "Generate Entries" bulk action in the Payroll page (loops one `POST /payroll/entries` call per eligible employee — not a true server-side bulk endpoint), (b) a single "Add entry for employee" dialog, or (c) implicitly, the first time an attendance-discipline event, an incentive, or an overtime application needs a `PayrollEntry` that doesn't exist yet.

**Eligibility:** by default only `ACTIVE`/`ON_REST` employees get entries; HR can force-generate for others (e.g., an approved-but-still-suspended employee) by supplying `allowNonActive: true` + a written `approvalReason`, which is audit-logged and flags the entry `forcedNonActive: true` so it stays visible in listings regardless of the employee's live status. 🔴 Note: the Stipend Receipts and Incentives modules each use their own, **slightly different** eligible-status lists (`[ACTIVE, APPOINTED]`) than Payroll's own default (`[ACTIVE, ON_REST]`) — three overlapping-but-different definitions of "eligible employee" coexist.

**Idempotency:** unique on `[stipendRecordId, month, year]`. A `PENDING` entry is **fully recomputed from scratch every time it's read or re-generated**; only `PROCESSED`/`PAID` entries are frozen.

### 14.2 Exact net stipend formula (as implemented, `payroll-hours.util.ts`)
```
hourlyRate = contractualBasicStipend / (dailyDutyHours × daysInMonth)

payableMinutes = minutesActuallyWorkedInsideDutyWindow
                + (paidLeaveDays × dailyDutyMinutes)      ← first N leave days in the month,
                                                              N = floor(Employee.monthlyAllowedLeaves);
                                                              unlimited-paid if that field is null
                + (shortLeaveHalfDays × dailyDutyMinutes / 2)

hourlyBasicEarned = round( (payableMinutes / 60) × hourlyRate )

fixedAllowances         = StipendRecord.(allowances + reward + progressReward + fuelAllowance)
fixedPackageDeductions  = StipendRecord.(loanDeduction + advanceDeduction + fineDeduction + healthDeduction)
extraAllowances         = Σ Allowance rows        (OVERTIME, ADDITIONAL_WORKING_DAYS, CUSTOM)
disciplineDeductions    = Σ PayrollDeduction rows (LATE_ARRIVAL, UNINFORMED_ABSENCE, UNPAID_LEAVE, OTHER)

basicStipend    = max(0, hourlyBasicEarned)
totalAllowances = max(0, fixedAllowances + extraAllowances)
totalDeductions = max(0, fixedPackageDeductions + disciplineDeductions)
netStipend      = basicStipend + totalAllowances − totalDeductions
```
Worked example: see Part 10.

The four "package" fields (`loanDeduction, advanceDeduction, fineDeduction, healthDeduction`) are **static numbers HR types directly into the Stipend Increment form** — applied identically every single month until manually changed. They are **not** derived from anything else in the system (see 14.4 for the loan disconnect).

### 14.3 Deduction/allowance sources traced to origin

| Line item | Auto-created by | Notes |
|---|---|---|
| `LATE_ARRIVAL` deduction | Attendance discipline rules | 3rd/6th/9th-occurrence only (Part 10) |
| `UNINFORMED_ABSENCE` deduction | Attendance discipline rules | Every occurrence |
| `UNPAID_LEAVE` deduction | Payroll itself, from `ON_LEAVE` attendance rows beyond `monthlyAllowedLeaves` | Recomputed every generation |
| `DISCIPLINARY_FINE` deduction | 🔴 **Nothing** — never auto-created anywhere | Must be entered manually via generic "Add Deduction" |
| `OVERTIME` allowance | HR clicking "Apply Overtime" (`hours × hourlyRate`) | Manual approval step, clears attendance's `overtimePending` flag |
| `ADDITIONAL_WORKING_DAYS` allowance | Payroll, from `AdditionalWorkingDay` rows (incl. closed reliever sessions) | Also the *de facto* reliever-pay mechanism (Part 12) |
| `CUSTOM` allowance | Incentives module, one row per `Incentive` added by HR | Deleted by fragile description-string matching, not a foreign key |
| `RELIEVER` allowance | 🔴 **Never created anywhere** — dead enum value | |

### 14.4 Advance/Loan — 🟠 disconnected from payroll, no admin approval UI
The request → approve/reject workflow (`AdvanceLoanRequest`) is functionally complete on both ends for the **employee**: Portal has a working "New Request"/"My Requests" flow, and computes an "estimated monthly deduction" preview for loans. But:
- **`monthlyDeduction`, once computed on approval, is never read anywhere else in the codebase** — not by Payroll, not by any scheduler. There is no repayment-balance tracking at all (no "how much is left to repay" concept exists). HR must manually replicate the number into the unrelated static `StipendRecord.loanDeduction`/`advanceDeduction` fields every month by hand.
- 🟠 **No HRMS admin screen exists to approve or reject these requests** at all, despite the backend fully supporting it (`PATCH /advance-loan/:id/approve|reject`) — the only HRMS-side view is a **read-only** table embedded in the employee's profile page. The frontend API client even has `approve()`/`reject()` functions defined, but nothing in the app calls them (and the `reject()` function's payload key doesn't match what the backend expects, which would break immediately if it were ever wired up).

### 14.5 Approval / lock mechanism
`PENDING → PROCESSED → PAID`, one-directional only (`PENDING → PAID` directly is rejected; nothing can move backward). Once `PROCESSED`/`PAID`, manual deduction/allowance/overtime edits are explicitly blocked by the service. 🔴 **However, attendance-triggered automatic deductions (late/absence) bypass this lock entirely** — they write directly to the `PayrollEntry` totals with no status check, so a late/absence event occurring after an entry is already `PROCESSED` still silently posts against it.

### 14.6 Payslip / receipt workflow
No PDF library is used for payslips specifically — the on-screen payslip is rendered as a React component and printed via the browser's own print-to-PDF (`window.print()`); a separate bulk Excel export exists for whole-branch reports (`exceljs`). Several printed line items (`providentFund`, `tax`, `auditDifference`) are **always hardcoded to zero** — inherited from a legacy paper-slip layout, not computed from any real data.

A **payslip acceptance workflow** (`StipendReceipt`) runs alongside: receipts are generated monthly (cron, 3rd of the month) or manually, employees have **48 hours** to Accept/Reject in the Portal, and unanswered receipts are **auto-accepted** by the hourly cron once the deadline passes.

### 14.7 Finance module
`apps/api/src/modules/finance` is a confirmed, explicitly-labeled **scaffold** ("Domain logic... will land here") — two read-only stub endpoints, no models, no write paths, no frontend page anywhere. All actual money movement lives in Payroll/Stipend-Receipts/Incentives/Advance-Loan instead.

---

## PART 15 — Warning Letter / HR Letter System

### 15.1 Coverage
17 `LetterType` values, 16 backed by seeded **bilingual (Urdu-primary) Handlebars templates** plus one English selection/appointment letter: `APPOINTMENT, WARNING, ADVICE, DISCIPLINARY, EXPLANATION, SHOW_CAUSE, FINE, INQUIRY, APPRECIATION, TRANSFER, SUSPENSION, TERMINATION, REINSTATEMENT, REJOINING, SALARY_INCREMENT, EXPERIENCE, EXPLANATION_FINE, CUSTOM`.

### 15.2 Generation & PDF
Letters are generated by HR (`SUPER_ADMIN, HR_MANAGER, ADMIN_MANAGER, ADMIN_OFFICER`, scope-checked) through a 4-step wizard with a distinct **Preview** step (no letter number consumed) before **Issue** (which consumes a global sequential number, formatted `{n}/YCDO/{year}`, plus a human-readable ref like `HRMS/WRN/456`). Variables are merged from the employee record and HR-typed fields, with automatic Urdu transliteration/translation helpers for name/designation/branch. PDFs are rendered with **Puppeteer** (headless Chromium) from the final HTML, stored on Cloudinary (falling back to local disk), and can be **regenerated on the fly** if the stored file goes missing.

### 15.3 Letter Template Designer — ✅ fully implemented
`IT_ADMIN`/`SUPER_ADMIN` can live-edit the wording of every built-in template (bumping a version number, audit-logged) and create/soft-delete entirely custom templates with their own dynamic field schema, through a real rich-text bilingual editor with live preview — not a stub.

### 15.4 Automatic letter issuance (outside the manual wizard)
A second, fully independent pathway auto-issues letters from inside attendance discipline logic (3rd/6th late → Warning #1/#2; 9th late or &gt;2 uninformed absences/month → Suspension) — see Part 10. 🔴 **These auto-issued letters never create a matching `DisciplinaryAction` record**, so they're invisible on the Disciplinary Actions screen and are never audit-logged (system-actor letter generation explicitly skips the audit log).

### 15.5 Show Cause escalation
A Show Cause letter carries a hardcoded **48-hour reply deadline**. The hourly cron auto-suspends the employee if unreplied (creates a `DisciplinaryAction`, suspends, deactivates login) — but 🔴 **issues no letter and no WhatsApp/notification to the employee** about this specific suspension, unlike the attendance-driven suspension path which does generate a letter. Two different "suspend the employee" flows exist with inconsistent side effects (a third exists via manually creating a `SUSPENSION` disciplinary action, which creates a letter but does **not** deactivate the login) — three genuinely different combinations of consequences for the same nominal action.

### 15.6 WhatsApp delivery
Automatic: every generated letter's PDF is uploaded and sent via the **Meta WhatsApp Business Cloud API** (a pre-approved message template, `employee_letter_issued` by default) immediately after generation — best-effort, failures only logged (never block the letter itself). Manual fallback: a `wa.me` deep-link flow where HR downloads the PDF and attaches it by hand in WhatsApp Web, then self-confirms "sent" (trust-based, no delivery verification, unlike the Meta path's real message-ID tracking). The Meta webhook only processes `failed` delivery callbacks — `sent`/`delivered`/`read` events are received but never persisted, so a message's stored status can go stale.

### 15.7 Acknowledgement
Employees must tick a confirmation checkbox to acknowledge certain letter types (`WARNING, SHOW_CAUSE, SUSPENSION, TERMINATION, FINE, DISCIPLINARY, EXPLANATION, EXPLANATION_FINE, APPOINTMENT` — `CUSTOM` letters never require it, regardless of content). The acknowledgement captures the employee's IP address and is written to the audit log.

### 15.8 Email
There is **no employee-facing email channel anywhere in the system.** SMTP/Nodemailer exists solely to deliver the Super Admin's login OTP.

---

## PART 16 — Notifications

All notifications are **in-app only** (a `Notification` row per employee, shown as a bell-icon badge) — there is no push/SMS channel, and the only external channel used for anything is WhatsApp (letters only, Part 15). Every trigger below fires automatically as a side effect inside the relevant module's own transaction (there is no shared "NotificationsService.create()" — each module writes `Notification` rows directly):

Leave submitted/approved/rejected/reliever-requested/reliever-auto-rejected · attendance uninformed-absent · late-warning · absence-deduction · disciplinary action created/inquiry started/resolved/dismissed · letter issued · show-cause reply received/escalated · letter acknowledged · branch-change (outstation) submitted/status-changed · advance/loan requested/approved/rejected · incentive added · stipend receipt generated/rejected · resignation/promotion · new account created (recruitment) · salary increment · admin broadcast · manual "reminder" (the one manually-triggered type, used for nudging unacknowledged/unreplied letters).

🔵 **In the HRMS admin app specifically, notifications are only a decorative count badge** — the bell icon has no click handler, there is no inbox/list route anywhere, and `getAll`/`markRead`/`markAllRead` are defined in the API client but never called from any screen. The Portal app, by contrast, has a fully working notifications dropdown (mark read/unread, mark all read).

---

## PART 17 — Dashboards

`DashboardPage.tsx` (HRMS) is a single route that renders a different, role-specific dashboard component, all real/query-backed (no mock data found in any of them):

| Dashboard | Roles | Content |
|---|---|---|
| Generic Admin | HR_EXECUTIVE, HR_MANAGER, HR_ADMIN_MANAGER, SUPER_ADMIN, etc. | Org-wide KPI tiles (present/absent/late/uninformed-absent/on-leave/relievers today, pending leave, open disciplinary cases, pending applications), recent-employees/recent-leave tables |
| Branch Manager (`AdminManagerDashboard`) | ADMIN_MANAGER | Same tiles scoped to the manager's own branch, plus a personal audit-log feed |
| Department Incharge (`DeptInchargeDashboard`) | ADMIN_OFFICER | Pending department-stage leave approvals with inline approve/reject and reliever assignment |
| HR Operations (`HrOperationsDashboard`) | HR_OPERATIONS_MANAGER | Final-stage leave approval queue, monthly approve/reject counts |
| Executive (`ExecutiveDashboard`) | CHAIRMAN/FOUNDER/PRESIDENT | Org KPIs, **pending onboarding approvals** (their primary function), recent leave decisions, branch headcount |
| Medicine Manager | MEDICINE_MANAGER | Same attendance tiles, scoped to the Medicine department only; explicit "you cannot add/edit employees" notice |
| IT Admin (`ItAdminDashboard`) | IT_ADMIN | A full embedded org-setup console (Projects/Branches/Abbreviations/Departments/Designations/Employees/System Logins/Biometric IDs/Devices/Face Sync tabs) — 2,256 lines, genuinely complete CRUD, not a shell |
| 🔵 Dead code — `BranchManagerDashboard.tsx` | — | A complete, working alternate branch-manager dashboard that is **never imported or rendered anywhere** — `ADMIN_MANAGER` actually renders `AdminManagerDashboard` instead. Orphaned. |

Portal dashboards similarly branch by role: a regular employee gets stat cards + quick actions + recent notifications; a pure executive (no linked employee record) gets an approvals-only screen; `ADMIN_MANAGER` gets an intentional stub redirecting them to use HRMS instead.

---

## PART 18 — Reports

`ReportsPage.tsx` (HRMS, `/reports`) presents **13 report types** as a card grid, each opening a shared modal with real filters, a live backend fetch (not mock rows), and both **CSV export** (client-generated from the fetched dataset) and **Print**: Employee Master, Employee Status, Training Staff, Appointed Staff, Daily Attendance, Monthly Attendance, Late Arrival, Absent Report, Leave Report, Branch Change Request Report, District Summary, Branch-wise Employee, Department-wise Employee. District Summary additionally renders a hand-rolled CSS conic-gradient pie chart. All confirmed to pull genuinely live, filtered data — nothing decorative was found here. Payroll has its own separate bulk **Excel** export (`exceljs`, one worksheet per employee, branch/month-scoped).

---

## PART 19 — Search, Filters & Exports

- Search/filter inputs across the app (employees, attendance, leave, payroll, letters, reports) genuinely send their values to the backend as real query parameters — confirmed not decorative.
- 🟡 **Pagination is a hybrid**: filters reach the server, but the *page-slicing* itself happens client-side after fetching the full filtered result set (fixed batches of 20). This is a legitimate approach for the organization's current data volume but is a scaling consideration to flag, not a defect.
- CSV export on report/reference screens (e.g., Biometric IDs, Reports page) is real client-side generation of the already-fetched data, not a stub.
- No screen was found in the HRMS audit where a filter control was present but silently ignored by its query — filters that exist visually do connect to real requests throughout.

---

## PART 20 — API Documentation (representative routes by module)

*Auth required = `JwtAuthGuard`; roles = `@Roles(...)` (`RolesGuard`, with `SUPER_ADMIN`/`HR_EXECUTIVE` always bypassing).*

### Auth (`/auth`)
| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /auth/login` | Public | Email+password login; `client` field separates HRMS/Portal; Super Admin gets routed into the OTP step-up instead of a token |
| `POST /auth/verify-otp` / `POST /auth/resend-otp` | Public (challenge ID) | Completes/refreshes the Super Admin OTP challenge |
| `POST /auth/register` | 🔴 **Public, unguarded** | Creates a user with any `role` including `SUPER_ADMIN` — see Part 29 |
| `GET /auth/me` | JWT | Current user + effective roles/permissions |
| `PATCH /auth/change-password` | JWT, role `EMPLOYEE` only | Self password change (unused by any frontend) |
| `PATCH /auth/reset-password` | JWT, `SUPER_ADMIN`/`IT_ADMIN` | Admin-driven reset, audit-logged |

### Attendance (`/attendance`)
| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /attendance/biometric-push` | `x-device-key` header only | Device punch ingestion (see Part 7.2 for full trace); **409** on duplicate CHECKIN, **400** on invalid CHECKOUT |
| `POST /attendance/manual` | HR/branch-admin roles | HR-entered check-in/out/status |
| `PATCH /attendance/:id` | HR/IT roles (narrower rules for branch-admin roles) | Edit a log; overtime-minute edits further restricted |
| `PATCH /attendance/:id/approve-overtime` | `SUPER_ADMIN` only | Approve pending overtime |
| `GET /attendance/timer/:employeeId` | Self (`EMPLOYEE`) | Portal live-timer widget data (incl. reliever session status) |
| `POST /attendance/reliever-sessions/check-in`\|`check-out` | HR/branch-admin roles | Manual reliever Extra-Duty punches (Part 12) |
| `POST /attendance/portal-checkin`\|`portal-checkout` | `EMPLOYEE` | 🟠 GPS self check-in — backend live, no frontend caller |
| `POST /attendance/import` | HR roles | Bulk upsert |
| `POST /attendance/backfill-absent` | `SUPER_ADMIN` | Retroactive absent-marking |

### Leave (`/leave`)
| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /leave` | `EMPLOYEE` + HR roles | Apply for leave |
| `PATCH /leave/:id/branch-approve`\|`dept-approve`\|`hr-approve` | `ADMIN_MANAGER` / `ADMIN_OFFICER` / `HR_OPERATIONS_MANAGER` respectively | The 3-stage chain (Part 11) |
| `POST /leave/emergency`\|`/verified` | HR roles | Instant-approve bypass paths |
| `POST /leave/:id/request-reliever`\|`hr-assign-reliever` | `EMPLOYEE` / HR roles | Reliever assignment |
| `PATCH /leave/reliever/:requestId/respond` | `EMPLOYEE` | Reliever accept/decline |
| `GET /leave/today-relievers` | HR/branch-admin roles | "Today's Relievers" view |

### Payroll (`/payroll`)
| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /payroll/entries` | HR/IT roles | Generate/recompute an entry (Part 14.1) |
| `POST /payroll/entries/:id/deductions`\|`allowances` | HR/IT roles | Manual line items (blocked once `PROCESSED`/`PAID`) |
| `PATCH /payroll/entries/:id/status` | `SUPER_ADMIN, HR_OPERATIONS_MANAGER, IT_ADMIN` only | `PENDING→PROCESSED→PAID` (one-way) |
| `POST /payroll/increment` | HR/IT roles | New `StipendRecord` version |
| `POST /payroll/apply-overtime` | HR/IT roles | Converts pending attendance overtime into an allowance |
| `GET /payroll/report` | Broad HR read roles | Branch-wide Excel export |

### Letters (`/letters`)
| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /letters` / `POST /letters/preview` | HR/branch-admin roles + scope check | Generate / dry-run a letter |
| `GET /letters/:id/pdf` | Scoped | Download PDF (regenerates if missing) |
| `GET /letters/pending` | HR roles | Queue of letters needing manual WhatsApp fallback |
| `PATCH /letters/templates/:id` | `SUPER_ADMIN`/`IT_ADMIN` | Template Designer edits (built-ins can be reworded but not deleted) |
| `POST /whatsapp/letter-sends/:id/resend` | HR roles | Manual retry of a failed Meta send |

### Employees / Onboarding / Separation / Recruitment
| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /employees` | HR roles + `EMPLOYEES_CREATE` permission | Full create flow (Part 5) |
| `POST /employees/:id/transfer` | `SUPER_ADMIN`/`HR_MANAGER` | Branch/dept/designation change |
| `PATCH /employees/:id/status` | `SUPER_ADMIN`/`HR_MANAGER` | Status change with guard rails |
| `DELETE /employees/:id` | `SUPER_ADMIN`/`IT_ADMIN` | Hard delete with manual cascade |
| `POST /employee-onboarding/employee/:id/physical-form` | HR roles | Scanned-form upload |
| `POST /employee-onboarding/:id/approve`\|`reject` | Targeted executive role or `SUPER_ADMIN` | Onboarding decision |
| `POST /separation/resign`\|`/promote` | `SUPER_ADMIN`/`HR_MANAGER` | 🟠 Fully built, zero frontend callers |
| `POST /recruitment/apply` | **Public, unauthenticated** | Job application intake |
| `POST /recruitment/:id/accept` | `SUPER_ADMIN`/`HR_MANAGER` | Creates the actual `Employee` record |
| `POST /recruitment/:id/convert` | `SUPER_ADMIN`/`HR_MANAGER` | 🔴 Named "convert to employee" but does nothing except return a preview payload — vestigial |

---

## PART 21 — Database Documentation

*(Field lists are illustrative of key columns, not exhaustive; full detail is in `apps/api/prisma/schema.prisma`.)*

| Model | Purpose | Key fields | Notable constraints |
|---|---|---|---|
| `Project` | Top-level org unit (Hospital/VTI/Kitchen/Software House) | `type` (enum) | |
| `Branch` | Physical/operational site | `projectId?`, `abbreviation`, `sortOrder` | |
| `Department` / `Designation` | Global catalogs | `isActive`, `isDeleted`, `sortOrder` | Upsert-by-name; delete un-assigns employees rather than blocking |
| `Employee` | Core HR record | `employeeCode` (unique), `cnic` (unique, optional), `biometricId` (unique, optional), `status` (10-value enum), `staffType`, `relieverOnly`, `dutyStartTime/EndTime/TotalHours`, `monthlyAllowedLeaves` | |
| `EmploymentHistory` | Career trail | `changeType` (JOINED/TRANSFERRED/PROMOTED/DEMOTED/REINSTATED/REJOINED) | |
| `EmployeeOnboardingApproval` | New-hire executive approval | `approverTarget`, `status`, `formSnapshot` (Json), `physicalFormUrl` | 1:1 with Employee |
| `AttendanceLog` | Daily attendance | `date`, `type` (REGULAR/OVERTIME), `checkIn/checkOut`, `status` (9-value enum), `lateMinutes`, `overtimeMinutes`, `overtimePending`, `source` (BIOMETRIC/MANUAL) | `@@unique([employeeId, date, type])` |
| `PortalAttendance` | GPS check-in audit trail (separate from `AttendanceLog`) | `latitude/longitude`, `verified` | Currently write-reachable only via a dormant frontend feature |
| `BranchLocation` | Geofence per branch | `latitude/longitude/radius` (default 200) | No admin UI to manage it |
| `RelieverSession` | Reliever clocked hours | `checkIn/checkOut`, `totalMinutes` | Separate from `AttendanceLog` |
| `MutualSwap` | Shift-swap-for-a-day between two employees | `status` (plain `String`, not an enum!) | No DB constraint on valid status values |
| `Shift` | Duty-time template | `branchId?` (nullable but effectively unused — Part 9) | `@@unique([name, startTime, endTime])` |
| `LeaveRecord` | Leave applications | `status` (9-value enum), `currentStage` (3-value enum) | |
| `LeaveApproval` | Per-stage audit trail | `stage`, `action` | |
| `RelieverRequest` | Reliever assignment | `status` (PENDING/ACCEPTED/REJECTED/AUTO_REJECTED/HR_ASSIGNED) | `@@unique` per `leaveRecordId` |
| `StipendRecord` | An employee's pay package, versioned | `basicStipend`, `allowances/reward/progressReward/fuelAllowance`, `loanDeduction/advanceDeduction/fineDeduction/healthDeduction`, `effectiveFrom/To` | |
| `PayrollEntry` | Monthly computed payroll | `status` (PENDING/PROCESSED/PAID), `forcedNonActive` | `@@unique([stipendRecordId, month, year])` |
| `Allowance` / `PayrollDeduction` | Line items on an entry | `type`/`reason` enums | |
| `StipendReceipt` | Payslip acceptance | `status` (PENDING/ACCEPTED/REJECTED/AUTO_ACCEPTED), `deadlineAt` | |
| `Incentive` | Manual bonus | `month/year` | |
| `AdditionalWorkingDay` | Extra duty days (incl. reliever payout mechanism) | `date`, `note` | `@@unique([employeeId, date])` |
| `AdvanceLoanRequest` | Loan/advance request | `status` (plain `String`), `monthlyDeduction` | Never read by Payroll |
| `DisciplinaryAction` / `Inquiry` | Formal discipline case | `type`, `status`, `deadlineAt` (Inquiry — not scheduler-enforced) | |
| `LetterTemplate` / `Letter` | Bilingual letter templates and issued letters | `letterNo` (unique, sequential), `requiresAcknowledgement`, `autoEscalated`, `whatsappSharedAt` | |
| `WhatsAppLetterSend` | Delivery tracking | `status` (PENDING/SENT/FAILED/SKIPPED), `metaMessageId` | `@@unique` per letter |
| `LetterReply` / `AllegationAcknowledgement` | Employee responses | `ipAddress` captured on acknowledgement | |
| `User` | Login account | `role` (15-value enum), `employeeId?` (unique, nullable — system accounts have none) | |
| `UserPassword` | 🔴 Plaintext password mirror | `plainText` | By design (Part 4) |
| `UserPermission` | Per-user permission override | `permission`, `granted` | `@@unique([userId, permission])` |
| `UserAdditionalRole` | Multi-role grant | — | Write path dead (Part 3.2) |
| `UserManagerScope` | Hospital dept/designation scoping | `projectId, departmentId, designationId?` | |
| `LoginOtpChallenge` | Super Admin OTP | `codeHash`, `expiresAt` | |
| `Notification` / `NotificationBroadcast` | In-app messaging | `type` (free string, ~35 distinct values observed in code) | |
| `AuditLog` | Generic audit trail | `action`, `entity`, `changes` (Json) | Coverage is partial — see Part 29 |
| `JobApplication` | Recruitment pipeline | `status` (5-value enum) | No `gender` field (Part 29) |
| `BranchChangeRequest` | "Outstation" travel/duty-location request | `status` (OutstationStatus) | Backend module still named `outstation` |
| `LocationValue` | Province/city/district reference data | `type`, `value` | `@@unique([type, value])` |

**Core relationship chain:**
```
Project → Branch → Department/Designation → Employee
Employee → User (0..1 login) → UserPermission / UserAdditionalRole / UserManagerScope
Employee → StipendRecord → PayrollEntry → Allowance / PayrollDeduction / StipendReceipt
Employee → AttendanceLog (many) ; Employee → RelieverSession (many, as reliever)
Employee → LeaveRecord → LeaveApproval (many) ; LeaveRecord → RelieverRequest (0..1)
Employee → Letter (many) → LetterReply / AllegationAcknowledgement / WhatsAppLetterSend
Employee → DisciplinaryAction (many) → Inquiry (0..1)
```

---

## PART 22 — Cron Jobs / Automatic Processes

Fully covered in Part 2.3. Summary of failure/duplicate-protection behavior: every scheduler queries by a specific status filter (e.g., `PENDING`, `checkOut: null`) so a record that's already been processed simply won't be picked up again on the next run — none of the five jobs use an explicit distributed lock or idempotency key beyond that status-based filtering, which is adequate given they run sequentially within a single process. None of the jobs have alerting on failure beyond server logs; a silently-failing cron tick would not notify anyone.

---

## PART 23 — Current HRMS Business Rules (consolidated)

**Attendance:** One attendance record per employee per date per type (`REGULAR`/`OVERTIME`), enforced by a database unique constraint. A punch more than 15 minutes past duty start is Late; more than 60 minutes past is escalated to Half Day. Overtime only starts accruing 60 minutes after duty end. No check-in exists before check-out is possible. Employees on 24-hour shifts never get late/half-day/uninformed-absent logic. Attendance is created lazily/by cron, never fully pre-generated for a future date.

**Leave:** Leave requires 48 hours' notice (regular leave only). A reliever is optional in practice, not enforced as mandatory. Only `PENDING` leave requests can be cancelled. Leave only touches attendance once it reaches full `APPROVED`.

**Reliever:** A reliever's coverage hours are tracked separately from their normal attendance. No system check prevents double-booking a reliever or assigning someone who is themself on leave.

**Payroll:** Stipend is computed hourly from actual attendance, not a flat monthly salary. The first N leave days per month (N = the employee's personal allowance) are paid; the rest are deducted at the daily rate. A `PROCESSED`/`PAID` entry cannot be manually edited (though automatic discipline deductions can still post to it).

**Discipline:** Lateness is only fined on the 3rd/6th/9th occurrence per month; every uninformed absence is fined. Nine late occurrences or three uninformed absences in a month auto-suspends the employee.

**Permissions:** `SUPER_ADMIN` and `HR_EXECUTIVE` bypass essentially every guard in the system. Permissions are role-defaulted but overridable per individual login.

**Org structure:** Departments and Designations are shared, global catalogs, not owned by one branch.

---

## PART 24 — Validation Matrix (representative)

| Field | Module | Required? | Backend check | Frontend check | Notes |
|---|---|---|---|---|---|
| `email` (login) | Auth | Yes | `@IsEmail` | Zod email format | |
| `password` (login) | Auth | Yes | `@MinLength(6)` | Zod min 6 | |
| `role` (register) | Auth | Yes | `@IsEnum(UserRole)` only | N/A — no UI uses this route | 🔴 No authorization check at all |
| `cnic` | Employee | No | Regex format, unique if present | Regex format | Optional both sides |
| `basicStipend` | Employee create | Yes | Numeric | Numeric | |
| `startDate`/`endDate` | Leave apply | Yes | Date range, ≥48h for REGULAR, overlap check | Date range, zod | |
| `reason` (rejection) | Onboarding reject | Yes | `@MinLength(5)` | Enforced in dialog | |
| `rejectionReason` (stipend receipt) | Portal | Yes | Non-empty (`.trim()`) | 🔴 Frontend requires ≥10 chars, backend only requires non-empty | Frontend stricter than backend |
| `reason` (advance/loan reject) | HRMS (unused) | Yes | Body key `rejectionReason` | Frontend client sends `reason` | 🔴 Would break if ever wired up (Part 14.4) |
| Attendance edit — mark-only roles | Attendance | — | 403 outside 15-min grace window, and outside "first checkout only" once already marked | Mirrored client-side | Consistent |
| Overtime minutes edit | Attendance | — | Restricted to `FULL_ATTENDANCE_EDIT_ROLES` regardless of general edit access | Mirrored | Consistent |
| Physical form upload | Onboarding | Only while `PENDING` | Enforced | Enforced | |

---

## PART 25 — Status & Enum Reference (exact values from code)

**`AttendanceStatus`**: `PRESENT, ABSENT, UNMARKED, LATE, HALF_DAY, ON_LEAVE, HOLIDAY (dead), UNINFORMED_ABSENT, SWAP_COVERED`

**`AttendanceSource`**: `BIOMETRIC, MANUAL`

**`EmployeeStatus`**: `TRAINEE, ACTIVE, APPOINTED, SUSPENDED, TERMINATED, RESIGNED, DISMISSED, ON_LEAVE, ON_REST, PENDING_APPROVAL`

**`LeaveStatus`**: `PENDING, BRANCH_APPROVED, DEPT_APPROVED, RELIEVER_PENDING, RELIEVER_CONFIRMED, RELIEVER_REJECTED, HR_PENDING, APPROVED, REJECTED, CANCELLED`

**`LeaveApprovalStage`**: `BRANCH_MANAGER, DEPARTMENT_INCHARGE, HR_OPERATIONS`

**`RelieverRequestStatus`**: `PENDING, ACCEPTED, REJECTED, AUTO_REJECTED, HR_ASSIGNED`

**`PayrollStatus`**: `PENDING, PROCESSED, PAID` (one-directional transitions only)

**`StipendStatus`** (receipts): `PENDING, ACCEPTED, REJECTED, AUTO_ACCEPTED`

**`DisciplinaryType`**: `WARNING, SHOW_CAUSE, FINE, SUSPENSION, TERMINATION` · **`DisciplinaryStatus`**: `OPEN, UNDER_INQUIRY, RESOLVED, DISMISSED` · **`InquiryOutcome`**: `REINSTATED, TERMINATED, REJOINED, DISMISSED`

**`LetterType`** (17 values): `APPOINTMENT, WARNING, ADVICE, DISCIPLINARY, EXPLANATION, SHOW_CAUSE, FINE, INQUIRY, APPRECIATION, TRANSFER, SUSPENSION, TERMINATION, REINSTATEMENT, REJOINING, SALARY_INCREMENT, EXPERIENCE, EXPLANATION_FINE, CUSTOM`

**`WhatsAppSendStatus`**: `PENDING, SENT, FAILED, SKIPPED`

**`UserRole`** (15 values): see Part 3.1 · **`Permission`** (14 values): see Part 3.2

**`ProjectType`**: `HOSPITAL, VTI, KITCHEN, SOFTWARE_HOUSE`

**`ChangeType`** (employment history): `JOINED, TRANSFERRED, PROMOTED, DEMOTED, REINSTATED, REJOINED`

**`ApplicationStatus`** (recruitment): `APPLIED, SHORTLISTED, INTERVIEW_SCHEDULED, SELECTED, REJECTED` (terminal at `REJECTED`)

**`DeductionType`**: `LATE_ARRIVAL, UNINFORMED_ABSENCE, DISCIPLINARY_FINE (never auto-set), UNPAID_LEAVE, OTHER`

**`AllowanceType`**: `OVERTIME, RELIEVER (dead), CUSTOM, ADDITIONAL_WORKING_DAYS`

---

## PART 26 — Complete Software Workflows (as actually implemented)

**Workflow 1 — New Employee**
HR fills the 3-step create wizard → chooses branch/department/designation/shift → (if `staffType: NEW`) picks an executive approver → submits → system creates Employee (status `PENDING_APPROVAL` or `ACTIVE`), a login, a StipendRecord, auto-assigns a biometric ID → if approval was required, the targeted executive reviews via the **Portal app** → approve reactivates the login, sets `ACTIVE`, and auto-issues the Appointment letter.

**Workflow 2 — Daily Attendance**
Shift start time passes → cron creates an `UNMARKED` placeholder (unless the employee is on approved leave) → biometric punch arrives → server matches employee by biometric ID → resolves CHECKIN/CHECKOUT/AUTO → computes late minutes against the employee's individual duty window (15-min grace) → status set (`PRESENT`/`LATE`) and discipline rules run in the same transaction (possible fine/warning/auto-suspend) → checkout later computes overtime (60-min grace) → if still unpunched 3 hours after shift start, cron escalates to `UNINFORMED_ABSENT` with its own deduction/possible auto-suspend.

**Workflow 3 — Leave**
Employee (or HR on their behalf) applies → Branch Manager approves → Department Incharge approves (optionally routing through reliever request/accept) → HR Operations gives final approval → **only now** does the system write `ON_LEAVE`/`HALF_DAY` into `AttendanceLog` for the date range → Payroll later reads those rows to decide paid vs. unpaid based on the employee's monthly allowance.

**Workflow 4 — Payroll**
HR triggers "Generate Entries" for the month → for each employee: sum in-window worked minutes from `AttendanceLog` + paid leave minutes → hourly rate × payable hours = basic earned → add fixed package allowances/deductions + any ad-hoc allowance/deduction rows already posted by discipline/incentive/overtime events → `netStipend` → HR reviews, marks `PROCESSED` (freezing the calculation) then `PAID` → a StipendReceipt is generated (cron or manual) for the employee to accept within 48 hours (auto-accepted if they don't respond).

**Workflow 5 — Reliever**
Employee applies for leave, optionally naming a preferred reliever at Department-approval time → reliever gets 8 hours to accept/decline (or HR force-assigns, no accept step) → once the leave is fully `APPROVED`, HR manually punches the reliever's Extra-Duty session in/out on the Attendance page's Reliever tab (separate from the reliever's own normal attendance) → closing that session upserts an `AdditionalWorkingDay` row → Payroll converts those days into an allowance at the employee's hourly rate.

---

## PART 27 — Screen-by-Screen Documentation

*(Full per-screen detail — route, fields, buttons, exact API calls, and status — was compiled in depth for both apps during this analysis; summarized here by module. All routes below are real, registered routes with no dead sidebar links found in either app.)*

### HRMS admin app (`apps/hrms`) — 34 routes
Every module screen (Employees list/create/profile, Biometric IDs, Attendance [4 tabs], Leave, Branch Change Requests, Incentives, Payroll [4 tabs], Reports [13 report types], Letters [+ Template Designer], Failed WhatsApp, Disciplinary [Actions + Inquiries], Recruitment [3 stages], Broadcasts, Branches/Projects, Branch Contacts, Login Access, Roles Management, Master Data, Employee/System Logins, Activity Trail, Shifts, Rule Book, Profile Settings) is **✅ Fully implemented** with real, correctly-typed API calls and no mock data — this was the reviewing agent's explicit overall conclusion after examining every page and every API client file.

The few real gaps found were narrow and specific: a dead/orphaned `BranchManagerDashboard.tsx` component (Part 17); two coded-but-unreachable tabs inside the IT Admin dashboard (Shifts and Location Values — both fully duplicated by their own standalone routes, so no functionality is actually lost); a header notification bell with no click handler and no inbox page (🔵 UI only); two permanently-disabled header dropdown items ("Profile"/"Change Password" — a working Profile page exists elsewhere via the sidebar, but no working Change Password screen exists anywhere in this app); and most module routes lacking a page-level role redirect (relying on backend 403s alone) except for Master Data, Roles Management, Letter Templates, Broadcasts, and Activity Trail, which do self-guard.

### Employee Portal (`apps/portal`) — 12 routes, also an Android/iOS app
Login, Dashboard (role-branched), My Attendance (read-only — see below), My Leave (apply/cancel/reliever respond, ✅), My Payroll (stipend receipts, payslip view/print, incentives, ✅), My Letters (view/reply/acknowledge/download, ✅), Branch Change Request (✅), Advance & Loan (✅ for submit/track; no rejection-reason detail shown to the employee), My Profile (✅ for the intentionally-limited self-editable fields; most HR data is correctly read-only here by design).

🟠 **My Attendance** is fully implemented as a **read-only** tracking screen (log, monthly summary, reliever-session history, a live "on duty" timer) — but, as detailed in Part 7.6, there is **no check-in/check-out control anywhere in this app**. This is the single most significant frontend finding in the Portal: the feature was built, then deliberately removed, leaving working read-side screens with no corresponding write-side action.

---

## PART 28 — Implementation Status Matrix

| Feature | Frontend | Backend | Database | API | Status | Notes |
|---|---|---|---|---|---|---|
| Biometric attendance | Yes (device agent) | Yes | Yes | Yes | ✅ Implemented | Three inconsistent late/half-day formulas across channels (Part 7.3) |
| Portal GPS self check-in | **No** | Yes | Yes | Yes | 🟠 Backend exists / frontend not connected | Deliberately removed from UI; no admin UI to configure geofences either |
| Manual attendance marking (HR) | Yes | Yes | Yes | Yes | ✅ Implemented | Grace-window + "first checkout only" rules for branch-admin roles |
| Reliever assignment | Yes | Yes | Yes | Yes | 🟡 Partial | No double-booking or own-leave conflict checks; dead `RELIEVER` allowance type |
| Leave 3-stage approval | Yes | Yes | Yes | Yes | ✅ Implemented | Reliever not actually enforced as mandatory; deprecated bypass route still live |
| Holiday / weekly-off | No | No | Enum value only, unused | No | 🔴 Not implemented | No model, no logic anywhere |
| Stipend/payroll generation | Yes | Yes | Yes | Yes | ✅ Implemented | Real hourly-prorated, unit-tested formula |
| Disciplinary fine → payroll | Yes (manual only) | No (automatic) | Enum exists, never auto-set | Manual deduction endpoint only | 🔴 Gap | HR must manually re-enter the fine amount |
| Advance/Loan employee request | Yes | Yes | Yes | Yes | ✅ Implemented (request side) | |
| Advance/Loan HR approval | 🔴 Read-only view only | Yes (full) | Yes | Yes | 🟠 Backend exists / frontend not connected | No approve/reject screen anywhere |
| Advance/Loan → payroll effect | N/A | **No** | `monthlyDeduction` stored but unread | N/A | 🔴 Not implemented | HR must manually replicate the deduction |
| Separation (resign/promote workflow) | **No** | Yes (full, with letters) | Yes | Yes | 🟠 Backend exists / frontend not connected | HR uses generic status-change instead |
| Recruitment → employee conversion | Partial (via Accept) | `convert` endpoint is vestigial | Yes | Yes | 🔴 Naming/logic conflict | Real creation happens in `accept`, not `convert` |
| Bilingual HR letters + PDF | Yes | Yes | Yes | Yes | ✅ Implemented | |
| Letter Template Designer | Yes | Yes | Yes | Yes | ✅ Implemented | |
| WhatsApp letter delivery | Yes (auto + manual fallback) | Yes | Yes | Yes | ✅ Implemented | Webhook only tracks `failed`, not `sent`/`delivered`/`read` |
| In-app notifications (Portal) | Yes | Yes | Yes | Yes | ✅ Implemented | |
| In-app notifications (HRMS) | 🔵 Count badge only | Yes | Yes | Yes | 🔵 UI only / not fully implemented | No inbox, bell has no click handler |
| Self password change | **No screen anywhere** | Yes | Yes | Yes | 🟠 Backend exists / frontend not connected | |
| `POST /auth/register` | Not used by any frontend | Yes, unauthenticated | Yes | Yes | 🔴 Security gap | Accepts arbitrary role including SUPER_ADMIN |
| Branch-specific shifts | Yes (UI implies it) | **No** (ignored server-side) | Field exists | Field exists | 🔴 Conflict | All shifts are forced global regardless of input |
| Multi-role users (`UserAdditionalRole`) | Read-only consumption | Read yes, **write discarded** | Yes | Partial | 🟡 Partial | No UI/API path actually creates these rows |

---

## PART 29 — Bugs, Risks & Logic Conflicts

**1. Unauthenticated account registration with arbitrary role — `POST /auth/register`**
- **Current behavior:** any HTTP client can create a fully-functional login with `role: 'SUPER_ADMIN'` and no authentication.
- **Why it happens:** `AuthController.register()` has no `@UseGuards(...)` at all, and `RegisterDto.role` only validates that the string is a member of the `UserRole` enum — it never restricts which roles are self-assignable.
- **Affected files:** `apps/api/src/modules/auth/auth.controller.ts`, `auth.dto.ts`, `auth.service.ts`.
- **Business impact:** complete authentication bypass for anyone who can reach the API. No frontend currently calls this route, which is the only reason it hasn't surfaced as an incident — it is reachable directly regardless.
- **Severity: Critical**

**2. Three inconsistent late/half-day calculation formulas across attendance channels**
- **Current behavior:** the same lateness can be classified differently depending on whether it was recorded via biometric, manual HR entry, or the (currently unused) portal check-in path.
- **Why it happens:** three separate utility functions (`assessCheckIn`/`statusFromLateMinutes`, `determineBiometricCheckInStatus`, `determineCheckInStatus`) implement different thresholds (fixed 60-min half-day cutoff vs. shift-midpoint cutoff) and were evidently written independently over time.
- **Affected files:** `apps/api/src/common/duty.util.ts`, `apps/api/src/modules/attendance/attendance-biometric.util.ts`, `apps/api/src/modules/attendance/shift-time.util.ts`, `attendance.service.ts` (`determineCheckInStatus`, `calculateOvertimeMinutes`).
- **Business impact:** inconsistent pay/discipline outcomes for functionally identical lateness depending purely on which entry method was used; a client demo comparing two employees' records side by side could expose this.
- **Severity: High**

**3. Disciplinary fines never create a payroll deduction automatically**
- **Current behavior:** issuing a `FINE` disciplinary action or letter has zero automatic effect on any employee's stipend; the auto-letter's amount field is even a placeholder string.
- **Why it happens:** `DisciplinaryService.create()`'s letter-generation switch never calls the payroll deduction API for `FINE`-type actions.
- **Affected files:** `apps/api/src/modules/disciplinary/disciplinary.service.ts`, `apps/api/src/modules/payroll/payroll.service.ts`.
- **Business impact:** fines silently don't reduce pay unless a payroll user separately remembers to add the exact amount by hand every time.
- **Severity: High**

**4. Approved advance/loan requests have no effect on payroll, and no HR approval UI exists**
- **Current behavior:** `AdvanceLoanRequest.monthlyDeduction` is computed and stored on approval but never read anywhere else in the system; there is also no HRMS screen to approve/reject requests at all (read-only view only).
- **Why it happens:** the feature's request/response backend was fully built, but neither the payroll-linkage code nor the HR-facing approval screen were completed; the Portal's "estimated monthly deduction" preview implies automation that doesn't exist.
- **Affected files:** `apps/api/src/modules/advance-loan/advance-loan.service.ts`, `apps/api/src/modules/payroll/*`, `apps/hrms/src/components/employees/EmployeePayrollTab.tsx`, `apps/hrms/src/api/endpoints/advanceLoan.ts`.
- **Business impact:** loans/advances must be tracked and deducted entirely by hand outside the system; HR currently has no way to actually action a request from the admin app.
- **Severity: High**

**5. Reliever double-booking and own-leave conflicts are not validated**
- **Current behavior:** one employee can be confirmed as reliever for two different people on overlapping dates, and an employee already on approved leave can still be assigned/accept as someone else's reliever.
- **Why it happens:** `requestReliever()`/`hrAssignReliever()` only validate the candidate's employment status, never cross-check other `RelieverRequest`/`LeaveRecord` rows for that date.
- **Affected files:** `apps/api/src/modules/leave/leave.service.ts`.
- **Business impact:** could result in a branch believing it has coverage that doesn't actually exist.
- **Severity: Medium**

**6. No holiday or weekly-off concept anywhere**
- **Current behavior:** every calendar day is treated as a normal working day by the auto-absent scheduler; there is no way to designate a public holiday or a weekly rest day.
- **Why it happens:** no `Holiday` model or rest-day field was ever added, despite `AttendanceStatus.HOLIDAY` existing in the enum.
- **Affected files:** `apps/api/prisma/schema.prisma`, `apps/api/src/modules/attendance/shift-absent.scheduler.ts`.
- **Business impact:** staff would be auto-flagged `UNINFORMED_ABSENT` (with a real pay deduction and possible auto-suspension risk) on their actual day off unless HR manually pre-marks every such date as leave.
- **Severity: High**

**7. Branch-specific shifts silently don't work**
- **Current behavior:** the create/list endpoints accept and appear to honor a `branchId`, but the service forces every shift to `branchId: null` on create and ignores the branch filter on every list query.
- **Why it happens:** `ShiftsService.create()`/`findAll()`/`getShiftsByBranch()` hardcode/ignore the parameter.
- **Affected files:** `apps/api/src/modules/shifts/shifts.service.ts`.
- **Business impact:** any branch expecting distinct shift catalogs will actually see the global list; low risk today since only one shift set appears to be in use, but a real trap if a second branch-specific shift is ever created expecting isolation.
- **Severity: Medium**

**8. Frontend role gating uses primary role only; backend uses full effective roles**
- **Current behavior:** `Sidebar.tsx` and a couple of page-level redirect guards key off `user.role` (the primary role) while the backend `RolesGuard` and `useAuth().hasRole()` correctly use the merged effective-roles array (including `UserAdditionalRole`s).
- **Why it happens:** inconsistent implementation between two frontend gating mechanisms.
- **Affected files:** `apps/hrms/src/components/layout/Sidebar.tsx`, `apps/hrms/src/pages/admin/RolesManagementPage.tsx`.
- **Business impact:** currently low, since the multi-role write path is itself dead (Finding above), but latent if that ever gets fixed.
- **Severity: Low**

**9. Attendance-triggered payroll deductions bypass the PROCESSED/PAID lock**
- **Current behavior:** manual deduction/allowance/overtime edits are correctly blocked once an entry is `PROCESSED`/`PAID`, but automatic late/absence deductions from `discipline.helper.ts` write directly to the entry's totals with no status check.
- **Affected files:** `apps/api/src/modules/attendance/discipline.helper.ts`, `apps/api/src/modules/payroll/payroll.service.ts`.
- **Business impact:** a stipend already marked "Paid" could still silently change if a discipline event fires against that month afterward.
- **Severity: Medium**

**10. `MutualSwap.status` is a free-form string, not a database enum**
- **Current behavior:** the schema stores `'ACTIVE'`/`'CANCELLED'` as plain strings; nothing at the database level prevents any other string being written by a future code path.
- **Affected files:** `apps/api/prisma/schema.prisma` (`MutualSwap` model).
- **Business impact:** low today (only two values are ever written), but a latent data-integrity gap.
- **Severity: Low**

**11. Three different "employee eligible for X" status lists across payroll-adjacent modules**
- **Current behavior:** Payroll's own default eligibility is `[ACTIVE, ON_REST]`; Stipend Receipts and Incentives each independently use `[ACTIVE, APPOINTED]`.
- **Business impact:** an `APPOINTED` employee can receive incentives/receipts but has no default payroll entry generated for them, which could confuse HR trying to reconcile the two lists.
- **Severity: Low**

**12. Recruitment gender/CNIC data-quality gaps**
- **Current behavior:** accepting a job applicant into an employee always hardcodes `Gender.MALE` (there's no gender field on the application at all) and auto-generates a placeholder CNIC if none was supplied.
- **Affected files:** `apps/api/src/modules/recruitment/recruitment.service.ts`.
- **Business impact:** every hire made through Recruitment needs manual HR correction of gender and (often) CNIC afterward — and a wrong gender on a female hire would also block her access to the female-only private-photo/biometric privacy feature (Part 5.4) until corrected.
- **Severity: Medium**

**13. Timezone handling is a fixed +5h offset, not a real timezone**
- **Current behavior:** all "Pakistan time" math in attendance uses a hardcoded `+5:00` offset constant, not an IANA timezone lookup.
- **Business impact:** harmless today (Pakistan does not observe DST), but would silently miscalculate if that policy ever changed.
- **Severity: Low**

**14. Inconsistent org-entity delete safety (Part 6)** and **15. Inconsistent "who can be re-active-status'd" status allow-lists per module (Part 8)** — both already detailed above; re-flagged here as they are genuine cross-module inconsistencies, not isolated to one part of the report. **Severity: Low–Medium.**

---

## PART 30 — Client Presentation Summary (plain language)

**1. Employee Management** — *What it does:* keeps a full record for every staff member (personal info, job assignment, pay package, documents, photos) and their history of transfers/promotions. *Who uses it:* HR, IT Admin, and each employee for their own limited profile edits. *Normal workflow:* HR creates the record → (for genuinely new hires) an organization executive approves it from their phone → the employee gets a login and appears in attendance/payroll. *Key rules:* an employee can't move from Trainee to Active status without a formal appointment letter already on file; once "Dismissed," a record can never be reopened. *Incomplete:* resignation and promotion each have a richer, more automated path built in the system that currently isn't hooked up to any screen — HR is doing those two actions the plainer way for now, which means a couple of nice extras (an automatic Experience letter on resignation, an automatic Salary Increment letter on promotion) currently don't fire.

**2. Attendance** — *What it does:* records every employee's daily check-in/out and turns it into a Present/Late/Absent/Half-Day status automatically. *Who uses it:* everyone, passively (via the biometric device at their branch) or actively (HR marking it by hand when needed). *Normal workflow:* an employee scans in at the door → the system finds them, checks if they're on time, and records it — no human touches this for the normal case. *Key rules:* a 15-minute grace period before "late" counts; more than an hour late becomes a half-day; being late 3, 6, or 9 times a month triggers escalating consequences automatically, up to suspension. *Incomplete:* the phone-app "check in from your phone with GPS" option was built but is currently switched off in the employee app — right now every punch has to come from the branch's physical device or be entered by HR. There is also currently no way to mark a public holiday or a weekly day off, so those dates need a manual leave entry if you don't want the system flagging someone absent.

**3. Biometric** — *What it does:* connects physical face/fingerprint scanners at each branch to the system via a small program running on a local computer, which relays every scan to the central system in real time. *Who uses it:* IT Admin sets it up; employees just scan as usual. *Normal workflow:* scan face → device asks Check-In/Check-Out/Overtime → the answer is sent to the server, which makes the final decision. *Key rules:* the server's clock is always trusted over the device's; a duplicate scan is rejected, not silently ignored. *Incomplete:* nothing significant — this is one of the most robust parts of the system, including automatic recovery if the internet drops briefly.

**4. Shifts** — *What it does:* defines standard duty windows (Morning/Evening/Night/24-Hour) and, per employee, the exact hours they're expected to work. *Who uses it:* HR/IT set up shifts and assign them to employees. *Key rules:* changing a shift's timing automatically updates every employee currently on it. *Incomplete:* the system currently can't give two different branches their own separate shift lists — every shift created is available system-wide, even though the screen suggests you can scope one to a branch.

**5. Leave** — *What it does:* lets an employee ask for time off, which then needs sign-off from their Branch Manager, then their Department Incharge, then HR, before it's final. *Who uses it:* every employee (applying); managers and HR (approving). *Normal workflow:* apply → three approvals → attendance is updated to show the leave only at the very end. *Key rules:* regular leave needs 48 hours' notice; only a still-pending request can be cancelled — once approval has started, it can't be walked back through the app. *Incomplete:* there's no way to attach a document (like a medical certificate) to a leave request anywhere in the system today.

**6. Relievers** — *What it does:* lets someone cover an absent colleague's duties, tracked and (eventually) paid separately from their own normal attendance. *Who uses it:* the requesting employee, the reliever, and HR (who does the actual clock-in/out for the covering duty). *Normal workflow:* leave gets approved → a reliever is confirmed → HR manually punches the reliever's covering-duty time in the Attendance screen → it flows into that month's pay as extra hours. *Key rules:* a reliever's own normal attendance is completely unaffected by covering someone else. *Incomplete:* nothing currently stops the same person from being booked as reliever for two people at once, or from being assigned while they're themselves on leave — worth a policy conversation with the client about whether that should be blocked.

**7. Payroll (called "Stipend" throughout the system)** — *What it does:* calculates each employee's monthly pay based on the actual hours they worked, their fixed allowances, and any deductions for lateness, absence, unpaid leave, or fines. *Who uses it:* HR/Payroll to generate and approve; every employee to view and accept their own payslip. *Normal workflow:* generate → review → mark Processed → mark Paid → the employee gets 48 hours to accept the receipt (or it's accepted automatically). *Key rules:* pay is genuinely hour-based, not a flat monthly number; once marked Paid, it's locked from manual edits. *Incomplete:* a disciplinary fine doesn't automatically reduce pay — someone has to remember to type it in separately; and approved loans/advances currently have zero automatic effect on future paychecks, which is worth flagging clearly before a demo, since a client will likely assume that connection exists.

**8. Fines** — *What it does:* deducts pay for lateness (on the 3rd/6th/9th occurrence each month) and for every uninformed absence, fully automatically. *Who uses it:* nobody has to do anything — it's automatic, with warning letters and eventual suspension built in. *Incomplete:* the separate, HR-issued "Fine" disciplinary letter (as opposed to the automatic lateness/absence fines) does not itself deduct any pay — that part is manual.

**9. HR Letters** — *What it does:* generates professional, bilingual (Urdu and English) warning, suspension, appreciation, and other official letters as a PDF and delivers them straight to the employee's WhatsApp. *Who uses it:* HR generates them; every employee receives and, for serious ones, must formally acknowledge them. *Normal workflow:* pick employee and letter type → preview → issue → PDF is created and sent via WhatsApp automatically (with a manual backup method if that fails). *Key rules:* some letter types require the employee to tick a box confirming they've read it, which is logged with their IP address. *Incomplete:* nothing structurally missing, but three slightly different "how does this employee end up suspended" paths exist in the system with slightly different side effects (one always sends a letter, one doesn't) — worth being aware of before explaining the suspension process to a client.

**10. Reports** — *What it does:* 13 different report types (attendance, lateness, absences, leave, employee rosters, branch/district summaries) with real filters, CSV export, and print. *Who uses it:* HR and management. *Incomplete:* nothing found — every report pulls genuinely live data.

**11. Permissions** — *What it does:* controls exactly what each of the 15 different staff roles can see and do, down to individual permission toggles per login if needed. *Who uses it:* IT Admin/Super Admin configure it; everyone else is governed by it. *Key rules:* the Super Admin and a senior HR role ("HR Executive") can do essentially anything in the system by design. *Incomplete:* letting one login hold more than one role was designed for but the screen to actually grant a second role to someone doesn't currently work — that part of the system needs a direct database change today, not a button in the app.

**12. Automation** — *What it does:* five scheduled background jobs quietly keep the system honest — marking unpunched staff absent, escalating truly unexplained absences, expiring stale reliever requests, auto-accepting unread payslips, and auto-suspending anyone who ignores a formal warning letter. *Incomplete:* these all run on fixed timers (mostly hourly or every 15 minutes), so there's a small, acceptable lag between "the deadline passed" and "the system actually acted on it" — never more than about an hour.

---

*This document reflects the codebase as of the analysis date. It was produced by static code review only (no runtime/UI testing was performed against a live environment), so any behavior that depends on external service configuration (Cloudinary, WhatsApp, SMTP credentials) reflects what the code does when those services are reachable and correctly configured.*
