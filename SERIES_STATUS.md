# Series feature — current state & spec conflicts

## What's already built

### Data model
- **`cp_series`** — per-user RLS table. Fields: `id`, `name`, `people[]`, `project`, `area`, `projects[]`, `standing_context`, `cadence`, `archived`, `created`, `updated`, `updated_at`.
- **`cp_notes.series_id`** — links a meeting instance to its series (text, nullable). Already in `mapNote`, `noteRow`, `PATCH_COLS`.
- No `carry_item` / `cp_carry_items` table. Does not exist.

### db.js
- `mapSeries` / `seriesRow`, `createSeries`, `updateSeries`, `deleteSeries` (nulls out `series_id` on instances rather than cascade-deleting).
- `cp_series` loaded in `loadAll()` alongside all other tables.

### DataContext.jsx
- `series` state, exposed selectors:
  - `seriesById(id)`
  - `activeSeries` — non-archived series
  - `instancesForSeries(id)` — notes where `seriesId === id`
  - `openThreadsForSeries(id)` — **cheap text rollup**: filters instances where `nextSteps` is non-empty, returns `{noteId, title, date, text: n.nextSteps.trim()}`. Returns full markdown text blocks per meeting, not individual line items. No status, no tick-off.

### Series.jsx screen
Full screen with:
- Inline name edit, cadence pill, attendees chips, default project
- Standing context card (RichText/markdown, editable)
- **Prep the next meeting** card — "Draft agenda with AI" (calls `prepFromSeries`) + "Start meeting" button. If prep is run, passes the AI agenda to the composer. If not, falls back to the open-threads rollup text concatenated.
- **Across the series** card — on-demand `synthesizeSeries`, shows arc / open threads / commitments / decisions
- **Open threads** section — the `openThreadsForSeries` rollup: read-only list of each instance's `nextSteps` text, linking back to that note. No status, no resolution, just links.
- **Instances** list — all meetings in the series, with a detach button per row
- **Add existing meetings** picker — search + multi-select to attach orphaned meetings

### AI (`src/lib/ai.js`)
- `prepFromSeries({ name, standingContext, cadence, instances })` → `{ agenda }` (markdown bullets for the next meeting agenda).
- `synthesizeSeries({ name, standingContext, instances })` → `{ arc, openThreads, commitments, decisions }`.
- `askAcrossSeries(series[], history, question)` — chat across all series at once (Series index tab).
- `seriesInstanceDigest()` — internal helper: formats instances as a dated prose digest for AI prompts. Reads `nextSteps` and `actions[]` text.

### Recorder (RecorderContext.jsx + Record.jsx)
- `seriesId` field on recorder state, persisted to draft.
- When launched via `go({ screen:'meeting', series: id, agenda })`: pre-fills `seriesId`, `people`, `projects`, `area` from the series record, and `agenda` from whatever Series.jsx passed (open-threads text or AI prep).
- On save: `seriesId` written to the note row via `finalizeNote`.
- "Series: Jon 1:1" badge shown in composer when bound.

### What `agenda` on notes actually is
Not unused. It's the pre-meeting prep text (agenda the user/AI drafted before the meeting). Gets passed to `synthesizeMeeting` as context. `RecorderContext` loads it from the draft on resume.

---

## Conflicts with the spec

### 1. `meeting_series` → already `cp_series`
The spec's Phase 1 data model proposes a new `meeting_series` table. This exists as `cp_series` with a slightly different shape (`standing_context` not `standing_agenda`; `projects[]` for multi-project linking). Build on what's there.

### 2. `standing_agenda` field
The spec puts `standing_agenda text` on meeting_series as a template that pre-fills each instance's `agenda` field. Currently `cp_series` has `standing_context` — a broader "who they are + what we always cover" blob fed to AI prompts. These are meaningfully different: a standing agenda is a reusable checklist; standing context is background for the AI.

If the pre-fill behavior is wanted (series standing agenda → new meeting's agenda field), the current flow does pass the AI prep or rollup text as `agenda` when launching from a series. But there's no *persistent* standing agenda separate from standing context.

### 3. `cp_notes.series_id` → already exists
The spec says to confirm this before building. It's there.

### 4. `agenda` on notes → not unused
The spec says "`agenda` field, currently unused (null). Natural home for the standing agenda." It's not unused — it's the pre-meeting prep slot in RecorderContext, displayed in the composer, and passed to synthesis.

### 5. `carry_item` table — the main unbuilt piece
The spec's centerpiece (`cp_carry_items` with status, source, task_id, surfaced_on, resolved_on) does not exist. The current "Open threads" section is a read-only rollup of `nextSteps` text from past instances. There's no way to:
- Add a carry item directly from the series page (the "scratchpad" path)
- Tick an item done without going into the source note
- Track per-item status across instances

But see the section below on whether you actually want this table.

### 6. `actions[]` already materialize into tasks
The spec mentions task graduation as Phase 3, describing it as future work. Actions already materialize: `cp_tasks` rows get created with `src_meeting`, `materialized: true`. The question is whether those existing tasks should be the source of truth for the carry-forward, rather than a parallel `carry_item` store.

### 7. "Scheduled" task status
The spec recommends mapping "push to scheduled" → `next` flag + due date rather than adding a `scheduled` status. Current task vocabulary: `now / next / backlog / in-progress / done / none` + `next` bool + `waiting` string. No `scheduled` status. The spec's recommendation is correct as-is.

### 8. Task status vocabulary on spec
The spec lists `now / next / backlog / in-progress / done / none` plus `next` flag and `waiting` — this matches the live data exactly.

---

## The real question: scratchpad vs recurring meeting support

The spec's `carry_item` table is built around a **manual input surface** — you add "ask Jon about X" as a discrete item between meetings. The alternative (what "recurring meeting support" might mean instead) is a **derivation model**: carry-forward items come from what's already in your notes.

What already partially supports this:
- `openThreadsForSeries` surfaces `nextSteps` text from all instances
- `actions[]` materialize into tasks that have status tracking
- `synthesizeSeries` does AI-level deduplication + closed-loop detection

What the derivation model is still missing:
- **Per-item resolution on the series level** — marking an open thread "done here" without going into the source note. Currently the open-threads list is all-or-nothing per meeting's `nextSteps` block.
- **Actions surfacing on the series page** — the series screen only shows `nextSteps` text blobs, not the `actions[]` items that materialized into tasks. If an action was created for a meeting in this series and is still open, it's invisible on the series screen.
- **Standing agenda template** (distinct from standing context) — a checklist that pre-fills every new meeting in the series automatically, without AI gen.
- **Pre-fill that includes open tasks from this series** — when you hit "New meeting" from a series, the pre-fill currently passes open threads text (or AI agenda). It doesn't pull open tasks tagged to this series.
