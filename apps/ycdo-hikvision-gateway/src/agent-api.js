"use strict";

/**
 * Thin face-agent facing routes.
 * Auth: Authorization: Bearer <agent_token>
 * Proxies HRMS /face-sync/pending and /face-sync/result using BIOMETRIC_DEVICE_KEY.
 */

function createAgentRouter({ express, deviceStore, cfg, log }) {
  const router = express.Router();
  const onlineWithinMs = Math.max(
    Number(process.env.AGENT_ONLINE_WITHIN_MS || 90_000),
    30_000,
  );

  function requireAgent(req, res, next) {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const token = bearer || String(req.headers["x-agent-token"] || "").trim();
    if (!token) {
      return res.status(401).json({ error: "Missing agent token" });
    }
    const device = deviceStore.getByAgentToken(token);
    if (!device || !device.enabled) {
      return res.status(401).json({ error: "Unknown or disabled agent token" });
    }
    req.agentDevice = device;
    next();
  }

  function hrmsFaceSyncKey() {
    return (
      process.env.BIOMETRIC_DEVICE_KEY ||
      cfg.biometricDeviceKey ||
      cfg.deviceApiKey ||
      ""
    );
  }

  async function hrmsFetch(path, options = {}) {
    const key = hrmsFaceSyncKey();
    if (!key) {
      const err = new Error("BIOMETRIC_DEVICE_KEY (or DEVICE_API_KEY) is not configured on gateway");
      err.status = 500;
      throw err;
    }
    const url = `${cfg.hrmsApi}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      cfg.requestTimeoutMs || 12000,
    );
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-device-key": key,
          ...(options.headers || {}),
        },
      });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }
      return { res, body, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  router.post("/heartbeat", requireAgent, (req, res) => {
    const version =
      (req.body && req.body.version) ||
      req.headers["x-agent-version"] ||
      null;
    deviceStore.touchAgentHeartbeat(req.agentDevice.id, version);
    log("info", "Face agent heartbeat", {
      id: req.agentDevice.id,
      hrmsDeviceId: req.agentDevice.hrmsDeviceId,
      version: version || null,
    });
    res.json({
      ok: true,
      hrmsDeviceId: req.agentDevice.hrmsDeviceId,
      onlineWithinMs,
    });
  });

  router.get("/face-sync/pending", requireAgent, async (req, res) => {
    const deviceId = req.agentDevice.hrmsDeviceId;
    try {
      const { res: upstream, body, text } = await hrmsFetch(
        `/face-sync/pending?deviceId=${encodeURIComponent(deviceId)}`,
        { method: "GET" },
      );
      if (!upstream.ok) {
        log("warn", "HRMS face-sync pending failed", {
          hrmsDeviceId: deviceId,
          http: upstream.status,
          body: text.slice(0, 200),
        });
        return res.status(upstream.status).json(
          body && typeof body === "object" ? body : { error: text },
        );
      }
      res.json(body || { jobs: [] });
    } catch (err) {
      log("error", "HRMS face-sync pending exception", {
        hrmsDeviceId: deviceId,
        error: err.message,
      });
      res.status(err.status || 502).json({ error: err.message });
    }
  });

  router.post("/face-sync/result", requireAgent, async (req, res) => {
    const deviceId = req.agentDevice.hrmsDeviceId;
    const jobId = req.body?.jobId;
    const status = req.body?.status;
    const error = req.body?.error || null;

    if (!jobId || (status !== "SUCCESS" && status !== "FAILED")) {
      return res.status(400).json({
        error: "jobId and status (SUCCESS|FAILED) are required",
      });
    }

    try {
      const { res: upstream, body, text } = await hrmsFetch(
        "/face-sync/result",
        {
          method: "POST",
          body: JSON.stringify({
            jobId,
            deviceId,
            status,
            error: error || undefined,
          }),
        },
      );

      deviceStore.recordAgentSyncResult(req.agentDevice.id, status, error);

      if (!upstream.ok) {
        log("warn", "HRMS face-sync result failed", {
          hrmsDeviceId: deviceId,
          jobId,
          http: upstream.status,
          body: text.slice(0, 200),
        });
        return res.status(upstream.status).json(
          body && typeof body === "object" ? body : { error: text },
        );
      }

      log("info", "Face sync result proxied", {
        hrmsDeviceId: deviceId,
        jobId,
        status,
      });
      res.json(body || { ok: true });
    } catch (err) {
      log("error", "HRMS face-sync result exception", {
        hrmsDeviceId: deviceId,
        jobId,
        error: err.message,
      });
      res.status(err.status || 502).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createAgentRouter };
