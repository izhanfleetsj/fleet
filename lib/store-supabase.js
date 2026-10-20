/* Supabase (Postgres) storage via the Supabase REST API — used on Vercel, where
   the filesystem is not persistent. Needs the server-only service_role / secret
   key; tables are locked with RLS so the public key cannot read them.
   Schema: supabase/schema.sql. No client library needed — plain fetch. */
"use strict";

module.exports = function createSupabaseStore(url, key) {
  const base = url.replace(/\/+$/, "") + "/rest/v1";
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  async function call(method, pathname, body, extraHeaders = {}) {
    const res = await fetch(base + pathname, { method, headers: { ...headers, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = (data && (data.message || data.hint)) || `HTTP ${res.status}`;
      throw new Error(`Supabase: ${msg}${res.status === 404 ? " (did you run supabase/schema.sql?)" : ""}`);
    }
    return data;
  }
  const rpc = (fn, args) => call("POST", `/rpc/${fn}`, args);

  /* Files go to a private Supabase Storage bucket (created on first upload). */
  const storageBase = url.replace(/\/+$/, "") + "/storage/v1";
  const BUCKET = "fleet-files";
  const authHeaders = { apikey: key };
  if (key.startsWith("eyJ")) authHeaders.Authorization = `Bearer ${key}`;
  async function ensureBucket() {
    await fetch(`${storageBase}/bucket`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });   // "already exists" is fine
  }
  async function upload(id, data, type) {
    return fetch(`${storageBase}/object/${BUCKET}/${encodeURIComponent(id)}`, { method: "POST",
      headers: { ...authHeaders, "Content-Type": type, "x-upsert": "true" }, body: data });
  }

  return {
    name: "supabase",
    async get(k) {
      const rows = await call("GET", `/fleet_kv?key=eq.${encodeURIComponent(k)}&select=value,version,updated_at`);
      return rows.length ? rows[0] : null;
    },
    async put(k, value, role) {
      const rows = await rpc("fleet_put", { p_key: k, p_value: value, p_role: role });
      return rows[0];
    },
    async all() { return call("GET", "/fleet_kv?select=key,value,version,updated_at"); },
    async history(k, limit = 50) {
      return call("GET", `/fleet_kv_history?key=eq.${encodeURIComponent(k)}&select=id,value,role,saved_at&order=id.desc&limit=${Number(limit) || 50}`);
    },
    // every file in the bucket (for moving to a new project): [{id, type, size}]
    async listFiles() {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const res = await fetch(`${storageBase}/object/list/${BUCKET}`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: "", limit: 1000, offset, sortBy: { column: "name", order: "asc" } }) });
        if (res.status === 404 || res.status === 400) break;   // bucket not created yet
        if (!res.ok) throw new Error(`Supabase storage: HTTP ${res.status}`);
        const rows = await res.json();
        rows.filter(r => r && r.name && r.id !== null).forEach(r => out.push({ id: r.name, type: (r.metadata && r.metadata.mimetype) || "", size: (r.metadata && r.metadata.size) || 0 }));
        if (rows.length < 1000) break;
      }
      return out;
    },
    async getFile(id) {
      const res = await fetch(`${storageBase}/object/${BUCKET}/${encodeURIComponent(id)}`, { headers: authHeaders });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Supabase storage: HTTP ${res.status}`);
      return { type: res.headers.get("content-type") || "application/pdf", data: Buffer.from(await res.arrayBuffer()) };
    },
    async putFile(id, data, type) {
      let res = await upload(id, data, type);
      if (!res.ok) { await ensureBucket(); res = await upload(id, data, type); }
      if (!res.ok) throw new Error(`Supabase storage upload: HTTP ${res.status} ${await res.text()}`);
    },
    async deleteFile(id) {
      await fetch(`${storageBase}/object/${BUCKET}`, { method: "DELETE", headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [id] }) });
    },
    async loginFailureCount(ip) { return Number(await rpc("fleet_login_failures", { p_ip: ip })) || 0; },
    async recordLoginFailure(ip) { await rpc("fleet_login_fail", { p_ip: ip }); },
    async clearLoginFailures(ip) {
      await call("DELETE", `/fleet_login_attempts?ip=eq.${encodeURIComponent(ip)}`, null, { Prefer: "return=minimal" });
    },
  };
};
