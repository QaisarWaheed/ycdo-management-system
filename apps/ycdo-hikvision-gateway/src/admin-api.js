"use strict";

const express = require("express");
const path = require("path");

function createAdminRouter({ db, deviceStore, cfg, requireAdmin, log }) {
  const router = express.Router();

  router.get("/api/stats", requireAdmin, (_req, res) => {
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS c FROM events WHERE delivery_status IN ('PENDING','RETRY')",
      )
      .get().c;
    const delivered = db
      .prepare("SELECT COUNT(*) AS c FROM events WHERE delivery_status = 'DELIVERED'")
      .get().c;
    const rejected = db
      .prepare(
        "SELECT COUNT(*) AS c FROM events WHERE delivery_status = 'REJECTED_BY_HRMS'",
      )
      .get().c;
    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = db
      .prepare("SELECT COUNT(*) AS c FROM events WHERE created_at >= ?")
      .get(`${today}T00:00:00`).c;
    const devices = deviceStore.listAll();
    // Reuse device activity for dashboard online counts
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const lastByDevice = db
      .prepare(
        `
      SELECT device_id, MAX(created_at) AS last_seen_at
      FROM events
      GROUP BY device_id
    `,
      )
      .all();
    const lastMap = new Map(lastByDevice.map((r) => [r.device_id, r.last_seen_at]));
    const onlineWithinMs = Math.max(
      Number(process.env.DEVICE_ONLINE_WITHIN_MS || 24 * 60 * 60 * 1000),
      60_000,
    );
    const now = Date.now();
    let online = 0;
    let offline = 0;
    let neverSeen = 0;
    for (const d of devices) {
      const last = lastMap.get(d.hrmsDeviceId);
      const ms = last ? Date.parse(last) : NaN;
      if (Number.isFinite(ms) && now - ms <= onlineWithinMs) online += 1;
      else if (last) offline += 1;
      else neverSeen += 1;
    }
    res.json({
      ok: true,
      devices: {
        total: devices.length,
        enabled: devices.filter((d) => d.enabled).length,
        online,
        offline,
        neverSeen,
      },
      events: { pending, delivered, rejected, today: todayEvents },
      storage: {
        dbPath: cfg.dbPath,
        dataDir: cfg.dataDir,
        capRoverVolume: "/app/data",
      },
      hrmsApi: cfg.hrmsApi,
      since24h,
    });
  });

  router.get("/api/devices", requireAdmin, (_req, res) => {
    const onlineWithinMs = Math.max(
      Number(process.env.DEVICE_ONLINE_WITHIN_MS || 24 * 60 * 60 * 1000),
      60_000,
    );
    const agentOnlineWithinMs = Math.max(
      Number(process.env.AGENT_ONLINE_WITHIN_MS || 90_000),
      30_000,
    );
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const activity = db
      .prepare(
        `
      SELECT device_id,
             MAX(created_at) AS last_seen_at,
             MAX(source_ip) AS last_source_ip,
             COUNT(*) AS event_count,
             SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS events_24h
      FROM events
      GROUP BY device_id
    `,
      )
      .all(since24h);
    const byDeviceId = new Map(activity.map((row) => [row.device_id, row]));

    function agentConnectionStatus(device, nowMs, withinMs) {
      if (!device.agentToken) return "NO_TOKEN";
      const ms = device.agentLastSeenAt ? Date.parse(device.agentLastSeenAt) : NaN;
      if (Number.isFinite(ms) && nowMs - ms <= withinMs) return "ONLINE";
      if (device.agentLastSeenAt) return "OFFLINE";
      return "NEVER_SEEN";
    }

    const devices = deviceStore.listAll().map((device) => {
      const row = byDeviceId.get(device.hrmsDeviceId);
      const lastSeenAt = row?.last_seen_at || null;
      const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
      const heardRecently =
        Number.isFinite(lastSeenMs) && now - lastSeenMs <= onlineWithinMs;
      let connectionStatus = "NEVER_SEEN";
      if (heardRecently) connectionStatus = "ONLINE";
      else if (lastSeenAt) connectionStatus = "OFFLINE";

      return {
        ...device,
        lastSeenAt,
        lastSourceIp: row?.last_source_ip || null,
        eventCount: Number(row?.event_count || 0),
        events24h: Number(row?.events_24h || 0),
        connectionStatus,
        onlineWithinMs,
        agentOnlineWithinMs,
        agentStatus: agentConnectionStatus(device, now, agentOnlineWithinMs),
      };
    });

    res.json({ devices, onlineWithinMs, agentOnlineWithinMs });
  });

  router.post("/api/devices", requireAdmin, (req, res) => {
    try {
      const device = deviceStore.create(req.body || {});
      log("info", "Device created via admin UI", { id: device.id, hrmsDeviceId: device.hrmsDeviceId });
      res.status(201).json({ device });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put("/api/devices/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    try {
      const device = deviceStore.update(id, req.body || {});
      if (!device) return res.status(404).json({ error: "Device not found" });
      log("info", "Device updated via admin UI", { id, hrmsDeviceId: device.hrmsDeviceId });
      res.json({ device });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/api/devices/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!deviceStore.remove(id)) return res.status(404).json({ error: "Device not found" });
    log("info", "Device deleted via admin UI", { id });
    res.json({ ok: true });
  });

  router.post("/api/devices/:id/regenerate-token", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const device = deviceStore.regenerateToken(id);
    if (!device) return res.status(404).json({ error: "Device not found" });
    log("info", "Device token regenerated via admin UI", { id, hrmsDeviceId: device.hrmsDeviceId });
    res.json({ device });
  });

  router.post("/api/devices/:id/regenerate-agent-token", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const device = deviceStore.regenerateAgentToken(id);
    if (!device) return res.status(404).json({ error: "Device not found" });
    log("info", "Face agent token regenerated via admin UI", {
      id,
      hrmsDeviceId: device.hrmsDeviceId,
    });
    res.json({ device });
  });

  router.post("/api/devices/:id/clear-agent-token", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const device = deviceStore.clearAgentToken(id);
    if (!device) return res.status(404).json({ error: "Device not found" });
    log("info", "Face agent token cleared via admin UI", {
      id,
      hrmsDeviceId: device.hrmsDeviceId,
    });
    res.json({ device });
  });

  router.get("/api/events", requireAdmin, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const conditions = [];
    const params = [];

    if (req.query.device_id) {
      conditions.push("device_id = ?");
      params.push(String(req.query.device_id));
    }
    if (req.query.delivery_status) {
      conditions.push("delivery_status = ?");
      params.push(String(req.query.delivery_status));
    }
    if (req.query.employee_no) {
      conditions.push("employee_no LIKE ?");
      params.push(`%${String(req.query.employee_no).trim()}%`);
    }
    if (req.query.attendance_status) {
      conditions.push("attendance_status = ?");
      params.push(String(req.query.attendance_status));
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM events ${where}`)
      .get(...params).c;
    const events = db
      .prepare(
        `
      SELECT id, device_id, employee_no, device_time, attendance_status, auth_method,
             serial_no, source_ip, delivery_status, hrms_reason, attempts, last_error,
             hrms_http_status, hrms_response, created_at, updated_at
      FROM events ${where}
      ORDER BY id DESC LIMIT ? OFFSET ?
    `,
      )
      .all(...params, limit, offset);

    res.json({ events, total, limit, offset });
  });

  router.get("/api/events/:id", requireAdmin, (req, res) => {
    const row = db
      .prepare(
        `
      SELECT id, device_id, hikvision_device_id, employee_no, device_time, received_time,
             attendance_status, raw_attendance_status, auth_method, serial_no, source_ip,
             delivery_status, hrms_reason, attempts, last_error, hrms_http_status, hrms_response,
             raw_json, created_at, updated_at
      FROM events WHERE id = ?
    `,
      )
      .get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Event not found" });
    res.json({ event: row });
  });

  const publicDir = path.join(__dirname, "..", "public", "admin");
  router.use(express.static(publicDir));
  router.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return router;
}

module.exports = { createAdminRouter };
