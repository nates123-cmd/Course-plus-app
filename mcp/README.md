# Course+ MCP server

Lets **Claude Desktop** (and any MCP host) read + write your Course+ data — your
areas, projects, tasks, notes/meetings, and artifacts — the way Notion's
connector does. Claude is the client, so the reasoning is billed to your
Claude subscription, not Course+'s API.

Everything runs **as you**: the server loads your saved Supabase session and
every query goes through per-user RLS, so only your rows are ever returned.

---

## Setup (one time)

```bash
cd mcp
npm install
npm run login        # enter your Course+ email, then the 8-digit code
```

`login` writes `mcp/.session.json` (your refresh token — gitignored, never
commit it). The server refreshes this automatically; re-run `npm run login`
only if the session ever expires.

It reads your Supabase URL + anon key from the repo's root `.env`
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — same project the web app uses.

## Register with Claude Desktop

Edit `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add (use the **absolute** path to `server.js`):

```json
{
  "mcpServers": {
    "course-plus": {
      "command": "node",
      "args": ["/Users/natestephenson/Documents/Claude-Code-projects/Course-plus-app/mcp/server.js"]
    }
  }
}
```

Restart Claude Desktop. You'll see the `course-plus` tools in the 🔌 menu.

### Read-only mode

To disable every write tool (only `list_*`/`get_*` exposed), add an env block:

```json
"course-plus": {
  "command": "node",
  "args": [".../mcp/server.js"],
  "env": { "COURSE_MCP_READONLY": "1" }
}
```

---

## Try it

In Claude Desktop:
- "List my Arrow projects."
- "What's the next action on the Citrix CSP project?"
- "Add a task to the Citrix CSP project: draft the EMEA onboarding deck, due Friday."
- "Summarize my last meeting and file the action items."

Changes show up live in the Course+ web app.

---

## Tools

**Read:** `list_areas`, `list_projects`, `get_project`, `list_tasks`,
`list_notes`, `get_note`, `list_artifacts`, `get_artifact`, `list_inbox`.

**Write:** `create_area`, `create_project`, `update_project`, `create_task`,
`update_task`, `complete_task`, `delete_task`, `create_note`, `update_note`,
`delete_note`, `create_artifact`, `add_update`, `triage_inbox`.

Writes are real and immediate — there is no undo. Use `COURSE_MCP_READONLY=1`
if you want Claude to look but not touch.

## How it fits

```
Claude Desktop ──stdio──> server.js ──> lib/data.js (cp_* queries)
                                    └──> lib/client.js (your session → RLS)
                                              └──> Supabase (shared suite project)
```

The server never calls Course+'s own Claude proxy — it just returns data; the
host Claude does the reasoning. Phase 2 (remote MCP + OAuth for claude.ai web)
is planned in `../MCP_PLAN.md`.
