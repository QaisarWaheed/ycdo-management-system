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
    res.json({
      ok: true,
      devices: {
        total: devices.length,
        enabled: devices.filter((d) => d.enabled).length,
      },
      events: { pending, delivered, rejected, today: todayEvents },
      storage: {
        dbPath: cfg.dbPath,
        dataDir: cfg.dataDir,
        capRoverVolume: "/app/data",
      },
      hrmsApi: cfg.hrmsApi,
    });
  });

  router.get("/api/devices", requireAdmin, (_req, res) => {
    res.json({ devices: deviceStore.listAll() });
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
