"use strict";

const express = require("express");
const multer = require("multer");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createDeviceStore } = require("./device-store");
const { createAdminRouter } = require("./admin-api");
const { createAgentRouter } = require("./agent-api");
const { deliveryOutcome } = require("./hrms-response");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 8, fields: 50 },
});

const cfg = {
  port: Number(process.env.PORT || 9000),
  hrmsApi: String(process.env.HRMS_API || "").replace(/\/$/, ""),
  rawScanPath: process.env.HRMS_RAW_SCAN_PATH || "/attendance/raw-scan",
  deviceApiKey: process.env.DEVICE_API_KEY || "",
  dbPath:
    process.env.DB_PATH ||
    (process.env.NODE_ENV === "production"
      ? "/app/data/events.db"
      : path.join(__dirname, "..", "data", "events.db")),
  dataDir:
    process.env.DATA_DIR ||
    (process.env.NODE_ENV === "production" ? "/app/data" : path.join(__dirname, "..", "data")),
  devicesConfig: process.env.DEVICES_CONFIG || path.join(__dirname, "..", "config", "devices.json"),
  outboxPollMs: Number(process.env.OUTBOX_POLL_MS || 3000),
  retryBaseMs: Number(process.env.RETRY_BASE_MS || 5000),
  retryMaxMs: Number(process.env.RETRY_MAX_MS || 300000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 12000),
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
  saveImages: process.env.SAVE_IMAGES === "1" || process.env.SAVE_IMAGES === "true",
  captureDir: process.env.CAPTURE_DIR || path.join(__dirname, "..", "data", "captures"),
  adminToken: process.env.ADMIN_TOKEN || "",
  biometricDeviceKey: process.env.BIOMETRIC_DEVICE_KEY || "",
  sendAuthMethod: process.env.SEND_AUTH_METHOD === "1" || process.env.SEND_AUTH_METHOD === "true",
};

if (!cfg.hrmsApi) throw new Error("HRMS_API is required");
if (!cfg.deviceApiKey) throw new Error("DEVICE_API_KEY is required");

app.set("trust proxy", cfg.trustProxy ? 1 : false);
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
if (cfg.saveImages) fs.mkdirSync(cfg.captureDir, { recursive: true });

const dbExistedBeforeStart = fs.existsSync(cfg.dbPath);

function log(level, message, data) {
  const entry = { time: new Date().toISOString(), level, message, ...(data || {}) };
  console.log(JSON.stringify(entry));
}

function parseDevicesConfigForSeed(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : raw;
  if (typeof trimmed === "string" && !trimmed.startsWith("{")) {
    throw new Error(
      "DEVICES_JSON must be a JSON object like {\"devices\":[...]}. Remove this env var if you use the /admin/ UI instead.",
    );
  }
  const parsed = typeof trimmed === "string" ? JSON.parse(trimmed) : trimmed;
  if (!Array.isArray(parsed.devices)) throw new Error("devices config must contain a devices array");
  return parsed.devices;
}

function loadConfigDevicesForSeed() {
  const envJson = process.env.DEVICES_JSON?.trim();
  if (envJson) {
    if (!envJson.startsWith("{")) {
      log("warn", "DEVICES_JSON is not valid JSON — skipping seed. Remove it or use /admin/ to add devices.", {
        hint: 'Expected {"devices":[...]}',
      });
      return [];
    }
    return parseDevicesConfigForSeed(envJson);
  }
  if (fs.existsSync(cfg.devicesConfig)) {
    return parseDevicesConfigForSeed(fs.readFileSync(cfg.devicesConfig, "utf8"));
  }
  return [];
}

const db = new Database(cfg.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");

const deviceStore = createDeviceStore(db, log);
try {
  const seeded = deviceStore.seedFromConfig(loadConfigDevicesForSeed());
  if (seeded === 0 && deviceStore.listAll().length === 0) {
    log("info", "No devices configured yet — add branches at /admin/ (Devices tab)");
  }
} catch (err) {
  log("warn", "Could not seed devices from config", {
    error: err.message,
    hint: "Remove DEVICES_JSON or fix JSON; use /admin/ UI to manage devices",
  });
}

const registeredDevices = deviceStore.listAll().length;
log("info", "Gateway storage", {
  dbPath: cfg.dbPath,
  dataDir: cfg.dataDir,
  dbExistedBeforeStart,
  registeredDevices,
  persistenceHint:
    "Mount /app/data as a CapRover Persistent Directory so devices and events survive redeploy",
});
if (!dbExistedBeforeStart && registeredDevices === 0) {
  log("warn", "Fresh database — add CapRover persistent volume /app/data before registering devices", {
    capRoverSteps:
      "App Configs → Persistent Directories → Path in App: /app/data → Save & Update",
  });
}

function getDevices() {
  return deviceStore.getActiveDevices();
}
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  hikvision_device_id TEXT,
  employee_no TEXT NOT NULL,
  device_time TEXT NOT NULL,
  received_time TEXT NOT NULL,
  attendance_status TEXT NOT NULL,
  raw_attendance_status TEXT,
  auth_method TEXT,
  serial_no TEXT,
  major_event_type TEXT,
  sub_event_type TEXT,
  source_ip TEXT,
  raw_json TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  hrms_http_status INTEGER,
  hrms_response TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_delivery ON events(delivery_status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_events_employee_time ON events(employee_no, device_time);
`);

try {
  db.exec(`ALTER TABLE events ADD COLUMN hrms_reason TEXT`);
} catch {
  /* column already exists */
}

try {
  db.exec(`
    UPDATE events
    SET hrms_reason = json_extract(hrms_response, '$.reason')
    WHERE hrms_reason IS NULL
      AND hrms_response IS NOT NULL
      AND json_valid(hrms_response) = 1
      AND json_extract(hrms_response, '$.reason') IS NOT NULL
  `);
} catch {
  /* best-effort backfill for existing rows */
}

const insertEvent = db.prepare(`
INSERT INTO events (
  event_key, device_id, hikvision_device_id, employee_no, device_time, received_time,
  attendance_status, raw_attendance_status, auth_method, serial_no, major_event_type,
  sub_event_type, source_ip, raw_json, delivery_status, hrms_reason, next_attempt_at, created_at, updated_at
) VALUES (
  @event_key, @device_id, @hikvision_device_id, @employee_no, @device_time, @received_time,
  @attendance_status, @raw_attendance_status, @auth_method, @serial_no, @major_event_type,
  @sub_event_type, @source_ip, @raw_json, @delivery_status, @hrms_reason, @next_attempt_at, @created_at, @updated_at
)`);

const STALE_PUNCH_MS = 30 * 60 * 1000;
const FUTURE_PUNCH_MS = 5 * 60 * 1000;
const BAD_CALENDAR_MS = 24 * 60 * 60 * 1000;

function parseDevicePunchMs(deviceTime) {
  const raw = String(deviceTime || "").trim();
  const instant = Date.parse(raw);
  const naive = raw.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  const pktWall = naive
    ? Date.parse(`${naive[1].replace(" ", "T")}+05:00`)
    : NaN;
  return { instant, pktWall };
}

function pakistanMinutesOfDay(ms) {
  const pk = new Date(ms + 5 * 60 * 60 * 1000);
  return pk.getUTCHours() * 60 + pk.getUTCMinutes();
}

function clockOfDayClose(aMs, bMs) {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  const diff = Math.abs(pakistanMinutesOfDay(aMs) - pakistanMinutesOfDay(bMs));
  return Math.min(diff, 24 * 60 - diff) <= 30;
}

function isLiveDeviceClock(t, recv) {
  const delta = recv - t;
  return delta <= STALE_PUNCH_MS && delta >= -FUTURE_PUNCH_MS;
}

function isStaleReconnectDump(deviceTime, receivedAt) {
  const recv = Date.parse(String(receivedAt));
  const { instant, pktWall } = parseDevicePunchMs(deviceTime);
  if (!Number.isFinite(recv)) return false;
  const candidates = [instant, pktWall].filter((t) => Number.isFinite(t));
  if (candidates.some((t) => isLiveDeviceClock(t, recv))) return false;
  if (
    candidates.some(
      (t) => Math.abs(recv - t) > BAD_CALENDAR_MS && clockOfDayClose(t, recv),
    )
  ) {
    return false;
  }
  const t = Number.isFinite(instant) ? instant : pktWall;
  if (!Number.isFinite(t)) return false;
  const delta = recv - t;
  return delta > STALE_PUNCH_MS || delta < -FUTURE_PUNCH_MS;
}

function normalizeIp(ip) {
  if (!ip) return "";
  let v = String(ip).trim();
  if (v.startsWith("::ffff:")) v = v.slice(7);
  return v;
}

function isIpAllowed(device, sourceIp) {
  const list = Array.isArray(device.allowedPublicIps) ? device.allowedPublicIps.filter(Boolean) : [];
  if (!list.length) return true;
  const ip = normalizeIp(sourceIp);
  return list.some((allowed) => normalizeIp(allowed) === ip);
}

function constantTimeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function resolveDevice(token) {
  return getDevices().find((d) => constantTimeEqual(d.token, token));
}

function parseJsonSafe(v) {
  if (v == null) return null;
  if (typeof v === "object" && !Buffer.isBuffer(v)) return v;
  try { return JSON.parse(Buffer.isBuffer(v) ? v.toString("utf8") : String(v)); }
  catch { return null; }
}

function extractEvent(req) {
  if (req.body?.event_log) {
    const parsed = parseJsonSafe(req.body.event_log);
    if (parsed) return parsed;
  }

  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      const looksJson = f.mimetype === "application/json" || /json|event[_-]?log/i.test(f.fieldname || "");
      if (!looksJson) continue;
      const parsed = parseJsonSafe(f.buffer);
      if (parsed) return parsed;
    }
  }

  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
    return req.body;
  }

  return null;
}

const STATUS_MAP = new Map([
  ["checkin", "CHECK_IN"],
  ["checkout", "CHECK_OUT"],
  ["overtimein", "OVERTIME_IN"],
  ["overtimeout", "OVERTIME_OUT"],
]);

function normalizeAttendanceStatus(raw) {
  const key = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  return STATUS_MAP.get(key) || null;
}

function detectAuthMethod(event, ace) {
  const raw = ace?.currentVerifyMode ?? ace?.verifyMode ?? event?.currentVerifyMode ?? event?.verifyMode ?? null;
  if (raw == null) return null;
  const s = String(raw).toLowerCase();
  if (s.includes("face")) return "FACE";
  if (s.includes("finger")) return "FINGERPRINT";
  if (s.includes("card")) return "CARD";
  return String(raw).slice(0, 80);
}

function buildEventKey(n) {
  if (n.serialNo) return `serial:${n.deviceId}:${n.serialNo}`;
  const material = [
    n.deviceId, n.hikvisionDeviceId || "", n.employeeNo, n.deviceTime,
    n.attendanceStatus, n.majorEventType || "", n.subEventType || "", n.authMethod || ""
  ].join("|");
  return "hash:" + crypto.createHash("sha256").update(material).digest("hex");
}

function eventDeviceId(event, ace) {
  return event?.deviceID ?? event?.deviceId ?? ace?.deviceID ?? ace?.deviceName ?? null;
}

function normalizeEvent(event, device, sourceIp, receivedAt) {
  const ace = event?.AccessControllerEvent || event?.accessControllerEvent || null;
  if (!ace) return { skip: true, reason: "NO_ACCESS_CONTROLLER_EVENT" };

  const employeeNo = ace.employeeNoString ?? ace.employeeNo ?? null;
  if (employeeNo == null || String(employeeNo).trim() === "") {
    return { skip: true, reason: "NO_EMPLOYEE_NO" };
  }

  const rawStatus = ace.attendanceStatus ?? event.attendanceStatus ?? null;
  const status = normalizeAttendanceStatus(rawStatus);
  if (!status) {
    return { skip: true, reason: "UNSUPPORTED_ATTENDANCE_STATUS", rawStatus: rawStatus ?? null };
  }

  const hikvisionDeviceId = eventDeviceId(event, ace);
  const expected = Array.isArray(device.hikvisionDeviceIds) ? device.hikvisionDeviceIds.filter(Boolean).map(String) : [];
  if (expected.length && hikvisionDeviceId != null && !expected.includes(String(hikvisionDeviceId))) {
    return { reject: true, reason: "HIKVISION_DEVICE_ID_MISMATCH", hikvisionDeviceId: String(hikvisionDeviceId) };
  }

    const serialNo = ace.serialNo ?? ace.serialNumber ?? event.serialNo ?? event.serialNumber ?? null;
    // Punch clock lives on AccessControllerEvent. The outer EventNotificationAlert
    // dateTime is often the reconnect/envelope time and would stamp a whole
    // offline dump onto one instant.
    const deviceTime = ace.dateTime ?? event.dateTime ?? event.deviceTime ?? receivedAt;
  const authMethod = detectAuthMethod(event, ace);

  const normalized = {
    deviceId: String(device.hrmsDeviceId),
    hikvisionDeviceId: hikvisionDeviceId == null ? null : String(hikvisionDeviceId),
    employeeNo: String(employeeNo),
    deviceTime: String(deviceTime),
    receivedTime: receivedAt,
    attendanceStatus: status,
    rawAttendanceStatus: rawStatus == null ? null : String(rawStatus),
    authMethod,
    serialNo: serialNo == null ? null : String(serialNo),
    majorEventType: ace.majorEventType == null ? null : String(ace.majorEventType),
    subEventType: ace.subEventType == null ? null : String(ace.subEventType),
    sourceIp: normalizeIp(sourceIp),
    raw: event,
  };
  normalized.eventKey = buildEventKey(normalized);
  return normalized;
}

function saveImages(req, eventId) {
  if (!cfg.saveImages || !Array.isArray(req.files)) return;
  let i = 0;
  for (const f of req.files) {
    if (!String(f.mimetype || "").startsWith("image/")) continue;
    i += 1;
    const ext = f.mimetype.includes("png") ? "png" : "jpg";
    const filename = `${eventId}_${i}.${ext}`;
    fs.writeFileSync(path.join(cfg.captureDir, filename), f.buffer);
  }
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "ycdo-hikvision-gateway",
    health: "/health",
    admin: cfg.adminToken ? "/admin/" : null,
  });
});

app.get("/health", (_req, res) => {
  const pending = db.prepare("SELECT COUNT(*) AS c FROM events WHERE delivery_status IN ('PENDING','RETRY')").get().c;
  const deviceCount = deviceStore.listAll().length;
  res.json({
    ok: true,
    service: "ycdo-hikvision-gateway",
    devices: deviceCount,
    enabledDevices: getDevices().length,
    pending,
    dbPath: cfg.dbPath,
    dataDir: cfg.dataDir,
    adminUi: cfg.adminToken ? "/admin/" : null,
  });
});

app.post("/hikvision/event/:token", upload.any(), (req, res) => {
  const receivedAt = new Date().toISOString();
  const sourceIp = normalizeIp(req.ip || req.socket.remoteAddress);
  const device = resolveDevice(req.params.token);

  // Always keep Hikvision transport behavior simple: acknowledge handled requests with 200.
  // Unknown token/IP are security failures and intentionally get 403.
  if (!device) {
    log("warn", "Unknown device token", { sourceIp });
    return res.status(403).send("Forbidden");
  }
  if (!isIpAllowed(device, sourceIp)) {
    log("warn", "Source IP not allowed", { deviceId: device.hrmsDeviceId, sourceIp });
    return res.status(403).send("Forbidden");
  }

  const event = extractEvent(req);
  if (!event) {
    log("warn", "No event JSON parsed", { deviceId: device.hrmsDeviceId, sourceIp });
    return res.status(200).send("OK");
  }

  const n = normalizeEvent(event, device, sourceIp, receivedAt);
  if (n.reject) {
    log("warn", "Event rejected before storage", { deviceId: device.hrmsDeviceId, reason: n.reason, sourceIp });
    return res.status(200).send("OK");
  }
  if (n.skip) {
    log("info", "Non-attendance/noise event ignored", { deviceId: device.hrmsDeviceId, reason: n.reason, rawStatus: n.rawStatus });
    return res.status(200).send("OK");
  }

  const now = new Date().toISOString();
  const staleDump = isStaleReconnectDump(n.deviceTime, n.receivedTime);
  try {
    const info = insertEvent.run({
      event_key: n.eventKey,
      device_id: n.deviceId,
      hikvision_device_id: n.hikvisionDeviceId,
      employee_no: n.employeeNo,
      device_time: n.deviceTime,
      received_time: n.receivedTime,
      attendance_status: n.attendanceStatus,
      raw_attendance_status: n.rawAttendanceStatus,
      auth_method: n.authMethod,
      serial_no: n.serialNo,
      major_event_type: n.majorEventType,
      sub_event_type: n.subEventType,
      source_ip: n.sourceIp,
      raw_json: JSON.stringify(n.raw),
      delivery_status: staleDump ? "REJECTED_BY_HRMS" : "PENDING",
      hrms_reason: staleDump ? "STALE_DEVICE_EVENT" : null,
      next_attempt_at: staleDump ? null : now,
      created_at: now,
      updated_at: now,
    });
    saveImages(req, info.lastInsertRowid);
    log("info", staleDump ? "Stale reconnect dump ignored" : "Attendance event queued", {
      id: Number(info.lastInsertRowid), deviceId: n.deviceId, employeeNo: n.employeeNo,
      status: n.attendanceStatus, serialNo: n.serialNo, deviceTime: n.deviceTime,
    });
  } catch (err) {
    if (String(err.code || "").includes("SQLITE_CONSTRAINT_UNIQUE")) {
      log("info", "Exact device replay ignored", { deviceId: n.deviceId, employeeNo: n.employeeNo, eventKey: n.eventKey });
    } else {
      log("error", "Failed to persist event", { error: err.message, deviceId: n.deviceId });
      // Returning 500 asks Hikvision to retry because we did NOT safely persist the event.
      return res.status(500).send("RETRY");
    }
  }

  return res.status(200).send("OK");
});

function requireAdmin(req, res, next) {
  if (!cfg.adminToken) return res.status(404).end();
  const auth = req.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(supplied, cfg.adminToken)) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/admin/events", requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
  const rows = db.prepare(`
    SELECT id, device_id, employee_no, device_time, attendance_status, auth_method,
           serial_no, source_ip, delivery_status, hrms_reason, attempts, last_error, hrms_http_status,
           created_at, updated_at
    FROM events ORDER BY id DESC LIMIT ?
  `).all(limit);
  res.json({ events: rows });
});

if (cfg.adminToken) {
  app.use("/admin", createAdminRouter({ db, deviceStore, cfg, requireAdmin, log }));
} else {
  log("warn", "ADMIN_TOKEN not set — admin UI disabled");
}

app.use("/agent", createAgentRouter({ express, deviceStore, cfg, log }));

function nextRetryIso(attempts) {
  const delay = Math.min(cfg.retryBaseMs * Math.pow(2, Math.max(0, attempts - 1)), cfg.retryMaxMs);
  return new Date(Date.now() + delay).toISOString();
}

function payloadForHrms(row) {
  // Preserve Hikvision's semantic status on the HRMS boundary. The HRMS owns
  // mapping to internal CHECKIN/CHECKOUT enums and all duty/business rules.
  const statusForHrms = {
    CHECK_IN: "checkIn",
    CHECK_OUT: "checkOut",
    OVERTIME_IN: "overtimeIn",
    OVERTIME_OUT: "overtimeOut",
  }[row.attendance_status];

  const payload = {
    biometricId: String(row.employee_no),
    eventTime: row.device_time,
    timestamp: row.device_time,
    deviceId: row.device_id,
    deviceStatus: statusForHrms,
  };
  if (row.serial_no) payload.serialNo = row.serial_no;
  if (cfg.sendAuthMethod && row.auth_method) payload.authenticationType = row.auth_method;
  return payload;
}

async function deliverOne(row) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);
  const url = `${cfg.hrmsApi}${cfg.rawScanPath.startsWith("/") ? "" : "/"}${cfg.rawScanPath}`;
  const attemptNo = row.attempts + 1;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-key": cfg.deviceApiKey,
        "x-hikvision-gateway": "ycdo-v1",
      },
      body: JSON.stringify(payloadForHrms(row)),
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, 4000);
    const now = new Date().toISOString();
    const outcome = deliveryOutcome(response.status, text);

    if (outcome.deliveryStatus === "DELIVERED") {
      db.prepare(`UPDATE events SET delivery_status='DELIVERED', attempts=?, hrms_http_status=?, hrms_response=?, hrms_reason=?, last_error=NULL, updated_at=? WHERE id=?`)
        .run(attemptNo, response.status, text, outcome.hrmsReason, now, row.id);
      log("info", "Delivered to HRMS", {
        id: row.id,
        employeeNo: row.employee_no,
        status: row.attendance_status,
        http: response.status,
        hrmsReason: outcome.hrmsReason,
      });
      return;
    }

    if (outcome.deliveryStatus === "REJECTED_BY_HRMS") {
      db.prepare(`UPDATE events SET delivery_status='REJECTED_BY_HRMS', attempts=?, hrms_http_status=?, hrms_response=?, hrms_reason=?, last_error=?, updated_at=? WHERE id=?`)
        .run(attemptNo, response.status, text, outcome.hrmsReason, outcome.hrmsReason || `HRMS ${response.status}`, now, row.id);
      log("warn", "HRMS rejected event", {
        id: row.id,
        employeeNo: row.employee_no,
        http: response.status,
        hrmsReason: outcome.hrmsReason,
        response: text.slice(0, 300),
      });
      return;
    }

    const next = nextRetryIso(attemptNo);
    db.prepare(`UPDATE events SET delivery_status='RETRY', attempts=?, next_attempt_at=?, hrms_http_status=?, hrms_response=?, hrms_reason=?, last_error=?, updated_at=? WHERE id=?`)
      .run(attemptNo, next, response.status, text, outcome.hrmsReason, outcome.hrmsReason || `HRMS ${response.status}`, now, row.id);
    log("warn", "HRMS temporary failure; queued for retry", { id: row.id, http: response.status, next, hrmsReason: outcome.hrmsReason });
  } catch (err) {
    const now = new Date().toISOString();
    const next = nextRetryIso(attemptNo);
    db.prepare(`UPDATE events SET delivery_status='RETRY', attempts=?, next_attempt_at=?, last_error=?, updated_at=? WHERE id=?`)
      .run(attemptNo, next, err.name === "AbortError" ? "HRMS request timed out" : err.message, now, row.id);
    log("warn", "HRMS delivery exception; queued for retry", { id: row.id, error: err.message, next });
  } finally {
    clearTimeout(timeout);
  }
}

let workerBusy = false;
async function outboxTick() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const now = new Date().toISOString();
    const rows = db.prepare(`
      SELECT * FROM events
      WHERE delivery_status IN ('PENDING','RETRY')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY device_time ASC, id ASC LIMIT 50
    `).all(now);
    for (const row of rows) await deliverOne(row);
  } finally {
    workerBusy = false;
  }
}

const timer = setInterval(() => outboxTick().catch((e) => log("error", "Outbox worker error", { error: e.message })), cfg.outboxPollMs);
timer.unref();

const server = app.listen(cfg.port, "0.0.0.0", () => {
  log("info", "YCDO Hikvision Gateway started", {
    port: cfg.port,
    hrms: `${cfg.hrmsApi}${cfg.rawScanPath}`,
    devices: getDevices().length,
    db: cfg.dbPath,
    adminUi: cfg.adminToken ? `/admin/` : "disabled",
  });
  outboxTick().catch((e) => log("error", "Initial outbox run failed", { error: e.message }));
});

function shutdown(signal) {
  log("info", "Shutdown requested", { signal });
  clearInterval(timer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
