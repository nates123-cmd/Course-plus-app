// Loads the user's Course+ data from Supabase (seeding demo fixtures on first
// run) and exposes it + the prototype data helpers, bound to the loaded data,
// via context. Replaces the prototype's window.* module-level fixtures.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { loadAll, seedIfEmpty, updateProject, createUpdate, createInbox, createTask, updateNote } from './lib/db'
import { blocksToText } from './lib/blocks'
import { holdView, holdDue } from './kit'

// Human line for a project.hold in Claude-facing digests (was '[object Object]').
const holdLine = (hold) => { const v = holdView(hold); if (!v) return ''; return 'On hold: ' + (v.reason || '—') + (v.resurfaceText ? ' (resurface ' + v.resurfaceText + ')' : '') }

// Auto-reactivate on-hold projects whose resurface date has arrived: flip to
// active + clear hold, log a where-it-stands update, and drop a notification
// into the inbox. Idempotent — the same pass clears `on-hold`, so a project is
// never reactivated twice. Returns true if anything changed (caller re-fetches).
async function autoReactivateDue(areas) {
  const due = areas.flatMap((a) => a.projects
    .filter((p) => p.status === 'on-hold' && holdDue(p.hold))
    .map((p) => ({ ...p, areaName: a.name })))
  if (!due.length) return false
  for (const p of due) {
    const hv = holdView(p.hold)
    await updateProject(p.id, { status: 'active', hold: null })
    await createUpdate(p.id, 'Reactivated from hold — resurface date reached')
    await createInbox({
      title: `Reactivated: ${p.name}`,
      src: 'Auto-reactivate', srcIcon: 'player-play',
      snippet: `Resurface date reached${hv?.reason ? ` — ${hv.reason}` : ''}. ${p.name} is active again${p.areaName ? ' in ' + p.areaName : ''}.`,
      suggest: { project: p.id, confidence: 1 },
      tags: ['reactivated'],
    })
  }
  return true
}

// ── Materialize meeting action items into the project Backlog ────────
// Phase 2 of the pull-method rebuild: extraction no longer feeds a holding pen
// with a promote button. On load, every meeting's action items that are Nate's
// (or unassigned), read like a real deliverable, and aren't already a task,
// become Backlog tasks tagged with their source meeting. Each processed action
// is flagged `materialized` on its note so a load never double-creates, and a
// dismissed or completed task never resurfaces.
const OWNER_MINE = new Set(['', 'me', 'you', 'mine', 'i', 'us', 'we', 'open', 'unassigned', 'nate'])
const ownerIsMine = (o) => OWNER_MINE.has((o || '').trim().toLowerCase())
// Light deliverable threshold — catch obvious non-actions, nothing more (extraction accuracy is already high).
const NON_ACTION = /^(discussed|discussion|talked about|reviewed|review of|note:|fyi|update on|status of|question about|thoughts on|re:)\b/i
const looksActionable = (txt) => { const s = (txt || '').trim(); return s.split(/\s+/).length >= 2 && !NON_ACTION.test(s) }
// Fuzzy dedup on task label (token Jaccard) so extraction doesn't restate a task already present.
const DEDUP_STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'and', 'on', 'in', 'with', 'by', 'from', 'our', 'my', 'me', 'i', 'we', 'at', 'is', 'be', 'this', 'that'])
const normTokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !DEDUP_STOP.has(w))
const labelSim = (a, b) => {
  const A = new Set(normTokens(a)), B = new Set(normTokens(b))
  if (!A.size || !B.size) return 0
  let inter = 0; A.forEach((w) => { if (B.has(w)) inter++ })
  return inter / (A.size + B.size - inter)
}
async function materializeMeetingActions(areas, notes) {
  const projIndex = {} // project id -> { labels[], count } (all tasks, so completed/dismissed don't resurrect)
  for (const a of areas) for (const p of a.projects) projIndex[p.id] = { labels: (p.tasks || []).map((x) => x.label), count: (p.tasks || []).length }
  let wrote = false
  for (const n of notes) {
    if (n.kind !== 'meeting' || !Array.isArray(n.actions) || !n.actions.length) continue
    let changed = false
    const nextActions = n.actions.map((a) => ({ ...a }))
    for (const a of nextActions) {
      if (a.materialized) continue
      const projId = a.project || n.project
      const idx = projId ? projIndex[projId] : null
      if (!idx) continue // no project to file into — leave unflagged for a later (re)assignment
      changed = true
      a.materialized = true
      if (!a.text || !ownerIsMine(a.owner) || !looksActionable(a.text)) continue // skip: not mine / not a deliverable
      if (idx.labels.some((l) => labelSim(a.text, l) >= 0.6)) continue // already a task
      await createTask(projId, { label: a.text.trim(), taskStatus: 'backlog', srcMeeting: n.id, sort: idx.count })
      idx.labels.push(a.text); idx.count += 1
      wrote = true
    }
    if (changed) { await updateNote(n.id, { actions: nextActions }); wrote = true }
  }
  return wrote
}

const DataCtx = createContext(null)
export function useData() { return useContext(DataCtx) }

export function DataProvider({ children }) {
  const [areas, setAreas] = useState([])
  const [notes, setNotes] = useState([])
  const [inbox, setInbox] = useState([])
  const [assets, setAssets] = useState([])
  const [series, setSeries] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)

  // silent=true refreshes data in the background without flipping the app back to
  // the full-screen "Loading…" spinner — used by every post-mutation reload() so
  // a dismiss / status change doesn't feel like a page reload.
  const load = async (silent = false) => {
    try {
      if (!silent) setStatus('loading')
      await seedIfEmpty()
      let data = await loadAll()
      // Resurface anything whose hold date has come due, then re-read once.
      if (await autoReactivateDue(data.areas)) data = await loadAll()
      // Pull any un-materialized meeting action items into the project Backlogs.
      if (await materializeMeetingActions(data.areas, data.notes)) data = await loadAll()
      setAreas(data.areas); setNotes(data.notes); setInbox(data.inbox); setAssets(data.assets || []); setSeries(data.series || [])
      setStatus('ready')
    } catch (e) {
      if (!silent) { setError(e); setStatus('error') }
    }
  }
  const reload = () => load(true)
  useEffect(() => { load() }, [])

  // ── Single-level undo (Cmd/Ctrl+Z) ──────────────────────────────
  // Mutation sites call recordUndo(revertFn); the global key handler runs the
  // last one. Skipped while focused in a text field so native text-undo wins.
  const undoRef = useRef(null)
  const [canUndo, setCanUndo] = useState(false)
  const recordUndo = (revert) => { undoRef.current = revert; setCanUndo(!!revert) }
  const runUndo = async () => { const r = undoRef.current; if (!r) return; undoRef.current = null; setCanUndo(false); try { await r() } catch (e) { console.error('undo failed', e) } }
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || (e.key !== 'z' && e.key !== 'Z')) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (!undoRef.current) return
      e.preventDefault(); runUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(() => {
    const allProjects = () => areas.flatMap((a) => a.projects.map((p) => ({ ...p, area: a.id, areaName: a.name })))
    // Tasks assigned to a pillar with no project. Tagged with areaName for display.
    const looseTasks = () => areas.flatMap((a) => (a.areaTasks || []).map((tk) => ({ ...tk, area: a.id, areaName: a.name })))
    const looseTasksInArea = (areaId) => { const a = areaById(areaId); return a ? (a.areaTasks || []) : [] }
    const projectById = (id) => allProjects().find((p) => p.id === id) || null
    const areaById = (id) => areas.find((a) => a.id === id) || null
    const noteById = (id) => notes.find((n) => n.id === id)
    const artifactById = (id) => {
      for (const a of areas) for (const p of a.projects) { const f = (p.artifacts || []).find((x) => x.id === id); if (f) return { ...f, project: f.project || p.id } }
      return null
    }
    const noteByTitle = (title) => notes.find((n) => n.title === title)
    const projectName = (id) => { const p = projectById(id); return p ? p.name : null }
    const areaName = (id) => { const a = areas.find((x) => x.id === id); return a ? a.name : null }
    const areaOfProject = (id) => areas.find((a) => a.projects.some((p) => p.id === id))
    const ownedNotes = (id) => notes.filter((n) => n.project === id)
    const linkedMeetings = (id) => notes.filter((n) => n.project !== id && (n.projects || []).includes(id))
    const notesInArea = (areaId) => notes.filter((n) => n.area === areaId)
    // ── series (recurring meetings) ──
    const seriesById = (id) => series.find((s) => s.id === id) || null
    const activeSeries = series.filter((s) => !s.archived)
    // Instances of a series, newest first (updated_at desc from load, but sort by
    // date text is unreliable — keep load order which is updated_at desc).
    const instancesForSeries = (id) => notes.filter((n) => n.seriesId === id)
    // Cheap, no-AI carry-forward: each instance's next-steps with its date,
    // newest first. Powers the "Open threads" rollup until series synthesis runs.
    const openThreadsForSeries = (id) => instancesForSeries(id)
      .filter((n) => n.nextSteps && n.nextSteps.trim())
      .map((n) => ({ noteId: n.id, title: n.title, date: n.date, text: n.nextSteps.trim() }))
    const assetsForProject = (id) => assets.filter((a) => a.projectId === id)
    const assetsForNote = (id) => assets.filter((a) => a.noteId === id)
    // Every asset that belongs to a project either directly or via one of its
    // notes — used to inline the once-extracted markdown into project digests.
    const assetsInProject = (id) => {
      const noteIds = new Set([...ownedNotes(id), ...linkedMeetings(id)].map((n) => n.id))
      return assets.filter((a) => a.projectId === id || (a.noteId && noteIds.has(a.noteId)))
    }
    const actionsForProject = (id) => {
      const out = []
      notes.forEach((n) => {
        if (n.kind !== 'meeting' || !n.actions) return
        n.actions.forEach((a) => {
          const belongs = a.project ? a.project === id : n.project === id
          if (belongs) out.push({ ...a, meeting: n.title, mid: n.id, linked: n.project !== id })
        })
      })
      return out
    }
    // Compact, bounded text digest of a whole project — name/status, where-it-
    // stands updates, milestones, open tasks, and its notes/meetings (title +
    // summary, no full transcripts). Used to give DocChat project-wide context.
    const projectDigest = (projectId) => {
      const p = projectById(projectId)
      if (!p) return ''
      const lines = []
      lines.push(`PROJECT: ${p.name}${p.areaName ? ' · ' + p.areaName : ''}`)
      const meta = [p.status && 'status: ' + p.status, p.priority && 'priority: ' + p.priority, p.due && 'due: ' + p.due].filter(Boolean)
      if (meta.length) lines.push(meta.join(' · '))
      if (p.blurb) lines.push(p.blurb)
      if (p.hold) lines.push(holdLine(p.hold))

      const upd = (p.updates || []).slice(0, 6)
      if (upd.length) lines.push('\nWHERE IT STANDS (newest first):\n' + upd.map((u) => '- ' + (u.body || '')).join('\n'))

      const ms = p.milestones || []
      if (ms.length) lines.push('\nMILESTONES:\n' + ms.map((m) => `- ${m.label}${m.state ? ' (' + m.state + ')' : ''}${m.due ? ' — due ' + m.due : ''}`).join('\n'))

      const tasks = p.tasks || []
      const open = tasks.filter((x) => !x.done)
      const done = tasks.filter((x) => x.done)
      if (open.length) lines.push('\nOPEN TASKS:\n' + open.map((x) => {
        const st = x.waiting ? 'waiting on ' + x.waiting : x.taskStatus === 'now' ? 'now' : (x.next ? 'next' : '')
        const due = x.dueDate ? `${x.dueDate.y}-${x.dueDate.m + 1}-${x.dueDate.d}` : x.due
        return `- ${x.label}${st ? ' [' + st + ']' : ''}${due ? ' (due ' + due + ')' : ''}`
      }).join('\n'))
      if (done.length) lines.push(`(+${done.length} completed task${done.length === 1 ? '' : 's'})`)

      const seen = new Set()
      const docs = [...ownedNotes(projectId), ...linkedMeetings(projectId)].filter((n) => (seen.has(n.id) ? false : seen.add(n.id)))
      if (docs.length) lines.push('\nNOTES & MEETINGS IN THIS PROJECT:\n' + docs.map((n) => {
        const gist = n.summary || blocksToText(n.body || []).slice(0, 280)
        return `- [${n.kind}${n.date ? ', ' + n.date : ''}] ${n.title}${gist ? ': ' + gist.replace(/\s+/g, ' ').trim() : ''}`
      }).join('\n'))

      const arts = (p.artifacts || [])
      if (arts.length) lines.push('\nARTIFACTS:\n' + arts.map((a) => {
        const txt = (typeof a.body === 'string' ? a.body : blocksToText(a.body || [])).replace(/\s+/g, ' ').trim()
        const gist = txt.length > 1200 ? txt.slice(0, 1200) + '…' : txt
        return `- ${a.title || 'Untitled'} (${a.artType || 'artifact'})${gist ? ':\n  ' + gist : ''}`
      }).join('\n'))

      // Hosted files (screenshots / PDFs) — inline the markdown Claude already
      // extracted so Generate-with-AI + Ask + Gemini can "read" them as text.
      const files = assetsInProject(projectId).filter((a) => a.extractedMd && a.extractStatus === 'done')
      if (files.length) lines.push('\nATTACHED FILES (interpreted):\n' + files.map((a) => {
        const md = a.extractedMd.replace(/\s+$/g, '')
        const gist = md.length > 1800 ? md.slice(0, 1800) + '…' : md
        return `--- ${a.filename} (${a.kind}) ---\n${gist}`
      }).join('\n\n'))

      return lines.join('\n')
    }

    // Whole-pillar (area) digest — every project in the area at a summary level:
    // status/blurb, latest update, top open tasks, note/meeting titles. Bounded
    // (no note bodies) so a big pillar still fits. Used for DocChat area scope.
    const areaDigest = (areaId) => {
      const a = areaById(areaId)
      if (!a) return ''
      const lines = [`AREA / PILLAR: ${a.name} — ${(a.projects || []).length} project${(a.projects || []).length === 1 ? '' : 's'}`]
      for (const p of (a.projects || [])) {
        const seg = [`\n### ${p.name}${p.status ? ' (' + p.status + ')' : ''}${p.due ? ' · due ' + p.due : ''}`]
        if (p.blurb) seg.push(p.blurb)
        if (p.hold) seg.push(holdLine(p.hold))
        const latest = (p.updates || [])[0]
        if (latest) seg.push('Latest: ' + (latest.body || '').replace(/\s+/g, ' ').trim().slice(0, 240))
        const open = (p.tasks || []).filter((x) => !x.done).slice(0, 6)
        if (open.length) seg.push('Open tasks: ' + open.map((x) => x.label).join('; '))
        const docs = [...ownedNotes(p.id), ...linkedMeetings(p.id)]
        if (docs.length) seg.push('Docs: ' + docs.map((n) => n.title).slice(0, 12).join('; '))
        const arts = (p.artifacts || [])
        if (arts.length) seg.push('Artifacts:\n' + arts.slice(0, 8).map((x) => {
          const txt = (typeof x.body === 'string' ? x.body : blocksToText(x.body || [])).replace(/\s+/g, ' ').trim()
          const gist = txt.length > 400 ? txt.slice(0, 400) + '…' : txt
          return `- ${x.title || 'Untitled'}${gist ? ': ' + gist : ''}`
        }).join('\n'))
        const files = assetsInProject(p.id).filter((a) => a.extractedMd && a.extractStatus === 'done')
        if (files.length) seg.push('Files:\n' + files.slice(0, 6).map((a) => {
          const md = a.extractedMd.replace(/\s+/g, ' ').trim()
          const gist = md.length > 400 ? md.slice(0, 400) + '…' : md
          return `- ${a.filename}: ${gist}`
        }).join('\n'))
        lines.push(seg.join('\n'))
      }
      return lines.join('\n')
    }

    const notesByTag = (tag) => notes.filter((n) => (n.tags || []).includes(tag))
    const ALL_TAGS = [...new Set(notes.flatMap((n) => n.tags || []))].sort()

    // Global search across everything with a title (projects, tasks, docs).
    const globalSearch = (query, limit = 9) => {
      const q = (query || '').trim().toLowerCase()
      if (!q) return []
      const score = (text) => {
        const s = (text || '').toLowerCase(); const i = s.indexOf(q)
        if (i < 0) return -1
        return (i === 0 ? 0 : 100) + i + (/\b/.test(s[i - 1] || ' ') ? 0 : 30)
      }
      const out = []
      allProjects().forEach((p) => {
        const sc = score(p.name)
        if (sc >= 0) out.push({ type: 'project', id: p.id, title: p.name, area: p.area, sub: p.areaName, status: p.status, _s: sc })
        ;(p.tasks || []).forEach((tsk) => {
          const ts = score(tsk.label)
          if (ts >= 0) out.push({ type: 'task', id: tsk.id, projectId: p.id, title: tsk.label, sub: p.name,
            area: p.area, done: !!tsk.done, next: !!tsk.next, waiting: tsk.waiting, due: tsk.due, _s: ts + 5 })
        })
      })
      notes.forEach((n) => {
        const sc = score(n.title)
        if (sc >= 0) out.push({ type: 'doc', id: n.id, kind: n.kind, title: n.title,
          sub: (n.project ? (projectName(n.project) || '') : (n.area ? '' : 'Unfiled')), area: n.area, date: n.date, _s: sc + 2 })
      })
      out.sort((a, b) => a._s - b._s)
      return out.slice(0, limit)
    }

    return {
      areas, notes, inbox, assets, series, status, error, reload, recordUndo, canUndo,
      allProjects, looseTasks, looseTasksInArea, projectById, areaById, noteById, artifactById, noteByTitle, projectName, areaName, areaOfProject,
      ownedNotes, linkedMeetings, notesInArea, actionsForProject, notesByTag, ALL_TAGS, globalSearch, projectDigest, areaDigest,
      assetsForProject, assetsForNote, assetsInProject,
      seriesById, activeSeries, instancesForSeries, openThreadsForSeries,
    }
  }, [areas, notes, inbox, assets, series, status, error, canUndo])

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}
