# CLAUDE.md

Read **HANDOVER.md** first. It covers the project overview, how the owner works (reply in Malay, commit and
push every change to `claude/fleet-system-app-fuj4wz`, bump `public/sw.js` CACHE build number),
architecture, data-loss rules, module notes and how to test locally.

Quick rules:
- Every new API path needs a Vercel function file under `api/`, and every new storage key goes into
  `STORAGE_KEYS` in `lib/api.js`.
- Never save an admin-only list that the page has not loaded. Use `mergeSaveList` (or the hiring merge) for
  shared lists.
- UI text goes through `fleetI18n.tr()`; add BM pairs in `public/i18n.js`.
- Verify with Playwright locally (production is not reachable from the sandbox) before you report something as done.
