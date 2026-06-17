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
    date: r.date, updated: r.updated, indexed: r.indexed, status: r.status,
    rawWords: r.raw_words || undefined, transcript: r.transcript || undefined, summary: r.summary || undefined,
    agenda: r.agenda || undefined, incomplete: typeof r.incomplete === 'boolean' ? r.incomplete : undefined,
    nextSteps: r.next_steps || undefined,
    terms: r.terms || [], actions: r.actions || [], body: r.body || [], related: r.related || [],
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
    id: r.id, project: r.project_id, label: r.label, done: !!r.done, next: !!r.next,
    waiting: r.waiting || undefined, due: r.due || undefined, dueDate: r.due_date || undefined,
    workType: r.work_type || undefined, taskStatus: r.task_status || undefined,
    notes: r.notes || undefined, srcMeeting: r.src_meeting || undefined, sort: r.sort ?? 0,
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
  const tasksByProj = groupBy(taskRows.map(mapTask), 'project')
  const msByProj = groupBy(msRows.map(mapMilestone), 'project')
  const updByProj = groupBy(updRows.map(mapUpdate), 'project')
  const artByProj = groupBy(artRows.map(mapArtifact), 'project')
  return [...areaRows].sort((a, b) => a.sort - b.sort).map((a) => ({
    id: a.id, name: a.name, open: a.open_default,
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

// ── load everything ────────────────────────────────────────────────
export async function loadAll() {
  const [areas, projects, tasks, ms, upd, art, notes, inbox, assets] = await Promise.all([
    supabase.from('cp_areas').select('*'),
    supabase.from('cp_projects').select('*'),
    supabase.from('cp_tasks').select('*'),
    supabase.from('cp_milestones').select('*'),
    supabase.from('cp_updates').select('*'),
    supabase.from('cp_artifacts').select('*'),
    supabase.from('cp_notes').select('*').order('updated_at', { ascending: false }),
    supabase.from('cp_inbox').select('*').order('created_at', { ascending: false }),
    supabase.from('cp_assets').select('*').order('created_at', { ascending: false }),
  ])
  const err = areas.error || projects.error || tasks.error || ms.error || upd.error || art.error || notes.error || inbox.error || assets.error
  if (err) throw err
  return {
    areas: assemble(areas.data || [], projects.data || [], tasks.data || [], ms.data || [], upd.data || [], art.data || []),
    notes: (notes.data || []).map(mapNote),
    inbox: (inbox.data || []).map(mapInbox),
    assets: (assets.data || []).map(mapAsset),
  }
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
    next_steps: n.nextSteps ?? null,
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
  related: 'related', transcript: 'transcript', projects: 'projects', agenda: 'agenda', incomplete: 'incomplete', nextSteps: 'next_steps',
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

// ── tasks ──────────────────────────────────────────────────────────
const TASK_COLS = {
  label: 'label', done: 'done', next: 'next', waiting: 'waiting', due: 'due',
  dueDate: 'due_date', workType: 'work_type', taskStatus: 'task_status',
  notes: 'notes', srcMeeting: 'src_meeting', project: 'project_id', sort: 'sort',
}
export async function createTask(projectId, task = {}) {
  const id = task.id || uuid()
  const row = { id, project_id: projectId, label: task.label || '', done: !!task.done, next: !!task.next,
    waiting: task.waiting ?? null, due: task.due ?? null, due_date: task.dueDate ?? null,
    work_type: task.workType ?? null, task_status: task.taskStatus ?? null, notes: task.notes ?? null,
    src_meeting: task.srcMeeting ?? null, sort: task.sort ?? 0 }
  const { error } = await supabase.from('cp_tasks').insert(row)
  if (error) throw error
  return id
}
export async function updateTask(id, patch) {
  const row = {}
  for (const k in patch) if (TASK_COLS[k]) row[TASK_COLS[k]] = patch[k]
  const { error } = await supabase.from('cp_tasks').update(row).eq('id', id)
  if (error) throw error
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
  const { error } = await supabase.from('cp_artifacts').delete().eq('id', id)
  if (error) throw error
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
export async function reorderAreas(orderedIds) {
  const r = await Promise.all(orderedIds.map((id, sort) => supabase.from('cp_areas').update({ sort }).eq('id', id)))
  const err = r.find((x) => x.error); if (err) throw err.error
}
