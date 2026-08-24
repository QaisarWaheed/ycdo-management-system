const TOKEN_KEY = "ycdo_gateway_admin_token";
const PAGE_SIZE = 50;

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let eventsOffset = 0;
let eventsTotal = 0;
let publicBaseUrl = window.location.origin;

const $ = (sel) => document.querySelector(sel);
const loginScreen = $("#login-screen");
const app = $("#app");
const loginForm = $("#login-form");
const loginError = $("#login-error");

function showLogin() {
  app.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

function showApp() {
  loginScreen.classList.add("hidden");
  app.classList.remove("hidden");
}

async function api(path, options = {}) {
  const res = await fetch(`/admin${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    token = "";
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
    throw new Error("Session expired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function hikvisionUrl(deviceToken) {
  return `${publicBaseUrl}/hikvision/event/${deviceToken}`;
}

async function loadDashboard() {
  const stats = await api("/api/stats");
  $("#stat-devices").textContent = stats.devices.total;
  $("#stat-online").textContent = stats.devices.online ?? 0;
  $("#stat-offline").textContent =
    (stats.devices.offline ?? 0) + (stats.devices.neverSeen ?? 0);
  $("#stat-enabled").textContent = stats.devices.enabled;
  $("#stat-pending").textContent = stats.events.pending;
  $("#stat-delivered").textContent = stats.events.delivered;
  $("#stat-today").textContent = stats.events.today;
  $("#stat-rejected").textContent = stats.events.rejected;
  $("#hrms-link").textContent = `HRMS: ${stats.hrmsApi}`;
  if (stats.storage) {
    $("#storage-db-path").textContent = stats.storage.dbPath;
  }
}

function connectionBadge(status) {
  if (status === "ONLINE") return '<span class="badge ok">ONLINE</span>';
  if (status === "OFFLINE") return '<span class="badge bad">OFFLINE</span>';
  return '<span class="badge off">NEVER SEEN</span>';
}

function formatRelative(iso) {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return escapeHtml(iso);
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function agentBadge(status) {
  if (status === "ONLINE") return '<span class="badge ok">AGENT ONLINE</span>';
  if (status === "OFFLINE") return '<span class="badge bad">AGENT OFFLINE</span>';
  if (status === "NO_TOKEN") return '<span class="badge off">NO AGENT TOKEN</span>';
  return '<span class="badge off">AGENT NEVER SEEN</span>';
}

function renderDevices(devices) {
  const tbody = $("#devices-body");
  tbody.innerHTML = "";
  const filterDevice = $("#filter-device");
  const current = filterDevice.value;
  filterDevice.innerHTML = '<option value="">All devices</option>';
  for (const d of devices) {
    filterDevice.innerHTML += `<option value="${escapeHtml(d.hrmsDeviceId)}">${escapeHtml(d.name || d.hrmsDeviceId)}</option>`;
  }
  filterDevice.value = current;

  if (!devices.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">No devices yet. Click Add device.</td></tr>';
    return;
  }

  for (const d of devices) {
    const lastSeenTitle = d.lastSeenAt
      ? `${formatTime(d.lastSeenAt)}${d.lastSourceIp ? ` from ${d.lastSourceIp}` : ""}`
      : "No events received yet";
    const agentTitle = [
      d.agentLastSeenAt ? `Heartbeat ${formatTime(d.agentLastSeenAt)}` : "No heartbeat",
      d.agentLastSyncAt
        ? `Last sync ${formatTime(d.agentLastSyncAt)} (${d.agentLastSyncStatus || "?"})`
        : "No sync yet",
      d.agentVersion ? `v${d.agentVersion}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(d.name || "—")}</td>
      <td class="mono">${escapeHtml(d.hrmsDeviceId)}</td>
      <td><span class="badge ${d.enabled ? "ok" : "off"}">${d.enabled ? "Enabled" : "Disabled"}</span></td>
      <td>${connectionBadge(d.connectionStatus)}</td>
      <td title="${escapeHtml(agentTitle)}">${agentBadge(d.agentStatus)}</td>
      <td title="${escapeHtml(lastSeenTitle)}">${escapeHtml(formatRelative(d.lastSeenAt))}</td>
      <td class="mono">${d.events24h ?? 0}</td>
      <td class="url-cell mono">${escapeHtml(hikvisionUrl(d.token))}</td>
      <td class="actions">
        <button type="button" class="btn-small" data-copy="${escapeHtml(d.token)}">Copy URL</button>
        <button type="button" class="btn-small" data-copy-agent="${d.id}" ${d.agentToken ? "" : "disabled"}>Copy agent token</button>
        <button type="button" class="btn-small" data-edit="${d.id}">Edit</button>
        <button type="button" class="btn-small" data-regen="${d.id}">New token</button>
        <button type="button" class="btn-small" data-regen-agent="${d.id}">New agent token</button>
        <button type="button" class="btn-danger btn-small" data-delete="${d.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }
}

async function loadDevices() {
  const { devices } = await api("/api/devices");
  renderDevices(devices);
}

function openDeviceDialog(device) {
  $("#device-dialog-title").textContent = device ? "Edit device" : "Add device";
  $("#device-id").value = device?.id || "";
  $("#device-name").value = device?.name || "";
  $("#device-hrms-id").value = device?.hrmsDeviceId || "";
  $("#device-ips").value = (device?.allowedPublicIps || []).join(", ");
  $("#device-hik-ids").value = (device?.hikvisionDeviceIds || []).join(", ");
  $("#device-enabled").checked = device?.enabled !== false;
  $("#device-dialog").showModal();
}

function formatHrmsReason(event) {
  const reason = event.hrms_reason || event.last_error;
  if (!reason) return "—";
  return reason;
}

async function loadEvents() {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(eventsOffset),
  });
  const employee = $("#filter-employee").value.trim();
  const deviceId = $("#filter-device").value;
  const delivery = $("#filter-delivery").value;
  if (employee) params.set("employee_no", employee);
  if (deviceId) params.set("device_id", deviceId);
  if (delivery) params.set("delivery_status", delivery);

  const data = await api(`/api/events?${params}`);
  eventsTotal = data.total;
  const tbody = $("#events-body");
  tbody.innerHTML = "";

  if (!data.events.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">No events found.</td></tr>';
  } else {
    for (const e of data.events) {
      const reason = formatHrmsReason(e);
      const reasonClass = e.delivery_status === "REJECTED_BY_HRMS" ? "reason-rejected" : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${e.id}</td>
        <td>${escapeHtml(formatTime(e.device_time))}</td>
        <td class="mono">${escapeHtml(e.device_id)}</td>
        <td class="mono">${escapeHtml(e.employee_no)}</td>
        <td>${escapeHtml(e.attendance_status)}</td>
        <td><span class="badge ${escapeHtml(e.delivery_status)}">${escapeHtml(e.delivery_status)}</span></td>
        <td class="mono ${reasonClass}" title="${escapeHtml(reason)}">${escapeHtml(reason)}</td>
        <td><button type="button" class="btn-small" data-event="${e.id}">Details</button></td>`;
      tbody.appendChild(tr);
    }
  }

  const page = Math.floor(eventsOffset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(eventsTotal / PAGE_SIZE));
  $("#events-page-info").textContent = `Page ${page} of ${pages} (${eventsTotal} total)`;
  $("#events-prev").disabled = eventsOffset <= 0;
  $("#events-next").disabled = eventsOffset + PAGE_SIZE >= eventsTotal;
}

function formatTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${name}`);
  });
  if (name === "dashboard") loadDashboard().catch(alertError);
  if (name === "devices") loadDevices().catch(alertError);
  if (name === "events") {
    eventsOffset = 0;
    loadEvents().catch(alertError);
  }
}

function alertError(err) {
  alert(err.message || String(err));
}

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginError.classList.add("hidden");
  token = $("#admin-token").value.trim();
  try {
    await api("/api/stats");
    sessionStorage.setItem(TOKEN_KEY, token);
    showApp();
    switchTab("dashboard");
  } catch (err) {
    token = "";
    loginError.textContent = err.message || "Invalid token";
    loginError.classList.remove("hidden");
  }
});

$("#logout-btn").addEventListener("click", () => {
  token = "";
  sessionStorage.removeItem(TOKEN_KEY);
  showLogin();
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

$("#add-device-btn").addEventListener("click", () => openDeviceDialog(null));

$("#device-cancel").addEventListener("click", () => $("#device-dialog").close());

$("#device-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const payload = {
    name: $("#device-name").value.trim(),
    hrmsDeviceId: $("#device-hrms-id").value.trim(),
    allowedPublicIps: $("#device-ips").value.split(",").map((s) => s.trim()).filter(Boolean),
    hikvisionDeviceIds: $("#device-hik-ids").value.split(",").map((s) => s.trim()).filter(Boolean),
    enabled: $("#device-enabled").checked,
  };
  const id = $("#device-id").value;
  try {
    if (id) await api(`/api/devices/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    else await api("/api/devices", { method: "POST", body: JSON.stringify(payload) });
    $("#device-dialog").close();
    await loadDevices();
    await loadDashboard();
  } catch (err) {
    alertError(err);
  }
});

$("#devices-body").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  if (btn.dataset.copy) {
    await navigator.clipboard.writeText(hikvisionUrl(btn.dataset.copy));
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy URL"; }, 1200);
    return;
  }
  if (btn.dataset.copyAgent) {
    const { devices } = await api("/api/devices");
    const device = devices.find((d) => String(d.id) === btn.dataset.copyAgent);
    if (!device?.agentToken) {
      alert("Generate an agent token first (New agent token).");
      return;
    }
    await navigator.clipboard.writeText(device.agentToken);
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy agent token"; }, 1200);
    return;
  }
  if (btn.dataset.edit) {
    const { devices } = await api("/api/devices");
    const device = devices.find((d) => String(d.id) === btn.dataset.edit);
    if (device) openDeviceDialog(device);
    return;
  }
  if (btn.dataset.regen) {
    if (!confirm("Generate a new token? Update the Hikvision terminal URL afterward.")) return;
    try {
      await api(`/api/devices/${btn.dataset.regen}/regenerate-token`, { method: "POST", body: "{}" });
      await loadDevices();
    } catch (err) {
      alertError(err);
    }
    return;
  }
  if (btn.dataset.regenAgent) {
    if (!confirm("Generate a new face-agent token? Update face_agent.py AGENT_TOKEN afterward.")) return;
    try {
      const { device } = await api(`/api/devices/${btn.dataset.regenAgent}/regenerate-agent-token`, {
        method: "POST",
        body: "{}",
      });
      await loadDevices();
      if (device?.agentToken) {
        await navigator.clipboard.writeText(device.agentToken);
        alert("New agent token copied to clipboard. Paste into face_agent.py as AGENT_TOKEN.");
      }
    } catch (err) {
      alertError(err);
    }
    return;
  }
  if (btn.dataset.delete) {
    if (!confirm("Delete this device connection?")) return;
    try {
      await api(`/api/devices/${btn.dataset.delete}`, { method: "DELETE" });
      await loadDevices();
      await loadDashboard();
    } catch (err) {
      alertError(err);
    }
  }
});

$("#refresh-events-btn").addEventListener("click", () => {
  eventsOffset = 0;
  loadEvents().catch(alertError);
});
$("#filter-employee").addEventListener("change", () => { eventsOffset = 0; loadEvents().catch(alertError); });
$("#filter-device").addEventListener("change", () => { eventsOffset = 0; loadEvents().catch(alertError); });
$("#filter-delivery").addEventListener("change", () => { eventsOffset = 0; loadEvents().catch(alertError); });
$("#events-prev").addEventListener("click", () => {
  eventsOffset = Math.max(0, eventsOffset - PAGE_SIZE);
  loadEvents().catch(alertError);
});
$("#events-next").addEventListener("click", () => {
  eventsOffset += PAGE_SIZE;
  loadEvents().catch(alertError);
});

$("#events-body").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-event]");
  if (!btn) return;
  try {
    const { event } = await api(`/api/events/${btn.dataset.event}`);
    $("#event-detail").textContent = JSON.stringify(event, null, 2);
    $("#event-dialog").showModal();
  } catch (err) {
    alertError(err);
  }
});

$("#event-close").addEventListener("click", () => $("#event-dialog").close());

if (token) {
  api("/api/stats")
    .then(() => {
      showApp();
      switchTab("dashboard");
    })
    .catch(showLogin);
} else {
  showLogin();
}

setInterval(() => {
  if (app.classList.contains("hidden")) return;
  const active = document.querySelector(".tab.active")?.dataset.tab;
  if (active === "dashboard") loadDashboard().catch(() => {});
  if (active === "events") loadEvents().catch(() => {});
}, 15000);
