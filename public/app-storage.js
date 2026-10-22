/* Shared storage adapter — gives the dashboard the same window.storage.get/set
   interface it used as a Claude Artifact, but backed by the Fleet Ops server
   (SQLite) so all staff share one copy of the data. */
(function(){
  const HEADERS = { "Content-Type": "application/json", "X-Requested-With": "fleet-app" };

  async function call(method, url, body){
    const res = await fetch(url, { method, headers: HEADERS, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  }

  window.storage = {
    /* Resolves to {key, value} or null when nothing has been saved yet. */
    async get(key){
      const r = await call("GET", "/api/storage/" + encodeURIComponent(key));
      if(!r.ok) throw new Error((r.data && r.data.error) || ("HTTP " + r.status));
      return r.data.value == null ? null : { key: r.data.key, value: r.data.value };
    },
    async set(key, value){
      const r = await call("PUT", "/api/storage/" + encodeURIComponent(key), { value });
      if(!r.ok) throw new Error((r.data && r.data.error) || ("HTTP " + r.status));
      return { key, value };
    },
  };

  window.fleetAuth = {
    async session(){ const r = await call("GET", "/api/session"); return r.ok ? r.data.role : null; },
    async login(password){
      const r = await call("POST", "/api/login", { password });
      return r.ok ? { ok: true, role: r.data && r.data.role } : { ok: false, error: (r.data && r.data.error) || "Login failed." };
    },
    async logout(){ await call("POST", "/api/logout"); },
  };

  /* Show a banner when the server is missing configuration (e.g. Supabase or
     admin env vars not yet set on Vercel), so nobody thinks data is being saved. */
  window.addEventListener("DOMContentLoaded", async ()=>{
    try{
      const r = await call("GET", "/api/health");
      if(!r.ok || !r.data || r.data.ok) return;
      const bar = document.createElement("div");
      bar.style.cssText = "background:#C1443C;color:#fff;font:600 12.5px Inter,sans-serif;padding:8px 16px;";
      bar.textContent = "⚠ Server belum lengkap dikonfigurasi: " + r.data.warnings.join(" · ");
      document.body.prepend(bar);
    }catch{}
  });

  if("serviceWorker" in navigator){
    window.addEventListener("load", ()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
  }
})();
