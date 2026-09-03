# Meta WhatsApp Cloud API setup (YCDO)

Step-by-step guide to get credentials for HRMS letter delivery:

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TEMPLATE_NAME` (default `employee_letter_issued`)
- `WHATSAPP_TEMPLATE_LANG` (default `en`)
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (webhook handshake only)

App in this project: **YCDO_API** (Business Manager: **YCDO Serve Humanity**).

Official docs: [WhatsApp Cloud API Get Started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)

---

## Prerequisites

- Facebook account that is **Admin** on the Meta Business portfolio
- Meta Business Manager for the org ([business.facebook.com](https://business.facebook.com/))
- Meta Developer app of type **Business** (e.g. `YCDO_API`)
- A **dedicated phone number** that can receive SMS/voice OTP  
  - Prefer a number **not** already active on consumer WhatsApp / WhatsApp Business app (unless you use official coexistence / migration)
- Business verification (needed for real volume / display-name trust; can start with test numbers first)

---

## Part A — Create / open the Meta app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps).
2. Open **YCDO_API** (or **Create App** → type **Business** → link to **YCDO Serve Humanity**).
3. Note **App ID** (Settings → Basic). You do **not** put App ID in the letter-send env vars; you need Phone Number ID + token.

---

## Part B — Add WhatsApp product and phone (do this before “Connect assets”)

**Important:** In Business Manager → **Apps** → **Connect assets**, you may only see **“Other business assets”**. That means there is **no WhatsApp Business Account (WABA)** on this business yet. Cancel that modal and finish this part first.

1. In the developer app dashboard for **YCDO_API**, add product **WhatsApp** (Add products / Use cases).
2. Open **WhatsApp → API Setup** (or Getting started).
3. Connect or create a **WhatsApp Business Account** under your Business Manager.
4. Add a **From** phone number and verify ownership (OTP).
5. Complete registration for Cloud API if prompted (including 2-step PIN where required).
6. Set / submit **display name** for approval when asked.

### Copy now: Phone Number ID

On **API Setup**, under the phone / From section:

| Field | Env var |
|--------|---------|
| **Phone number ID** (long numeric ID) | `WHATSAPP_PHONE_NUMBER_ID` |

Do **not** confuse with:

- WhatsApp Business Account ID (WABA ID)
- App ID

Example:

```env
WHATSAPP_PHONE_NUMBER_ID=123456789012345
```

### Temporary token (test only)

On the same API Setup page, **Generate access token** works for a quick test message. It **expires** (often ~24 hours). Do **not** use it as production `WHATSAPP_TOKEN`.

---

## Part C — Permanent token (`WHATSAPP_TOKEN`)

Meta UI labels change. Prefer **System user** token.

### C1. Open System users (old settings URL)

Use:

[https://business.facebook.com/settings/system-users](https://business.facebook.com/settings/system-users)

- Top-left: select business **YCDO Serve Humanity**
- You must be **Business Admin**

### C2. Create system user

1. **Add** system user.
2. Role: **Admin**.
3. Save.

### C3. Give the system user access to the app

Meta may not show a single “Assign assets” button everywhere. Use either path:

**Path 1 — From Apps (what you already use)**

1. Business Settings → **Accounts** → **Apps** (or Apps list).
2. Select **YCDO_API**.
3. Click **Assign people**.
4. Select the **system user** (not only your personal login).
5. Grant **Full control** / Full access → Assign.

**Path 2 — From System user detail**

1. System users → click the system user name.
2. **Assign assets** / **⋯ → Assign assets** (if visible).
3. Under business assets:
   - **Apps** → **YCDO_API** → Full control / Manage app
   - **WhatsApp accounts** → your WABA → Full control  
     (WhatsApp only appears **after** Part B creates a WABA)

**Path 3 — WhatsApp account access**

1. Business Settings → **Accounts** → **WhatsApp accounts**.
2. Select your WABA.
3. **WhatsApp Account Access** / People → **Add people**.
4. Add the system user → **Full control**.

### C4. Generate token

1. System users → select the system user.
2. **Generate token**.
3. Select app **YCDO_API**.
4. Choose token expiry (prefer long-lived / never-expire if offered; otherwise calendar a rotation).
5. Enable permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
   - `business_management` (if listed)
6. Generate → **copy once** → store securely.

```env
WHATSAPP_TOKEN=EAAB...your_permanent_token
```

Treat like a password. Never commit to git.

---

## Part D — Message template (required for letters)

Business-initiated messages (HR sends a letter; the employee did not message first) **must** use an **approved** template.

1. Open **WhatsApp Manager** → **Message templates**.
2. **Create template** with these exact settings (copy/paste).

| Setting | Value |
|--------|--------|
| Category | **Utility** |
| Name | `employee_letter_issued` |
| Language | English — `en` (if Meta only offers `en_US`, use that and set `WHATSAPP_TEMPLATE_LANG=en_US`) |
| Header | **Image** (not Document / PDF) |
| Footer (optional) | `Youth Community Development Organization, Multan` |
| Buttons | None |

**Body** (named variables — must match the API):

```
YCDO official letter

Assalamu Alaikum {{employee_name}},

This is your {{letter_type}}. Please open the attached image, read it carefully, and keep it for your records.

For questions, contact your branch HR office.
```

**Samples for Meta review** (required when you submit):

| Variable | Sample |
|----------|--------|
| `employee_name` | Qaiser Waheed |
| `letter_type` | 2nd Letter Of Warning |

**Header sample image:** upload a **clean A4 scan/JPG of a letter only** (white page, YCDO letterhead). Do not upload a browser/PDF-viewer screenshot.

3. Submit → wait until status is **Approved**.
4. Env (must match name + language **exactly**):

```env
WHATSAPP_TEMPLATE_NAME=employee_letter_issued
WHATSAPP_TEMPLATE_LANG=en
```

If this template is already **In review**, you can edit the body to the text above before it is approved. If it is already **Approved**, create a new template (e.g. `ycdo_official_letter`) with the same body and update `WHATSAPP_TEMPLATE_NAME`.

Rejects: keep it Utility (not Marketing), no promotional wording, no missing sample values.

---

## Part E — Put values in the API

In `apps/api/.env` (see also `.env.example`):

```env
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TEMPLATE_NAME=employee_letter_issued
WHATSAPP_TEMPLATE_LANG=en
# Testing: only these numbers receive WhatsApp. Remove when going live.
WHATSAPP_ALLOWLIST=03001234567,03331112222
```

Then:

1. Restart the API.
2. Generate a letter for an employee with a valid Pakistan phone (`03…` or `92…`).
3. If Meta is misconfigured / template pending, letter still saves; check HRMS **Failed WhatsApp** and use **Resend**.

If any of token / phone number ID is missing, the app treats WhatsApp as off and records **SKIPPED**.

Also set a webhook verify secret (any long random string you invent — you type the same value in Meta):

```env
WHATSAPP_WEBHOOK_VERIFY_TOKEN=pick-a-long-random-secret
```

---

## Part F — Webhook (delivery status)

The API already exposes:

| Method | URL |
|--------|-----|
| GET (verify) + POST (events) | `https://hrms-api.ycdo.org.pk/whatsapp/webhook` |

This does **not** send letters. It only receives Meta’s delivery receipts (`sent` / `delivered` / `failed`) so Failed WhatsApp can show the real error.

1. Deploy the API with `WHATSAPP_WEBHOOK_VERIFY_TOKEN` set.
2. In [developers.facebook.com/apps](https://developers.facebook.com/apps) → your app → **WhatsApp** → **Configuration** (or App → **Webhooks**).
3. Click **Edit** / **Add callback URL**.
4. Callback URL: `https://hrms-api.ycdo.org.pk/whatsapp/webhook`
5. Verify token: **exactly** the same string as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
6. Verify and save. Meta sends `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. Our API returns the challenge if the token matches.
7. Subscribe to the **WhatsApp Business Account** field **`messages`** (covers message status updates).

If verify fails with 403: token mismatch or env not loaded — restart API and try again.  
If Meta cannot reach the URL: API must be publicly HTTPS (CapRover already is).

---

## Part G — Quick test from Meta (optional)

1. API Setup → add your personal WhatsApp as a **test recipient** (while in test mode).
2. Send sample / `hello_world` or your approved template.
3. Confirm delivery on the phone.
4. Then rely on the app’s letter send path.

---

## UI gotchas (from real setup)

| What you see | Meaning | What to do |
|--------------|---------|------------|
| **Connect assets** → only “Other business assets” | No WABA on this business yet | Finish **Part B** (WhatsApp on developer app) first |
| No **Assign assets** on System users | New UI / not selected user / not Admin | Open system user detail, use **Assign people** on the App, or WhatsApp accounts → Add people |
| “Business assets” picker | Renamed “Assign assets” list | Choose **Apps** and **WhatsApp accounts** asset types |
| Temporary token works, app fails later | Token expired | Create System user permanent token (**Part C**) |
| Sends FAIL with template error | Template not approved or wrong name/lang | Fix template; match `WHATSAPP_TEMPLATE_*` |

---

## Checklist

- [ ] Business Admin on **YCDO Serve Humanity**
- [ ] App **YCDO_API** exists
- [ ] WhatsApp product added; WABA + phone verified
- [ ] `WHATSAPP_PHONE_NUMBER_ID` copied from API Setup
- [ ] System user (Admin) created
- [ ] System user has Full access on **YCDO_API** and WABA
- [ ] Permanent token generated with WhatsApp permissions → `WHATSAPP_TOKEN`
- [ ] Template `employee_letter_issued` **Approved** (Image header + body `{{employee_name}}` / `{{letter_type}}`)
- [ ] `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG` match template
- [ ] Webhook `https://hrms-api.ycdo.org.pk/whatsapp/webhook` verified
- [ ] `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches Meta verify token
- [ ] Values in API env; API restarted
- [ ] Test letter send; use **Failed WhatsApp** if needed

---

## Related app docs

- Design: `docs/superpowers/specs/2026-08-01-meta-whatsapp-letters-design.md`
- Plan: `docs/superpowers/plans/2026-08-01-meta-whatsapp-letters.md`
