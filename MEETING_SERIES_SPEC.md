# Meeting Series — spec (full version)

**Problem.** Standing 1:1s (e.g. Jon) produce N orphan meeting notes with no link between them. No carry-forward of open items, no series-level synthesis, no prep-from-last-time.

**Solution.** A first-class **Series** entity: a named recurring meeting that owns its instances, standing context, default attendees/links, a rollup of open next-steps, AI prep generation, and cross-instance synthesis.

---

## 1. Data model

### New table `cp_series` (per-user RLS, `cp_*` prefix)
| col | type | notes |
|---|---|---|
| `id` | text | client UUID |
| `user_id` | uuid | `auth.uid()`, PK `(user_id,id)` |
| `name` | text | "Jon 1:1" |
| `people` | text[] | default attendees, pre-fill new instances |
| `project` | text | default home/primary project (nullable) |
| `area` | text | default area/pillar (nullable) |
| `projects` | text[] | default "projects discussed" links |
| `standing_context` | text | who they are + standing agenda; fed to every prep/synth |
| `cadence` | text | free label ("weekly", "biweekly"), display-only |
| `archived` | boolean | hide from nav |
| `created` / `updated` / `updated_at` | text / text / timestamptz | |

RLS: 4 owner policies (select/insert/update/delete on `user_id = auth.uid()`), mirroring `cp_notes`.

### `cp_notes` change
- add `series_id text` (nullable). Links a `kind='meeting'` instance to its series. No FK (suite convention = text ids, app-side joins).

---

## 2. Nav (App.jsx)

New **top-level collapsible "Series" section** in the left nav (sibling to Areas / Library, NOT nested per-area — a series like "Jon 1:1" spans projects). Mirrors the Library/topics nav pattern.

- Section header "Series" + expand chevron + count of active series.
- Each row → `go({screen:'series', id})`. Status dot, name, instance count.
- Collapsible per-series: expand to show recent instances (links to those notes). Optional v1 — can ship flat.
- Inline "+ New series" at the bottom of the section.
- Archived series hidden (surface in the existing global Archive area or a "Show archived" toggle — defer).

Route: add `case 'series': return <SeriesScreen key={route.id} id={route.id}/>` to the App.jsx:502-516 switch. Tab-label resolver (App.jsx:525-540) handles `series` → series name.

---

## 3. Series screen (`src/screens/Series.jsx`)

Sections top→bottom:

1. **Header** — name (inline edit), cadence pill, attendees chips, default project/area links. Edit mode reveals `standing_context` editor + default-project / default-people / default-projects pickers (reuse Record.jsx picker components).
2. **Standing context** card — RichText/markdown, editable. The durable "who Jon is / what we always cover."
3. **Open threads (rollup)** — aggregated open next-steps across all instances (see §5). Each row links to its source instance. This is the carry-forward surface.
4. **Series synthesis** — "Synthesize series" button → AI arc summary across last N instances: unresolved threads, what I committed and haven't done, decisions made. Cached to `cp_series` (optional col later; v1 = ephemeral in-screen).
5. **Instances list** — all meetings where `series_id === id`, newest first. Each row: date, title, summary gist, next-steps count. Click → Note screen.
6. **+ New meeting** button (primary CTA) — launches the Record composer pre-filled from series defaults (§4), with an **AI-generated prep agenda** from open threads.

---

## 4. Record composer — series-aware (RecorderContext.jsx + Record.jsx)

- `go({screen:'meeting', series: id, ...})` carries a `series` id into the composer.
- On composer init with a `series`: pre-fill `home`=series.project, `pillar`=series.area, `projects`=series.projects, `people`=series.people, and `agenda`= AI prep (§5) or the rolled-up open threads.
- `noteFields()` (RecorderContext.jsx:164-172) stamps `series_id: series` onto the meeting row.
- `save()` (Record.jsx:238-258) passes `series_id` through to `finalizeNote`.
- Show a small "Series: Jon 1:1" badge in the composer header when bound.

---

## 5. AI (`src/lib/ai.js`)

Two new calls, both through the existing `claude` proxy via `claudeComplete`/`pickModel`:

### `prepFromSeries({ name, standingContext, cadence, instances })`
- `instances` = last ~5, each `{date, summary, nextSteps}`.
- Returns `{ agenda }` — a suggested agenda for the *next* meeting: open loops to close, follow-ups on prior commitments, recurring topics. Light model. Used to pre-fill composer agenda + the Series-screen "Suggested prep" surface.

### `synthesizeSeries({ name, standingContext, instances })`
- Reads all (or last N) instances `{date, summary, nextSteps, actions}`.
- Returns `{ arc, openThreads:[{text, sinceDate}], commitments:[{text, done:bool}], decisions:[] }`.
- `arc` = narrative of the relationship/thread over time. `openThreads` powers §3 rollup when no structured source exists. Heavy model, max_tokens ~4000.

**Open-threads rollup source (decision):** v1 derives open threads two ways, merged:
1. Cheap/instant: concatenate each instance's `nextSteps` (free markdown) with its date, newest first — shown immediately, no AI.
2. On-demand: `synthesizeSeries.openThreads` — AI-deduped/closed-loop-aware list, replaces (1) when run.

(Structured per-item done-state tracking across instances is deferred — `actions`→tasks already exists per-meeting; series rollup stays summary-level for v1.)

---

## 6. db.js + DataContext wiring

**db.js**
- `mapSeries(r)` / `seriesRow(s)`; load `cp_series` in `loadAll()` Promise.all → `.series`.
- `createSeries` / `updateSeries(id,patch)` (whitelist `SERIES_COLS`) / `deleteSeries(id)` (also null out `series_id` on its instances, or leave orphaned — choose null-out).
- add `series_id` to `mapNote` (→`seriesId`), `noteRow`, `PATCH_COLS`.

**DataContext.jsx**
- `series` state; selectors: `seriesById(id)`, `activeSeries` (not archived), `instancesForSeries(id)` = notes where `seriesId===id` sorted by date desc, `openThreadsForSeries(id)` = cheap rollup (§5.1).
- expose `createSeries`/`updateSeries`/`deleteSeries` + reload.

---

## 7. Build order
1. Migration (cp_series + notes.series_id) — apply via Supabase MCP.
2. db.js: series CRUD + mappers + note series_id plumbing.
3. DataContext: state + selectors + actions.
4. ai.js: prepFromSeries + synthesizeSeries.
5. Series.jsx screen.
6. App.jsx: route + nav section + tab label.
7. RecorderContext/Record: series-aware init, stamp series_id, save passthrough.
8. Build, fix types, manual smoke.

## 8. Out of scope (v1)
- Per-item structured done-state across instances (stay summary-level).
- Calendar/cadence automation (no scheduling, cadence is a display label).
- Archived-series management UI beyond a hide flag.
- Caching series synthesis to a column (ephemeral in-screen for now).
