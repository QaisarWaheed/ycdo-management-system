# Gateway-managed face sync agent

Date: 2026-08-23  
Status: approved (implementation started)

## Goal

Branches stop using the full attendance+face `agent.py` for enrollment. Attendance stays on **Hikvision HTTP Listening → CapRover gateway**. Face enrollment uses a **thin on-site agent** whose **only cloud API is the gateway**. Gateway admin shows agent online status, bound device, last sync. HRMS remains the source of face jobs and photos.

## Why a local agent remains

CapRover cannot reach branch LAN IPs (`192.168.x.x`). Cloudflare proxy on 443 only carries **device → cloud** punches. Face enroll needs **LAN → device ISAPI**. The thin agent is that LAN hop.

## Decisions

| Topic | Choice |
|-------|--------|
| Cloud API for agent | Gateway only (not HRMS directly) |
| Job / photo source of truth | HRMS `face-sync` (unchanged) |
| Gateway role | Agent auth, heartbeat, proxy pending/result to HRMS, admin UI |
| Attendance in agent | None (gateway HTTP Listening only) |
| Binding | One agent token ↔ one gateway device (`hrmsDeviceId`) |
| HRMS biometric device | Must exist with `deviceId` equal to gateway `hrmsDeviceId` |

## Architecture

```text
HRMS IT Admin / employee UI
  → creates FaceSyncJob (existing)
         ↑
Gateway (CapRover)
  ↔ agent: heartbeat, GET pending, POST result
  ↔ HRMS: GET /face-sync/pending, POST /face-sync/result
         ↑                    (x-device-key = BIOMETRIC_DEVICE_KEY)
Thin face agent (branch PC)
  → Hikvision ISAPI UserInfo + FDLib face upload
```

## Components

### 1. Thin face agent (new script)

Location: e.g. `biometric_script/face_agent.py` (new; do not overload full `agent.py`).

Config (per branch):

- `GATEWAY_URL` — e.g. `https://biometric-gateway.ycdo.org.pk`
- `AGENT_TOKEN` — from gateway admin (bound to one device)
- `DEVICE_IP`, `DEVICE_USER`, `DEVICE_PASS`
- Optional: `AUTH_MODE` (auto digest/basic)

Behavior:

- Heartbeat to gateway every ~30s (`POST /agent/heartbeat`)
- Poll pending jobs every ~60s (`GET /agent/face-sync/pending`)
- For each job: download `photoUrl`, resize, ISAPI user create + face upload (same ISAPI flow as current `sync_face` in `agent.py`)
- Report result (`POST /agent/face-sync/result`) with `jobId`, `status` SUCCESS|FAILED, optional `error`
- No alertStream / AcsEvent / attendance forwarding
- Serialize device calls; gap between jobs so the terminal can keep pushing punches

### 2. Gateway API (agent-facing)

Auth: `Authorization: Bearer <AGENT_TOKEN>` or `x-agent-token` (pick one; document in README).

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/agent/heartbeat` | Body: optional `{ version }`. Updates last_seen. |
| GET | `/agent/face-sync/pending` | Proxy HRMS pending for bound `hrmsDeviceId`. |
| POST | `/agent/face-sync/result` | Proxy HRMS result; also store last result on gateway for admin. |

Env on CapRover gateway:

- `HRMS_API_BASE` (or reuse existing HRMS base used for raw-scan)
- `BIOMETRIC_DEVICE_KEY` — same secret HRMS expects on `x-device-key`

SQLite (persistent `/app/data`):

- Extend `gateway_devices` (or side table) with:
  - `agent_token` (unique, nullable until generated)
  - `agent_last_seen_at`
  - `agent_version`
  - `agent_last_sync_at`
  - `agent_last_sync_status` (SUCCESS|FAILED|null)
  - `agent_last_sync_error` (short text)

Online rule: `agent_last_seen_at` within last 90s (configurable).

Admin actions:

- Generate / rotate agent token for a device
- Clear agent token (agent goes unauthorized)

### 3. Gateway admin UI

On Devices (and optionally Dashboard):

- Face agent: **Online** / **Offline** / **No token**
- Last heartbeat, last sync time + status
- Buttons: **Copy agent token**, **New agent token**, optional **Copy config snippet**

No requirement to trigger sync-all from gateway in v1 (HRMS Face Sync UI stays the trigger).

### 4. HRMS

No schema change required for v1.

Constraints ops must keep:

- Biometric Devices row `deviceId` === gateway device `hrmsDeviceId` (e.g. `ghanta ghar`)
- `BIOMETRIC_DEVICE_KEY` matches on API and gateway env
- Employees have photos before sync-all / per-employee sync

Optional later: gateway admin “Sync all” button that calls HRMS JWT API — out of scope for v1.

## Ops flow

1. Create/enable device in gateway admin (`hrmsDeviceId` matches HRMS).
2. Ensure same ID exists under HRMS Biometric Devices.
3. **New agent token** → paste into `face_agent.py` config on branch PC.
4. Run agent (Windows service / scheduled task / always-on session).
5. Admin shows Online after first heartbeat.
6. IT Admin → Face Sync (or employee sync) in HRMS → jobs appear → agent enrolls → SUCCESS on admin + HRMS registration.

## Security

- Agent token ≥ 32 bytes hex; treat like device listening token
- HTTPS only to gateway
- Do not log full agent token or device password
- Rotating agent token invalidates old agent immediately
- Gateway must not expose HRMS `BIOMETRIC_DEVICE_KEY` to the browser; only server-side proxy

## Failure modes

| Symptom | Likely cause |
|---------|----------------|
| Offline forever | Agent not running / wrong token / firewall |
| Online, jobs never finish | Device IP/creds wrong / ISAPI fail |
| Pending empty but HRMS has jobs | `hrmsDeviceId` ≠ HRMS `deviceId` |
| 401 from HRMS proxy | Gateway `BIOMETRIC_DEVICE_KEY` mismatch |

## Out of scope (v1)

- Cloudflare Tunnel / CapRover direct-to-LAN ISAPI
- Fingerprint enrollment
- Moving FaceSyncJob storage into gateway SQLite
- Removing HRMS Face Sync UI
- Multi-device per single agent process (v1 = one agent config ↔ one terminal)

## Success criteria

- Branch with only HTTP Listening + thin face agent can enroll faces without `agent.py` attendance mode
- Gateway Devices row shows Online and a successful last sync after a test employee sync
- HRMS face-sync registration for that device shows SUCCESS
- Punch path unchanged (HTTP Listening → gateway → raw-scan)
