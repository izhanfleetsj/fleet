# Fleet Ops — Handover for the next Claude Code session

This file is for the Claude Code account that takes over this project. Read it fully
before changing anything. `CLAUDE.md` points here so it loads automatically.

---

## 1. What this is

**Fleet Swis Group fleet app**. It is a single-page web app used by admin, branch PICs, drivers and
requesters.

| | |
|---|---|
| Live URL | https://fleet-six-self.vercel.app (keep this link — do not create a new Vercel project) |
| Repo | `sharull92/fleet` |
| Working / deploy branch | `claude/fleet-system-app-fuj4wz`. Vercel deploys from this branch; every push goes live in about 1–2 min |
| Hosting | Vercel (functions in `api/`) and Supabase Postgres (data + `fleet-files` storage bucket) |
| Local / Docker | `server.js` with SQLite (`data/fleet.db`, git-ignored) |
| Node | 22, **zero npm dependencies** (Chart.js, XLSX, pdf.js are vendored in `public/vendor/`) |

## 2. How the owner works (important)

- **Reply in Bahasa Melayu.** The owner writes short Malay messages, often with a screenshot that has
  coloured boxes marking what to change. Keep replies short: what changed, how to use it, build number.
- **After every change: commit and push to `claude/fleet-system-app-fuj4wz`.** Do **not** open PRs unless
  asked. Do not put model names or IDs in commits.
- **Bump the build** on every change: `public/sw.js` → `const CACHE = "fleet-ops-vNNN"`. The current value
  is in the file (at the time of writing it was **v145**). The sidebar shows "build NNN" (read from `sw.js`). When the owner says
  "masih sama / tak berubah", ask them which build the sidebar shows. If it is old, it is a deploy or cache
  issue (hard refresh with Ctrl+Shift+R), not a code issue.
- The production site is **not reachable from the cloud sandbox** (egress proxy 403). Verify locally with
  Playwright. Never claim something was checked on production.
- **Security:** never ask for or echo passwords or API keys in chat. The admin password once appeared in a
  screenshot, so the owner was advised to change it (Vercel env `ADMIN_PASSWORD`). Do not repeat it.

## 3. Layout

```
server.js            local server: static /public + /api/* → lib/api.js
lib/api.js           ALL API logic: STORAGE_KEYS whitelist, login/session, files, history, gsheet, export
lib/store-sqlite.js  SQLite store (kv, kv_history last 50 versions, files)
lib/store-supabase.js Supabase REST store (fleet_kv, fleet_kv_history, storage bucket fleet-files)
supabase/schema.sql  tables + fleet_put() RPC (saves value and keeps 50 history versions per key)
api/**               Vercel functions — thin wrappers that call lib/api.js handleApi(path)
public/index.html    the whole front end (~8,000 lines: HTML + CSS + JS)
public/i18n.js       BM/EN translation (PAIRS + TEMPLATES) + theme switch; fleetI18n.tr()
public/app-storage.js window.storage.get/set → /api/storage/:key ; window.fleetAuth
public/wa-parse.js   WhatsApp job-message parser (Requester "Paste from WhatsApp")
public/sw.js         service worker, network-first; CACHE name = build number
```

### ⚠ Vercel routing gotcha
On Vercel, **every new API path needs a file under `api/`** (for example, `api/history/[key].js` for
`/api/history/:key`). The local `server.js` routes everything, so a route can work locally and still
return 404 on Vercel if the `api/` file is missing.

### Storage model
- Each dataset is **one JSON string under one key** (`PUT /api/storage/:key {value}`). Reads are public.
  Writes to `adminOnly` keys need the admin cookie. Keys are whitelisted in `STORAGE_KEYS` in `lib/api.js`,
  so a new key must be added there.
- The server keeps the **last 50 versions of every key** (`kv_history` / `fleet_kv_history`).
  `GET /api/history/:key` (admin) returns them, and the app's 🕘 *Recover* buttons use it.
- Files: `/api/files/:id` accepts PDF, JPG, PNG and WEBP, checks magic bytes, max 4 MB on Vercel, admin only.
  - Exception: ids matching `po-<20-40 chars>.(pdf|jpg|png|webp)` are public for GET/HEAD/PUT, and a public
    PUT cannot overwrite an existing file. These are POs uploaded by requesters and opened by drivers from
    WhatsApp links.
  - Back-charge forms use `bc-…` ids (admin only).

| Key | adminOnly | Used by |
|---|---|---|
| fleetComplianceRegister_v2 | no | Compliance Register (also insurance fields) — `complianceData` |
| fleetTickets_v1 | no | Workshop tickets (Driver / Repair) |
| fleetHiringRecords_v1 | no | Job requests (Requester / Hiring) |
| fleetCostingData_v1 | no | legacy costing rows (still used by Utilization) |
| fleetUtilizationData_v1, fleetTargetConfig_v1 | yes | Utilization |
| fleetContactsConfig_v1, fleetHolidays_v1 | yes | Settings (WhatsApp contacts, public holidays) |
| fleetDailyMovement_v1 | no | Driver daily movement / checklist |
| fleetDisposePipeline_v1 | yes | New / Dispose pipeline |
| fleetPurchaseInbox_v1 | no | purchase requests sent from the Requester page (imported by admin) |
| fleetInsuranceComparisons_v1 | yes | Insurance Renewal Comparison |
| fleetInsuranceDb_v1 | yes | Vehicle's Insurance Database |
| fleetOdooPo_v1 | yes | Costing (Odoo PO pivot import) |

### ⚠ Data-loss rules (learned the hard way)
1. Saving writes the **whole list**. If a page saves a list it never loaded, it wipes the server copy.
   - Admin-only lists load at startup only when the user is admin. `submitAdminLogin()` now also loads
     comparisons, the insurance DB and the Odoo data.
   - **Any new admin-only list must also be loaded there.**
2. Lists edited by several people use **per-record merge on save**:
   - Hiring: `persistHiringRecords()` (uid based, `hiringBase`).
   - Insurance comparisons and DB: generic `mergeSaveList(key, arr)` + `mergeBaseSet()`, which records need `id`.
   - Use the same helpers for new shared lists.
3. Inside the inline `<script>` of index.html never write a literal `</script>`. In print windows use
   `<\/script>`; a literal one breaks the whole page.

### Moving to a new database (Supabase project change)
Settings → **Move Database (new Supabase)** (`#migPanel`).
- **⬇ Download full backup** (`migDownload`) reads `GET /api/migrate-index` (admin; returns keys + file
  list + connected host), then downloads every key and every file into one JSON (`fleet-full-backup-v1`,
  files base64).
- **⬆ Restore from backup** (`migRestore`) PUTs them into whatever database is connected now.
- Steps for the owner: download from the old project → run `supabase/schema.sql` in the new project → change
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel and redeploy → log in → Restore.
- Key history (`kv_history`) is not carried over.

### Management login (view only)
Vercel env `MANAGEMENT_PASSWORD` enables a second login through the same 🔒 login button. Its session role
is `management`.
- **Server:** every `PUT /api/storage` returns 403, and files are GET/HEAD only.
- **Client:** `currentRole` is set to `"admin"` so all pages render, plus `READ_ONLY=true` / `body.read-only`:
  - `roSweep()` hides or disables every control whose inline handler matches `RO_EDIT_RE` (add / save /
    delete / update / upload / import / assign / send…).
  - `window.storage.set` is a no-op.
- **When adding a new editing control,** make sure its handler name matches `RO_EDIT_RE` (or extend the regex).

## 4. Front-end conventions
- **Translation:** UI text goes through `fleetI18n.tr("English")`. Add `["English","Melayu"]` to
  `PAIRS` in `public/i18n.js`. Strings with values go in `TEMPLATES`, for example
  `["{a} record(s) restored.","{a} rekod dipulihkan."]`, and are called with a template literal. The old `T()`
  is only the legacy EN dictionary.
- **Excel-style filters:** `xlRegister(id,{data,render,cols})`, `xlHeaderHtml(id)`, `xlRows(id)`, `xlAnyActive(id)`.
- **Phone layout:** at ≤700px, tables inside `.content` automatically become stacked cards
  (`mobileCardTables()` + `.m-cards` CSS, labels from the header). Add class `no-mcard` to opt out (pivot or
  wide matrix tables).
- **Printing / PDF:** `window.open` + `document.write` of a full HTML page with `@page` CSS, then
  `window.print()`. The owner saves it as PDF.
- **Charts:** Chart.js. The Costing palette was validated for light and dark mode with the dataviz validator.
  Dark mode is `html[data-theme="dark"]`, and colours come from CSS vars via `fleetI18n.cssVar()`.
- **Branches:** `BRANCH_CODES = OKLG, OSJ, OSBN, OPJ, OHDD, HQ Shared, OTN, SUBCON`. Register
  `location` → branch via `locationBranch()` (KLANG→OKLG, S.JAYA→OSJ, SEREMBAN→OSBN, PUTRAJAYA→OPJ, HDD→OHDD,
  HQ→HQ Shared). Show **branch codes** in Branch columns.
- Helpers: `escHtml`, `badge(text,cls)`, `A(msg)` (alert), `setSyncStatus`, `APP_TODAY_ISO`, `dmyToIso`,
  `isoToDmy`, `utilPlateKey(plate)` (normalise plates for matching).
- The owner likes UPPERCASE inputs (`class="dsp-up"`) and auto-save.

## 5. Modules (sidebar order) and key functions

| # | View id | Notes / key functions |
|---|---|---|
| 00 | overview | Dashboard KPIs, utilization gauge. "Attention Needed This Week" table has a Branch column — `renderOverview()` |
| 01 | external | Driver: daily movement + checklist, workshop ticket |
| 02 | requester | Public (no login). Log job request (paste from WhatsApp, PO upload `uploadHirePo`, pickup / drop-off + share location); "My Job Requests — Status" (yesterday / today / upcoming, cancel job → WhatsApp driver + admin); New Vehicle Purchase Request form (goes to `fleetPurchaseInbox_v1`) |
| 03 | compliance | Register (road tax / inspection / insurance / JKKP / APAD), Excel filters, renewal calendar + holidays. Admin edits cells inline (category, location, dates…) |
| 04 | insurance | Order: **Insurance Database (top) → Renewal Comparison → Insurance Register** |
| 05 | repair | Workshop tickets, repair frequency |
| 06 | costing | **Odoo PO pivot** only (old Excel costing UI removed) |
| 07 | hiring | Job records (New jobs grouped on top), assign panel, back charge, KPIs, Hire vs Own by item |
| 08 | utilization | GPS Oncore days utilized, targets (uses `costingData`) |
| 09 | dispose | New / Dispose pipeline + purchase request workflow |
| 10 | settings | WhatsApp contacts, holidays, backup download |

Module details:

- **Insurance Database** (`fleetInsuranceDb_v1`): `idbCalc()` follows the owner's Excel formulas:
  - NCD RM = basic × NCD%; gross = basic − NCD + add-ons
  - Service tax 8% on gross *before* rebate; total = gross − rebate + tax + stamp duty
  - Previous year = the latest earlier policy year, else the comparison's "Amt Payable" − stamp duty
  - Results: Saving / Increase / renewal status
  - Month filter `#idbMonth` (renewal month = policy start date)
  - **🖨 Export PDF report** → `printInsuranceDbReport()`: A4 landscape, summary boxes, table, totals, signatures
  - 🕘 Recover → `openRecover('idb')`
- **Renewal Comparison** (`fleetInsuranceComparisons_v1`): per vehicle per month.
  - Quotes grouped by broker; `icCalc()`; NCB is locked to basic × NCD; Additional Cover is the sum of benefits.
  - ★ selected quote auto-syncs to the register (`icSyncToRegister`, `icSyncAll`) and to the DB.
  - Broker PDF import: `importInsComparisonPdfs` (pdf.js).
  - Prints: `printInsComparison`, `printInsMonthlySummary` (sorted by road-tax day/month).
  - "All months" checkbox and 🕘 Recover.
- **Costing / Odoo** (`fleetOdooPo_v1`): import an Odoo `purchase.order.line` pivot xlsx (rows = vehicle → product,
  columns = months).
  - `parseOdooPivot()` merges Odoo " (2)" duplicate groups and also accepts total-only files.
  - `odooCategory()` sorts items into five types:

    | Type | Odoo items |
    |---|---|
    | fuel | fuel items |
    | repair | upkeep, parts, labour, machinery hiring, HDD joint machine, "upkeep of computer" (a mis-keyed vehicle upkeep) |
    | insurance | insurance + stamp duty |
    | gps | GPS items |
    | other | **Fixed Assets**: fixed assets, (Asset), small lorry, car/van |

  - Page has: year select (Jan–Dec columns), company / branch / type / sort / search filters, and the **multi-select
    Item filter** (`opItemSel`). The "☑ Odoo items" list switches items on or off (`odooPo.items`).
  - It also shows six KPIs, a monthly stacked chart + top-10 vehicles chart, an expandable pivot table
    (`renderCosting`, `opRows`) and Excel export (`exportOdooPivot`).
- **Hiring** (`fleetHiringRecords_v1`): each job has `assignments[]`
  (`{source:"Sendiri"|"Sewa", vehicle, driverName, driverPhone, bcFile?}`).
  - KPIs count this month excluding cancelled; Job Cancelled card.
  - The Hire vs Own by item table shows jobs vs units (a job can need more than one vehicle).
  - **Back charge**: an own-fleet vehicle whose register branch differs from the job branch shows
    "Back charge pending" + upload (`backChargeHtml`, `uploadBackCharge`).
  - Reply template buttons: 📲 Supervisor, WhatsApp driver, **👥 WhatsApp Group** (`wa.me/?text=`; a group
    cannot be targeted directly, so the user picks it).
  - The job *Item* is what the requester asked for. The vehicle type comes from the register `category`.
- **New / Dispose** (`fleetDisposePipeline_v1`): stages requested / approved / inProgress / delivered / disposed.
  - Removing a vehicle from the register moves it to Disposed (restore ↩).
  - Purchase request: serial `NV/YYYY/NNN` (`nextPurchaseSerial`); fields include **Requesting Branch
    (required)**.
  - **Trade-in can list several old vehicles** (`item.oldPlates[]` + `item.oldPlate` joined string; `prOldSet`,
    `prOldGet`).
  - Quotations 3–5 with files + ★ recommended, vehicle photos.
  - Prints `printPurchaseRequest(stage, idx, 'form'|'full')`:
    - Page 1 is the company form. The reason text is wrapped onto the ruled lines by `PR_WRAP_JS`, and
      trade-in plates are listed one per line.
    - The full bundle = quotation summary + quotation pages + approval page (B + C).
    - Page numbers are "Muka x / N".

- **Disposal request** (stage `disposalReq`, kind `"disposal"`, serial `DP/YYYY/NNN`):
  - The "+ Dispose" button on the Total Vehicles Sold card opens `toggleDisposalForm()`.
  - The form takes one or more plates, method (Jual / Trade In / Lupus / Hapus Kira), estimated value,
    meter reading and reason. Vehicle photos (required, up to 12) and attachments (up to 4) use
    `uploadDisposalFiles`.
  - `printDisposalRequest(idx | -1, disposedIdx)` prints: page 1 form, photo pages (6 per page),
    attachment pages, then a B + C approval page.
  - `completeDisposal(idx)` removes the plates from the register into Disposed. Each Disposed row keeps
    `dispReq`, so it can still be reprinted.

## 6. Testing locally (Playwright)
```bash
# start (kill old ones first — do NOT use `pkill -f "node server"`, it kills your own shell)
ps aux | grep "node server" | grep -v grep | awk '{print $2}' | xargs -r kill
(ADMIN_PASSWORD=secret123 PORT=3077 node server.js > /dev/null 2>&1 &); sleep 2
# Playwright is installed globally; Chromium is preinstalled
NODE_PATH=$(npm root -g) node my-test.js
```
Test script pattern: `browser.newContext({serviceWorkers:'block'})`, then `page.goto('http://localhost:3077/')`,
then `await page.evaluate(()=>fleetAuth.login('secret123'))`, then `page.reload()`. Navigate with
`.nav-btn[data-view=…]`. Always collect `pageerror` events and screenshot the result before reporting.
Print windows: `Promise.all([ctx.waitForEvent('page'), page.evaluate(()=>printX())])`.
Local test data goes into `data/fleet.db`, which is git-ignored.

## 7. Open items / things the owner may come back to
- **Recover on Vercel:** `api/history/[key].js` was added at handover time. Before that, 🕘 Recover returned
  404 on production. After deploy, ask the owner to run 🕘 Recover in Insurance (Comparison and Database) to
  bring back comparisons lost to the old overwrite bug.
- Offered, not yet requested:
  - Let admin change a job's *Item* in the Hiring Edit panel.
  - Show branch codes (OSJ) instead of S.JAYA in the register *Location* columns.
- The old purchase request NV/2026/001 was created before "Requesting Branch" existed. Admin needs to edit it and pick a branch.
- 19 Odoo plates are not in the Compliance Register (machines XZ…, HL…, SW 15 motorcycle, VMQ 4987/4991,
  etc.). They show in Costing without company, branch or type.
- `HIRE_ELIGIBLE_CATEGORIES` in index.html is unused (the assign panel lists all vehicles, with the matching
  category first).
