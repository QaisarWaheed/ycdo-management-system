"""
YCDO Face Agent — thin on-site enroll only.

Talks to the Hikvision Gateway (not HRMS directly):
  POST /agent/heartbeat
  GET  /agent/face-sync/pending
  POST /agent/face-sync/result

Attendance punches go device → gateway HTTP Listening. This process only
pushes faces onto the terminal over LAN ISAPI.

Edit the CONFIG block per branch, then:
  python face_agent.py
"""

from __future__ import annotations

import io
import json
import os
import sys
import threading
import time
from typing import Any

import requests
from PIL import Image
from requests.auth import HTTPBasicAuth, HTTPDigestAuth

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ─── CONFIG (edit per branch) ─────────────────────────────────
GATEWAY_URL = "https://biometric-gateway.ycdo.org.pk"
AGENT_TOKEN = "5af43e593d8285faf7dbce462e48983e6033a47e48d44dbe52d4a2b61332aa56"

DEVICE_IP = "192.168.1.13"
DEVICE_USER = "admin"
DEVICE_PASS = "IT@Umar1122"

# "auto" tries Digest then Basic. Force "digest" or "basic" if needed.
AUTH_MODE = "auto"

HEARTBEAT_SECONDS = 30
POLL_SECONDS = 60
FACE_SYNC_JOB_GAP = 5
AGENT_VERSION = "1.0.0"
# ───────────────────────────────────────────────────────────────

failed_jobs: set[str] = set()
device_lock = threading.Lock()
auth: Any = HTTPDigestAuth(DEVICE_USER, DEVICE_PASS)
_auth_name = "digest"


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def _auth_for(name: str):
    if name == "digest":
        return HTTPDigestAuth(DEVICE_USER, DEVICE_PASS)
    return HTTPBasicAuth(DEVICE_USER, DEVICE_PASS)


def gateway_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {AGENT_TOKEN}",
        "X-Agent-Version": AGENT_VERSION,
    }


def probe_device_auth() -> bool:
    """Verify credentials; avoid tight 401 loops (device lockout)."""
    global auth, _auth_name
    candidates = ["digest", "basic"] if AUTH_MODE == "auto" else [AUTH_MODE]
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
            log(f"AUTH OK via {name.upper()}")
            return True
        log(f"AUTH PROBE ({name}): HTTP {r.status_code}")
    log("AUTH FAILED — check DEVICE_IP / USER / PASS")
    return False


def resize_photo(photo_bytes: bytes, max_bytes: int = 200_000) -> bytes:
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


def sync_face(job: dict) -> None:
    job_id = job["jobId"]
    fpid = job["fpid"]
    photo_url = job["photoUrl"]
    full_name = job.get("fullName") or "Employee"

    log(f"Syncing face: {full_name} (FPID={fpid})")
    status = "FAILED"
    error = None

    try:
        photo_r = requests.get(photo_url, timeout=20)
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
                    "timeType": "local",
                },
                "doorRight": "1",
                "RightPlan": [{"doorNo": 1, "planTemplateNo": "1"}],
                "localUIRight": False,
                "numOfFace": 1,
                "numOfFP": 0,
                "numOfCard": 0,
            }
        }
        meta = json.dumps(
            {"faceLibType": "blackFD", "FDID": "1", "FPID": str(fpid)}
        )

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
                    "img": ("face.jpg", face_bytes, "image/jpeg"),
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
        log(f"  Job {job_id} will not retry this session")

    try:
        report_r = requests.post(
            f"{GATEWAY_URL.rstrip('/')}/agent/face-sync/result",
            json={"jobId": job_id, "status": status, "error": error},
            headers={**gateway_headers(), "Content-Type": "application/json"},
            timeout=15,
        )
        log(
            f"  Result reported: {status} → {report_r.status_code}: "
            f"{report_r.text[:200]}"
        )
    except Exception as e:
        log(f"  Report failed: {e}")


def heartbeat_loop() -> None:
    log(f"Heartbeat every {HEARTBEAT_SECONDS}s → {GATEWAY_URL}")
    while True:
        try:
            r = requests.post(
                f"{GATEWAY_URL.rstrip('/')}/agent/heartbeat",
                json={"version": AGENT_VERSION},
                headers={**gateway_headers(), "Content-Type": "application/json"},
                timeout=15,
            )
            if r.status_code == 200:
                data = r.json() if r.content else {}
                device = data.get("hrmsDeviceId") or "?"
                log(f"Heartbeat OK (device={device})")
            else:
                log(f"Heartbeat HTTP {r.status_code}: {r.text[:120]}")
        except Exception as e:
            log(f"Heartbeat error: {e}")
        time.sleep(HEARTBEAT_SECONDS)


def poll_face_sync() -> None:
    log(f"Face sync poll every {POLL_SECONDS}s")
    while True:
        try:
            r = requests.get(
                f"{GATEWAY_URL.rstrip('/')}/agent/face-sync/pending",
                headers=gateway_headers(),
                timeout=30,
            )
            if r.status_code == 200:
                jobs = [
                    j
                    for j in r.json().get("jobs", [])
                    if j.get("jobId") not in failed_jobs
                ]
                if jobs:
                    log(f"{len(jobs)} face sync job(s) pending")
                for job in jobs:
                    sync_face(job)
                    time.sleep(FACE_SYNC_JOB_GAP)
            else:
                log(f"Pending poll HTTP {r.status_code}: {r.text[:120]}")
        except Exception as e:
            log(f"Pending poll error: {e}")
        time.sleep(POLL_SECONDS)


def main() -> None:
    if not AGENT_TOKEN or AGENT_TOKEN.startswith("PASTE_"):
        log("Set AGENT_TOKEN from gateway /admin/ → New agent token")
        sys.exit(1)
    if not DEVICE_PASS or DEVICE_PASS == "CHANGE_ME":
        log("Set DEVICE_PASS to the Hikvision admin password")
        sys.exit(1)

    print("=== YCDO Face Agent ===")
    print(f"Gateway:  {GATEWAY_URL}")
    print(f"Device:   {DEVICE_IP}")
    print(f"Version:  {AGENT_VERSION}")
    print("=" * 28)

    if not probe_device_auth():
        log("Continuing anyway — will retry auth on first job")

    threading.Thread(target=heartbeat_loop, daemon=True).start()
    try:
        poll_face_sync()
    except KeyboardInterrupt:
        log("Stopped by user")


if __name__ == "__main__":
    main()
