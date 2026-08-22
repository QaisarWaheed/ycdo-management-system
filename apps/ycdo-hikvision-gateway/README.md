# YCDO Hikvision Gateway

Central HTTP Listening receiver for Hikvision attendance terminals.

## What it does

- Receives Hikvision `HTTP Listening` POST events directly from branch devices.
- Accepts plain JSON and multipart events (`event_log` field or JSON file part).
- Ignores door/tamper/heartbeat events that have no employee attendance punch.
- Preserves the device-provided attendance state: `CHECK_IN`, `CHECK_OUT`, `OVERTIME_IN`, `OVERTIME_OUT`.
- Uses the Hikvision event serial number when available for exact replay deduplication.
- Stores every attendance event durably in SQLite before acknowledging the device.
- Forwards stored events to the existing HRMS `/attendance/raw-scan` endpoint.
- Retries network/5xx/429 failures automatically without losing the punch.
- Does **not** replace server-side attendance policy. HRMS remains authoritative for rules such as duplicate check-in, checkout-without-checkin, duty windows, leave, manual attendance, late logic, and overtime eligibility.
- Supports unique per-device URL tokens and optional public-IP whitelisting.
- Can optionally retain image parts; disabled by default.

## Why HRMS must own the state machine

The gateway knows what the Hikvision device sent, but the HRMS knows the employee's actual duty, leave, HR/manual attendance, admin attendance and existing attendance record. Keeping validation in HRMS prevents two databases from disagreeing.

Expected `/attendance/raw-scan` payload:

```json
{
  "biometricId": "124",
  "timestamp": "2026-08-22T08:03:17+05:00",
  "deviceId": "YCDO-CENTRAL-HOSPITAL",
  "deviceStatus": "checkIn",
  "serialNo": "827361"
}
```

Recommended HRMS outcomes:

- `CHECK_IN`: accept only if the duty has no check-in yet.
- second `CHECK_IN`: idempotent/logical reject; never overwrite the original check-in.
- `CHECK_OUT`: require a valid check-in first.
- second `CHECK_OUT`: idempotent/logical reject; never overwrite the original checkout.
- `OVERTIME_IN`: require no active overtime session and apply HRMS eligibility policy.
- `OVERTIME_OUT`: require an overtime-in first.
- Exact same `(deviceId, serialNo)`: idempotent replay; return HTTP 200.
- For business-rule rejection, HRMS should preferably still return 2xx with a body such as `{ "accepted": false, "reason": "ALREADY_CHECKED_IN" }`. This is easier to operate than using transport errors for valid device deliveries.

## 1. Configure files

```bash
cp .env.example .env
cp config/devices.example.json config/devices.json
```

Edit `.env` and `config/devices.json`.

Generate a token:

```bash
openssl rand -hex 32
```

Example device config:

```json
{
  "devices": [
    {
      "name": "YCDO Central Hospital",
      "token": "YOUR_64_CHAR_RANDOM_TOKEN",
      "hrmsDeviceId": "YCDO-CENTRAL-HOSPITAL",
      "hikvisionDeviceIds": [],
      "allowedPublicIps": ["203.0.113.25"],
      "enabled": true
    }
  ]
}
```

Leave `allowedPublicIps` empty if the branch has a dynamic public IP. The unique URL token still protects the endpoint. If you know the exact Hikvision `deviceID` field sent by the terminal, add it to `hikvisionDeviceIds` after the first test event.

## 2. Start with Docker

```bash
docker compose up -d --build
docker compose logs -f
```

Health check:

```bash
curl http://127.0.0.1:9000/health
```

## 3. Put it behind HTTPS

Recommended public URL:

`https://attendance-ingest.ycdo.org.pk/hikvision/event/<DEVICE_TOKEN>`

Terminate TLS at CapRover/Nginx and proxy to port 9000. Do not expose SQLite or `/admin/events` publicly without the admin bearer token.

If CapRover/Nginx is the only path to the app, keep `TRUST_PROXY=1` so the gateway can see the branch public IP from the trusted proxy. If the Node port is directly exposed to the internet, do not trust arbitrary forwarded headers.

## 4. Hikvision configuration

On each supported terminal configure **HTTP Listening** with:

- Protocol: HTTPS (preferred)
- Domain/IP: `attendance-ingest.ycdo.org.pk`
- Port: `443`
- URL: `/hikvision/event/<THAT_DEVICE_TOKEN>`

Set the device Time & Attendance mode so it sends explicit statuses for Check In, Check Out, Overtime In and Overtime Out.

## 5. First-device verification

1. Configure one test terminal only.
2. Perform one Check In.
3. Verify gateway log says `Attendance event queued`.
4. Verify `/health` pending returns to `0` after HRMS accepts it.
5. Confirm HRMS stored the **device event time**, not receiver time.
6. Repeat Check In: HRMS should keep the original check-in and record/return `ALREADY_CHECKED_IN`.
7. Test Check Out after Check In: should succeed.
8. Test Check Out without a valid Check In on a controlled test employee/date: HRMS should reject logically.
9. Test Overtime In / Overtime Out sequence.
10. Disconnect HRMS/API briefly, scan once, restore HRMS and confirm the queued event is retried and delivered.
11. Repeat the exact same Hikvision event/serial if possible and confirm it is not processed twice.

## Admin audit endpoint

Set `ADMIN_TOKEN` to a long random value, then:

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "https://attendance-ingest.ycdo.org.pk/admin/events?limit=100"
```

## Admin web UI

When `ADMIN_TOKEN` is set, open:

`https://attendance-ingest.ycdo.org.pk/admin/`

Sign in with the same admin token. From there you can:

- **Dashboard** — pending deliveries, event counts, device totals
- **Devices** — add/edit/delete branch terminals, copy Hikvision URLs, regenerate tokens
- **Attendance Events** — browse all punches with delivery status and filters

Devices are stored in SQLite (`/app/data`) and survive redeploys. Optional `DEVICES_JSON` or `config/devices.json` only **seeds** the database on first run if the device table is empty.

Protect `/admin/` behind HTTPS. Do not expose it without a strong `ADMIN_TOKEN`.

## Face/fingerprint management

This gateway is intentionally the **attendance ingest** service. Central face/fingerprint enrollment should be implemented over a server-to-device management channel (for example ISUP/SDK, or server-to-branch VPN + ISAPI). HTTP Listening is outbound event delivery and by itself does not create a reverse management channel.

## 6. Deploy on CapRover

CapRover app name suggestion: `hikvision-gateway`

Public domain: `biometric-gateway.ycdo.org.pk` (or `attendance-ingest.ycdo.org.pk`) → container port **9000**

**Critical:** CapRover → App Config → HTTP Settings → set **Container HTTP Port** to `9000`. Wrong port = Cloudflare **502 Bad Gateway**.

### Build

Deploy from `apps/ycdo-hikvision-gateway` (includes [`captain-definition`](./captain-definition) pointing at [`Dockerfile`](./Dockerfile)).

### Persistent volume (required — devices disappear without this)

All devices, tokens, and attendance events live in one SQLite file:

`/app/data/events.db`

On CapRover, the container filesystem is **wiped on every redeploy** unless you mount persistent storage.

**One-time setup (do this before adding devices):**

1. Open your CapRover dashboard → app **`hikvision-gateway`** (or your app name)
2. When creating the app, check **Has Persistent Data** (if not already)
3. Go to **App Configs** → **Persistent Directories**
4. Click **Add Directory**
   - **Path in App:** `/app/data`
   - **Label:** `gateway-data` (any name is fine)
5. Click **Save & Update** and wait for the app to restart
6. Set env `DB_PATH=/app/data/events.db` (recommended; this is the default in production)

After this, redeploys keep your devices and event history.

Verify: `curl https://biometric-gateway.ycdo.org.pk/health` should show `"dbPath":"/app/data/events.db"` and your device count should not reset to 0 after redeploy.

**Do not** put `DEVICES_JSON` as your only backup — use persistent storage. `DEVICES_JSON` only seeds when the device table is empty.

### Required environment variables

| Variable | Example | Notes |
|----------|---------|-------|
| `HRMS_API` | `https://hrms-api.ycdo.org.pk` | HRMS API base URL |
| `DEVICE_API_KEY` | (secret) | Must match API `BIOMETRIC_DEVICE_KEY` |
| `TRUST_PROXY` | `1` | Required behind CapRover/Nginx |
| `PORT` | `9000` | Container listen port |
| `DB_PATH` | `/app/data/events.db` | SQLite outbox path |
| `ADMIN_TOKEN` | (long random) | Enables `/admin/` UI and audit API |

Optional: `HRMS_RAW_SCAN_PATH` (default `/attendance/raw-scan`), `OUTBOX_POLL_MS`, retry tuning — see [`.env.example`](./.env.example).

### Device registry (choose one)

**Option A — `DEVICES_JSON` env (recommended on CapRover):**

```json
{"devices":[{"name":"YCDO Central Hospital","token":"YOUR_64_CHAR_TOKEN","hrmsDeviceId":"YCDO-CENTRAL-HOSPITAL","hikvisionDeviceIds":[],"allowedPublicIps":[],"enabled":true}]}
```

**Option B — file on persistent volume:** mount `/app/config/devices.json` (copy from [`config/devices.example.json`](./config/devices.example.json)).

### Pre-deploy checklist

1. Run HRMS migration `20260822140000_biometric_device_event` and deploy API with `/attendance/raw-scan`.
2. Set `BIOMETRIC_DEVICE_KEY` on API = `DEVICE_API_KEY` on gateway.
3. Register each `hrmsDeviceId` in HRMS **Biometric Devices** (must match branch).
4. Generate one unique token per terminal: `openssl rand -hex 32`.
5. Configure each Hikvision terminal HTTP Listening URL:  
   `https://attendance-ingest.ycdo.org.pk/hikvision/event/<TOKEN>`

### Post-deploy smoke test

```bash
curl https://attendance-ingest.ycdo.org.pk/health
# → {"ok":true,"pending":0,...}
```

Then run the [first-device verification](#5-first-device-verification) checklist on one test terminal.
