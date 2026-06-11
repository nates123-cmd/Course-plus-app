# Course+ MCP Server — implementation plan

Let **Claude Desktop** and **claude.ai web** read + write Course+ data (projects, tasks,
areas, meetings/notes, artifacts, updates, inbox) — like the Notion connector. Claude is the
*client*; calls are billed by Nate's Pro/Max subscription, **not** Course+'s API credits.
(Subscription ≠ API credits — this does not make Course+'s own in-app AI free.)

## Principle
The MCP server returns **data**; the host Claude does the reasoning. So the MCP tools are thin
wrappers over the `cp_*` tables (reuse the logic in `src/lib/db.js`). We do **not** call
Course+'s own Claude proxy from MCP (that would double-bill and defeat the point).

## Tools (read + write), all scoped to Nate via RLS
- **Areas/pillars:** `list_areas`, `create_area(name)`
- **Projects:** `list_projects(area?, status?)`, `get_project(id)` (tasks + milestones + updates + docs),
  `create_project(area, name, status?)`, `update_project(id, {name,status,priority,due,area})`
- **Tasks:** `list_tasks(project?, filter?)`, `create_task(project, label, due?, next?)`,
  `update_task(id, patch)`, `complete_task(id)`, `delete_task(id)`
- **Notes / meetings:** `list_notes(project?, kind?)`, `get_note(id)` (incl. transcript),
  `create_note({kind,title,project,area,body,…})`, `update_note(id, patch)`, `delete_note(id)`
- **Artifacts:** `list_artifacts(project?)`, `get_artifact(id)`, `create_artifact(project, title, body, artType?)`
- **Updates:** `add_update(project, body)` ("where it stands")
- **Inbox:** `list_inbox`, `triage_inbox(id, project)`

Each tool is one Supabase query mirroring `src/lib/db.js` (mapNote/noteRow/etc.). No React deps.

## Auth (the crux — RLS scoping)
`cp_*` is per-user RLS (`user_id = auth.uid()`). The server must act **as Nate** so rows scope.

- **Phase 1 (local stdio):** Nate signs in once via a tiny CLI (`mcp/login.mjs`: email → 8-digit OTP →
  `verifyOtp`). Store the **refresh token** in `mcp/.session.json` (gitignored). `supabase-js`
  auto-refreshes the access token on each run → all queries run as Nate.
- **Phase 2 (remote):** OAuth 2.0 — claude.ai/Desktop run the OAuth flow against the server; the
  server gates on Nate's login and acts as his Supabase session.

## Phase 1 — Local MCP for Claude Desktop (fast, usable today)
New package (in-repo `mcp/` or sibling repo `course-plus-mcp`). Node, ESM:
- `package.json` — deps: `@modelcontextprotocol/sdk`, `@supabase/supabase-js`.
- `mcp/lib/data.js` — Supabase client + the cp_* read/write ops (port the queries + mappers from
  `src/lib/db.js`; pure, no React).
- `mcp/login.mjs` — one-time OTP login → writes `.session.json` (refresh token).
- `mcp/server.js` — MCP server (stdio); registers the tools above; loads the session and refreshes.
- `mcp/README.md` — setup; `.gitignore` adds `mcp/.session.json`.

Reuses suite creds from `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

**Wire into Claude Desktop** (`claude_desktop_config.json`):
```json
{ "mcpServers": { "course-plus": { "command": "node", "args": ["<abs>/mcp/server.js"] } } }
```
Restart Desktop → tools appear.

## Phase 2 — Remote MCP + OAuth (claude.ai web + Desktop, one server for both)
- `supabase/functions/mcp/index.ts` — MCP over **Streamable HTTP** (JSON-RPC) in Deno, reusing the
  same tool handlers (shared TS module).
- **OAuth 2.0** (auth code + PKCE): a small authorize/token endpoint (or front Supabase Auth);
  on connect Nate signs in → server issues a short-lived token the MCP endpoint validates →
  acts as Nate (RLS).
- Deploy via the Supabase MCP `deploy_edge_function`. Register as a **custom connector** in
  claude.ai (Settings → Connectors, Pro/Max) and/or Desktop. One endpoint serves both clients.

## Security
- `.session.json` / tokens are sensitive → gitignored, local only (Phase 1); short-lived OAuth
  tokens (Phase 2).
- Write/delete tools are real + mostly irreversible — keep them explicit; consider a
  `COURSE_MCP_READONLY=1` env to disable writes, and lean on Claude's confirm-before-write behavior.

## Files
- **Phase 1 (new):** `mcp/package.json`, `mcp/server.js`, `mcp/login.mjs`, `mcp/lib/data.js`,
  `mcp/README.md`, `.gitignore` (+`mcp/.session.json`).
- **Phase 2 (new):** `supabase/functions/mcp/index.ts` + OAuth pieces; deploy.
- **Optional refactor:** extract shared cp_* query/mapping logic from `src/lib/db.js` so the app and
  the MCP server import one module (else duplicate the thin queries in `mcp/lib/data.js`).

## Verification
- **Phase 1:** `node mcp/login.mjs` (email+OTP) → add to Desktop config → restart → in Desktop ask
  "list my Arrow projects", "add a task to Citrix CSP", "read the SGS meeting" → tools fire, and the
  writes show up in the live web app. Confirm only Nate's rows return (RLS).
- **Phase 2:** from claude.ai (Pro/Max) add the connector → OAuth login → the same tool calls work
  in the browser.

## Effort
- **Phase 1 (Desktop, local):** ~half a day. Usable immediately.
- **Phase 2 (web, OAuth remote):** ~1–2 days.

**Recommendation:** build Phase 1 first (real value in Desktop now), then Phase 2 for the web app.
