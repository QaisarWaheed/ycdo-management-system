"""
YCDO Biometric Agent — THIN variant (Phase 1A).

This is a SEPARATE script from agent.py. It does not replace or modify
agent.py — branches keep using agent.py against POST /attendance/biometric-push
exactly as before until they are individually switched to this script against
POST /attendance/raw-scan. Both endpoints and both agents can run in
production at the same time, branch by branch.

What changed vs agent.py: this agent does ZERO attendance business logic.
It does not map device status to CHECKIN/CHECKOUT, does not deduplicate,
and does not guess. It forwards exactly what the device reported —
{ biometricId, deviceId, deviceStatus, eventTime, serialNo, verifyMode } —
to the server, which owns all status mapping, permanent (deviceId, serialNo)
deduplication, and business rules.

What did NOT change: the device-communication layer (auth probing, the
Digest/Basic fallback, the alertStream/poll dual-mode handling, the
watchdog, connection-reuse quirks, AcsEvent query combos, backfill-after-
outage). That is hard-won reliability work against real Hikvision firmware
quirks, not business logic — it is carried forward from agent.py unchanged
in spirit, because there is no reason to re-litigate it for this phase.
Face-sync (photo enrollment) is also carried forward unchanged; it is a
separate concern from attendance and this phase does not touch it.
"""
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

REPLAY_HOURS = 0.5  # 30 min — do not forward hours-old reconnect dumps

# ── Mode ──
# "stream" = alertStream realtime push (modern devices)
# "poll"   = AcsEvent log polling (old models without alertStream support)
MODE = "stream"

# ── Stability tuning (stream mode) — unchanged from agent.py ──
STREAM_READ_TIMEOUT = 60
BACKFILL_MIN_GAP    = 90
STREAM_WAKE_SECONDS  = 1
STREAM_QUEUE_MAXSIZE = 256
STREAM_PUT_TIMEOUT   = 5
ACS_PAGE_SIZE        = 50

# ── Poll mode tuning — unchanged from agent.py ──
POLL_INTERVAL_SECONDS   = 5
POLL_LOOKBACK_MINUTES   = 15
POLL_MINOR              = 38
POLL_MAX_RESULTS        = 30

# ── Shared ──
FACE_SYNC_JOB_GAP   = 5
DEVICE_UTC_OFFSET_HOURS = 5

AUTH_MODE = "auto"

PKT = datetime.timezone(datetime.timedelta(hours=5))

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
    """Same as agent.py — verify credentials, pick digest vs basic, avoid lockout retries."""
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
        log(f"  device said: {last_body}")
        if "lock" in last_body.lower():
            log(
                "  ^ DEVICE IS LOCKED OUT. Stop this agent, then wait ~30 min "
                "or reboot the device. Every retry restarts the lock timer."
            )
        time.sleep(2)

    log(
        f"AUTH FAILED for user '{DEVICE_USER}' on {DEVICE_IP}. "
        f"Check: (1) device locked out? (2) password correct FOR THIS device? "
        f"(3) does this account have remote/network permission?"
    )
    return False

# ─── Device access serialization — unchanged from agent.py ────
device_lock = threading.Lock()

# ─── Active stream registry — unchanged from agent.py ─────────
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

# ─── Watchdog — unchanged from agent.py ────────────────────────
WATCHDOG_LIMITS = {
    "main":      300 if MODE == "stream" else 180,
    "face_sync": 300,
}
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
                close_active_stream()
                os._exit(1)

# ─── Helpers — unchanged from agent.py ─────────────────────────
def get_pakistan_time():
    return datetime.datetime.now(PKT).isoformat()

def log(msg):
    try:
        print(f"[{get_pakistan_time()}] {msg}", flush=True)
    except Exception:
        pass

def _close_quietly(closeable):
    try:
        if closeable is not None:
            closeable.close()
    except Exception:
        pass

def is_recent(event_datetime_str):
    try:
        dt = datetime.datetime.fromisoformat(event_datetime_str.replace("Z", "+00:00"))
        dt_pkt = dt.astimezone(PKT)
        now = datetime.datetime.now(PKT)
        diff = now - dt_pkt
        return diff.total_seconds() <= (REPLAY_HOURS * 3600)
    except Exception:
        return True

def device_tz():
    return datetime.timezone(datetime.timedelta(hours=DEVICE_UTC_OFFSET_HOURS))

def device_now():
    return datetime.datetime.now(device_tz())

def fmt_device_time(dt):
    dt = dt.astimezone(device_tz())
    sign = "+" if DEVICE_UTC_OFFSET_HOURS >= 0 else "-"
    return dt.strftime(f"%Y-%m-%dT%H:%M:%S{sign}{abs(DEVICE_UTC_OFFSET_HOURS):02d}:00")

def acs_post(payload, timeout=10):
    """Same as agent.py — fresh Session per call so the Digest challenge leg
    doesn't get broken by connection reuse on this firmware."""
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

# ─── Field extraction — unchanged from agent.py, plus serialNo ─
def extract_field(buf, name):
    m = re.search(rf'"{name}"\s*:\s*"([^"]*)"', buf, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(rf"<{name}>\s*([^<]*)\s*</{name}>", buf, re.I)
    if m:
        return m.group(1).strip()
    return None

def extract_int_field(buf, name):
    m = re.search(rf'"{name}"\s*:\s*(\d+)', buf, re.I)
    if m:
        return m.group(1)
    m = re.search(rf"<{name}>\s*(\d+)\s*</{name}>", buf, re.I)
    if m:
        return m.group(1)
    return None

def extract_employees(buf):
    emps = re.findall(r'"employeeNoString"\s*:\s*"(\w+)"', buf)
    if not emps:
        emps = re.findall(r"<employeeNoString>\s*([^<]+)\s*</employeeNoString>", buf, re.I)
        emps = [e.strip() for e in emps if e.strip()]
    return emps

# ─── Raw-scan forwarding — the ONLY "what does this event mean" code left ──
# in the agent, and it means nothing more than "relay it". No status
# mapping, no dedup, no CHECKIN/CHECKOUT decision. That all lives server-side
# now, at POST /attendance/raw-scan, keyed on (deviceId, serialNo).
def forward_raw_scan(employee_no, device_status, event_time=None, serial_no=None, verify_mode=None):
    """
    Forward one raw device event to the server. Never raises: a failed
    forward is logged and returns False so callers keep running. serialNo
    is required by the server contract (it is the idempotency key together
    with deviceId) — if the device genuinely didn't provide one, a
    synthesized fallback is used so the event isn't silently dropped, but
    this should not normally happen on devices that support AcsEvent/
    alertStream, which always include serialNo.
    """
    try:
        resolved_serial = str(serial_no) if serial_no not in (None, "") else f"no-serial-{int(time.time() * 1000)}"
        if serial_no in (None, ""):
            log(f"WARNING: device event for employee={employee_no} had no serialNo — "
                f"using a synthesized one ({resolved_serial}); this event cannot be "
                f"deduplicated against a real replay of the same device event.")

        payload = {
            "biometricId": str(employee_no),
            "deviceId":    DEVICE_ID,
            "deviceStatus": str(device_status) if device_status not in (None, "") else "",
            "eventTime":   event_time or get_pakistan_time(),
            "serialNo":    resolved_serial,
            "verifyMode":  str(verify_mode) if verify_mode not in (None, "") else "",
        }
        r = requests.post(
            f"{HRMS_API}/attendance/raw-scan",
            json=payload,
            headers={"x-device-key": DEVICE_KEY},
            timeout=10,
        )
        body = r.text[:200]
        if r.status_code >= 400:
            log(f"raw-scan REJECTED: employee={employee_no} status={device_status!r} "
                f"serial={resolved_serial} -> {r.status_code}: {body}")
            return False
        log(f"raw-scan forwarded: employee={employee_no} status={device_status!r} "
            f"serial={resolved_serial} -> {r.status_code}: {body}")
        return True
    except Exception as e:
        log(f"raw-scan forward error: employee={employee_no} status={device_status!r}: {e}")
        return False

# ─── Backfill after stream outage — same shape as agent.py, forwards raw ──
def backfill_missed_events(since_dt):
    """
    After a stream outage/stall, pull the device event log for the gap and
    forward every row that has an employee number — raw, unfiltered. The
    server's (deviceId, serialNo) dedup makes this safe to re-run even if
    some of these rows were already delivered live before the outage.
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
            while position < 300:
                beat("main")
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
                        if forward_raw_scan(
                            emp,
                            status,
                            event_time=info.get("time"),
                            serial_no=info.get("serialNo"),
                            verify_mode=info.get("currentVerifyMode"),
                        ):
                            recovered += 1

                    if len(info_list) < ACS_PAGE_SIZE:
                        break
                    position += len(info_list)
                except Exception as e:
                    log(f"Backfill error (major={major} minor={minor}): {e}")
                    break

    log(f"Backfill complete: {recovered} event(s) recovered")

# ─── Poll mode (old device models without alertStream) ────────
seen_events = set()  # technical dedup only — same device event row read
                      # twice from an overlapping poll window. The server's
                      # (deviceId, serialNo) table is the real dedup.

def poll_attendance():
    log(
        f"POLL mode: querying AcsEvent every {POLL_INTERVAL_SECONDS}s "
        f"(lookback {POLL_LOOKBACK_MINUTES} min)"
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
                any_success = False
                for major, minor in acs_query_combos():
                    position = 0
                    while position < 300:
                        beat("main")
                        payload = {
                            "AcsEventCond": {
                                "searchID":             f"ycdo-poll-{int(time.time())}-{major}-{minor}",
                                "searchResultPosition": position,
                                "maxResults":           POLL_MAX_RESULTS,
                                "major":                major,
                                "minor":                minor,
                                "startTime":            start,
                                "endTime":              end,
                            }
                        }
                        resp = acs_post(payload, timeout=10)
                        if resp.status_code != 200:
                            note_acs_combo((major, minor), False, resp.text)
                            if resp.status_code == 401:
                                auth_fail = True
                            log(f"POLL query failed (major={major} minor={minor}): HTTP {resp.status_code}")
                            break

                        note_acs_combo((major, minor), True)
                        any_success = True
                        info_list = (resp.json().get("AcsEvent") or {}).get("InfoList") or []
                        if not info_list:
                            break
                        rows.extend(info_list)
                        if len(info_list) < POLL_MAX_RESULTS:
                            break
                        position += len(info_list)

                    if auth_fail:
                        break

                if not any_success:
                    rejected = True

            if rejected:
                if auth_fail:
                    if probe_device_auth():
                        log("Transient AcsEvent 401 — auth still valid, retrying shortly")
                        time.sleep(POLL_INTERVAL_SECONDS)
                    else:
                        log("Auth genuinely failing — backing off 5 min")
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
                    continue

                verify = str(info.get("currentVerifyMode") or "").strip().lower()
                if verify in ("", "invalid"):
                    continue

                serial = info.get("serialNo")
                t = info.get("time") or ""
                ekey = f"{emp}|{serial or t}"
                if ekey in seen_events:
                    continue
                seen_events.add(ekey)
                if len(seen_events) > 20000:
                    seen_events.clear()
                new_count += 1

                status = info.get("attendanceStatus") or info.get("label")
                log(f"POLL scan: employee={emp} status={status!r} verify={verify} "
                    f"serial={serial} time={t}")
                forward_raw_scan(emp, status, event_time=t, serial_no=serial, verify_mode=verify)

            if new_count == 0:
                empty_cycles += 1
                if empty_cycles % 120 == 0:
                    log("POLL: no new events for a while — if staff ARE scanning, "
                        "check device clock / DEVICE_UTC_OFFSET_HOURS")
            else:
                empty_cycles = 0

        except Exception as e:
            log(f"POLL error: {e}")
            time.sleep(5)

        time.sleep(POLL_INTERVAL_SECONDS)

# ─── Attendance stream (modern devices) ────────────────────────
_STREAM_EOF = object()

class _StreamFailure:
    def __init__(self, exc):
        self.exc = exc

def _stream_reader(resp, out_queue):
    try:
        for chunk in resp.iter_content(chunk_size=4096):
            if not chunk:
                continue
            try:
                out_queue.put(chunk, timeout=STREAM_PUT_TIMEOUT)
            except queue.Full:
                return
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
    Connect to device alertStream and forward every event that carries an
    employee number. Unlike agent.py, there is no "wait for CheckIn/CheckOut
    selection on the device screen" step — devices are in T&A Manual mode
    and report their own status (attendanceStatus/label/statusValue) in the
    same event, so each event is forwarded as soon as it's seen. If an event
    genuinely arrives with an employee but no status at all, it is still
    forwarded (with an empty deviceStatus) rather than held — the server's
    AUTO fallback handles that case; the agent does not wait or guess.
    """
    url = f"http://{DEVICE_IP}/ISAPI/Event/notification/alertStream"
    log(f"Connecting to device {DEVICE_IP}...")

    last_ok = None

    while True:
        beat("main")
        r = None
        stream_session = None
        try:
            stream_session = requests.Session()
            stream_session.headers.update({"Connection": "close"})
            r = stream_session.get(
                url,
                auth=_auth_for(_auth_name),
                stream=True,
                timeout=(10, STREAM_READ_TIMEOUT),
            )

            if r.status_code != 200:
                snippet = ""
                try:
                    snippet = (r.text or "")[:600]
                except Exception:
                    pass
                _close_quietly(r)
                _close_quietly(stream_session)
                low = snippet.lower()
                slots_full = "deployexceedmax" in low

                if slots_full:
                    log("Stream rejected: event-subscription slots FULL on the device. "
                        "Reboot the device or make sure only ONE agent runs against it.")
                    for _ in range(12):
                        beat("main")
                        time.sleep(5)
                elif r.status_code == 401:
                    if probe_device_auth():
                        log("Transient stream 401 — auth still valid, reconnecting shortly")
                        time.sleep(5)
                    else:
                        log("Auth genuinely failing — backing off 5 min")
                        for _ in range(60):
                            beat("main")
                            time.sleep(5)
                        probe_device_auth()
                else:
                    log(f"Stream rejected: HTTP {r.status_code}: {snippet}")
                    time.sleep(30)
                continue

            log("Connected (HTTP 200). Waiting for scans...")
            beat("main")
            set_active_stream(r, stream_session)

            if last_ok:
                gap = (datetime.datetime.now(PKT) - last_ok).total_seconds()
                if gap > BACKFILL_MIN_GAP:
                    log(f"Stream was down {int(gap)}s — running backfill")
                    backfill_missed_events(last_ok)
            last_ok = datetime.datetime.now(PKT)

            buf = ""
            total_bytes = 0
            head = ""

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

                date_match = re.search(r'"dateTime"\s*:\s*"([^"]+)"', buf)
                last_event_time = date_match.group(1) if date_match else None
                if not last_event_time:
                    xml_date = re.search(r"<dateTime>\s*([^<]+)\s*</dateTime>", buf, re.I)
                    if xml_date:
                        last_event_time = xml_date.group(1).strip()

                emps = extract_employees(buf)
                status = extract_field(buf, "attendanceStatus") or extract_field(buf, "label")
                serial = extract_field(buf, "serialNo") or extract_int_field(buf, "serialNo")
                verify_mode = extract_field(buf, "currentVerifyMode")
                has_status_field = bool(
                    re.search(r'"attendanceStatus"\s*:', buf, re.I)
                    or re.search(r'"label"\s*:', buf, re.I)
                    or re.search(r'"statusValue"\s*:', buf, re.I)
                    or re.search(r"<attendanceStatus>", buf, re.I)
                )

                if not emps:
                    if len(buf) > 10000:
                        buf = buf[-5000:]
                    continue

                if last_event_time and not is_recent(last_event_time):
                    stale_emp = emps[0]
                    log(f"Skipping old event: employee={stale_emp} at {last_event_time}")
                    buf = ""
                    continue

                # Devices in T&A Manual mode report status in the same event
                # as the employee number — forward as soon as we have both,
                # or once the buffer has grown enough that no more status is
                # coming (forward anyway, empty status, server's AUTO handles it).
                if status or not has_status_field or len(buf) >= 8000:
                    emp_no = emps[0]
                    log(f"SCAN: employee={emp_no} status={status!r} serial={serial}")
                    forward_raw_scan(emp_no, status, event_time=last_event_time, serial_no=serial, verify_mode=verify_mode)
                    buf = ""
                    continue

                if len(buf) > 10000:
                    buf = buf[-5000:]

            set_active_stream(None, None)
            _close_quietly(r)
            _close_quietly(stream_session)

            if idle_refresh:
                log(f"Stream idle {STREAM_READ_TIMEOUT}s — refreshing connection")
                time.sleep(1)
                continue

            log(f"Stream closed by device after {total_bytes} bytes — reconnecting in 5s...")
            if 0 < total_bytes < 2000:
                log(f"  Device sent: {head!r}")
            time.sleep(5)

        except requests.exceptions.RequestException as e:
            beat("main")
            set_active_stream(None, None)
            _close_quietly(r)
            _close_quietly(stream_session)
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

# ─── Face sync — unchanged from agent.py, unrelated to this phase ─────
failed_jobs = set()

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
                return output.getvalue()
            quality -= 10
        img.thumbnail((320, 240), Image.LANCZOS)
        output = io.BytesIO()
        img.save(output, format="JPEG", quality=60)
        return output.getvalue()
    except Exception as e:
        log(f"  Photo resize error: {e}")
        return photo_bytes

def sync_face(job):
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
                for job in jobs:
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
    print("=== YCDO Biometric Agent (THIN) ===")
    print(f"Mode:      {MODE.upper()}")
    print(f"Device:    {DEVICE_IP}")
    print(f"API:       {HRMS_API}/attendance/raw-scan")
    print(f"Device ID: {DEVICE_ID}")
    print(f"PKT Time:  {get_pakistan_time()}")
    print("=" * 35)

    threading.Thread(target=poll_face_sync, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()

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
