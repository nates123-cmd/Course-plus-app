# Scribe — build state

Single-user, Claude-connected notes/reference app (suite sibling to Course).
**Live:** https://nates123-cmd.github.io/Scribe-App/

## Stack
- Vite + React 19 + `@supabase/supabase-js`. Plain JS/JSX.
- Theming: CSS vars in `src/styles.css` (light/dark) via `[data-theme]` on `<html>`;
  components read `t.*` from `src/theme/tokens.js` (→ `var(--*)`). `ctx.mobile`
  (`useIsMobile`, 760px) drives the responsive split.
- Shared suite Supabase project `xsmnfcmtbpeaccnyinkr`. 8-digit email OTP
  (`src/auth/AuthGate.jsx`), per-user RLS. Claude via the JWT-gated `claude`
  edge proxy (`src/lib/claude.js`, called with a plain `fetch` so only
  allow-listed CORS headers are sent).

## Data model (Supabase, per-user RLS)
- `scribe_areas` / `scribe_projects` — the left-nav tree.
- `scribe_notes` — documents. Sub-structures (body / actions / related as JSONB;
  people / tags / terms / projects as arrays). `transcript` column stores raw
  meeting transcripts. Ordered by `updated_at desc`.
- `scribe_inbox` — untriaged captures.
- Migrations in `supabase/migrations/`. `src/lib/db.js` = loadAll, seedIfEmpty
  (memoized), createNote, updateNote, deleteNote, deleteInbox, createArea,
  createProject. `src/DataContext.jsx` loads on login + exposes data + helpers.

## DONE (all live)
- All 7 screens (Library, Inbox, Capture, Note, Project, Ask, Compose) + shell.
- Mobile layout (drawer nav + bottom tabs + single-column screens).
- Supabase-backed data; demo fixtures seed once per user on first load.
- Live Claude: Ask (retrieval over notes incl people/terms/body/transcript),
  project Briefing, Compose deliverables, Capture Synthesize. Note Claude-rail
  actions (Summarize / Extract action items / Suggest tags / Rewrite) write back.
- Note editing (title/body/tags), delete, recency sort, selectable content.
- Inbox triage creates real notes (+ project picker). Capture saves notes +
  meetings (with transcript) and has a home picker.
- Add areas/projects from the sidebar (+ buttons).
- Deployed to GitHub Pages from the `gh-pages` branch.

## Deploy (manual — token lacks `workflow` scope)
`.github/workflows/deploy.yml` exists but can't be pushed without re-auth.
Until then, re-ship = `npm run build:gh-pages` → force-push `dist/` to the
`gh-pages` branch → `gh api -X POST repos/nates123-cmd/Scribe-App/pages/builds`.
To switch to auto-deploy-on-push: `gh auth refresh -h github.com -s workflow`,
then re-add the workflow file.

## Planned: MCP connection to a Claude subscription
Goal: work Scribe notes from inside the Claude apps (Desktop / claude.ai),
billed by the user's Pro/Max subscription — NOT a way to make Scribe's own
in-app AI free (subscription ≠ API credits; Scribe's API calls always bill
tokens).

Build a **Scribe MCP server** (Claude = client, Scribe = data source):
- Tools wrapping existing ops: `search_notes(query)`, `get_note(id)`,
  `list_areas`, `create_note(...)`, `update_note(...)`, `ask(query)`; optionally
  notes as MCP resources. Reuse `src/lib/db.js` + `src/lib/ai.js` logic.
- Transport: remote MCP over HTTP (a new Supabase Edge Function fits the suite)
  for claude.ai, or local stdio for Claude Desktop.
- Auth: server must act as the user so RLS scopes rows.
  - Phase 1 (fast): Claude Desktop, local stdio, token in config — no OAuth (~½ day).
  - Phase 2: claude.ai web connector — needs OAuth 2.0 on the server (Pro/Max/
    Team/Enterprise) (~1–2 days).
- Effort: medium. Start with Desktop/stdio to prove the tools, then add OAuth.

## Remaining (not blocking)
- "+ Course" action-item push (needs Course's `course_captures` schema).
- Semantic search / Voyage embeddings — Ask currently sends note content
  (incl. transcripts) to Claude every query; cost grows as transcripts pile up.
  Embeddings = send only relevant notes.
- Full PWA install (service worker; main.jsx currently unregisters SWs).
- Solar auto light/dark; related/[[links]] resolve by title not id.
- Optional: route Synthesize/Extract/Suggest-tags to Haiku (~3× cheaper).

Out of scope per brief: block editor, graph view, board/timeline/calendar,
in-app docx/pptx export, sharing/collab/permissions.

## Run
- `npm install` → `npm run dev`
- `npm run build` / `npm run build:gh-pages` (base `/Scribe-App/`)
