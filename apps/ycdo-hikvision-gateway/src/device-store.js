"use strict";

const crypto = require("crypto");

function ensureColumn(db, table, column, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
  }
}

function rowToDevice(row) {
  return {
    id: row.id,
    name: row.name || "",
    token: row.token,
    hrmsDeviceId: row.hrms_device_id,
    hikvisionDeviceIds: JSON.parse(row.hikvision_device_ids || "[]"),
    allowedPublicIps: JSON.parse(row.allowed_public_ips || "[]"),
    enabled: row.enabled === 1,
    agentToken: row.agent_token || null,
    agentLastSeenAt: row.agent_last_seen_at || null,
    agentVersion: row.agent_version || null,
    agentLastSyncAt: row.agent_last_sync_at || null,
    agentLastSyncStatus: row.agent_last_sync_status || null,
    agentLastSyncError: row.agent_last_sync_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateDeviceInput(d) {
  if (!d.hrmsDeviceId || !String(d.hrmsDeviceId).trim()) {
    throw new Error("hrmsDeviceId is required");
  }
  const token = d.token ? String(d.token) : generateToken();
  if (token.length < 20) throw new Error("token must be at least 20 characters");
  return {
    name: String(d.name || "").trim(),
    token,
    hrmsDeviceId: String(d.hrmsDeviceId).trim(),
    hikvisionDeviceIds: Array.isArray(d.hikvisionDeviceIds)
      ? d.hikvisionDeviceIds.filter(Boolean).map(String)
      : [],
    allowedPublicIps: Array.isArray(d.allowedPublicIps)
      ? d.allowedPublicIps.filter(Boolean).map(String)
      : [],
    enabled: d.enabled !== false,
  };
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createDeviceStore(db, log) {
  db.exec(`
CREATE TABLE IF NOT EXISTS gateway_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  hrms_device_id TEXT NOT NULL UNIQUE,
  hikvision_device_ids TEXT NOT NULL DEFAULT '[]',
  allowed_public_ips TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
  ensureColumn(db, "gateway_devices", "agent_token", "TEXT");
  ensureColumn(db, "gateway_devices", "agent_last_seen_at", "TEXT");
  ensureColumn(db, "gateway_devices", "agent_version", "TEXT");
  ensureColumn(db, "gateway_devices", "agent_last_sync_at", "TEXT");
  ensureColumn(db, "gateway_devices", "agent_last_sync_status", "TEXT");
  ensureColumn(db, "gateway_devices", "agent_last_sync_error", "TEXT");
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_devices_agent_token ON gateway_devices(agent_token) WHERE agent_token IS NOT NULL",
    );
  } catch {
    // SQLite versions without partial indexes: ignore; uniqueness still checked in app
  }

  let cache = [];

  function reloadCache() {
    const rows = db
      .prepare("SELECT * FROM gateway_devices WHERE enabled = 1 ORDER BY name ASC, id ASC")
      .all();
    cache = rows.map((row) => {
      const d = rowToDevice(row);
      return {
        name: d.name,
        token: d.token,
        hrmsDeviceId: d.hrmsDeviceId,
        hikvisionDeviceIds: d.hikvisionDeviceIds,
        allowedPublicIps: d.allowedPublicIps,
        enabled: d.enabled,
      };
    });
    return cache;
  }

  function seedFromConfig(devices) {
    const count = db.prepare("SELECT COUNT(*) AS c FROM gateway_devices").get().c;
    if (count > 0 || !devices?.length) return 0;
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO gateway_devices (
        name, token, hrms_device_id, hikvision_device_ids, allowed_public_ips,
        enabled, created_at, updated_at
      ) VALUES (
        @name, @token, @hrms_device_id, @hikvision_device_ids, @allowed_public_ips,
        @enabled, @created_at, @updated_at
      )
    `);
    let seeded = 0;
    for (const raw of devices) {
      const d = validateDeviceInput(raw);
      insert.run({
        name: d.name,
        token: d.token,
        hrms_device_id: d.hrmsDeviceId,
        hikvision_device_ids: JSON.stringify(d.hikvisionDeviceIds),
        allowed_public_ips: JSON.stringify(d.allowedPublicIps),
        enabled: d.enabled ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
      seeded += 1;
    }
    if (seeded) log("info", "Seeded gateway devices from config", { count: seeded });
    reloadCache();
    return seeded;
  }

  function listAll() {
    return db
      .prepare("SELECT * FROM gateway_devices ORDER BY name ASC, id ASC")
      .all()
      .map(rowToDevice);
  }

  function getById(id) {
    const row = db.prepare("SELECT * FROM gateway_devices WHERE id = ?").get(id);
    return row ? rowToDevice(row) : null;
  }

  function create(input) {
    const d = validateDeviceInput(input);
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `
      INSERT INTO gateway_devices (
        name, token, hrms_device_id, hikvision_device_ids, allowed_public_ips,
        enabled, created_at, updated_at
      ) VALUES (
        @name, @token, @hrms_device_id, @hikvision_device_ids, @allowed_public_ips,
        @enabled, @created_at, @updated_at
      )
    `,
      )
      .run({
        name: d.name,
        token: d.token,
        hrms_device_id: d.hrmsDeviceId,
        hikvision_device_ids: JSON.stringify(d.hikvisionDeviceIds),
        allowed_public_ips: JSON.stringify(d.allowedPublicIps),
        enabled: d.enabled ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
    reloadCache();
    return getById(Number(info.lastInsertRowid));
  }

  function update(id, input) {
    const existing = getById(id);
    if (!existing) return null;
    const d = validateDeviceInput({
      ...existing,
      ...input,
      token: input.token ?? existing.token,
      hrmsDeviceId: input.hrmsDeviceId ?? existing.hrmsDeviceId,
    });
    const now = new Date().toISOString();
    db.prepare(
      `
      UPDATE gateway_devices SET
        name = @name,
        token = @token,
        hrms_device_id = @hrms_device_id,
        hikvision_device_ids = @hikvision_device_ids,
        allowed_public_ips = @allowed_public_ips,
        enabled = @enabled,
        updated_at = @updated_at
      WHERE id = @id
    `,
    ).run({
      id,
      name: d.name,
      token: d.token,
      hrms_device_id: d.hrmsDeviceId,
      hikvision_device_ids: JSON.stringify(d.hikvisionDeviceIds),
      allowed_public_ips: JSON.stringify(d.allowedPublicIps),
      enabled: d.enabled ? 1 : 0,
      updated_at: now,
    });
    reloadCache();
    return getById(id);
  }

  function remove(id) {
    const existing = getById(id);
    if (!existing) return false;
    db.prepare("DELETE FROM gateway_devices WHERE id = ?").run(id);
    reloadCache();
    return true;
  }

  function regenerateToken(id) {
    return update(id, { token: generateToken() });
  }

  function getByAgentToken(token) {
    if (!token) return null;
    const row = db
      .prepare("SELECT * FROM gateway_devices WHERE agent_token = ?")
      .get(String(token));
    return row ? rowToDevice(row) : null;
  }

  function regenerateAgentToken(id) {
    const existing = getById(id);
    if (!existing) return null;
    const token = generateToken();
    const now = new Date().toISOString();
    db.prepare(
      `
      UPDATE gateway_devices SET
        agent_token = @agent_token,
        updated_at = @updated_at
      WHERE id = @id
    `,
    ).run({ id, agent_token: token, updated_at: now });
    reloadCache();
    return getById(id);
  }

  function clearAgentToken(id) {
    const existing = getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    db.prepare(
      `
      UPDATE gateway_devices SET
        agent_token = NULL,
        updated_at = @updated_at
      WHERE id = @id
    `,
    ).run({ id, updated_at: now });
    reloadCache();
    return getById(id);
  }

  function touchAgentHeartbeat(id, version) {
    const now = new Date().toISOString();
    db.prepare(
      `
      UPDATE gateway_devices SET
        agent_last_seen_at = @agent_last_seen_at,
        agent_version = COALESCE(@agent_version, agent_version),
        updated_at = @updated_at
      WHERE id = @id
    `,
    ).run({
      id,
      agent_last_seen_at: now,
      agent_version: version ? String(version).slice(0, 64) : null,
      updated_at: now,
    });
    reloadCache();
    return getById(id);
  }

  function recordAgentSyncResult(id, status, error) {
    const now = new Date().toISOString();
    db.prepare(
      `
      UPDATE gateway_devices SET
        agent_last_sync_at = @agent_last_sync_at,
        agent_last_sync_status = @agent_last_sync_status,
        agent_last_sync_error = @agent_last_sync_error,
        updated_at = @updated_at
      WHERE id = @id
    `,
    ).run({
      id,
      agent_last_sync_at: now,
      agent_last_sync_status: status ? String(status).slice(0, 32) : null,
      agent_last_sync_error: error ? String(error).slice(0, 500) : null,
      updated_at: now,
    });
    reloadCache();
    return getById(id);
  }

  reloadCache();

  return {
    getActiveDevices: () => cache,
    reloadCache,
    seedFromConfig,
    listAll,
    getById,
    create,
    update,
    remove,
    regenerateToken,
    generateToken,
    getByAgentToken,
    regenerateAgentToken,
    clearAgentToken,
    touchAgentHeartbeat,
    recordAgentSyncResult,
  };
}

module.exports = { createDeviceStore, generateToken, validateDeviceInput };
