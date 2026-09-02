// Course+ data ops for the MCP server — thin Supabase queries over the cp_*
// tables, mirroring src/lib/db.js. JSON-friendly shapes for the host Claude.
// The recurrence engine is shared with the app rather than copied — this server
// runs from the repo, so it can import the real thing. (The remote edge function
// cannot reach outside its own directory and carries a port instead; see
// supabase/functions/_shared/recurrence.ts.)
import { normalizeRule, nextOccurrence, recurrenceLabel, todayYmd } from '../../src/lib/recurrence.js'

const uuid = () => globalThis.crypto.randomUUID()
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ── date helpers: jsonb {y,m,d} (m 0-indexed) <-> ISO 'YYYY-MM-DD' ──
// A bare 'YYYY-MM-DD' is parsed by Date as UTC midnight, which is the PREVIOUS
// day in every timezone west of Greenwich — so every due date Claude set through
// MCP landed a day early. Read the calendar parts directly instead; only fall
// back to Date for the fuller timestamps it actually handles correctly.
const toYMD = (s) => {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim())
  if (m) return { y: +m[1], m: +m[2] - 1, d: +m[3] }
  const d = new Date(s); if (isNaN(d)) return null
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }
}
const ymdStr = (o) => (o && o.y != null) ? `${o.y}-${String(o.m + 1).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : null
const todayLabel = () => { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }

// ── markdown <-> note body blocks ──
const UL = /^[-*•]\s+/, OL = /^\d+[.)]\s+/
export function textToBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []; let para = [], ul = [], ol = []
  const fp = () => { if (para.length) { blocks.push({ p: para.join(' ').trim() }); para = [] } }
  const fu = () => { if (ul.length) { blocks.push({ ul: ul.slice() }); ul = [] } }
  const fo = () => { if (ol.length) { blocks.push({ ol: ol.slice() }); ol = [] } }
  for (const raw of lines) {
    const l = raw.trim()
    if (!l) { fp(); fu(); fo(); continue }
    if (UL.test(l)) { fp(); fo(); ul.push(l.replace(/^[-*•]\s+\[?\s?\]?\s*/, '').replace(UL, '').trim()) }
    else if (OL.test(l)) { fp(); fu(); ol.push(l.replace(OL, '').trim()) }
    else { fu(); fo(); para.push(l) }
  }
  fp(); fu(); fo(); return blocks
}
export function blocksToText(blocks = []) {
  return (blocks || []).map((b) => b.p || (b.ul ? b.ul.map((i) => '- ' + i).join('\n') : (b.ol ? b.ol.map((i, n) => `${n + 1}. ${i}`).join('\n') : (b.links ? b.links.map((l) => `[[${l}]]`).join(' ') : '')))).filter(Boolean).join('\n\n')
}

const mapTask = (r) => ({ id: r.id, project: r.project_id, label: r.label, done: !!r.done, next: !!r.next, waiting: r.waiting || null, due: ymdStr(r.due_date) || r.due || null, workType: r.work_type || null, priority: r.priority ?? null, status: r.task_status || null, notes: r.notes || null, sort: r.sort ?? 0, repeats: recurrenceLabel(r.recurrence), recurrence: r.recurrence || null })
const mapMs = (r) => ({ id: r.id, label: r.label, state: r.state, sub: r.sub || null, due: ymdStr(r.due) })
const noteRow = (n) => ({ id: n.id, kind: n.kind, title: n.title, project: n.project ?? null, area: n.area ?? null, projects: n.projects || [], people: n.people || [], tags: n.tags || [], date: n.date, updated: n.updated, indexed: true, status: n.status ?? 2, transcript: n.transcript ?? null, summary: n.summary ?? null, agenda: n.agenda ?? null, terms: n.terms || [], actions: n.actions || [], body: n.body || [], related: n.related || [] })
const noteOut = (r) => ({ id: r.id, kind: r.kind, title: r.title, project: r.project, area: r.area, projects: r.projects || [], people: r.people || [], tags: r.tags || [], date: r.date, summary: r.summary || null, agenda: r.agenda || null, incomplete: !!r.incomplete, bodyMarkdown: blocksToText(r.body || []), transcript: r.transcript || null, actions: r.actions || [], terms: r.terms || [] })

const must = (e) => { if (e) throw new Error(e.message || String(e)) }

// ── areas / projects ──
export async function listAreas(sb) {
  const { data, error } = await sb.from('cp_areas').select('*').order('sort'); must(error)
  return (data || []).map((a) => ({ id: a.id, name: a.name }))
}
export async function createArea(sb, { name }) {
  const id = uuid(); const { error } = await sb.from('cp_areas').insert({ id, name, open_default: true, sort: 99 }); must(error); return { id, name }
}
export async function listProjects(sb, { area, status } = {}) {
  let q = sb.from('cp_projects').select('id,name,area_id,status,priority,due,blurb').order('sort')
  if (area) q = q.eq('area_id', area)
  if (status) q = q.eq('status', status)
  const { data, error } = await q; must(error)
  return (data || []).map((p) => ({ id: p.id, name: p.name, area: p.area_id, status: p.status, priority: p.priority ?? null, due: ymdStr(p.due), blurb: p.blurb || null }))
}
export async function getProject(sb, { id }) {
  const [p, tasks, ms, upd, art] = await Promise.all([
    sb.from('cp_projects').select('*').eq('id', id).single(),
    sb.from('cp_tasks').select('*').eq('project_id', id),
    sb.from('cp_milestones').select('*').eq('project_id', id),
    sb.from('cp_updates').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    sb.from('cp_artifacts').select('id,title,art_type,provenance,created_at').eq('project_id', id).order('created_at', { ascending: false }),
  ])
  must(p.error || tasks.error || ms.error || upd.error || art.error)
  const pr = p.data
  return {
    id: pr.id, name: pr.name, area: pr.area_id, status: pr.status, priority: pr.priority ?? null, due: ymdStr(pr.due), blurb: pr.blurb || null, hold: pr.hold || null,
    tasks: (tasks.data || []).map(mapTask).sort((a, b) => a.sort - b.sort),
    milestones: (ms.data || []).map(mapMs),
    updates: (upd.data || []).map((u) => ({ body: u.body, at: u.created_at })),
    artifacts: (art.data || []).map((a) => ({ id: a.id, title: a.title, artType: a.art_type, provenance: a.provenance })),
  }
}
export async function createProject(sb, { area, name, status = 'active', priority = null }) {
  const id = uuid(); const { error } = await sb.from('cp_projects').insert({ id, area_id: area, name, status, priority, sort: 99 }); must(error); return { id, name, area, status }
}
export async function updateProject(sb, { id, name, status, priority, due, area }) {
  const row = {}
  if (name != null) row.name = name; if (status != null) row.status = status; if (priority !== undefined) row.priority = priority
  if (due !== undefined) row.due = toYMD(due); if (area != null) row.area_id = area
  const { error } = await sb.from('cp_projects').update(row).eq('id', id); must(error); return { id, ...row }
}

// ── tasks ──
export async function listTasks(sb, { project, status = 'open', lane } = {}) {
  let q = sb.from('cp_tasks').select('*').order('sort')
  if (project) q = q.eq('project_id', project)
  if (status === 'open') q = q.eq('done', false)
  else if (status === 'done') q = q.eq('done', true)
  const { data, error } = await q; must(error)
  let rows = (data || []).map(mapTask)
  // lane lives in task_status: 'now' = Now lane, anything else open = the Icebox
  // lane (still stored as 'backlog' — the rename was display-only).
  if (lane === 'now') rows = rows.filter((t) => t.status === 'now')
  else if (lane === 'backlog') rows = rows.filter((t) => t.status !== 'now')
  return rows
}
// Claude passes `until` as a YYYY-MM-DD string (every other date in this API is
// one); the rule stores it as {y,m,d}. Convert before normalising, or the end
// date would be silently dropped and the series would never stop.
const repeatIn = (repeat) => {
  if (repeat == null) return null
  return normalizeRule(typeof repeat.until === 'string' ? { ...repeat, until: toYMD(repeat.until) } : repeat)
}

export async function createTask(sb, { project, label, due, next = false, waiting, priority = null, lane = 'backlog', srcMeeting, repeat }) {
  const id = uuid()
  const { error } = await sb.from('cp_tasks').insert({ id, project_id: project, label, done: false, next, waiting: waiting ?? null, due_date: due ? toYMD(due) : null, priority, task_status: lane === 'now' ? 'now' : 'backlog', src_meeting: srcMeeting ?? null, sort: 99, completed_at: null, recurrence: repeatIn(repeat) })
  must(error); return { id, project, label, repeats: recurrenceLabel(repeatIn(repeat)) }
}
export async function updateTask(sb, { id, label, done, next, waiting, due, workType, notes, status, priority, repeat }) {
  const row = {}
  if (label != null) row.label = label; if (done != null) row.done = done; if (next != null) row.next = next
  if (waiting !== undefined) row.waiting = waiting; if (due !== undefined) row.due_date = due ? toYMD(due) : null
  if (workType !== undefined) row.work_type = workType; if (notes !== undefined) row.notes = notes; if (status !== undefined) row.task_status = status
  if (priority !== undefined) row.priority = priority
  if (repeat !== undefined) row.recurrence = repeatIn(repeat) // null clears the repeat
  // Stamp the honest completion time, same as src/lib/db.js updateTask. Without
  // this a task Claude ticks off gets no date and the Goals ledger cannot place it.
  if (done != null) row.completed_at = done ? new Date().toISOString() : null
  const { error } = await sb.from('cp_tasks').update(row).eq('id', id); must(error)
  const out = { id, ...row }
  // Completing a recurring task spawns its successor, exactly as the app does
  // (src/DataContext.jsx). Best-effort: the repeat must never fail the completion.
  if (done === true) {
    try { const nx = await spawnNext(sb, id); if (nx) out.spawnedNext = nx } catch { /* keep the completion */ }
  }
  return out
}
// Create the next occurrence of a recurring task that has just been completed.
// Mirrors spawnNextOccurrence in src/DataContext.jsx: the new task inherits what
// describes the WORK and not the finished instance's own state (waiting-on,
// meeting assignment, reschedule count), and the completed row is flagged
// recur_spawned so a re-completion can never fork the series a second time.
async function spawnNext(sb, id) {
  const { data: cur } = await sb.from('cp_tasks').select('*').eq('id', id).single()
  if (!cur || !cur.recurrence) return null
  const nx = nextOccurrence({ recurrence: cur.recurrence, dueDate: cur.due_date, recurIndex: cur.recur_index ?? 0, recurSpawned: !!cur.recur_spawned }, todayYmd())
  if (!nx) return null
  const seriesId = cur.recur_parent || cur.id
  const newId = uuid()
  const { error } = await sb.from('cp_tasks').insert({
    id: newId, project_id: cur.project_id, area_id: cur.area_id, label: cur.label,
    done: false, next: !!cur.next, waiting: null, due_date: nx.dueDate,
    work_type: cur.work_type === 'scheduled' ? null : cur.work_type,
    task_status: cur.task_status === 'now' ? 'now' : 'backlog',
    priority: cur.priority ?? null, notes: cur.notes ?? null, group_label: cur.group_label ?? null,
    sort: cur.sort ?? 0, completed_at: null,
    recurrence: cur.recurrence, recur_parent: seriesId, recur_index: nx.index, recur_spawned: false,
  })
  must(error)
  await sb.from('cp_tasks').update({ recur_spawned: true, recur_parent: seriesId }).eq('id', id)
  return { id: newId, label: cur.label, due: ymdStr(nx.dueDate) }
}
export async function deleteTask(sb, { id }) { const { error } = await sb.from('cp_tasks').delete().eq('id', id); must(error); return { id, deleted: true } }

// ── notes / meetings ──
export async function listNotes(sb, { project, kind } = {}) {
  let q = sb.from('cp_notes').select('id,kind,title,project,area,people,tags,date,summary,incomplete').order('updated_at', { ascending: false })
  if (project) q = q.eq('project', project)
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q; must(error)
  return (data || []).map((n) => ({ id: n.id, kind: n.kind, title: n.title, project: n.project, area: n.area, people: n.people || [], tags: n.tags || [], date: n.date, summary: n.summary || null, incomplete: !!n.incomplete }))
}
export async function getNote(sb, { id }) { const { data, error } = await sb.from('cp_notes').select('*').eq('id', id).single(); must(error); return noteOut(data) }
export async function createNote(sb, { kind = 'note', title, project = null, area = null, body, people, tags, summary, transcript }) {
  const id = uuid()
  const row = noteRow({ id, kind, title: title || 'Untitled', project, area, people, tags, summary, transcript, body: body ? textToBlocks(body) : [], date: todayLabel(), updated: 'now' })
  const { error } = await sb.from('cp_notes').insert(row); must(error); return { id, title: row.title, kind }
}
export async function updateNote(sb, { id, title, body, summary, tags, people, status }) {
  const row = { updated: 'now', updated_at: new Date().toISOString() }
  if (title != null) row.title = title; if (body != null) row.body = textToBlocks(body); if (summary !== undefined) row.summary = summary
  if (tags != null) row.tags = tags; if (people != null) row.people = people; if (status != null) row.status = status
  const { error } = await sb.from('cp_notes').update(row).eq('id', id); must(error); return { id, updated: true }
}
export async function deleteNote(sb, { id }) { const { error } = await sb.from('cp_notes').delete().eq('id', id); must(error); return { id, deleted: true } }

// ── artifacts ──
export async function listArtifacts(sb, { project } = {}) {
  let q = sb.from('cp_artifacts').select('id,project_id,title,art_type,provenance,created_at').order('created_at', { ascending: false })
  if (project) q = q.eq('project_id', project)
  const { data, error } = await q; must(error)
  return (data || []).map((a) => ({ id: a.id, project: a.project_id, title: a.title, artType: a.art_type, provenance: a.provenance }))
}
export async function getArtifact(sb, { id }) { const { data, error } = await sb.from('cp_artifacts').select('*').eq('id', id).single(); must(error); return { id: data.id, project: data.project_id, title: data.title, artType: data.art_type, provenance: data.provenance, body: data.body || '' } }
export async function createArtifact(sb, { project, title, body, artType = 'file' }) {
  const id = uuid(); const { error } = await sb.from('cp_artifacts').insert({ id, project_id: project, title: title || 'Untitled', art_type: artType, provenance: 'Added via Claude (MCP)', body: body ?? '' }); must(error); return { id, title }
}

// ── updates / inbox ──
export async function addUpdate(sb, { project, body }) { const id = uuid(); const { error } = await sb.from('cp_updates').insert({ id, project_id: project, body }); must(error); return { id, project } }
export async function listInbox(sb) {
  const { data, error } = await sb.from('cp_inbox').select('*').order('created_at', { ascending: false }); must(error)
  return (data || []).map((c) => ({ id: c.id, title: c.title, src: c.src, snippet: c.snippet, suggest: c.suggest || null, tags: c.tags || [] }))
}
export async function triageInbox(sb, { id, project }) {
  const { data: c, error: e1 } = await sb.from('cp_inbox').select('*').eq('id', id).single(); must(e1)
  const { data: p } = await sb.from('cp_projects').select('area_id').eq('id', project).single()
  const noteId = uuid()
  const { error: e2 } = await sb.from('cp_notes').insert(noteRow({ id: noteId, kind: 'note', title: c.title, project, area: p?.area_id || null, tags: c.tags || [], summary: c.snippet, body: c.snippet ? [{ p: c.snippet }] : [], date: todayLabel(), updated: 'now' }))
  must(e2)
  const { error: e3 } = await sb.from('cp_inbox').delete().eq('id', id); must(e3)
  return { noteId, project, fromInbox: id }
}
