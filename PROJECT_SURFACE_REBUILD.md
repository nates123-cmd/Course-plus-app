# Course+ build brief — project surface rebuild + pull method

This file carries two linked pieces of work handed off from a Mac session:
1. **Project-level pull (Overview)** — decided in-session, NOT yet built. Spec below.
2. **Project surface rebuild** — Nate's full build brief, verbatim, below that.

Read BOTH before touching code. Inspect the live schema + app structure first
(`src/lib/db.js`, `src/DataContext.jsx`, `src/screens/Overview.jsx`,
`src/screens/Project.jsx`, `MCP_PLAN.md`). Map intent onto what already exists;
do not invent tables/fields that already have equivalents.

---

## Part 0 — Session context (what already shipped / was decided)

**Just shipped (live on main + gh-pages, sw `course-plus-v10`):** drag-to-reorder
project cards on the Work overview. `src/screens/Overview.jsx` — `ProjectCard`
takes an optional `drag` prop + `grip-vertical` handle; new `LiveGrid` component
owns per-Area order, persists via existing `reorderProjects(orderedIds)` in
`db.js` (writes `cp_projects.sort = index`). The `liveRank` status re-sort was
dropped so manual order sticks. This drag infra is the foundation the pull lanes
reuse.

**Deploy landmine (CRITICAL):** building `build:gh-pages` from a `.claude/worktrees/*`
worktree bakes NO Supabase env (`.env` is gitignored, lives only in the MAIN
checkout) -> blank white live site. ALWAYS build from the MAIN checkout, OR
`cp` the main checkout's `.env` into the worktree first. Verify a build:
`python3 -c "import glob; s=open(sorted(glob.glob('dist/assets/index-*.js'))[-1]).read(); print(s.count('xsmnfcmtbpeaccnyinkr.supabase.co'), 'Missing VITE_SUPABASE' in s)"`
-> want `3 False`, NOT `0 True`.

---

## Part 1 — Project-level pull on the Work overview (decided, build first)

Cal Newport pull method at the PROJECT level. Decisions locked with Nate:

- **Scope:** cap applies to **projects** (not tasks, at this level).
- **Cap style:** **soft**. User can exceed; overage flags red + nags; never blocks.
- **Cap value:** `usePersisted('course.wipCap', 3)` (localStorage, no backend). Small
  stepper in the Active-lane header. (Global for now; per-project cap is a task-lane
  concern handled in Part 2.)
- **Lanes are GLOBAL (cross-area)**, placed at the TOP of the Work overview, ABOVE
  the existing per-area sections (which stay unchanged for browsing/edit):

  ```
  Work
    Active   3/3            <- global, cross-area, soft-capped, red if over
    On deck  (5)  drag ⇕    <- global queue, drag-ordered (reuse LiveGrid)
    ─────
    Arrow ▸  Citrix ▸ …     <- existing area-grouped sections, unchanged
  ```

- **Data:** add status value `queue` to `cp_projects.status` (text col — no schema
  migration). New projects created as `queue`, not `active` (`createProject` default).
  On-deck order = existing `sort`. Existing statuses (`active/sent/on-hold/idea/
  archived`) unchanged. Ideas = deep backlog, on-hold = waiting.
- **Active lane:** `status active|sent`, count badge `N/cap` (red + nag when over),
  each card gets a quiet "↓ Send to deck".
- **On-deck lane:** `status queue`, draggable (reuse `LiveGrid`), each card gets
  "↑ Pull" -> `updateProject(id, {status:'active'})`. Over cap -> still works, but
  confirm "Active over cap (4/3) — pull anyway?".
- **Slot-free nudge:** finishing/holding/sending an active project surfaces a banner
  "Slot open — pull [top of queue]?" (reuse the `ResurfaceBanner` pattern).

This project-level active/backlog state is the model the TASK lanes in Part 2 must
read consistently with ("same discipline nested one level down").

---

## Part 2 — Course Plus: project surface rebuild (Nate's brief, verbatim)

# Course Plus: project surface rebuild

Build brief for Claude Code. Read this whole file before making changes. Inspect the current schema and app structure first, then map the intent below onto what already exists. Do not invent tables or fields that already have equivalents: reuse them.

## Goal

Reformat the per-project surface from four separate sections (tasks, notes/updates, meetings, artifacts/files) into three things: a task pull board, one open capture input, and a single filterable library. Remove the parts that go unused. Change AI-extracted action items from a separate holding pen into a trusted feed that lands directly in the task backlog.

The driving insight from an audit of live data: the AI action-item extraction is accurate (roughly 14 of 15 items were real commitments, a few duplicates, one wrong). So the manual step of retyping items into tasks was never a quality gate. It was a focus ritual. We are replacing that ritual with a cheaper one: pulling tasks into a small active lane, in the spirit of Cal Newport's pull method, which is already being applied at the project level.

## Design principles (hard constraints)

1. Agency first. No gamification, no streaks, no forced sequences, no hard blocks. Limits nudge, they do not forbid.
2. Keep the existing stack conventions: single-file PWA, shared Supabase backend, GitHub Pages deploy, email OTP auth, existing Course Plus MCP connector.
3. Capture friction stays near zero. One input, classification happens after submit, never blocks the user at input time.
4. No em dashes anywhere in UI copy or code comments. Use colons, periods, parentheses, or commas.
5. Calm, flat visual language. Do not add color or chrome that does not carry meaning.

## What changes at a glance

Keep and elevate: tasks (become the pull board), meetings, files, notes, the AI action-item extraction (repurposed as a backlog feed).

Remove from the project view: the where-it-stands active/inactive timeline, milestones, the standalone synthesized briefing block, the separate open-action-items holding pen, and the promote-to-task button (there is nothing left to promote into, since the backlog is the task list).

Underlying data for removed features can stay in the schema if it is cheap to leave. Just stop rendering it. Do not run destructive migrations to drop it in this pass.

## Surface: the project screen

Top to bottom, one scrolling column:

1. Header: project name, status pill, priority pill.
2. Task pull board: a `Now` lane and a `Backlog` lane (detailed below).
3. Capture input: one open box, `Throw something in: paste a transcript, drop a file, or jot a note`.
4. Library: chronological stream of everything captured, with type filter chips.

Open decision flagged below: whether the library sits under the board on the same scroll, or behind a tab. Default to same scroll unless it feels too long in testing.

## The task pull board

Two lanes stacked vertically.

`Now` is the working surface and is WIP-limited. It shows only the tasks currently pulled into active focus. Header shows the count against the limit, for example `2 of 3 pulled`. When a slot is open, show a quiet dashed placeholder inviting the user to pull one up. The limit is a nudge: if the user drags a task in past the limit, allow it, but visibly flag that they are over their own line (for example the count turns to a warning tint and reads `4 of 3`). Never refuse the drop.

`Backlog` holds everything else: manually added tasks plus accepted action items. It can be arbitrarily long, which is fine because the user never works from it directly. Backlog is sortable by priority and due date, which act as hints for what is worth pulling next. Items sourced from a meeting carry a small `meeting` tag with the source reference.

Interaction: drag and drop to move a task between backlog and Now, and to reorder within a lane. Persist lane and intra-lane position. Completing a task moves it out of both lanes into done (reuse existing complete behavior).

This mirrors the project-level pull already in progress: projects are pulled into active at the top level, tasks are pulled into Now within an active project. Same discipline nested one level down. Align the task lane model to whatever project-level active/backlog state already exists so the two read consistently.

## The capture input and processing

One input per project. Accepts typed text, pasted text, and file drops. On submit, a lightweight processing layer classifies the entry into a type and files it into the library. It never blocks submission.

Classification heuristics:
- Attachment that Course or Claude did not generate: `File`.
- Long text or something that looks like a transcript or recording: `Meeting`.
- Short freeform text: `Note`.
- Cannot tell: file it into the library anyway, tagged with a `?`, and route it to the existing inbox so it can be resolved with a tap. Use the current `list_inbox` and `triage_inbox` primitives rather than building a new mechanism.

A `Meeting` entry additionally triggers extraction (next section). Other types do not.

Keep a direct manual add-task affordance available too. Not every task comes from a meeting.

## The library

Replaces the old notes, meetings, and artifacts sections with one stream.

- One chronological list ordered by created date, newest first.
- Filter chips: `All`, `Meeting`, `File`, `Note`. Type is a filter, not a container.
- Each row: date, type badge, title. Tapping opens the full entry.

Type definitions:
- `File`: an artifact not made in Course or with Claude. Stored reference plus a one-line description.
- `Meeting`: recorded info or a pasted transcript. The most frequent type. Carries summary, transcript, and extracted action items.
- `Note`: a quick jot.

Note on the old `Artifact` type: Claude-made deliverables should not get a separate library chip by default. If a generated deliverable matters enough to keep, save it as a `File` entry. Otherwise it lives via the MCP and is referenced there rather than cluttering the library. Confirm with Nate before finalizing (see open decisions).

## Synthesis: meetings to backlog tasks

When a `Meeting` entry is captured, run extraction and write results straight into the project backlog. No separate holding pen, no promote button.

Extraction rules:
1. Produce a short summary and a list of candidate action items.
2. Assign an owner to each action item where possible. Only create backlog tasks for items owned by Nate or left unassigned. Skip items clearly owned by someone else. The current data tags the source meeting or attendee, not the owner, so make owner a distinct field from source.
3. Require a clear deliverable. Do not create tasks from pure discussion phrasing. Keep this threshold light, since extraction accuracy is already high, but it should catch obvious non-actions.
4. Dedup against existing open tasks in the same project before writing. Fuzzy match on task label. Do not create a task that restates one already present.
5. Each created task lands in `Backlog`, tagged with `meeting` and a reference to the source entry.
6. Provide a quiet dismiss on any backlog task, so the rare wrong extraction is removed in one tap.

If the MCP connector is the write path for extraction, extend `create_task` to accept `lane` and source metadata, and make sure `list_tasks` can filter by lane.

## Data model changes

Inspect current schema first. Intended changes, mapped to whatever exists:

- Tasks: add a lane or status dimension with values `now`, `backlog`, `done` (reuse existing status field if present). Add an intra-lane position for ordering. Add `source_type` (for example `meeting`, `manual`) and `source_ref` (id of the originating entry). Priority and due already exist via `update_task`.
- Library entries: ensure notes, meetings, and files share a common queryable shape with a `type` field (`meeting`, `file`, `note`) and a `created_at` for chronological ordering. If they are currently separate tables, either unify or provide a view that returns them as one stream.
- Action items: stop treating them as a distinct promotable entity. Extraction now writes tasks directly. If an action-items table exists, either repoint extraction to write tasks, or keep the table only as an internal staging step that immediately materializes tasks.
- Milestones and where-it-stands updates: leave data in place, stop rendering. No destructive migration this pass.

## Removals from the project view

- Where-it-stands active/inactive timeline.
- Milestones section.
- Standalone synthesized briefing block.
- Separate open-action-items list and its promote-to-task button.

## Home and cross-project index (later phase, optional)

Natural extension, lower priority. A home surface that rolls up active projects, each showing its `Now` items, so the whole picture is visible without opening each project. Project-level pull governs which projects appear as active. This is where the habit of trusting the action-item feed actually forms, since Now items become the first thing seen. Scope with Nate before building.

## Build phases

Phase 1: task pull board. Introduce `Now` and `Backlog` lanes, drag and drop between and within lanes, the WIP nudge, and persistence of lane and position. Migrate existing open tasks into `Backlog`, and let the user pull a few into `Now`.

Phase 2: extraction to backlog. Repoint action-item extraction to auto-create backlog tasks with owner assignment, deliverable threshold, dedup, source tagging, and one-tap dismiss. Remove the holding pen and promote button.

Phase 3: library and capture. Unify notes, meetings, and files into one chronological library with type filter chips. Add the single capture input with post-submit classification and inbox routing for unclear items. Remove milestones, the where-it-stands timeline, and the briefing block from the view.

Phase 4 (optional): home and cross-project index with project-level pull.

## Acceptance criteria

- The project screen shows exactly three regions: task pull board, capture input, library. No milestones, no where-it-stands timeline, no briefing block, no separate action-items pen.
- `Now` enforces a soft WIP limit: the user can exceed it, but the overage is visibly flagged, never blocked.
- A task can be dragged between backlog and Now and reordered within a lane, and the position survives reload.
- Pasting a meeting transcript into the capture input creates a `Meeting` library entry and writes deliverable-bearing, Nate-owned or unassigned action items into `Backlog`, deduped against existing tasks, each tagged with its source.
- An item extraction gets wrong can be dismissed from the backlog in one action.
- The library shows one chronological stream filterable to `Meeting`, `File`, or `Note`.
- An ambiguous capture lands in the library tagged `?` and appears in the inbox for triage.
- No em dashes appear anywhere in shipped UI copy.

## Open decisions for Nate

1. Default WIP limit for `Now`. Suggest 3. Also decide whether the limit is global or set per project.
2. Library placement: same scroll under the board, or a separate tab.
3. Artifact handling: confirm that Claude-made deliverables become `File` entries when kept and otherwise live in the MCP, with no separate library chip.
4. Home and cross-project index: build now, or defer to a later pass.
