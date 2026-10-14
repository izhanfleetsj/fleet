/* Fleet Ops API — shared by the local server (server.js) and the Vercel
   functions in api/. Picks its storage from the environment:
   Supabase when SUPABASE_URL + a service key are set, otherwise SQLite on disk. */
"use strict";
const path = require("node:path");
const crypto = require("node:crypto");

const ON_VERCEL = !!process.env.VERCEL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (ON_VERCEL ? null : "komatsu2026");
const SESSION_SECRET = process.env.SESSION_SECRET || (ON_VERCEL ? null : crypto.randomBytes(32).toString("hex"));
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
// Vercel caps request bodies at 4.5 MB.
const MAX_BODY_BYTES = ON_VERCEL ? 4.5 * 1024 * 1024 : 20 * 1024 * 1024;

/* Keys the dashboard is allowed to store. Admin-only keys reject writes from
   non-admin sessions; the rest are written by drivers / branch staff too. */
const STORAGE_KEYS = {
  fleetComplianceRegister_v2: { adminOnly: false },
  fleetTickets_v1: { adminOnly: false },
  fleetHiringRecords_v1: { adminOnly: false },
  fleetCostingData_v1: { adminOnly: false },
  fleetUtilizationData_v1: { adminOnly: true },
  fleetTargetConfig_v1: { adminOnly: true },
  fleetContactsConfig_v1: { adminOnly: true },
  fleetDailyMovement_v1: { adminOnly: false },
  fleetHolidays_v1: { adminOnly: true },
  fleetDisposePipeline_v1: { adminOnly: true },
  fleetPurchaseInbox_v1: { adminOnly: false },
  fleetInsuranceComparisons_v1: { adminOnly: true },
  fleetInsuranceDb_v1: { adminOnly: true },
  fleetOdooPo_v1: { adminOnly: true },                 // purchase-order lines from Odoo (pivot export) → Costing            // insurance database — one record per vehicle per policy year   // insurance renewal quotation comparisons (template → printable comparison + monthly summary)   // new-vehicle purchase requests sent from the Requester page; admin moves them into New / Dispose
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

let store = null;
function getStore() {
  if (store) return store;
  if (SUPABASE_URL && SUPABASE_KEY) {
    store = require("./store-supabase")(SUPABASE_URL, SUPABASE_KEY);
  } else if (!ON_VERCEL) {
    store = require("./store-sqlite")(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
  }
  return store;
}

function configWarnings() {
  const w = [];
  if (!process.env.ADMIN_PASSWORD) w.push(ON_VERCEL ? "ADMIN_PASSWORD not set — admin login disabled." : "ADMIN_PASSWORD not set — using the default prototype password. Set it before going live.");
  if (!process.env.SESSION_SECRET) w.push(ON_VERCEL ? "SESSION_SECRET not set — admin login disabled." : "SESSION_SECRET not set — admin sessions reset whenever the server restarts.");
  if (ON_VERCEL && !(SUPABASE_URL && SUPABASE_KEY)) w.push("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — data cannot be saved.");
  return w;
}

/* ---------- Sessions (signed cookie, stateless) ---------- */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!SESSION_SECRET || !token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}
function getRole(req) {
  const s = verify(parseCookies(req).fleet_session);
  return s ? s.role : null;
}
function sessionCookie(req, value, maxAgeSec) {
  const secure = req.headers["x-forwarded-proto"] === "https" || (req.socket && req.socket.encrypted) ? "; Secure" : "";
  return `fleet_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure}`;
}
function passwordMatches(pw) {
  const a = crypto.createHash("sha256").update(String(pw)).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (ON_VERCEL && fwd ? String(fwd).split(",")[0].trim() : null) || req.socket?.remoteAddress || "unknown";
}

/* ---------- HTTP helpers ---------- */
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function readBody(req) {
  // Vercel's Node runtime pre-parses JSON bodies onto req.body.
  if (req.body !== undefined) {
    if (typeof req.body === "string") { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.reject(httpError(400, "Invalid JSON")); } }
    if (Buffer.isBuffer(req.body)) { try { return Promise.resolve(JSON.parse(req.body.toString())); } catch { return Promise.reject(httpError(400, "Invalid JSON")); } }
    return Promise.resolve(req.body || {});
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(httpError(413, "Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(httpError(400, "Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

/* Raw (binary) request body, e.g. an uploaded PDF. */
function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(Buffer.from(req.body, "binary"));
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(httpError(413, "File too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const FILE_TYPES = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
/* The bytes must match the declared type (no HTML / script uploads disguised as a PDF or image). */
function fileMagicOk(type, d) {
  if (type === "application/pdf") return d.subarray(0, 5).toString() === "%PDF-";
  if (type === "image/jpeg") return d[0] === 0xFF && d[1] === 0xD8 && d[2] === 0xFF;
  if (type === "image/png") return d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  if (type === "image/webp") return d.subarray(0, 4).toString() === "RIFF" && d.subarray(8, 12).toString() === "WEBP";
  return false;
}

/* ---------- Routes ---------- */
async function route(req, res, pathname) {
  const role = getRole(req);
  const p = pathname;

  if (p === "/api/health") {
    return sendJson(res, 200, { ok: configWarnings().length === 0, storage: getStore()?.name || "none", warnings: configWarnings() });
  }

  if (p === "/api/session" && req.method === "GET") return sendJson(res, 200, { role });

  if (p === "/api/login" && req.method === "POST") {
    if (!ADMIN_PASSWORD || !SESSION_SECRET) return sendJson(res, 503, { error: "Admin login not configured on the server (ADMIN_PASSWORD / SESSION_SECRET)." });
    const s = getStore();
    if (!s) return sendJson(res, 503, { error: "Database not connected." });
    const ip = clientIp(req);
    if (await s.loginFailureCount(ip) >= 10) return sendJson(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const { password } = await readBody(req);
    if (!password || !passwordMatches(password)) {
      await s.recordLoginFailure(ip);
      return sendJson(res, 401, { error: "Password admin salah." });
    }
    await s.clearLoginFailures(ip);
    const token = sign({ role: "admin", exp: Date.now() + SESSION_TTL_MS });
    return sendJson(res, 200, { role: "admin" }, { "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
  }

  if (p === "/api/logout" && req.method === "POST") {
    return sendJson(res, 200, { role: null }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  // Full backup of every stored key (admin only).
  if (p === "/api/export" && req.method === "GET") {
    if (role !== "admin") return sendJson(res, 403, { error: "Admin sahaja." });
    const s = getStore();
    if (!s) return sendJson(res, 503, { error: "Database not connected." });
    const out = {};
    for (const r of await s.all()) out[r.key] = { value: JSON.parse(r.value), version: r.version, updated_at: r.updated_at };
    const stamp = new Date().toISOString().slice(0, 10);
    return sendJson(res, 200, out, { "Content-Disposition": `attachment; filename="fleet-backup-${stamp}.json"` });
  }

  /* Google Sheet (shared "anyone with the link") → its .xlsx export, so the page can read
     rows + hyperlinks. Only the sheet id is taken from the caller; the URL is fixed (no SSRF). */
  const gs = p.match(/^\/api\/gsheet\/([A-Za-z0-9_-]{20,100})$/);
  if (gs && req.method === "GET") {
    if (role !== "admin") return sendJson(res, 403, { error: "Admin sahaja." });
    let r, buf;
    try { r = await fetch(`https://docs.google.com/spreadsheets/d/${gs[1]}/export?format=xlsx`, { redirect: "follow" }); buf = Buffer.from(await r.arrayBuffer()); }
    catch { return sendJson(res, 502, { error: "Could not reach Google Sheets." }); }
    if (!r.ok || buf.subarray(0, 2).toString() !== "PK") {
      return sendJson(res, 403, { error: "Cannot open the Google Sheet — set sharing to “Anyone with the link can view”." });
    }
    res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store" });
    return res.end(buf);
  }

  /* Copy a PDF from Google Drive (shared "anyone with the link") into file storage. */
  if (p === "/api/files/fromdrive" && req.method === "POST") {
    if (role !== "admin") return sendJson(res, 403, { error: "Admin sahaja." });
    const s = getStore();
    if (!s || !s.putFile) return sendJson(res, 503, { error: "File storage not available." });
    const { driveId, id } = await readBody(req);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(driveId || "")) || !/^[A-Za-z0-9_.-]{1,120}\.pdf$/.test(String(id || ""))) {
      return sendJson(res, 400, { error: "Bad request" });
    }
    let data = null;
    for (const url of [`https://drive.google.com/uc?export=download&id=${driveId}`,
                       `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`]) {
      let r, buf;
      try { r = await fetch(url, { redirect: "follow" }); if (!r.ok) continue; buf = Buffer.from(await r.arrayBuffer()); }
      catch { continue; }
      if (buf.subarray(0, 5).toString() === "%PDF-") { data = buf; break; }
    }
    if (!data) return sendJson(res, 422, { error: "Not a downloadable PDF — check the file is shared “Anyone with the link”." });
    if (data.length > 15 * 1024 * 1024) return sendJson(res, 413, { error: "PDF larger than 15 MB." });
    await s.putFile(id, data, "application/pdf");
    return sendJson(res, 200, { id, size: data.length });
  }

  /* Uploaded documents (insurance policy PDFs, purchase quotations, vehicle photos, job-request POs). Admin only, except POs (below). */
  const f = p.match(/^\/api\/files\/([A-Za-z0-9_.-]{1,120})$/);
  if (f) {
    const id = f[1];
    /* Purchase-order files attached to a job request ("po-" + long random id) can be uploaded by
       requesters and opened by the assigned driver from the WhatsApp link — no login. They can
       never be overwritten or deleted except by admin. */
    const isPo = /^po-[a-z0-9]{20,40}\.(pdf|jpg|png|webp)$/.test(id);
    if (role !== "admin" && !(isPo && ["GET", "HEAD", "PUT"].includes(req.method)))
      return sendJson(res, 403, { error: "Admin sahaja." });
    const s = getStore();
    if (!s || !s.putFile) return sendJson(res, 503, { error: "File storage not available." });
    if (req.method === "GET" || req.method === "HEAD") {
      const file = await s.getFile(id);
      if (!file) return sendJson(res, 404, { error: "File not found" });
      res.writeHead(200, { "Content-Type": file.type || "application/pdf", "Content-Length": file.data.length,
        "Content-Disposition": `inline; filename="${id}"`, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
      return res.end(req.method === "HEAD" ? undefined : file.data);
    }
    if (req.method === "PUT") {
      const type = String(req.headers["content-type"] || "").split(";")[0].trim();
      if (!FILE_TYPES[type] || !id.endsWith(FILE_TYPES[type])) return sendJson(res, 415, { error: "Only PDF or image files (JPG / PNG / WEBP) are accepted." });
      const data = await readRawBody(req);
      if (!data.length) return sendJson(res, 400, { error: "Empty file" });
      if (!fileMagicOk(type, data)) return sendJson(res, 415, { error: "The file content does not match its type (PDF / JPG / PNG / WEBP)." });
      if (role !== "admin" && await s.getFile(id)) return sendJson(res, 409, { error: "File already exists." });
      await s.putFile(id, data, type);
      return sendJson(res, 200, { id, size: data.length });
    }
    if (req.method === "DELETE") {
      await s.deleteFile(id);
      return sendJson(res, 200, { id, deleted: true });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const m = p.match(/^\/api\/storage\/([A-Za-z0-9_]+)$/);
  if (m) {
    const key = m[1];
    const meta = STORAGE_KEYS[key];
    if (!meta) return sendJson(res, 404, { error: "Unknown key" });
    const s = getStore();
    if (!s) return sendJson(res, 503, { error: "Database not connected — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });

    if (req.method === "GET") {
      const row = await s.get(key);
      if (!row) return sendJson(res, 200, { key, value: null });
      return sendJson(res, 200, { key, value: row.value, version: row.version, updated_at: row.updated_at });
    }
    if (req.method === "PUT") {
      if (meta.adminOnly && role !== "admin") return sendJson(res, 403, { error: "Admin sahaja boleh simpan data ini." });
      const { value } = await readBody(req);
      if (typeof value !== "string") return sendJson(res, 400, { error: "value must be a string" });
      try { JSON.parse(value); } catch { return sendJson(res, 400, { error: "value must be JSON text" }); }
      const saved = await s.put(key, value, role || "public");
      return sendJson(res, 200, { key, version: saved.version, updated_at: saved.updated_at });
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 404, { error: "Not found", path: p });
}

/* Entry point for /api/* requests. */
async function handleApi(req, res, pathname) {
  try {
    // CSRF guard: state-changing API calls must come from this app's own pages.
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-requested-with"] !== "fleet-app") {
      return sendJson(res, 403, { error: "Forbidden" });
    }
    await route(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : "Server error" });
  }
}

module.exports = { handleApi, configWarnings, getStore };
