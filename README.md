# Course+

Single-user, Claude-connected project & meeting workspace (desktop) — part of the
Personal OS suite, sibling to Course/Scribe. Projects, tasks, meetings/notes,
artifacts, and an inbox, all editable in-app.

Plus a **Course+ MCP server** that lets Claude Desktop and claude.ai read + write
this data the way the Notion connector does (Claude is the client, billed to your
Pro/Max subscription — not Course+'s API credits). See [MCP_PLAN.md](./MCP_PLAN.md)
and [mcp/README.md](./mcp/README.md).

Live: https://nates123-cmd.github.io/Course-plus-app/

## Dev
```
npm install
cp .env.example .env   # fill in suite Supabase creds
npm run dev
```

Stack: Vite + React 19 + supabase-js. Shared suite Supabase project
(`xsmnfcmtbpeaccnyinkr`), 8-digit email OTP auth, per-user RLS, JWT-gated `claude`
edge proxy. Data lives in `cp_*` tables (areas/projects/tasks/milestones/notes/
artifacts/updates/inbox); ops in `src/lib/db.js`.
