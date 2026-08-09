import requests
import re
import json
import datetime
import time
import threading
import queue
import atexit
import io
import os
import sys
from PIL import Image
from requests.auth import HTTPDigestAuth

# Windows consoles default to cp1252, which cannot encode the arrows/box
# characters used in log lines — that raised UnicodeEncodeError and killed
# the calling thread before log() became crash-proof.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ─── Configuration ────────────────────────────────────────────
# !! EDIT THESE PER BRANCH !!
DEVICE_IP   = "192.168.1.64"
DEVICE_USER = "admin"
DEVICE_PASS = "YCDOit@1122"
HRMS_API    = "https://hrms-api.ycdo.org.pk"
DEVICE_KEY  = "ycdo-device-secret-2026"
DEVICE_ID   = "newOLD"

REPLAY_HOURS         = 24    # process events up to 24 hours old
PENDING_SCAN_SECONDS = 120   # how long to wait for status after face scan

# ── Mode ──
# "stream" = alertStream realtime push (modern devices, status selection on screen)
# "poll"   = AcsEvent log polling (OLD models without alertStream support)
MODE = "stream"

# ── Stability tuning (stream mode) ──
STREAM_READ_TIMEOUT = 60     # reconnect if the alertStream is silent this long
BACKFILL_MIN_GAP    = 90     # if stream was down longer than this, backfill AcsEvent
# The alertStream is read by a helper thread. requests' read timeout does not
# reliably interrupt an idle Hikvision socket on Windows, so the main loop
# wakes every STREAM_WAKE_SECONDS to heartbeat and enforce its own deadline.
STREAM_WAKE_SECONDS  = 1
STREAM_QUEUE_MAXSIZE = 256   # ~1 MB of buffered chunks; also bounds a stale reader
STREAM_PUT_TIMEOUT   = 5     # reader exits if the consumer abandoned the connection
ACS_PAGE_SIZE        = 50    # rows per AcsEvent page during backfill

# ── Poll mode tuning ──
POLL_INTERVAL_SECONDS   = 5    # how often to query the device event log
POLL_LOOKBACK_MINUTES   = 15   # sliding window each query covers (overlap is safe)
# AcsEvent minor codes differ per model/firmware — DS-K1T341AMF emits
# authenticated attendance under minor 38, other units under 75, etc.
# Rather than whitelist a minor (fragile), we query a broad minor and
# keep only rows that have BOTH an employeeNoString AND a real
# attendanceStatus. That captures face/card/fp/PIN on any firmware.
# Some firmware rejects minor=0 as "Invalid Operation", so we also keep a
# concrete minor from the capabilities list that returns the widest result
# set. Both modes try minor=0 first and fall back to POLL_MINOR.
POLL_MINOR              = 38   # broad query minor (DS-K1T341AMF passing event);
                               # actual filtering is done in Python below
POLL_MAX_RESULTS        = 30   # this firmware caps maxResults at 30 (capabilities @max)

# ── Shared ──
FACE_SYNC_JOB_GAP   = 5      # seconds between face-sync jobs (device breathing room)
# What the DEVICE clock is set to (PKT = 5; some units ship at 8). Used by
# BOTH modes: every AcsEvent time window is built in this offset.
DEVICE_UTC_OFFSET_HOURS = 5

# "auto" tries Digest then Basic and remembers what worked.
# Force "digest" or "basic" only if you know the device.
AUTH_MODE = "auto"

PKT = datetime.timezone(datetime.timedelta(hours=5))

# Current auth object — probe_device_auth() may swap Digest <-> Basic.
auth = HTTPDigestAuth(DEVICE_USER, DEVICE_PASS)
_auth_name = "digest"

def _auth_for(name):
    from requests.auth import HTTPBasicAuth
    return (
        HTTPDigestAuth(DEVICE_USER, DEVICE_PASS)
        if name == "digest"
        else HTTPBasicAuth(DEVICE_USER, DEVICE_PASS)
    )

def probe_device_auth():
    """
    Hit /ISAPI/System/deviceInfo to verify credentials and pick the auth
    scheme. Returns True on success.

    IMPORTANT: on 401 we do NOT retry in a tight loop. Hikvision terminals
    lock out the source IP after a handful of failed attempts (~30 min),
    and on most firmware every further attempt RESTARTS that timer — so a
    fast retry loop keeps the device permanently locked against itself.
    """
    global auth, _auth_name
    candidates = ["digest", "basic"] if AUTH_MODE == "auto" else [AUTH_MODE]
    last_body = ""
    for name in candidates:
        try:
            r = requests.get(
                f"http://{DEVICE_IP}/ISAPI/System/deviceInfo",
                auth=_auth_for(name),
                timeout=15,
            )
        except Exception as e:
            log(f"AUTH PROBE ({name}): connection error: {e}")
            continue

        if r.status_code == 200:
            auth = _auth_for(name)
            _auth_name = name
            model = extract_field(r.text, "model") or "?"
            fw    = extract_field(r.text, "firmwareVersion") or "?"
            log(f"AUTH OK via {name.upper()} — model={model} firmware={fw}")
            return True

        last_body = (r.text or "")[:600]
        log(f"AUTH PROBE ({name}): HTTP {r.status_code}")
        # Full body — Hikvision puts the real reason here (lockStatus,
        # retryLoginTime, subStatusCode). Truncating it hides the cause.
        log(f"  device said: {last_body}")
        if "lock" in last_body.lower():
            log(
                "  ^ DEVICE IS LOCKED OUT. Stop this agent, then wait ~30 min "
                "or reboot the device. Every retry restarts the lock timer."
            )
        time.sleep(2)   # never hammer auth

    log(
        f"AUTH FAILED for user '{DEVICE_USER}' on {DEVICE_IP}. "
        f"Check: (1) device locked out? (2) password correct FOR THIS device? "
        f"(3) does this account have remote/network permission?"
    )
    return False

# ─── Device access serialization ──────────────────────────────
# The Hikvision terminal has a weak CPU and a low cap on concurrent ISAPI
# sessions. Face enrollment (FDSetUp) makes it stall the event stream.
# This lock serializes ALL non-stream device requests (AcsEvent queries,
# face sync, backfill) so at most 2 sessions ever exist:
#   1. the long-lived alertStream GET
#   2. one lock-holder doing a query/upload
device_lock = threading.Lock()

# ─── Active stream registry ───────────────────────────────────
# The device allocates an event-subscription slot per alertStream connection
# and only reclaims it when the socket closes or the session times out.
# A watchdog os._exit() skips every finally/atexit hook, so the slot leaks
# and the next run can be refused with deployExceedMax. Track the live
# response/session here and close them on every exit path.
_active_stream = (None, None)
_active_stream_lock = threading.Lock()

def set_active_stream(resp=None, session=None):
    global _active_stream
    with _active_stream_lock:
        _active_stream = (resp, session)

def close_active_stream():
    global _active_stream
    with _active_stream_lock:
        resp, session = _active_stream
        _active_stream = (None, None)
    _close_quietly(resp)
    _close_quietly(session)

atexit.register(close_active_stream)

# ─── Watchdog ─────────────────────────────────────────────────
# Every loop reports a heartbeat. If a loop goes silent past its limit,
# the process is hung — we exit deliberately so start.bat relaunches us.
#
# IMPORTANT: heartbeats use time.monotonic(), NOT time.time().
# Wall clock jumps (PC sleep/resume, NTP sync, manual clock correction)
# must never look like a hung thread. Additionally, the watchdog measures
# its own cycle gap: if the whole process was suspended (PC slept), it
# re-arms all heartbeats instead of firing a false restart.
#
# Stream mode heartbeats once per STREAM_WAKE_SECONDS even while the device
# sends nothing, so a quiet terminal can no longer look hung. Its wider limit
# therefore only has to cover a slow backfill, not an idle night.
WATCHDOG_LIMITS = {
    "main":      300 if MODE == "stream" else 180,   # main attendance loop
    "face_sync": 300,   # face sync loop (one slow job < 300s worst case)
}
if MODE == "stream":
    WATCHDOG_LIMITS["acs_poller"] = 120   # pending-status poller (stream mode only)
heartbeats = {name: time.monotonic() for name in WATCHDOG_LIMITS}

def beat(name):
    heartbeats[name] = time.monotonic()

def watchdog():
    log("Watchdog started")
    last_cycle = time.monotonic()
    while True:
        time.sleep(15)
        now = time.monotonic()
        cycle_gap = now - last_cycle
        last_cycle = now

        # If our own 15s sleep took much longer, the WHOLE process was
        # suspended (PC sleep) or frozen — that is not a single hung
        # thread. Re-arm everything and let the loops recover naturally.
        if cycle_gap > 60:
            log(
                f"Time jump detected ({int(cycle_gap)}s since last watchdog "
                f"cycle) — PC likely slept/resumed; re-arming heartbeats"
            )
            for k in heartbeats:
                heartbeats[k] = now
            continue

        for name, limit in WATCHDOG_LIMITS.items():
            silent = now - heartbeats.get(name, now)
            if silent > limit:
                log(
                    f"WATCHDOG: thread '{name}' silent for {int(silent)}s "
                    f"(limit {limit}s) — process is hung, forcing restart"
                )
                close_active_stream()   # free the device subscription slot
                os._exit(1)   # start.bat loop relaunches the agent

# ─── Deduplication ────────────────────────────────────────────
# No local "already checked in" business logic here on purpose. Every scan
# is forwarded to the API; the server is the single source of truth for
# whether a punch is valid (enrolled, on duty, already checked in, no open
# session, etc.) and answers with the appropriate success/error response.
# Only technical dedup (the exact same device event row read twice, e.g.
# from overlapping AcsEvent windows) stays local — see seen_events below.
failed_jobs = set()  # face-sync job ids that failed this session

# ─── Pending scan state ───────────────────────────────────────
# Single slot: employee scanned face, waiting for CheckIn/CheckOut
# selection on device screen.
pending_scan = None
_pending_lock = threading.Lock()

# ─── Helpers ──────────────────────────────────────────────────
def get_pakistan_time():
    return datetime.datetime.now(PKT).isoformat()

def log(msg):
    """Crash-proof logging: a broken stdout must never kill a thread."""
    try:
        print(f"[{get_pakistan_time()}] {msg}", flush=True)
    except Exception:
        pass

def _close_quietly(closeable):
    """Close a response or session; never raise from a cleanup path."""
    try:
        if closeable is not None:
            closeable.close()
    except Exception:
        pass

def is_recent(event_datetime_str):
    """Allow events within last REPLAY_HOURS hours."""
    try:
        dt = datetime.datetime.fromisoformat(event_datetime_str.replace("Z", "+00:00"))
        dt_pkt = dt.astimezone(PKT)
        now = datetime.datetime.now(PKT)
        diff = now - dt_pkt
        return diff.total_seconds() <= (REPLAY_HOURS * 3600)
    except Exception:
        return True

# ─── Status mapping ───────────────────────────────────────────
STATUS_TO_PUNCH = {
    "checkin":            "CHECKIN",
    "checkout":           "CHECKOUT",
    "overtimein":         "OVERTIME_CHECKIN",
    "overtimecheckin":    "OVERTIME_CHECKIN",
    "overtimeout":        "OVERTIME_CHECKOUT",
    "overtimecheckout":   "OVERTIME_CHECKOUT",
}

STATUS_VALUE_TO_LABEL = {
    1: "checkIn",
    2: "checkOut",
    3: "breakOut",   # mapped as CHECKOUT
    4: "breakIn",    # mapped as CHECKIN
    5: "overtimeIn",
    6: "overtimeOut",
}

def map_punch_type(attendance_status):
    """
    Map device attendanceStatus/label → API punchType string.
    Returns None if the value is absent or unrecognised.
    """
    if attendance_status is None:
        return None
    if isinstance(attendance_status, (int, float)):
        return map_status_value(int(attendance_status))
    raw = str(attendance_status).strip()
    if not raw or raw.lower() in ("undefined", "unknown", "null", "none", ""):
        return None
    key = re.sub(r"[^a-z]", "", raw.lower())
    if key in STATUS_TO_PUNCH:
        return STATUS_TO_PUNCH[key]
    # Fuzzy fallback
    if "checkout" in key or ("check" in key and "out" in key):
        return "CHECKOUT"
    if "checkin" in key or ("check" in key and "in" in key and "out" not in key):
        return "CHECKIN"
    if "overtime" in key and "out" in key:
        return "OVERTIME_CHECKOUT"
    if "overtime" in key and "in" in key:
        return "OVERTIME_CHECKIN"
    return None

def map_status_value(n):
    """Map numeric statusValue → punchType."""
    if n is None:
        return None
    try:
        n = int(n)
    except (TypeError, ValueError):
        return None
    if n == 0:
        return None
    label = STATUS_VALUE_TO_LABEL.get(n)
    return map_punch_type(label) if label else None

def status_label_for_punch(punch):
    """Reverse lookup: punchType → canonical device label (for logging/push)."""
    for _k, label in STATUS_VALUE_TO_LABEL.items():
        if map_punch_type(label) == punch:
            return label
    return punch

def parse_event_dt(value):
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        return value if value.tzinfo else value.replace(tzinfo=PKT)
    try:
        dt = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=device_tz())
        return dt
    except Exception:
        return None

# ─── Device clock + AcsEvent query helpers (both modes) ───────
def device_tz():
    return datetime.timezone(datetime.timedelta(hours=DEVICE_UTC_OFFSET_HOURS))

def device_now():
    return datetime.datetime.now(device_tz())

def fmt_device_time(dt):
    """Format a datetime in the DEVICE's own offset — the only form its
    AcsEvent search accepts. A window built in the wrong offset silently
    returns nothing."""
    dt = dt.astimezone(device_tz())
    sign = "+" if DEVICE_UTC_OFFSET_HOURS >= 0 else "-"
    return dt.strftime(f"%Y-%m-%dT%H:%M:%S{sign}{abs(DEVICE_UTC_OFFSET_HOURS):02d}:00")

def acs_post(payload, timeout=10):
    """
    POST to AcsEvent with Digest auth, tolerant of older firmware.

    DS-K1T341AMF (webs server) answers the first (challenge) leg of Digest
    with `Connection: close`. On some urllib3 versions that breaks requests'
    in-session Digest retry, so every AcsEvent call 401s on leg one even
    though the credentials are valid (deviceInfo works because it's a
    separate, smaller exchange). curl succeeds because it always retries the
    challenge on a fresh connection.

    We reproduce curl's behaviour: a fresh Session per call, keep-alive off,
    fresh digest handler — so both legs are clean independent requests.
    """
    s = requests.Session()
    s.headers.update({"Connection": "close"})
    try:
        return s.post(
            f"http://{DEVICE_IP}/ISAPI/AccessControl/AcsEvent?format=json",
            data=json.dumps(payload),
            auth=_auth_for(_auth_name),
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
    finally:
        s.close()

# (major, minor) pairs to try, widest first. minor=0 means "any" on modern
# firmware but is rejected as "Invalid Operation" by some older units, which
# need a concrete minor instead. Rejected pairs are remembered so we stop
# paying for them, and the pair that answered is tried first next time.
ACS_QUERY_COMBOS = ((5, 0), (5, POLL_MINOR), (0, 0))
_acs_combo_lock = threading.Lock()
_acs_bad_combos = set()
_acs_good_combo = None

def acs_query_combos():
    with _acs_combo_lock:
        good, bad = _acs_good_combo, set(_acs_bad_combos)
    ordered = [c for c in ACS_QUERY_COMBOS if c not in bad]
    if good in ordered:
        ordered.remove(good)
        ordered.insert(0, good)
    return ordered or list(ACS_QUERY_COMBOS)

def note_acs_combo(combo, ok, body=""):
    global _acs_good_combo
    with _acs_combo_lock:
        if ok:
            _acs_good_combo = combo
            _acs_bad_combos.discard(combo)
        elif "invalid operation" in (body or "").lower():
            _acs_bad_combos.add(combo)

# ─── Stream parsing helpers ───────────────────────────────────
def extract_field(buf, name):
    m = re.search(rf'"{name}"\s*:\s*"([^"]*)"', buf, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(rf"<{name}>\s*([^<]*)\s*</{name}>", buf, re.I)
    if m:
        return m.group(1).strip()
    return None

def extract_status_value(buf):
    m = re.search(r'"statusValue"\s*:\s*(\d+)', buf, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"<statusValue>\s*(\d+)\s*</statusValue>", buf, re.I)
    if m:
        return int(m.group(1))
    return None

def extract_employees(buf):
    emps = re.findall(r'"employeeNoString"\s*:\s*"(\w+)"', buf)
    if not emps:
        emps = re.findall(r"<employeeNoString>\s*([^<]+)\s*</employeeNoString>", buf, re.I)
        emps = [e.strip() for e in emps if e.strip()]
    return emps

def resolve_usable_status(buf):
    """Return a mappable status string from stream buffer, else None."""
    for field in ("attendanceStatus", "label"):
        value = extract_field(buf, field)
        if value and map_punch_type(value):
            return value
    sv = extract_status_value(buf)
    punch = map_status_value(sv)
    if punch:
        return status_label_for_punch(punch)
    return None

# ─── Attendance push ──────────────────────────────────────────
def _send_punch(employee_no, punch_type, event_time=None):
    """
    POST a single punch to HRMS and report the outcome. No local business
    logic — the server decides whether the punch is valid and this just
    relays its answer. Never raises: a failed push is logged and returns
    False so callers keep running.
    """
    try:
        payload = {
            "biometricId": str(employee_no),
            "deviceId":    DEVICE_ID,
            "punchType":   punch_type,
        }
        r = requests.post(
            f"{HRMS_API}/attendance/biometric-push",
            json=payload,
            headers={"x-device-key": DEVICE_KEY},
            timeout=10,
        )
        body = r.text[:200]
        if r.status_code >= 400:
            log(f"{punch_type} REJECTED by API: employee={employee_no} → {r.status_code}: {body}")
            return False
        log(f"{punch_type} pushed: employee={employee_no} → {r.status_code}: {body}")
        return True
    except Exception as e:
        log(f"Attendance push error: employee={employee_no} {punch_type}: {e}")
        return False

def push_attendance(employee_no, attendance_status, event_time=None):
    """
    Push a single punch to HRMS. Maps the device's reported status to a
    punchType and forwards it — see _send_punch() for what happens next.
    """
    punch_type = map_punch_type(attendance_status)
    if not punch_type:
        log(
            f"SKIPPED: employee={employee_no} "
            f"status={attendance_status!r} — unrecognised attendance status"
        )
        return False
    return _send_punch(employee_no, punch_type, event_time)

def push_attendance_auto(employee_no, event_time=None):
    """
    Fallback when device never sends a status after face/finger auth
    (employee walked away without selecting CheckIn/CheckOut, or an old
    model has no status screen at all).

    We don't guess CHECKIN vs CHECKOUT locally — the API already resolves
    punchType "AUTO" itself (checks for an open session today and picks
    CHECKOUT if one exists, else CHECKIN), so send it once and let the
    server decide.
    """
    log(f"AUTO fallback: employee={employee_no} — deferring to server AUTO resolution")
    return _send_punch(employee_no, "AUTO", event_time)

# ─── Pending scan management ──────────────────────────────────
def remember_pending_scan(employee_no, event_time):
    global pending_scan
    with _pending_lock:
        if pending_scan and pending_scan["employee"] != str(employee_no):
            log(
                f"WARNING: new scan for employee={employee_no} while "
                f"employee={pending_scan['employee']} is still pending — "
                f"discarding previous pending"
            )
        pending_scan = {
            "employee":   str(employee_no),
            "event_time": event_time,
            "at":         datetime.datetime.now(PKT),
        }
    log(
        f"Auth OK: employee={employee_no} — waiting for status selection "
        f"(CheckIn/CheckOut/Overtime) on device..."
    )

def get_pending_scan():
    with _pending_lock:
        return dict(pending_scan) if pending_scan else None

def clear_pending_scan():
    global pending_scan
    with _pending_lock:
        pending_scan = None

def pending_not_before(pending):
    return parse_event_dt(pending.get("event_time")) or pending.get("at")

def complete_pending_with_status(status, event_time=None, source="stream"):
    """Apply status to the pending employee and push to HRMS."""
    pending = get_pending_scan()
    if not pending:
        return False
    emp_no = pending["employee"]
    ts = event_time or pending.get("event_time")
    log(f"Status selected via {source}: {status} → employee={emp_no}")
    ok = push_attendance(emp_no, status, ts)
    clear_pending_scan()
    return ok

# ─── AcsEvent poller (status after auth) ─────────────────────
def query_acs_events_for_status(employee_no, not_before=None, verbose=False):
    """
    Poll device event log to retrieve the status the employee selected
    after scanning their face/finger.

    NOTE: caller must hold device_lock.
    """
    dev_tz = device_tz()
    anchor = not_before or datetime.datetime.now(dev_tz)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=dev_tz)
    anchor_dev = anchor.astimezone(dev_tz)

    start = fmt_device_time(anchor_dev - datetime.timedelta(minutes=2))
    end   = fmt_device_time(anchor_dev + datetime.timedelta(minutes=10))

    def event_is_fresh(info_time):
        if not not_before or not info_time:
            return True
        dt = parse_event_dt(info_time)
        if not dt:
            return True
        nb = not_before if not_before.tzinfo else not_before.replace(tzinfo=PKT)
        return dt.astimezone(datetime.timezone.utc) >= (
            nb.astimezone(datetime.timezone.utc) - datetime.timedelta(seconds=5)
        )

    for major, minor in acs_query_combos():
        payload = {
            "AcsEventCond": {
                "searchID":             f"ycdo-{int(time.time())}-{major}-{minor}",
                "searchResultPosition": 0,
                "maxResults":           ACS_PAGE_SIZE,
                "major":                major,
                "minor":                minor,
                "startTime":            start,
                "endTime":              end,
            }
        }
        try:
            r = acs_post(payload, timeout=8)
            if r.status_code != 200:
                note_acs_combo((major, minor), False, r.text)
                if verbose:
                    log(
                        f"AcsEvent major={major} minor={minor} → "
                        f"HTTP {r.status_code}: {r.text[:120]}"
                    )
                continue
            note_acs_combo((major, minor), True)

            data = r.json()
            info_list = (data.get("AcsEvent") or {}).get("InfoList") or []

            for info in reversed(info_list):
                emp = str(
                    info.get("employeeNoString") or info.get("employeeNo") or ""
                ).strip()
                if emp != str(employee_no):
                    continue
                info_time = info.get("time")
                if not event_is_fresh(info_time):
                    continue

                status = info.get("attendanceStatus") or info.get("label") or ""
                sv     = info.get("statusValue")

                if map_punch_type(status):
                    return status, info_time
                punch = map_status_value(sv)
                if punch:
                    return status_label_for_punch(punch), info_time

            if verbose:
                log(
                    f"AcsEvent major={major} minor={minor}: no usable status yet "
                    f"for employee={employee_no} (window {start} → {end})"
                )
        except Exception as e:
            log(f"AcsEvent poll error (major={major} minor={minor}): {e}")

    return None, None

# ─── Backfill after stream outage ─────────────────────────────
def backfill_missed_events(since_dt):
    """
    After a stream outage/stall, pull the device event log for the gap and
    push any punches that already have a selected status.

    Safe to re-run: daily dedup (agent side) + duplicate guards (API side)
    block repeats. Auth events WITHOUT a status are skipped — we cannot
    guess the employee's intent after the fact.
    """
    start_dt = since_dt.astimezone(device_tz()) - datetime.timedelta(seconds=60)
    end_dt   = device_now() + datetime.timedelta(seconds=30)
    start = fmt_device_time(start_dt)
    end   = fmt_device_time(end_dt)

    log(f"Backfill: querying AcsEvent for stream gap {start} → {end}")
    recovered = 0

    with device_lock:
        for major, minor in acs_query_combos():
            position = 0
            while position < 300:   # hard cap — never loop forever
                beat("main")      # backfill runs in the stream thread
                payload = {
                    "AcsEventCond": {
                        "searchID":             f"ycdo-backfill-{int(time.time())}-{major}-{minor}",
                        "searchResultPosition": position,
                        "maxResults":           ACS_PAGE_SIZE,
                        "major":                major,
                        "minor":                minor,
                        "startTime":            start,
                        "endTime":              end,
                    }
                }
                try:
                    resp = acs_post(payload, timeout=10)
                    if resp.status_code != 200:
                        note_acs_combo((major, minor), False, resp.text)
                        break
                    note_acs_combo((major, minor), True)
                    info_list = (resp.json().get("AcsEvent") or {}).get("InfoList") or []
                    if not info_list:
                        break

                    for info in info_list:
                        emp = str(
                            info.get("employeeNoString") or info.get("employeeNo") or ""
                        ).strip()
                        if not emp:
                            continue

                        status = info.get("attendanceStatus") or info.get("label")
                        if not map_punch_type(status):
                            punch = map_status_value(info.get("statusValue"))
                            if not punch:
                                continue  # auth without status — skip
                            status = status_label_for_punch(punch)

                        if push_attendance(emp, status, info.get("time")):
                            recovered += 1

                    if len(info_list) < ACS_PAGE_SIZE:
                        break
                    position += len(info_list)
                except Exception as e:
                    log(f"Backfill error (major={major} minor={minor}): {e}")
                    break

    log(f"Backfill complete: {recovered} punch(es) recovered")

# ─── Pending status poller thread ─────────────────────────────
def pending_status_poller():
    """
    Background thread: every 2 seconds, poll AcsEvent for the status of
    the employee whose scan is pending. Falls back to AUTO after timeout.

    Skips the device query (without blocking) when face sync holds the
    device — retries next cycle. AUTO fallback needs no device access
    so it always runs when the timeout is reached.
    """
    log("Pending-status AcsEvent poller started")
    last_verbose_at = 0

    while True:
        beat("acs_poller")
        try:
            pending = get_pending_scan()
            if pending:
                age     = (datetime.datetime.now(PKT) - pending["at"]).total_seconds()
                verbose = (time.time() - last_verbose_at) >= 15
                if verbose:
                    last_verbose_at = time.time()

                status, event_time = None, None
                if device_lock.acquire(blocking=False):
                    try:
                        status, event_time = query_acs_events_for_status(
                            pending["employee"],
                            not_before=pending_not_before(pending),
                            verbose=verbose,
                        )
                    finally:
                        device_lock.release()
                elif verbose:
                    log("Device busy (face sync in progress) — AcsEvent check deferred")

                if status and map_punch_type(status):
                    complete_pending_with_status(
                        status,
                        event_time or pending.get("event_time"),
                        source="AcsEvent",
                    )
                elif age >= PENDING_SCAN_SECONDS:
                    log(
                        f"No device status for employee={pending['employee']} "
                        f"after {PENDING_SCAN_SECONDS}s — AUTO fallback"
                    )
                    push_attendance_auto(
                        pending["employee"],
                        pending.get("event_time"),
                    )
                    clear_pending_scan()
        except Exception as e:
            log(f"Pending status poller error: {e}")

        time.sleep(2)

# ─── Poll mode (old device models) ────────────────────────────
# Old Hikvision terminals have no alertStream and often no status screen —
# but ALL of them keep an AcsEvent log. Poll mode queries that log on a
# short interval and pushes new events through the same dedup + API path.
#
# Data-quality rules that the "first scan / last scan" approach gets wrong,
# handled here instead:
#   - rows without an employeeNo (denied/unknown scans) are ignored
#   - rows WITH attendanceStatus/statusValue use the real punch type
#   - rows without any status (truly old models) resolve via AUTO —
#     forwarded to the server on every scan; it checks for an open
#     session and rejects anything redundant
seen_events = set()   # "emp|deviceTime" keys within the sliding window —
                       # technical dedup only: stops the same device event
                       # row (read twice from an overlapping query window)
                       # from being processed twice. No business logic.

def handle_raw_scan(emp, event_time):
    """Old models: no status selection exists on the device. Forward every
    raw scan as AUTO — the server resolves CHECKIN vs CHECKOUT and rejects
    anything that doesn't make sense (e.g. already checked in)."""
    log(f"POLL raw scan: employee={emp} time={event_time} → AUTO resolve")
    push_attendance_auto(emp, event_time)

def poll_attendance():
    """
    Main loop for MODE == "poll".

    Every POLL_INTERVAL_SECONDS: query AcsEvent for the last
    POLL_LOOKBACK_MINUTES (overlapping windows are safe — seen_events,
    daily dedup, and the AUTO gap guard all absorb repeats), then push
    anything new.

    Limitations (by design):
      - Punch time is stamped server-side on push, so worst-case lag is
        one poll interval (~seconds). Historical import stays a manual job.
      - Only events from the lookback window are processed — no
        hours-old replay, because replaying old raw scans would record
        them at the wrong time.
    """
    log(
        f"POLL mode: querying AcsEvent every {POLL_INTERVAL_SECONDS}s "
        f"(lookback {POLL_LOOKBACK_MINUTES} min, device clock assumed "
        f"UTC{'+' if DEVICE_UTC_OFFSET_HOURS >= 0 else ''}{DEVICE_UTC_OFFSET_HOURS})"
    )
    empty_cycles = 0

    while True:
        beat("main")
        rejected = False
        auth_fail = False
        rows = []
        try:
            now_dev = device_now()
            start = fmt_device_time(now_dev - datetime.timedelta(minutes=POLL_LOOKBACK_MINUTES))
            end   = fmt_device_time(now_dev + datetime.timedelta(minutes=5))

            with device_lock:
                position = 0
                while position < 300:
                    beat("main")
                    payload = {
                        "AcsEventCond": {
                            "searchID":             f"ycdo-poll-{int(time.time())}",
                            "searchResultPosition": position,
                            "maxResults":           POLL_MAX_RESULTS,
                            "major":                5,
                            "minor":                POLL_MINOR,
                            "startTime":            start,
                            "endTime":              end,
                        }
                    }
                    resp = acs_post(payload, timeout=10)
                    if resp.status_code != 200:
                        body = (resp.text or "")[:600]
                        hint = ""
                        if resp.status_code == 401:
                            hint = " — auth rejected"
                        elif resp.status_code == 403:
                            hint = " — ISAPI/CGI integration disabled on device"
                        elif resp.status_code == 404:
                            hint = " — very old firmware may not support AcsEvent JSON; report this"
                        log(f"POLL rejected: HTTP {resp.status_code}{hint}")
                        log(f"  device said: {body}")
                        rejected = True
                        auth_fail = (resp.status_code == 401)
                        break

                    info_list = (resp.json().get("AcsEvent") or {}).get("InfoList") or []
                    if not info_list:
                        break
                    rows.extend(info_list)
                    if len(info_list) < POLL_MAX_RESULTS:
                        break
                    position += len(info_list)

            if rejected:
                if auth_fail:
                    # A 401 here is usually the first leg of the Digest handshake
                    # or a transient nonce race with the face-sync thread — NOT a
                    # lockout. Verify with a single deviceInfo probe; only if THAT
                    # fails do we back off hard.
                    if probe_device_auth():
                        log("Transient AcsEvent 401 (nonce race / first Digest leg) "
                            "— auth still valid, retrying shortly")
                        time.sleep(POLL_INTERVAL_SECONDS)
                    else:
                        log("Auth genuinely failing — backing off 5 min "
                            "(rapid retries maintain any device lockout)")
                        for _ in range(60):
                            beat("main")
                            time.sleep(5)
                        probe_device_auth()
                else:
                    time.sleep(30)
                continue

            new_count = 0
            for info in rows:
                emp = str(
                    info.get("employeeNoString") or info.get("employeeNo") or ""
                ).strip()
                if not emp:
                    continue  # door-open / config / denied event — no employee

                # Skip non-authentication rows: door sensor, config, invalid
                # verify. A genuine attendance row has a real verify mode.
                verify = str(info.get("currentVerifyMode") or "").strip().lower()
                if verify in ("", "invalid"):
                    continue

                t = info.get("time") or ""
                ekey = f"{emp}|{t}"
                if ekey in seen_events:
                    continue
                seen_events.add(ekey)
                if len(seen_events) > 20000:
                    seen_events.clear()
                new_count += 1

                # Prefer the device-reported attendanceStatus; fall back to
                # statusValue; only if BOTH are absent do we AUTO-resolve.
                raw_status = info.get("attendanceStatus")
                status = raw_status if map_punch_type(raw_status) else None
                if not status:
                    punch = map_status_value(info.get("statusValue"))
                    status = status_label_for_punch(punch) if punch else None

                if status:
                    log(f"POLL scan (status): employee={emp} status={status} "
                        f"verify={verify} time={t}")
                    push_attendance(emp, status, t)
                else:
                    log(f"POLL raw scan (no status): employee={emp} "
                        f"verify={verify} time={t} → AUTO resolve")
                    handle_raw_scan(emp, t)

            if new_count == 0:
                empty_cycles += 1
                if empty_cycles % 120 == 0:   # ~every 10 min at 5s interval
                    log(
                        "POLL: no new events for a while — if staff ARE "
                        "scanning, check device clock / DEVICE_UTC_OFFSET_HOURS"
                    )
            else:
                empty_cycles = 0

        except Exception as e:
            log(f"POLL error: {e}")
            time.sleep(5)

        time.sleep(POLL_INTERVAL_SECONDS)

# ─── Attendance stream ────────────────────────────────────────
_STREAM_EOF = object()

class _StreamFailure:
    """Carries a reader-thread exception back to the main loop."""
    def __init__(self, exc):
        self.exc = exc

def _stream_reader(resp, out_queue):
    """
    Feed alertStream chunks into out_queue.

    Runs in its own thread so the main loop keeps heartbeating and can
    enforce its own idle deadline: on newer firmware the device holds the
    connection open with no data between scans, and requests' read timeout
    does not reliably interrupt that blocked recv on Windows — the main
    loop used to sit in iter_content() until the watchdog killed the
    process every ~3 minutes.
    """
    try:
        for chunk in resp.iter_content(chunk_size=4096):
            if not chunk:
                continue
            try:
                out_queue.put(chunk, timeout=STREAM_PUT_TIMEOUT)
            except queue.Full:
                return   # consumer moved on to a new connection
    except Exception as e:
        try:
            out_queue.put_nowait(_StreamFailure(e))
        except Exception:
            pass
    finally:
        try:
            out_queue.put_nowait(_STREAM_EOF)
        except Exception:
            pass

def listen_attendance():
    """
    Connect to device alertStream.

    Stability rules:
      - Chunks are read by _stream_reader(); this loop wakes every
        STREAM_WAKE_SECONDS to heartbeat, so an idle-but-healthy stream
        never looks like a hung thread to the watchdog.
      - Idle deadline is enforced here (STREAM_READ_TIMEOUT, 60s) instead
        of relying on the socket read timeout, which the device/OS can
        swallow. NOTE: when requests DOES raise it, a mid-stream read
        timeout surfaces as ConnectionError (wrapping urllib3
        ReadTimeoutError), not ReadTimeout — both are treated as a quiet
        refresh, not an error.
      - After an outage longer than BACKFILL_MIN_GAP, we query AcsEvent
        for the gap and recover any statused punches we missed.
      - Every exit path closes the response AND the session, and clears
        the active-stream registry, so the device's event-subscription
        slot is released instead of leaking until it times out.
      - Non-200 responses and device-closed streams are LOGGED with the
        actual status/body. Previously both were silent and caused an
        instant reconnect loop that looked like
        "Connected. Waiting for scans..." repeating forever.
    """
    url = f"http://{DEVICE_IP}/ISAPI/Event/notification/alertStream"
    log(f"Connecting to device {DEVICE_IP}...")
    log("Flow: scan face/finger first → select status on device screen")

    last_ok = None   # last time we received stream data

    while True:
        beat("main")
        r = None
        stream_session = None
        try:
            # Fresh session + keep-alive off: this firmware answers the
            # Digest challenge leg with `Connection: close`, which breaks
            # requests' in-session retry and surfaces as a bogus 401
            # "Invalid Operation". Same fix as acs_post().
            stream_session = requests.Session()
            stream_session.headers.update({"Connection": "close"})
            r = stream_session.get(
                url,
                auth=_auth_for(_auth_name),
                stream=True,
                timeout=(10, STREAM_READ_TIMEOUT),
            )

            # The device answered — but with what? A 401/404/500 here used
            # to be treated as a healthy stream and looped silently.
            if r.status_code != 200:
                snippet = ""
                try:
                    snippet = (r.text or "")[:600]
                except Exception:
                    pass
                _close_quietly(r)
                _close_quietly(stream_session)
                low = snippet.lower()
                # deployExceedMax = the device's event-subscription slots are
                # all in use (stale sessions from a crashed agent, a second
                # agent instance, or iVMS-4200 / Hik-Connect holding them).
                # It does NOT mean the model lacks alertStream support.
                slots_full = "deployexceedmax" in low

                hint = ""
                if slots_full:
                    hint = " — event-subscription slots FULL on the device"
                elif r.status_code == 401:
                    hint = " — auth rejected"
                elif r.status_code == 403:
                    hint = " — ISAPI/CGI integration disabled or user lacks permission on device"
                elif r.status_code == 404:
                    hint = " — endpoint not found; this model may not support alertStream (set MODE = \"poll\")"
                log(f"Stream rejected: HTTP {r.status_code}{hint}")
                log(f"  device said: {snippet}")

                if slots_full:
                    log("  → The device supports alertStream but has no free "
                        "subscription slot. Fix: reboot the device to drop stale "
                        "sessions, make sure only ONE agent runs against it, and "
                        "close iVMS-4200 / Hik-Connect if connected.")
                    log("  Retrying in 60s (slots free themselves when stale "
                        "sessions time out).")
                    for _ in range(12):
                        beat("main")
                        time.sleep(5)
                elif r.status_code == 401:
                    # Verify with a single probe before assuming a real failure —
                    # a 401 here is often just the Digest challenge leg.
                    if probe_device_auth():
                        log("Transient stream 401 (Digest challenge leg) — auth "
                            "still valid, reconnecting shortly")
                        time.sleep(5)
                    else:
                        log("Auth genuinely failing — backing off 5 min "
                            "(rapid retries maintain any device lockout)")
                        for _ in range(60):
                            beat("main")
                            time.sleep(5)
                        probe_device_auth()
                else:
                    time.sleep(30)
                continue

            log("Connected (HTTP 200). Waiting for scans...")
            beat("main")
            set_active_stream(r, stream_session)

            # Recover punches missed while the stream was down/stalled
            if last_ok:
                gap = (datetime.datetime.now(PKT) - last_ok).total_seconds()
                if gap > BACKFILL_MIN_GAP:
                    log(f"Stream was down {int(gap)}s — running backfill")
                    backfill_missed_events(last_ok)
            last_ok = datetime.datetime.now(PKT)

            buf = ""
            total_bytes = 0
            head = ""   # first bytes of this connection, for diagnostics

            chunk_queue = queue.Queue(maxsize=STREAM_QUEUE_MAXSIZE)
            threading.Thread(
                target=_stream_reader,
                args=(r, chunk_queue),
                name="alertStream-reader",
                daemon=True,
            ).start()

            last_data = time.monotonic()
            idle_refresh = False

            while True:
                beat("main")
                try:
                    item = chunk_queue.get(timeout=STREAM_WAKE_SECONDS)
                except queue.Empty:
                    if (time.monotonic() - last_data) > STREAM_READ_TIMEOUT:
                        idle_refresh = True
                        break
                    continue

                if item is _STREAM_EOF:
                    break
                if isinstance(item, _StreamFailure):
                    raise item.exc

                chunk = item
                last_data = time.monotonic()
                last_ok = datetime.datetime.now(PKT)
                total_bytes += len(chunk)
                text = chunk.decode("utf-8", errors="replace")
                if len(head) < 300:
                    head = (head + text)[:300]
                buf += text

                # Extract event time from JSON or XML
                date_match = re.search(r'"dateTime"\s*:\s*"([^"]+)"', buf)
                last_event_time = date_match.group(1) if date_match else None
                if not last_event_time:
                    xml_date = re.search(r"<dateTime>\s*([^<]+)\s*</dateTime>", buf, re.I)
                    if xml_date:
                        last_event_time = xml_date.group(1).strip()

                emps          = extract_employees(buf)
                usable_status = resolve_usable_status(buf)
                has_status_field = bool(
                    re.search(r'"attendanceStatus"\s*:', buf, re.I)
                    or re.search(r'"label"\s*:', buf, re.I)
                    or re.search(r'"statusValue"\s*:', buf, re.I)
                    or re.search(r"<attendanceStatus>", buf, re.I)
                )

                if not emps and not usable_status:
                    if len(buf) > 10000:
                        buf = buf[-5000:]
                    continue

                # ── Case A: status is present in this event ──────────────
                if usable_status:
                    emp_no  = emps[0] if emps else None
                    pending = get_pending_scan()

                    if emp_no and pending and str(emp_no) != str(pending["employee"]):
                        # Different employee arrived with their status
                        log(f"SCAN (with status): employee={emp_no} status={usable_status}")
                        push_attendance(emp_no, usable_status, last_event_time)
                        buf = ""
                        continue

                    if pending:
                        complete_pending_with_status(usable_status, last_event_time, source="stream")
                        buf = ""
                        continue

                    if emp_no:
                        log(f"SCAN (with status): employee={emp_no} status={usable_status}")
                        push_attendance(emp_no, usable_status, last_event_time)
                        buf = ""
                        continue

                    log(f"Status {usable_status!r} received but no employee and no pending — ignoring")
                    buf = ""
                    continue

                # ── Case B: employee present but no status yet ────────────
                if emps:
                    for emp_no in emps:
                        if last_event_time and not is_recent(last_event_time):
                            log(f"Skipping old event: employee={emp_no} at {last_event_time}")
                            buf = ""
                            break

                        # Wait for more data if status field hasn't arrived yet
                        if not has_status_field and len(buf) < 8000:
                            break

                        raw = extract_field(buf, "attendanceStatus") or extract_field(buf, "label")
                        log(
                            f"SCAN (auth): employee={emp_no} "
                            f"status={raw or 'pending — waiting for device screen selection'}"
                        )
                        remember_pending_scan(emp_no, last_event_time)
                        buf = ""
                        break
                    continue

                if len(buf) > 10000:
                    buf = buf[-5000:]

            # Closing the response is what unblocks the reader thread, so it
            # must happen on this path too — not just on errors.
            set_active_stream(None, None)
            _close_quietly(r)
            _close_quietly(stream_session)

            if idle_refresh:
                # Healthy but silent: no scans, or the device stopped sending
                # keep-alives. Reconnect quietly instead of waiting for a
                # socket timeout the OS may never deliver.
                log(f"Stream idle {STREAM_READ_TIMEOUT}s — refreshing connection")
                time.sleep(1)
                continue

            # Reader finished WITHOUT an exception: the device closed the
            # stream (or sent a complete, finite response). Previously this
            # fell through silently and reconnected instantly — the
            # "Connected. Waiting for scans..." infinite loop.
            log(f"Stream closed by device after {total_bytes} bytes — reconnecting in 5s...")
            if 0 < total_bytes < 2000:
                log(f"  Device sent: {head!r}")
            time.sleep(5)

        except requests.exceptions.RequestException as e:
            beat("main")
            set_active_stream(None, None)
            _close_quietly(r)
            _close_quietly(stream_session)
            # Mid-stream read timeouts surface as ConnectionError, not
            # ReadTimeout — match both. This is normal during face sync
            # and quiet periods.
            if isinstance(e, requests.exceptions.ReadTimeout) or "Read timed out" in str(e):
                log(f"Stream idle {STREAM_READ_TIMEOUT}s — refreshing connection")
                time.sleep(1)
                continue
            log(f"Attendance stream disconnected: {e}. Retry in 5s...")
            time.sleep(5)
        except Exception as e:
            beat("main")
            set_active_stream(None, None)
            _close_quietly(r)
            _close_quietly(stream_session)
            log(f"Attendance stream error: {e}. Retry in 5s...")
            time.sleep(5)

# ─── Face sync ────────────────────────────────────────────────
def resize_photo(photo_bytes, max_bytes=200000):
    try:
        img = Image.open(io.BytesIO(photo_bytes))
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        img.thumbnail((640, 480), Image.LANCZOS)
        quality = 85
        while quality >= 20:
            output = io.BytesIO()
            img.save(output, format="JPEG", quality=quality)
            if output.tell() <= max_bytes:
                log(f"  Photo resized: {output.tell()} bytes (quality={quality})")
                return output.getvalue()
            quality -= 10
        img.thumbnail((320, 240), Image.LANCZOS)
        output = io.BytesIO()
        img.save(output, format="JPEG", quality=60)
        log(f"  Photo resized (small): {output.tell()} bytes")
        return output.getvalue()
    except Exception as e:
        log(f"  Photo resize error: {e}")
        return photo_bytes

def sync_face(job):
    """
    Sync one face to the device.

    Photo download + resize happen WITHOUT the device lock (they don't
    touch the device). Only the two device calls hold the lock, keeping
    the busy window as short as possible.
    """
    job_id    = job["jobId"]
    fpid      = job["fpid"]
    photo_url = job["photoUrl"]
    full_name = job["fullName"]

    log(f"Syncing face: {full_name} (FPID={fpid})")
    status = "FAILED"
    error  = None

    try:
        photo_r = requests.get(photo_url, timeout=15)
        if photo_r.status_code != 200:
            raise Exception(f"Photo download failed: {photo_r.status_code}")

        log(f"  Original photo: {len(photo_r.content)} bytes")
        face_bytes = resize_photo(photo_r.content)

        user_payload = {
            "UserInfo": {
                "employeeNo": str(fpid),
                "name":       full_name[:32],
                "userType":   "normal",
                "Valid": {
                    "enable":    True,
                    "beginTime": "2026-01-01T00:00:00",
                    "endTime":   "2037-12-31T23:59:59",
                    "timeType":  "local",
                },
                "doorRight": "1",
                "RightPlan": [{"doorNo": 1, "planTemplateNo": "1"}],
                "localUIRight": False,
                "numOfFace": 1,
                "numOfFP":   0,
                "numOfCard": 0,
            }
        }
        meta = json.dumps({"faceLibType": "blackFD", "FDID": "1", "FPID": str(fpid)})

        # Device calls — serialized with AcsEvent polling / backfill
        with device_lock:
            user_r = requests.post(
                f"http://{DEVICE_IP}/ISAPI/AccessControl/UserInfo/Record?format=json",
                data=json.dumps(user_payload),
                auth=auth,
                headers={"Content-Type": "application/json"},
                timeout=10,
            )
            log(f"  User create: {user_r.status_code}")

            face_r = requests.put(
                f"http://{DEVICE_IP}/ISAPI/Intelligent/FDLib/FDSetUp?format=json",
                files={
                    "FaceDataRecord": (None, meta, "application/json"),
                    "img":            ("face.jpg", face_bytes, "image/jpeg"),
                },
                auth=auth,
                timeout=15,
            )

        if face_r.status_code == 200:
            status = "SUCCESS"
            log(f"  Face sync SUCCESS: {full_name}")
        else:
            error = f"Device {face_r.status_code}: {face_r.text[:100]}"
            log(f"  Face sync FAILED: {error}")

    except Exception as e:
        error = str(e)
        log(f"  Face sync ERROR: {e}")

    if status == "FAILED":
        failed_jobs.add(job_id)
        log(f"  Job {job_id} added to failed set — will not retry this session")

    try:
        report_r = requests.post(
            f"{HRMS_API}/face-sync/result",
            json={"jobId": job_id, "deviceId": DEVICE_ID, "status": status, "error": error},
            headers={"x-device-key": DEVICE_KEY},
            timeout=10,
        )
        log(f"  Result reported: {status} → {report_r.status_code}: {report_r.text[:200]}")
    except Exception as e:
        log(f"  Report failed: {e}")

def poll_face_sync():
    """
    Face sync loop. Attendance always wins:
      - Before each job, wait while a scan is pending (max 120s).
      - Sleep FACE_SYNC_JOB_GAP seconds between jobs so the device's
        event stream keeps flowing.
    """
    log("Face sync polling started (every 60s)")
    while True:
        beat("face_sync")
        try:
            r = requests.get(
                f"{HRMS_API}/face-sync/pending",
                params={"deviceId": DEVICE_ID},
                headers={"x-device-key": DEVICE_KEY},
                timeout=10,
            )
            if r.status_code == 200:
                jobs = [j for j in r.json().get("jobs", []) if j["jobId"] not in failed_jobs]
                if jobs:
                    log(f"{len(jobs)} face sync job(s) pending")
                for job in jobs:
                    # Yield to live attendance
                    waited = 0
                    while get_pending_scan() and waited < 120:
                        time.sleep(2)
                        waited += 2
                        beat("face_sync")
                    if waited:
                        log(f"Face sync waited {waited}s for attendance to finish")

                    sync_face(job)
                    beat("face_sync")
                    time.sleep(FACE_SYNC_JOB_GAP)
            else:
                log(f"Face sync poll: {r.status_code} {r.text[:100]}")
        except Exception as e:
            log(f"Face sync poll error: {e}")
        time.sleep(60)

# ─── Entry point ──────────────────────────────────────────────
if __name__ == "__main__":
    print("=== YCDO Biometric Agent ===")
    print(f"Mode:      {MODE.upper()}")
    print(f"Device:    {DEVICE_IP}")
    print(f"API:       {HRMS_API}")
    print(f"Device ID: {DEVICE_ID}")
    print(f"PKT Time:  {get_pakistan_time()}")
    print(f"Replay:    Last {REPLAY_HOURS} hours")
    print("=" * 35)

    threading.Thread(target=poll_face_sync, daemon=True).start()
    threading.Thread(target=watchdog,       daemon=True).start()
    if MODE == "stream":
        threading.Thread(target=pending_status_poller, daemon=True).start()

    # Verify credentials + auth scheme once, up front. A clear failure here
    # beats a loop of rejections, and it prints the model/firmware.
    if not probe_device_auth():
        log("Continuing anyway — main loop will re-probe periodically.")

    try:
        if MODE == "poll":
            poll_attendance()
        else:
            listen_attendance()
    except KeyboardInterrupt:
        close_active_stream()
        log("Stopped by user")
    except Exception as e:
        close_active_stream()
        log(f"FATAL: main loop crashed: {e} — exiting for restart")
        os._exit(1)
