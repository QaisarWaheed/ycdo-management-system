import requests
import re
import json
import datetime
import time
import threading
import io
from PIL import Image
from requests.auth import HTTPDigestAuth

# ─── Configuration ────────────────────────────────────────────
DEVICE_IP = "192.168.1.100"
DEVICE_USER = "admin"
DEVICE_PASS = "YCDOit@1122"
HRMS_API = "https://hrms-api.ycdo.org.pk"
DEVICE_KEY = "ycdo-device-secret-2026"
DEVICE_ID = "YCDO-CENTRAL-HOSPITAL"

REPLAY_HOURS = 24  # process events up to 24 hours old

auth = HTTPDigestAuth(DEVICE_USER, DEVICE_PASS)
pushed = set()
failed_jobs = set()
PKT = datetime.timezone(datetime.timedelta(hours=5))

# ─── Helpers ──────────────────────────────────────────────────
def get_pakistan_time():
    return datetime.datetime.now(PKT).isoformat()

def log(msg):
    print(f"[{get_pakistan_time()}] {msg}")

def is_recent(event_datetime_str):
    """Allow events within last REPLAY_HOURS hours."""
    try:
        dt = datetime.datetime.fromisoformat(event_datetime_str.replace('Z', '+00:00'))
        dt_pkt = dt.astimezone(PKT)
        now = datetime.datetime.now(PKT)
        diff = now - dt_pkt
        return diff.total_seconds() <= (REPLAY_HOURS * 3600)
    except Exception:
        return True

# ─── Attendance ───────────────────────────────────────────────
STATUS_TO_PUNCH = {
    "checkin": "CHECKIN",
    "checkout": "CHECKOUT",
    "overtimein": "OVERTIME_CHECKIN",
    "overtimecheckin": "OVERTIME_CHECKIN",
    "overtimeout": "OVERTIME_CHECKOUT",
    "overtimecheckout": "OVERTIME_CHECKOUT",
}


def map_punch_type(attendance_status):
    """Map device attendanceStatus to API punchType. Returns None if unknown."""
    if not attendance_status:
        return None
    key = re.sub(r"[^a-z]", "", attendance_status.lower())
    return STATUS_TO_PUNCH.get(key)


def to_pkt_timestamp(event_time=None):
    """Prefer device event time; fall back to now. Always PKT ISO."""
    if event_time:
        try:
            dt = datetime.datetime.fromisoformat(event_time.replace("Z", "+00:00"))
            return dt.astimezone(PKT).isoformat()
        except Exception:
            pass
    return get_pakistan_time()


def push_attendance(employee_no, attendance_status=None, event_time=None):
    try:
        punch_type = map_punch_type(attendance_status)
        if not punch_type:
            log(
                f"Skipping punch: employee={employee_no} "
                f"status={attendance_status or 'missing'} (no attendance status)"
            )
            return

        payload = {
            "biometricId": str(employee_no),
            "timestamp": to_pkt_timestamp(event_time),
            "deviceId": DEVICE_ID,
            "punchType": punch_type,
        }

        r = requests.post(
            f"{HRMS_API}/attendance/biometric-push",
            json=payload,
            headers={"x-device-key": DEVICE_KEY},
            timeout=10,
        )
        body = r.text[:200]
        if r.status_code >= 400:
            log(f"{punch_type} REJECTED: {employee_no} → {r.status_code}: {body}")
        else:
            log(f"{punch_type} pushed: {employee_no} → {r.status_code}: {body}")
    except Exception as e:
        log(f"Attendance push failed: {e}")


def listen_attendance():
    url = f"http://{DEVICE_IP}/ISAPI/Event/notification/alertStream"
    log(f"Connecting to device {DEVICE_IP}...")

    while True:
        try:
            r = requests.get(url, auth=auth, stream=True, timeout=300)
            log("Connected. Waiting for scans...")
            buf = ""
            last_status = None
            last_event_time = None

            for chunk in r.iter_content(chunk_size=4096):
                buf += chunk.decode("utf-8", errors="replace")

                date_match = re.search(r'"dateTime"\s*:\s*"([^"]+)"', buf)
                if date_match:
                    last_event_time = date_match.group(1)

                status_match = re.search(r'"attendanceStatus"\s*:\s*"(\w+)"', buf)
                if status_match:
                    captured = status_match.group(1)
                    if captured.lower() not in ("undefined", "unknown"):
                        last_status = captured

                emp_matches = re.findall(r'"employeeNoString"\s*:\s*"(\w+)"', buf)

                for emp_no in emp_matches:
                    if last_event_time and not is_recent(last_event_time):
                        log(f"Skipping old event: {emp_no} at {last_event_time}")
                        buf = ""
                        last_status = None
                        last_event_time = None
                        break

                    punch_type = map_punch_type(last_status)
                    event_key = (
                        f"{emp_no}-{last_event_time or 'notime'}-"
                        f"{punch_type or last_status or 'none'}"
                    )
                    if event_key in pushed:
                        # Drop stale employee id from buffer so it is not re-scanned
                        buf = re.sub(
                            rf'"employeeNoString"\s*:\s*"{re.escape(emp_no)}"',
                            "",
                            buf,
                            count=1,
                        )
                        continue

                    pushed.add(event_key)
                    current_status = last_status
                    log(
                        f"SCAN: employee={emp_no} status={current_status or 'missing'} "
                        f"time={last_event_time}"
                    )
                    push_attendance(emp_no, current_status, last_event_time)
                    last_status = None
                    buf = re.sub(
                        rf'"employeeNoString"\s*:\s*"{re.escape(emp_no)}"',
                        "",
                        buf,
                        count=1,
                    )

                    if len(pushed) > 1000:
                        pushed.clear()

                if len(buf) > 10000:
                    buf = buf[-5000:]

        except Exception as e:
            log(f"Attendance stream disconnected: {e}. Retry in 5s...")
            time.sleep(5)

# ─── Face Sync ────────────────────────────────────────────────
def resize_photo(photo_bytes, max_bytes=200000):
    try:
        img = Image.open(io.BytesIO(photo_bytes))
        if img.mode in ('RGBA', 'P', 'LA'):
            img = img.convert('RGB')
        img.thumbnail((640, 480), Image.LANCZOS)
        quality = 85
        while quality >= 20:
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=quality)
            size = output.tell()
            if size <= max_bytes:
                log(f"  Photo resized: {size} bytes (quality={quality})")
                return output.getvalue()
            quality -= 10
        img.thumbnail((320, 240), Image.LANCZOS)
        output = io.BytesIO()
        img.save(output, format='JPEG', quality=60)
        log(f"  Photo resized (small): {output.tell()} bytes")
        return output.getvalue()
    except Exception as e:
        log(f"  Photo resize error: {e}")
        return photo_bytes

def sync_face(job):
    job_id = job["jobId"]
    fpid = job["fpid"]
    photo_url = job["photoUrl"]
    full_name = job["fullName"]

    log(f"Syncing face: {full_name} (FPID={fpid})")
    status = "FAILED"
    error = None

    try:
        photo_r = requests.get(photo_url, timeout=15)
        if photo_r.status_code != 200:
            raise Exception(f"Photo download failed: {photo_r.status_code}")

        log(f"  Original photo: {len(photo_r.content)} bytes")
        face_bytes = resize_photo(photo_r.content)

        user_payload = {
            "UserInfo": {
                "employeeNo": str(fpid),
                "name": full_name[:32],
                "userType": "normal",
                "Valid": {
                    "enable": True,
                    "beginTime": "2026-01-01T00:00:00",
                    "endTime": "2037-12-31T23:59:59",
                    "timeType": "local"
                },
                "doorRight": "1",
                "RightPlan": [{"doorNo": 1, "planTemplateNo": "1"}],
                "localUIRight": False,
                "numOfFace": 1,
                "numOfFP": 0,
                "numOfCard": 0
            }
        }

        user_r = requests.post(
            f"http://{DEVICE_IP}/ISAPI/AccessControl/UserInfo/Record?format=json",
            data=json.dumps(user_payload),
            auth=auth,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        log(f"  User create: {user_r.status_code}")

        meta = json.dumps({
            "faceLibType": "blackFD",
            "FDID": "1",
            "FPID": str(fpid)
        })

        face_r = requests.put(
            f"http://{DEVICE_IP}/ISAPI/Intelligent/FDLib/FDSetUp?format=json",
            files={
                "FaceDataRecord": (None, meta, "application/json"),
                "img": ("face.jpg", face_bytes, "image/jpeg")
            },
            auth=auth,
            timeout=15
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
            json={
                "jobId": job_id,
                "deviceId": DEVICE_ID,
                "status": status,
                "error": error
            },
            headers={"x-device-key": DEVICE_KEY},
            timeout=10
        )
        log(f"  Result reported: {status} → {report_r.status_code}: {report_r.text[:200]}")
    except Exception as e:
        log(f"  Report failed: {e}")

def poll_face_sync():
    log("Face sync polling started (every 60s)")
    log(f"Face sync using deviceId={DEVICE_ID}")
    while True:
        try:
            r = requests.get(
                f"{HRMS_API}/face-sync/pending",
                params={"deviceId": DEVICE_ID},
                headers={"x-device-key": DEVICE_KEY},
                timeout=10,
            )
            if r.status_code == 200:
                jobs = r.json().get("jobs", [])
                jobs = [j for j in jobs if j["jobId"] not in failed_jobs]
                if jobs:
                    log(f"{len(jobs)} face sync jobs pending")
                for job in jobs:
                    sync_face(job)
            elif r.status_code == 404:
                log(
                    f"Face sync poll 404 for deviceId={DEVICE_ID!r}: {r.text[:200]}"
                )
                log(
                    "HINT: Register this deviceId in HRMS → Biometric Devices "
                    "(must match agent.py DEVICE_ID exactly), then restart the agent."
                )
            else:
                log(
                    f"Face sync poll: {r.status_code} deviceId={DEVICE_ID!r} "
                    f"{r.text[:150]}"
                )
        except Exception as e:
            log(f"Face sync poll error: {e}")
        time.sleep(60)

# ─── Main ─────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== YCDO Biometric Agent ===")
    print(f"Device:    {DEVICE_IP}")
    print(f"API:       {HRMS_API}")
    print(f"Device ID: {DEVICE_ID}")
    print(f"PKT Time:  {get_pakistan_time()}")
    print(f"Replay:    Last {REPLAY_HOURS} hours")
    print("=" * 35)

    face_thread = threading.Thread(target=poll_face_sync, daemon=True)
    face_thread.start()

    listen_attendance()