// Goals — the success record.
//
// A goal owns no work. It points at projects, and everything on it is DERIVED
// from them: wins on one side, hindrances on the other. Nothing here is a list
// you keep up to date, which is the whole point — finishing a task IS filing
// the win.
//
// Derived, then PERSISTED. Pure derivation would be less code but it silently
// rewrites history: clean up a finished task six months from now and the win it
// represented vanishes from the record. cp_goal_events is append-only, keyed by
// (goal, kind, source_kind, source_id), snapshotting the title as it read at the
// time. A source that disappears is marked `orphaned`, never deleted.
//
// Hindrances are recorded as SPANS, not live flags. "Shipped the CSA model
// despite being blocked on Ludo for six weeks" is the sentence a review needs,
// and a flag that clears itself can never produce it. So a hindrance opens once
// and later closes; it never disappears.
//
// Deliberately NOT loaded in loadAll(): Goals is a screen you visit, not part
// of the work spine every boot renders, and a missing migration here must never
// take the whole app down. Same shape as lib/dives.js.
import { supabase } from './supabase'
import { claudeComplete, extractJSON, houseStyle, pickModel } from './claude'
import { hindrancesFor } from './nudges'

const uuid = () => (crypto?.randomUUID?.() || 'id-' + Date.now() + '-' + Math.round(Math.random() * 1e6))

// Course+ migrations are applied by hand, so a build can reach a browser before
// its tables exist. Postgres 42P01 ("relation does not exist") is that exact
// case — translate it once, here, so the UI says what to do instead of leaking
// a PostgREST error string.
const NOT_MIGRATED =
  'The Goals tables are not in this database yet. Apply supabase/migrations/20260813120000_cp_goals.sql, then reload.'
function translate(error) {
  return error?.code === '42P01' ? new Error(NOT_MIGRATED) : error
}
const must = (error) => { if (error) throw translate(error) }

export const GOAL_STATUS = {
  'on-track': { label: 'On track', tone: 'good' },
  'at-risk': { label: 'At risk', tone: 'risk' },
  hit: { label: 'Hit', tone: 'good' },
  missed: { label: 'Missed', tone: 'risk' },
}

function mapGoal(r) {
  return {
    id: r.id, title: r.title || '', blurb: r.blurb || '',
    weight: r.weight ?? null, kind: r.kind || 'goal', period: r.period || '',
    status: r.status || 'on-track', sourceNote: r.source_note || null,
    projectIds: Array.isArray(r.project_ids) ? r.project_ids : [],
    sort: r.sort ?? 0, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
function mapEvent(r) {
  return {
    id: r.id, goal: r.goal_id, kind: r.kind || 'win', sourceKind: r.source_kind,
    sourceId: r.source_id || null, project: r.project_id || null,
    title: r.title || '', detail: r.detail || '',
    at: r.happened_at, openedAt: r.opened_at, closedAt: r.closed_at,
    orphaned: !!r.orphaned, manual: !!r.manual, dismissed: !!r.dismissed, createdAt: r.created_at,
  }
}

// ── goals CRUD ─────────────────────────────────────────────────────────
export async function listGoals({ includeArchived = false } = {}) {
  let q = supabase.from('cp_goals').select('*').order('sort')
  if (!includeArchived) q = q.eq('archived', false)
  const { data, error } = await q
  must(error)
  return (data || []).map(mapGoal)
}
export async function createGoal(goal = {}) {
  const id = goal.id || uuid()
  const row = {
    id, title: goal.title || '', blurb: goal.blurb ?? null, weight: goal.weight ?? null,
    kind: goal.kind || 'goal', period: goal.period ?? null, status: goal.status || 'on-track',
    source_note: goal.sourceNote ?? null, project_ids: goal.projectIds || [], sort: goal.sort ?? 0,
  }
  const { error } = await supabase.from('cp_goals').insert(row)
  must(error)
  return id
}
const GOAL_COLS = {
  title: 'title', blurb: 'blurb', weight: 'weight', kind: 'kind', period: 'period',
  status: 'status', sourceNote: 'source_note', projectIds: 'project_ids', sort: 'sort', archived: 'archived',
}
export async function updateGoal(id, patch) {
  const row = { updated_at: new Date().toISOString() }
  for (const k in patch) if (GOAL_COLS[k]) row[GOAL_COLS[k]] = patch[k]
  const { error } = await supabase.from('cp_goals').update(row).eq('id', id)
  must(error)
}
// Deleting a goal takes its ledger with it — an event is meaningless without
// the goal it counted toward, and there are no FKs to cascade for us.
export async function deleteGoal(id) {
  const e = await supabase.from('cp_goal_events').delete().eq('goal_id', id)
  must(e.error)
  const { error } = await supabase.from('cp_goals').delete().eq('id', id)
  must(error)
}
export async function reorderGoals(orderedIds) {
  const r = await Promise.all(orderedIds.map((id, sort) => supabase.from('cp_goals').update({ sort }).eq('id', id)))
  const err = r.find((x) => x.error); if (err) must(err.error)
}

// Drop a project from every goal that links it. Called best-effort when a
// project is deleted — a dangling id is only cosmetic, so this must never be
// allowed to fail the delete it is cleaning up after.
export async function unlinkProjectEverywhere(projectId) {
  const goals = await listGoals({ includeArchived: true })
  const hit = goals.filter((g) => (g.projectIds || []).includes(projectId))
  for (const g of hit) {
    await updateGoal(g.id, { projectIds: g.projectIds.filter((x) => x !== projectId) })
  }
  return hit.length
}

// ── ledger ─────────────────────────────────────────────────────────────
export async function listEvents(goalIds) {
  let q = supabase.from('cp_goal_events').select('*').order('happened_at', { ascending: false, nullsFirst: false })
  if (Array.isArray(goalIds)) {
    if (!goalIds.length) return []
    q = q.in('goal_id', goalIds)
  }
  const { data, error } = await q
  must(error)
  return (data || []).map(mapEvent)
}
export async function addManualWin(goalId, { title, detail, at, project } = {}) {
  const id = uuid()
  const row = {
    id, goal_id: goalId, kind: 'win', source_kind: 'manual', source_id: null,
    project_id: project ?? null, title: title || '', detail: detail ?? null,
    happened_at: at || new Date().toISOString(), manual: true,
  }
  const { error } = await supabase.from('cp_goal_events').insert(row)
  must(error)
  return id
}
// Dismissing hides an event without destroying it. The reconciler keys on
// (goal, kind, source) and never re-inserts, so a dismissed row stays dismissed.
export async function dismissEvent(id, dismissed = true) {
  const { error } = await supabase.from('cp_goal_events').update({ dismissed }).eq('id', id)
  must(error)
}
export async function deleteEvent(id) {
  const { error } = await supabase.from('cp_goal_events').delete().eq('id', id)
  must(error)
}

// ── derivation (pure) ──────────────────────────────────────────────────
// Which cp_updates lines count as an accomplishment. Status flips already write
// rows here (Inbox.jsx, Project.jsx, Overview.jsx), so this is free history
// going back months — but the same feed carries the bad news. Anything that
// records work STOPPING is not a win; it surfaces as a hindrance instead.
const NOT_A_WIN = /^(waiting\b|still waiting\b|think it through|status\s*(→|->)\s*(on hold|waiting|backlog|icebox|idea))/i
// An explicit way to log a win from the project page that the reconciler picks
// up for free: write an update starting "Win: ".
const WIN_PREFIX = /^win:\s*/i

export function updateIsWin(body) {
  const s = String(body || '').trim()
  if (!s) return false
  return !NOT_A_WIN.test(s)
}

const tsOf = (v) => (v ? Date.parse(v) || 0 : 0)

// Every candidate win a project currently offers. Pure — no I/O.
// Milestones are deliberately excluded: cp_milestones carries no completion
// timestamp at all, so dating one would place the win at project-creation time.
// Wrong dates on a surface whose entire job is dates is worse than omission.
export function winsFromProject(p) {
  if (!p) return []
  const out = []
  for (const tk of p.tasks || []) {
    if (!tk.done) continue
    const at = tk.completedAt || tk.updatedAt || tk.createdAt || null
    out.push({
      sourceKind: 'task', sourceId: tk.id, project: p.id, title: tk.label || 'Untitled task',
      // The detail line is what makes a win quotable in a review.
      detail: tk.waiting ? `${p.name} · was blocked on ${tk.waiting}` : p.name,
      at, approx: !tk.completedAt,
    })
  }
  for (const a of p.artifacts || []) {
    out.push({
      sourceKind: 'artifact', sourceId: a.id, project: p.id, title: a.title || 'Untitled deliverable',
      detail: a.artType ? `${p.name} · ${a.artType}` : p.name, at: a.at || null,
    })
  }
  for (const u of p.updates || []) {
    const body = String(u.body || '').trim()
    if (!updateIsWin(body)) continue
    out.push({
      sourceKind: 'update', sourceId: u.id, project: p.id,
      title: WIN_PREFIX.test(body) ? body.replace(WIN_PREFIX, '') : body,
      detail: p.name, at: u.at || null,
    })
  }
  return out.filter((w) => w.at).sort((a, b) => tsOf(b.at) - tsOf(a.at))
}

// Everything one goal derives from the current spine. Unresolvable project ids
// come back separately — the live "Nate's Goals" note links a legacy `csp` id
// with no row behind it, and that has to be visible, not silently dropped.
export function deriveGoal(goal, projectById, lastTouchAt) {
  const ids = goal.projectIds || []
  const projects = ids.map((id) => projectById(id)).filter(Boolean)
  const missingIds = ids.filter((id) => !projectById(id))
  const wins = projects.flatMap(winsFromProject).sort((a, b) => tsOf(b.at) - tsOf(a.at))
  const hindrances = projects.flatMap((p) => hindrancesFor(p, lastTouchAt))
  return { projects, missingIds, wins, hindrances }
}

const keyOf = (kind, e) => `${kind}|${e.sourceKind}|${e.sourceId}`

// Diff the derived picture against the stored ledger. Returns rows to insert
// and patches to apply — never deletes. Pure, so it can be reasoned about
// without a database.
export function planReconcile(goal, derived, existing, nowIso) {
  const mine = existing.filter((e) => e.goal === goal.id && !e.manual)
  const byKey = new Map(mine.filter((e) => e.sourceId).map((e) => [keyOf(e.kind, e), e]))
  const insert = [], patch = []

  const seenWin = new Set()
  for (const w of derived.wins) {
    const k = keyOf('win', w)
    seenWin.add(k)
    const hit = byKey.get(k)
    if (!hit) {
      insert.push({
        id: uuid(), goal_id: goal.id, kind: 'win', source_kind: w.sourceKind, source_id: w.sourceId,
        project_id: w.project, title: w.title, detail: w.detail ?? null, happened_at: w.at,
      })
    } else if (hit.orphaned) {
      patch.push({ id: hit.id, orphaned: false }) // the source came back
    }
  }
  const seenHind = new Set()
  for (const h of derived.hindrances) {
    const src = { sourceKind: h.kind, sourceId: h.task || h.project }
    const k = keyOf('hindrance', src)
    if (seenHind.has(k)) continue
    seenHind.add(k)
    const hit = byKey.get(k)
    if (!hit) {
      insert.push({
        id: uuid(), goal_id: goal.id, kind: 'hindrance', source_kind: h.kind, source_id: src.sourceId,
        project_id: h.project, title: h.text, detail: h.projectName ?? null, opened_at: nowIso,
      })
    } else if (hit.closedAt) {
      patch.push({ id: hit.id, closed_at: null }) // it came back
    }
  }
  // Anything stored but no longer derived. Wins go orphaned (the task was
  // deleted — the win still happened). Hindrances close (it cleared, and the
  // span is the interesting part).
  //
  // Guarded on the goal actually resolving a project. If the spine were ever
  // empty when this ran — mid-load, or every linked project deleted — the
  // derived set would be empty and this loop would orphan the entire record in
  // one pass. Nothing to compare against means nothing to retire.
  if (!derived.projects.length) return { insert, patch }
  for (const [k, e] of byKey) {
    if (e.kind === 'win' && !seenWin.has(k) && !e.orphaned) patch.push({ id: e.id, orphaned: true })
    if (e.kind === 'hindrance' && !seenHind.has(k) && !e.closedAt) patch.push({ id: e.id, closed_at: nowIso })
  }
  return { insert, patch }
}

// Apply a plan. Best-effort by design: this runs on a READ screen, so a write
// failure must degrade to "the screen still renders", never to an error state.
// 23505 means a concurrent mount already inserted the row — that is success.
async function applyPlan({ insert, patch }) {
  let wrote = 0
  if (insert.length) {
    const { error } = await supabase.from('cp_goal_events').insert(insert)
    if (error && error.code !== '23505') must(error)
    if (!error) wrote += insert.length
  }
  for (const p of patch) {
    const { id, ...row } = p
    const { error } = await supabase.from('cp_goal_events').update(row).eq('id', id)
    if (error) must(error)
  }
  return wrote
}

// Reconcile every goal in one pass. Returns the count of newly recorded events
// so the screen can say "3 new".
export async function reconcileAll(goals, projectById, lastTouchAt) {
  if (!goals.length) return 0
  const existing = await listEvents(goals.map((g) => g.id))
  const now = new Date().toISOString()
  let wrote = 0
  for (const g of goals) {
    const derived = deriveGoal(g, projectById, lastTouchAt)
    wrote += await applyPlan(planReconcile(g, derived, existing, now))
  }
  return wrote
}

// ── sync from the Library ──────────────────────────────────────────────
// Read a note and pull weighted goals out of it. Written for the real EPR doc
// once it exists; the meeting summary that currently holds the goals works too,
// which is why summary, body and transcript are all fed in.
const SYNC_SYSTEM =
  'You extract performance-review goals from a work document. Return ONLY a JSON array, no prose. ' +
  'Each element: {"title": string, "weight": number|null, "kind": "goal"|"competency", "blurb": string}. ' +
  'title is a short noun phrase, under 8 words. weight is the percentage if the document states one, else null. ' +
  'kind is "competency" only for behavioural or skill items, otherwise "goal". ' +
  'blurb is one sentence on what achieving it looks like. Do not invent goals the document does not state.'

const noteText = (n) => [
  n?.summary || '',
  (n?.body || []).map((b) => b.p || (b.ul ? b.ul.map((i) => '- ' + i).join('\n') : (b.ol ? b.ol.map((i, k) => `${k + 1}. ${i}`).join('\n') : ''))).join('\n'),
  n?.transcript || '',
].filter(Boolean).join('\n\n').trim()

export function noteHasContent(n) {
  return noteText(n).length > 200
}

// Every note that looks like it holds goals, best candidate first. A note with
// real content beats an empty stub with the better title — "Nate's Goals" is
// currently a title and five project links with nothing in the body, and the
// actual EPR breakdown lives in a meeting called "Jon Goals".
export function findGoalNotes(notes = []) {
  return notes
    .filter((n) => /\bgoals?\b|\bepr\b|objective/i.test(n.title || '') || (n.tags || []).some((x) => /goal|epr/i.test(x)))
    .map((n) => ({ note: n, hasContent: noteHasContent(n) }))
    .sort((a, b) => (b.hasContent - a.hasContent) || ((Date.parse(b.note.date || '') || 0) - (Date.parse(a.note.date || '') || 0)))
}

// Returns parsed goal drafts — the caller decides what to write, so a bad parse
// never silently rewrites the record.
export async function parseGoalsFromNote(note) {
  const text = noteText(note)
  if (!text) throw new Error('That note is empty - there is nothing to sync from.')
  const raw = await claudeComplete(
    `Document title: ${note.title || 'Untitled'}\n\n${text.slice(0, 12000)}`,
    { system: SYNC_SYSTEM, model: pickModel('heavy'), max_tokens: 1500 },
  )
  const parsed = extractJSON(raw)
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.goals) ? parsed.goals : null)
  if (!arr) throw new Error('Could not read goals out of that note.')
  return arr
    .filter((g) => g && typeof g.title === 'string' && g.title.trim())
    .map((g) => ({
      title: houseStyle(g.title.trim()),
      weight: Number.isFinite(g.weight) ? Math.round(g.weight) : null,
      kind: g.kind === 'competency' ? 'competency' : 'goal',
      blurb: houseStyle(String(g.blurb || '').trim()),
    }))
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Stopwords that carry no signal when matching a goal title to a project name.
const STOP = new Set(['the', 'and', 'for', 'with', 'a', 'an', 'of', 'to', 'in', 'on', 'program', 'project', 'goal', 'goals', 'full', 'model', 'new'])
const tokens = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w))

// Guess which projects feed a goal, by word overlap between the goal title and
// the project name. Deliberately conservative: one shared meaningful word is
// enough to suggest, but the caller shows the result before writing, so a wrong
// guess costs a click rather than corrupting the record.
export function suggestProjects(title, projects = [], seedIds = []) {
  const want = new Set(tokens(title))
  if (!want.size) return []
  const seed = new Set(seedIds)
  return projects
    .map((p) => ({ p, score: tokens(p.name).filter((w) => want.has(w)).length }))
    .filter((x) => x.score > 0)
    // Projects the source note already pointed at are ones he hand-picked as
    // related, so a tie there is not really a tie.
    .sort((a, b) => (b.score - a.score) || ((seed.has(b.p.id) ? 1 : 0) - (seed.has(a.p.id) ? 1 : 0)))
    .map((x) => x.p.id)
}

// Upsert drafts against the existing goals, matched on normalized title.
// Project links, status and sort always survive a re-sync — the note is the
// source for WHAT the goals are, never for how they are wired up.
export async function applyGoalDrafts(drafts, existing, { sourceNote = null, period = null } = {}) {
  const byTitle = new Map(existing.map((g) => [norm(g.title), g]))
  let added = 0, updated = 0
  let sort = existing.reduce((m, g) => Math.max(m, g.sort ?? 0), 0)
  for (const d of drafts) {
    const hit = byTitle.get(norm(d.title))
    if (hit) {
      await updateGoal(hit.id, {
        title: d.title, blurb: d.blurb || hit.blurb, weight: d.weight ?? hit.weight,
        kind: d.kind, sourceNote, ...(period ? { period } : {}),
      })
      updated++
    } else {
      // projectIds is only ever set on CREATE, so re-syncing never stomps links
      // that were corrected by hand.
      await createGoal({ ...d, projectIds: d.projectIds || [], sourceNote, period, sort: ++sort })
      added++
    }
  }
  return { added, updated }
}
