# Course+ — build state

Single-user, Claude-connected project/meeting workspace (suite sibling to Course).
Forked from Scribe, repointed to `cp_*` tables.
**Live:** https://nates123-cmd.github.io/Course-plus-app/

## Stack
- Vite + React 19 + `@supabase/supabase-js`. Plain JS/JSX.
- Theming: CSS vars in `src/styles.css` (light/dark) via `[data-theme]` on `<html>`;
  components read `t.*` from `src/theme/tokens.js` (→ `var(--*)`). `ctx.mobile`
  (`useIsMobile`, 760px) drives the responsive split.
- Shared suite Supabase project `xsmnfcmtbpeaccnyinkr`. 8-digit email OTP
  (`src/auth/AuthGate.jsx`), per-user RLS. Claude via the JWT-gated `claude`
  edge proxy (`src/lib/claude.js`, called with a plain `fetch` so only
  allow-listed CORS headers are sent).

## Data model (Supabase, per-user RLS, `cp_*` prefix)
- `cp_areas` / `cp_projects` — the left-nav tree.
- `cp_tasks` / `cp_milestones` — project work + milestones.
- `cp_notes` — documents + meetings (`transcript` column for raw transcripts).
- `cp_artifacts` — Claude-composed deliverables / update guides.
- `cp_updates` — "where it stands" project log.
- `cp_inbox` — untriaged captures.
- Migrations in `supabase/migrations/`. `src/lib/db.js` = loadAll, seedIfEmpty,
  createNote/Project/Task, updateNote, complete/delete, triage, etc.
  `src/DataContext.jsx` loads on login + exposes data + helpers (silent
  background reload after mutations).

## Screens
Overview, Library, Inbox, Project, Note, Artifact (full-page viewer + DocChat),
Ask (retrieval over notes), Record (meeting capture + transcribe), TaskSheet.

## DONE (live)
- Web app: all screens + shell, mobile layout, Supabase-backed data, demo seed.
- Live Claude: Ask, project Briefing, Compose/Artifacts, Capture Synthesize,
  note rail actions (Summarize / Extract / Suggest tags / Rewrite), DocChat
  (whole-project context), "Update doc from meeting" hybrid edit guide.
- Optimistic task chip updates, task undo, back button.
- **MCP server Phase 1 (local stdio):** `mcp/server.js` + `mcp/login.mjs`
  (OTP → `mcp/.session.json`). Wire into `claude_desktop_config.json`.
- **MCP server Phase 2 (remote, DEPLOYED):** edge fn `supabase/functions/mcp/index.ts`
  = MCP JSON-RPC + OAuth 2.1. Live at
  `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/mcp`. Connect in
  claude.ai → Settings → Connectors → Add custom connector. Guards: email
  allowlist (`MCP_ALLOWED_EMAIL`), `COURSE_MCP_READONLY` toggle, redirect locked
  to claude.ai/.com, 5-min single-use codes. (Connected here as "Course Plus".)

## MCP tools
Thin Supabase wrappers mirroring `src/lib/db.js` — server returns data, host
Claude reasons (no double-billing through Course+'s own proxy). Areas:
`list_areas`/`create_area`. Projects: `list_projects`/`get_project`/`create_project`/
`update_project`. Tasks: `list_tasks`/`create_task`/`update_task`/`complete_task`/
`delete_task`. Notes: `list_notes`/`get_note`/`create_note`/`update_note`/`delete_note`.
Artifacts: `list_artifacts`/`get_artifact`/`create_artifact`. Updates: `add_update`.
Inbox: `list_inbox`/`triage_inbox`.

## Deploy
`npm run build:gh-pages` (base `/Course-plus-app/`) → push `dist/` to the
`gh-pages` branch → trigger a Pages build.

## Run
- `npm install` → `npm run dev`
- `npm run build` / `npm run build:gh-pages`
