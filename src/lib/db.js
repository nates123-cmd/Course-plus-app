// Course+ data access — load the merged work spine (areas → projects with
// tasks / milestones / updates / artifacts) plus the document corpus (notes) and
// inbox from Supabase (per-user RLS, cp_* tables), seed demo fixtures on first
// run, and read/write every entity. Mirrors Scribe's db.js patterns.
import { supabase } from './supabase'
import { mapAsset } from './assets'
import { SEED_AREAS, SEED_NOTES, SEED_INBOX } from '../data'

const uuid = () => (crypto?.randomUUID?.() || 'id-' + Date.now() + '-' + Math.round(Math.random() * 1e6))

// ── row -> app shape ───────────────────────────────────────────────
function mapNote(r) {
  return {
    id: r.id, kind: r.kind, title: r.title, project: r.project, area: r.area,
    projects: r.projects || [], people: r.people || [], tags: r.tags || [],
    reference: typeof r.reference === 'boolean' ? r.reference : undefined,
    date: r.date, updated: r.updated, updatedAt: r.updated_at, indexed: r.indexed, status: r.status,
    rawWords: r.raw_words || undefined, transcript: r.transcript || undefined, summary: r.summary || undefined,
    agenda: r.agenda || undefined, incomplete: typeof r.incomplete === 'boolean' ? r.incomplete : undefined,
    nextSteps: r.next_steps || undefined, seriesId: r.series_id || undefined,
    terms: r.terms || [], actions: r.actions || [], body: r.body || [], related: r.related || [],
  }
}
function mapSeries(r) {
  return {
    id: r.id, name: r.name, people: r.people || [], project: r.project || null, area: r.area || null,
    projects: r.projects || [], standingContext: r.standing_context || '',
    standingAgenda: r.standing_agenda || '', cadence: r.cadence || '',
    calendarTitles: r.calendar_titles || [],
    archived: !!r.archived, created: r.created, updated: r.updated, updatedAt: r.updated_at,
  }
}
function mapInbox(r) {
  return {
    id: r.id, title: r.title, src: r.src, srcIcon: r.src_icon, snippet: r.snippet,
    suggest: r.suggest || null, suggestMulti: r.suggest_multi || undefined, tags: r.tags || [],
  }
}
function mapTask(r) {
  return {
    id: r.id, project: r.project_id || undefined, area: r.area_id || undefined, label: r.label, done: !!r.done, next: !!r.next,
    waiting: r.waiting || undefined, due: r.due || undefined, dueDate: r.due_date || undefined,
    workType: r.work_type || undefined, taskStatus: r.task_status || undefined,
    priority: r.priority ?? undefined,
    notes: r.notes || undefined, srcMeeting: r.src_meeting || undefined, meetingId: r.meeting_id || undefined, sort: r.sort ?? 0,
    createdAt: r.created_at, updatedAt: r.updated_at, rescheduleCount: r.reschedule_count ?? 0,
  }
}
function mapMilestone(r) {
  return { id: r.id, project: r.project_id, label: r.label, state: r.state, sub: r.sub || undefined, due: r.due || undefined, sort: r.sort ?? 0 }
}
function mapUpdate(r) {
  return { id: r.id, project: r.project_id, body: r.body, at: r.created_at }
}
function mapArtifact(r) {
  return { id: r.id, project: r.project_id, title: r.title, artType: r.art_type, provenance: r.provenance, fromCount: r.from_count, body: r.body, at: r.created_at }
}

function assemble(areaRows, projRows, taskRows, msRows, updRows, artRows) {
  const allTasks = taskRows.map(mapTask)
  const tasksByProj = groupBy(allTasks.filter((t) => t.project), 'project')
  // Pillar-only tasks (no project) hang off their area directly.
  const looseByArea = groupBy(allTasks.filter((t) => !t.project && t.area), 'area')
  const msByProj = groupBy(msRows.map(mapMilestone), 'project')
  const updByProj = groupBy(updRows.map(mapUpdate), 'project')
  const artByProj = groupBy(artRows.map(mapArtifact), 'project')
  return [...areaRows].sort((a, b) => a.sort - b.sort).map((a) => ({
    id: a.id, name: a.name, open: a.open_default,
    // tasks assigned to this pillar with no project — surfaced in Open tasks + the Area screen
    areaTasks: (looseByArea[a.id] || []).sort((x, y) => x.sort - y.sort),
    projects: projRows.filter((p) => p.area_id === a.id).sort((x, y) => x.sort - y.sort).map((p) => ({
      id: p.id, name: p.name, status: p.status, priority: p.priority ?? null,
      due: p.due || undefined, blurb: p.blurb || undefined, hold: p.hold || undefined,
      tasks: (tasksByProj[p.id] || []).sort((x, y) => x.sort - y.sort),
      milestones: (msByProj[p.id] || []).sort((x, y) => x.sort - y.sort),
      updates: (updByProj[p.id] || []).sort((x, y) => (x.at < y.at ? 1 : -1)),
      artifacts: (artByProj[p.id] || []).sort((x, y) => (x.at < y.at ? 1 : -1)),
    })),
  }))
}
function groupBy(arr, key) {
  const o = {}
  for (const x of arr) { (o[x[key]] = o[x[key]] || []).push(x) }
  return o
}

// Authored-date order for the note corpus. The `date` label is stamped once at
// create time and never patched, so it's the true authored date — unlike
// `updated_at`, which every edit/autosave bumps to now() (that floated old,
// edited notes to the top and broke the Library order). Parse the label into a
// real epoch (reliable, unlike a naive string sort); fall back to updated_at
// when it's absent/malformed, and tie-break same-day notes on edit recency.
const _MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
function noteSortKey(n) {
  const m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(n.date || '')
  if (m && _MON[m[1]] != null) return Date.UTC(+m[3], _MON[m[1]], +m[2])
  return n.updatedAt ? Date.parse(n.updatedAt) : 0
}
function sortNotes(rows) {
  return rows.map(mapNote).sort((a, b) =>
    (noteSortKey(b) - noteSortKey(a)) ||
    ((Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0)))
}

// ── load everything ────────────────────────────────────────────────
export async function loadAll() {
  const [areas, projects, tasks, ms, upd, art, notes, inbox, assets, series] = await Promise.all([
    supabase.from('cp_areas').select('*'),
    supabase.from('cp_projects').select('*'),
    supabase.from('cp_tasks').select('*'),
    supabase.from('cp_milestones').select('*'),
    supabase.from('cp_updates').select('*'),
    supabase.from('cp_artifacts').select('*'),
    supabase.from('cp_notes').select('*').order('updated_at', { ascending: false }),
    supabase.from('cp_inbox').select('*').order('created_at', { ascending: false }),
    supabase.from('cp_assets').select('*').order('created_at', { ascending: false }),
    supabase.from('cp_series').select('*').order('updated_at', { ascending: false }),
  ])
  const err = areas.error || projects.error || tasks.error || ms.error || upd.error || art.error || notes.error || inbox.error || assets.error || series.error
  if (err) throw err
  return {
    areas: assemble(areas.data || [], projects.data || [], tasks.data || [], ms.data || [], upd.data || [], art.data || []),
    notes: sortNotes(notes.data || []),
    inbox: (inbox.data || []).map(mapInbox),
    assets: (assets.data || []).map(mapAsset),
    series: (series.data || []).map(mapSeries),
    nudgeStates: await loadNudgeStates(),
  }
}

// ── Nudge memory (cp_nudge_states) ──────────────────────────────────────────
// Persisted "Pending decisions" state: a project waved off stays waved off, and
// a project decided on stays quiet for a while. Deliberately kept OUT of the
// loadAll() error gate above — a read failure here (e.g. the table not migrated
// yet) degrades to "no memory", it must never take the whole spine down.
export async function loadNudgeStates() {
  try {
    const { data, error } = await supabase.from('cp_nudge_states').select('*')
    if (error) return []
    return (data || []).map((r) => ({
      project: r.project_id, snoozedUntil: r.snoozed_until, dismissedAt: r.dismissed_at, lastQuestion: r.last_question,
    }))
  } catch { return [] }
}
export async function upsertNudgeState(projectId, patch = {}) {
  const row = { project_id: projectId, updated_at: new Date().toISOString() }
  if (patch.snoozedUntil !== undefined) row.snoozed_until = patch.snoozedUntil
  if (patch.dismissedAt !== undefined) row.dismissed_at = patch.dismissedAt
  if (patch.lastQuestion !== undefined) row.last_question = patch.lastQuestion
  const { error } = await supabase.from('cp_nudge_states').upsert(row, { onConflict: 'user_id,project_id' })
  if (error) throw error
}

// ── app shape -> row ───────────────────────────────────────────────
function noteRow(n) {
  return {
    id: n.id, kind: n.kind, title: n.title, project: n.project ?? null, area: n.area ?? null,
    projects: n.projects || [], people: n.people || [], tags: n.tags || [],
    reference: typeof n.reference === 'boolean' ? n.reference : null,
    date: n.date, updated: n.updated, indexed: n.indexed ?? true, status: n.status ?? 2,
    raw_words: n.rawWords ?? null, transcript: n.transcript ?? null, summary: n.summary ?? null, terms: n.terms || [],
    agenda: n.agenda ?? null, incomplete: typeof n.incomplete === 'boolean' ? n.incomplete : null,
    next_steps: n.nextSteps ?? null, series_id: n.seriesId ?? null,
    actions: n.actions || [], body: n.body || [], related: n.related || [],
  }
}
function inboxRow(c) {
  return {
    id: c.id, title: c.title, src: c.src, src_icon: c.srcIcon, snippet: c.snippet,
    suggest: c.suggest ?? null, suggest_multi: c.suggestMulti ?? null, tags: c.tags || [],
  }
}

// Seed the demo fixtures once, under the logged-in user. No-op if any project exists.
let _seedPromise = null
export function seedIfEmpty() {
  if (!_seedPromise) _seedPromise = _seed()
  return _seedPromise
}
async function _seed() {
  const { count, error } = await supabase.from('cp_projects').select('id', { count: 'exact', head: true })
  if (error) throw error
  if (count && count > 0) return false

  const areaRows = SEED_AREAS.map((a, i) => ({ id: a.id, name: a.name, open_default: a.open, sort: i }))
  const projRows = [], taskRows = [], msRows = []
  SEED_AREAS.forEach((a) => a.projects.forEach((p, pi) => {
    projRows.push({ id: p.id, area_id: a.id, name: p.name, status: p.status, priority: p.priority ?? null,
      due: p.due ?? null, blurb: p.blurb ?? null, hold: p.hold ?? null, sort: pi })
    ;(p.tasks || []).forEach((tk, ti) => taskRows.push({ id: tk.id, project_id: p.id, label: tk.label,
      done: !!tk.done, next: !!tk.next, waiting: tk.waiting ?? null, due: tk.due ?? null,
      work_type: tk.work_type ?? null, sort: ti }))
    ;(p.milestones || []).forEach((m, mi) => msRows.push({ id: m.id, project_id: p.id, label: m.label,
      state: m.state, sub: m.sub ?? null, sort: mi }))
  }))

  const r = await Promise.all([
    supabase.from('cp_areas').insert(areaRows),
    supabase.from('cp_projects').insert(projRows),
    supabase.from('cp_tasks').insert(taskRows),
    supabase.from('cp_milestones').insert(msRows),
    supabase.from('cp_notes').insert(SEED_NOTES.map(noteRow)),
    supabase.from('cp_inbox').insert(SEED_INBOX.map(inboxRow)),
  ])
  const err = r.find((x) => x.error)
  if (err) throw err.error
  return true
}

// ── notes ──────────────────────────────────────────────────────────
export async function createNote(note) {
  const id = note.id || uuid()
  const { error } = await supabase.from('cp_notes').insert(noteRow({ ...note, id }))
  if (error) throw error
  return id
}
const PATCH_COLS = {
  title: 'title', body: 'body', summary: 'summary', tags: 'tags', actions: 'actions',
  people: 'people', terms: 'terms', status: 'status', kind: 'kind', project: 'project',
  area: 'area', indexed: 'indexed', rawWords: 'raw_words', reference: 'reference',
  related: 'related', transcript: 'transcript', projects: 'projects', agenda: 'agenda', incomplete: 'incomplete', nextSteps: 'next_steps', seriesId: 'series_id',
}
export async function updateNote(id, patch) {
  const row = { updated: patch.updated ?? 'now', updated_at: new Date().toISOString() }
  for (const k in patch) if (PATCH_COLS[k]) row[PATCH_COLS[k]] = patch[k]
  const { error } = await supabase.from('cp_notes').update(row).eq('id', id)
  if (error) throw error
}
export async function deleteNote(id) {
  const { error } = await supabase.from('cp_notes').delete().eq('id', id)
  if (error) throw error
}
export async function deleteInbox(id) {
  const { error } = await supabase.from('cp_inbox').delete().eq('id', id)
  if (error) throw error
}
export async function createInbox(item) {
  const id = item.id || uuid()
  const { error } = await supabase.from('cp_inbox').insert(inboxRow({ ...item, id }))
  if (error) throw error
  return id
}

// ── series (recurring meetings) ────────────────────────────────────
function seriesRow(s) {
  return {
    id: s.id, name: s.name || 'Untitled series', people: s.people || [],
    project: s.project ?? null, area: s.area ?? null, projects: s.projects || [],
    standing_context: s.standingContext ?? null, standing_agenda: s.standingAgenda ?? null,
    calendar_titles: s.calendarTitles || [], cadence: s.cadence ?? null,
    archived: !!s.archived, created: s.created ?? null, updated: s.updated ?? 'now',
  }
}
export async function createSeries(series = {}) {
  const id = series.id || uuid()
  const { error } = await supabase.from('cp_series').insert(seriesRow({ ...series, id }))
  if (error) throw error
  return id
}
const SERIES_COLS = {
  name: 'name', people: 'people', project: 'project', area: 'area', projects: 'projects',
  standingContext: 'standing_context', standingAgenda: 'standing_agenda',
  calendarTitles: 'calendar_titles', cadence: 'cadence', archived: 'archived',
}
export async function updateSeries(id, patch) {
  const row = { updated: patch.updated ?? 'now', updated_at: new Date().toISOString() }
  for (const k in patch) if (SERIES_COLS[k]) row[SERIES_COLS[k]] = patch[k]
  const { error } = await supabase.from('cp_series').update(row).eq('id', id)
  if (error) throw error
}
export async function deleteSeries(id) {
  // Orphan the instances rather than delete them — null out their series link.
  await supabase.from('cp_notes').update({ series_id: null }).eq('series_id', id)
  const { error } = await supabase.from('cp_series').delete().eq('id', id)
  if (error) throw error
}

// ── tasks ──────────────────────────────────────────────────────────
const TASK_COLS = {
  label: 'label', done: 'done', next: 'next', waiting: 'waiting', due: 'due',
  dueDate: 'due_date', workType: 'work_type', taskStatus: 'task_status', priority: 'priority',
  notes: 'notes', srcMeeting: 'src_meeting', meetingId: 'meeting_id', project: 'project_id', area: 'area_id', sort: 'sort',
  rescheduleCount: 'reschedule_count',
}
// projectId may be null for a pillar-only task — pass the pillar via task.area.
export async function createTask(projectId, task = {}) {
  const id = task.id || uuid()
  const row = { id, project_id: projectId ?? null, area_id: task.area ?? null,
    label: task.label || '', done: !!task.done, next: !!task.next,
    waiting: task.waiting ?? null, due: task.due ?? null, due_date: task.dueDate ?? null,
    work_type: task.workType ?? null, task_status: task.taskStatus ?? null, priority: task.priority ?? null,
    notes: task.notes ?? null, src_meeting: task.srcMeeting ?? null, meeting_id: task.meetingId ?? null, sort: task.sort ?? 0 }
  const { error } = await supabase.from('cp_tasks').insert(row)
  if (error) throw error
  return id
}
export async function updateTask(id, patch) {
  // Stamp updated_at on every edit — this is the ONLY record that a task was
  // touched (completed, re-prioritized, relabelled). Without it those edits left
  // no timestamp anywhere and a project you were actively working still read as
  // stale to the "Pending decisions" nudge (see lastTouchAt in DataContext).
  const row = { updated_at: new Date().toISOString() }
  for (const k in patch) if (TASK_COLS[k]) row[TASK_COLS[k]] = patch[k]
  const { error } = await supabase.from('cp_tasks').update(row).eq('id', id)
  if (!error) return
  // reschedule_count ships ahead of its migration (20260712130000). If the column
  // isn't there yet, drop it and retry rather than failing the user's edit — a
  // missing drift counter is a lost stat; a failed update is a lost task change.
  if (error.code === '42703' && 'reschedule_count' in row) {
    const { reschedule_count, ...rest } = row
    const retry = await supabase.from('cp_tasks').update(rest).eq('id', id)
    if (!retry.error) return
    throw retry.error
  }
  throw error
}
export async function deleteTask(id) {
  const { error } = await supabase.from('cp_tasks').delete().eq('id', id)
  if (error) throw error
}
export async function reorderTasks(orderedIds) {
  const r = await Promise.all(orderedIds.map((id, sort) => supabase.from('cp_tasks').update({ sort }).eq('id', id)))
  const err = r.find((x) => x.error); if (err) throw err.error
}

// ── milestones ─────────────────────────────────────────────────────
export async function createMilestone(projectId, ms = {}) {
  const id = ms.id || uuid()
  const row = { id, project_id: projectId, label: ms.label || '', state: ms.state || 'upcoming',
    sub: ms.sub ?? null, due: ms.due ?? null, sort: ms.sort ?? 0 }
  const { error } = await supabase.from('cp_milestones').insert(row)
  if (error) throw error
  return id
}
export async function updateMilestone(id, patch) {
  const row = {}
  if (patch.label != null) row.label = patch.label
  if (patch.state != null) row.state = patch.state
  if (patch.sub !== undefined) row.sub = patch.sub
  if (patch.due !== undefined) row.due = patch.due
  if (patch.sort != null) row.sort = patch.sort
  const { error } = await supabase.from('cp_milestones').update(row).eq('id', id)
  if (error) throw error
}
export async function deleteMilestone(id) {
  const { error } = await supabase.from('cp_milestones').delete().eq('id', id)
  if (error) throw error
}

// ── updates (where-it-stands timeline) ─────────────────────────────
export async function createUpdate(projectId, body) {
  const id = uuid()
  const { error } = await supabase.from('cp_updates').insert({ id, project_id: projectId, body })
  if (error) throw error
  return id
}

// ── reMarkable push queue ──────────────────────────────────────────
// Course+ is a static site and the tablet sleeps, so there is nothing to push
// to directly. Queue it instead: the Beelink poller renders the markdown to a
// reMarkable-sized PDF and Syncthing delivers on the device's next wake.
// id and user_id both come from column defaults (gen_random_uuid / auth.uid).
export async function queueRemarkablePush(push = {}) {
  const row = {
    title: push.title || 'Untitled',
    body: push.body || '',
    dest: push.dest || 'markup',
    source_app: 'course-plus',
    source_kind: push.sourceKind ?? null,
    source_ref: push.sourceRef ?? null,
  }
  const { error } = await supabase.from('rm_push_queue').insert(row)
  if (error) throw error
}

// ── artifacts ──────────────────────────────────────────────────────
export async function createArtifact(projectId, art = {}) {
  const id = art.id || uuid()
  const row = { id, project_id: projectId, title: art.title || '', art_type: art.artType ?? null,
    provenance: art.provenance ?? null, from_count: art.fromCount ?? null, body: art.body ?? null }
  const { error } = await supabase.from('cp_artifacts').insert(row)
  if (error) throw error
  return id
}
const ARTIFACT_COLS = { title: 'title', body: 'body', artType: 'art_type', provenance: 'provenance', fromCount: 'from_count', project: 'project_id' }
export async function updateArtifact(id, patch) {
  const row = {}
  for (const k in patch) if (ARTIFACT_COLS[k]) row[ARTIFACT_COLS[k]] = patch[k]
  const { error } = await supabase.from('cp_artifacts').update(row).eq('id', id)
  if (error) throw error
}
export async function deleteArtifact(id) {
  await supabase.from('cp_artifact_versions').delete().eq('artifact_id', id)
  const { error } = await supabase.from('cp_artifacts').delete().eq('id', id)
  if (error) throw error
}

// ── artifact version history ───────────────────────────────────────
// Snapshots of a document taken right BEFORE it is overwritten, so any update
// (AI revision or manual edit) can be rolled back. Loaded on demand from the
// artifact screen rather than in loadAll() — full document bodies would bloat
// every boot for something only read when you open the history.
function mapArtifactVersion(r) {
  return { id: r.id, artifactId: r.artifact_id, title: r.title, body: r.body || '', reason: r.reason || '', at: r.created_at }
}
export async function listArtifactVersions(artifactId) {
  const { data, error } = await supabase.from('cp_artifact_versions').select('*')
    .eq('artifact_id', artifactId).order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(mapArtifactVersion)
}
// Snapshot the CURRENT state of an artifact. Call before writing the new body.
export async function snapshotArtifact(artifactId, { title = '', body = '', reason = '' } = {}) {
  const id = uuid()
  const { error } = await supabase.from('cp_artifact_versions')
    .insert({ id, artifact_id: artifactId, title, body, reason })
  if (error) throw error
  return id
}

// ── projects ───────────────────────────────────────────────────────
export async function createProject(areaId, name, opts = {}) {
  const id = opts.id || uuid()
  const { error } = await supabase.from('cp_projects').insert({ id, area_id: areaId, name,
    status: opts.status || 'active', priority: opts.priority ?? null, sort: opts.sort ?? 0 })
  if (error) throw error
  return id
}
export async function updateProject(id, patch) {
  const row = {}
  if (patch.name != null) row.name = patch.name
  if (patch.status != null) row.status = patch.status
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.due !== undefined) row.due = patch.due
  if (patch.blurb !== undefined) row.blurb = patch.blurb
  if (patch.hold !== undefined) row.hold = patch.hold
  if (patch.areaId != null) row.area_id = patch.areaId
  const { error } = await supabase.from('cp_projects').update(row).eq('id', id)
  if (error) throw error
}
export async function deleteProject(id) {
  const { error } = await supabase.from('cp_projects').delete().eq('id', id)
  if (error) throw error
}
// Persist a new project ordering (sort = position). orderedIds = project ids in display order.
export async function reorderProjects(orderedIds) {
  const r = await Promise.all(orderedIds.map((id, sort) => supabase.from('cp_projects').update({ sort }).eq('id', id)))
  const err = r.find((x) => x.error); if (err) throw err.error
}

// ── areas ──────────────────────────────────────────────────────────
export async function createArea(name, sort = 0) {
  const id = uuid()
  const { error } = await supabase.from('cp_areas').insert({ id, name, open_default: true, sort })
  if (error) throw error
  return id
}
export async function updateArea(id, patch) {
  const row = {}
  if (patch.name != null) row.name = patch.name
  if (patch.open != null) row.open_default = patch.open
  const { error } = await supabase.from('cp_areas').update(row).eq('id', id)
  if (error) throw error
}
export async function deleteArea(id) {
  const { error } = await supabase.from('cp_areas').delete().eq('id', id)
  if (error) throw error
}

// Delete an area AND everything under it. cp_* references are app-side (no FK
// cascade), so a bare deleteArea would orphan its projects/tasks/notes — this
// removes the children first, then the area. Irreversible; confirm before use.
export async function deleteAreaCascade(id) {
  const projs = await supabase.from('cp_projects').select('id').eq('area_id', id)
  if (projs.error) throw projs.error
  const pids = (projs.data || []).map((p) => p.id)
  const inDel = (table, col) => supabase.from(table).delete().in(col, pids)
  if (pids.length) {
    const child = await Promise.all([
      inDel('cp_tasks', 'project_id'), inDel('cp_notes', 'project'), // cp_notes uses `project`, not project_id
      inDel('cp_artifacts', 'project_id'), inDel('cp_milestones', 'project_id'),
      inDel('cp_updates', 'project_id'), inDel('cp_assets', 'project_id'),
    ])
    const cErr = child.find((r) => r.error); if (cErr) throw cErr.error
    const pErr = (await supabase.from('cp_projects').delete().in('id', pids)).error
    if (pErr) throw pErr
  }
  // loose pillar tasks / notes attached directly to the area (note: cp_notes uses `area`)
  const loose = await Promise.all([
    supabase.from('cp_tasks').delete().eq('area_id', id),
    supabase.from('cp_notes').delete().eq('area', id),
  ])
  const lErr = loose.find((r) => r.error); if (lErr) throw lErr.error
  const { error } = await supabase.from('cp_areas').delete().eq('id', id)
  if (error) throw error
}
export async function reorderAreas(orderedIds) {
  const r = await Promise.all(orderedIds.map((id, sort) => supabase.from('cp_areas').update({ sort }).eq('id', id)))
  const err = r.find((x) => x.error); if (err) throw err.error
}
