// Project detail — THE home surface (Direction B), rebuilt around Cal Newport's
// pull method. Three regions in one column: the task pull board (Now / Backlog
// lanes, drag + tap, long-press → TaskSheet), one open Capture input (classifies
// after submit into Meeting / Note / File, ambiguous → inbox), and one filterable
// Library (Meeting / File / Note; Claude deliverables show as File). Right rail =
// scoped Ask · Related. Meeting extraction feeds Backlog directly (no holding
// pen). Every mutation is a real db write followed by reload(); React state stays
// the source of truth for lane + ordering.
import { Fragment, useEffect, useState, useRef } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import {
  Icon, Btn, IconBtn, StatusPill, Priority, AreaDot, Card, Label,
  Popover, PopRow, STATUS, statusSkin, areaColor, KIND, DatePill, fmtDate, TODAY, usePersisted,
} from '../kit'

import { handleTablePaste } from '../lib/tablePaste'
import { composeDeliverable, updateGuide, synthesizeMeeting } from '../lib/ai'
import { composePrompt, openInClaude } from '../lib/claudeBridge'
import { claudeCost } from '../lib/claude'

// "~$0.04" style rough cost from a usage record (null/0 → '')
const usdRough = (usage) => { const c = claudeCost(usage); return c ? `~$${c < 0.01 ? c.toFixed(3) : c.toFixed(2)}` : '' }
import { COMPOSE_TYPES } from '../data'
import {
  updateTask, reorderTasks,
  createUpdate, createArtifact, deleteArtifact, updateProject, createArea, updateNote, createNote, createInbox, deleteNote,
} from '../lib/db'
import { TaskSheet, useLongPress } from './TaskSheet'
import { HoldSheet } from './HoldSheet'
import { handleCsvPaste } from '../lib/tablePaste'
import { uploadAsset, signedUrl } from '../lib/assets'

// ── relative-ish time from an ISO/at string ─────────────────────
function timeAgo(at) {
  if (!at) return 'just now'
  const ts = typeof at === 'number' ? at : Date.parse(at)
  if (!ts || Number.isNaN(ts)) return typeof at === 'string' ? at : 'just now'
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 50) return 'just now'
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago'
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago'
  const d = Math.round(h / 24); if (d < 7) return d + 'd ago'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Section header (label · optional action · optional + add) ────
function SectionHead({ label, action, onAction, onAdd, collapsible, collapsed, onToggle }) {
  const { t, f } = useApp()
  const head = collapsible
    ? <span onClick={onToggle} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <Icon n={collapsed ? 'chevron-right' : 'chevron-down'} s={14} c={t.t3} /><Label style={{ whiteSpace: 'nowrap' }}>{label}</Label></span>
    : <Label style={{ whiteSpace: 'nowrap' }}>{label}</Label>
  return <div style={{ display: 'flex', alignItems: 'center', marginBottom: 11, gap: 10 }}>
    {head}
    <div style={{ flex: 1 }} />
    {action && <span onClick={onAction} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: f.ui, fontSize: 12, fontWeight: 500, color: t.accent, cursor: 'pointer' }}>{action}</span>}
    {onAdd && <button onClick={onAdd} title="Add to this project" style={{ width: 24, height: 24, borderRadius: 7,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', border: '1px solid ' + t.line2,
      background: 'transparent', color: t.t2, cursor: 'pointer', transition: 'border-color .14s, color .14s, background .14s' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.color = t.accent; e.currentTarget.style.background = t.accentBg }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.line2; e.currentTarget.style.color = t.t2; e.currentTarget.style.background = 'transparent' }}>
      <Icon n="plus" s={14} /></button>}
  </div>
}

// ── Header ───────────────────────────────────────────────────────
function ProjectHeader({ project, reload }) {
  const { t, f, go } = useApp()
  const { areas } = useData()
  const [open, setOpen] = useState(false)
  const [areaOpen, setAreaOpen] = useState(false)
  const [holdOpen, setHoldOpen] = useState(false)
  const [newPillar, setNewPillar] = useState(null) // null = closed, '' = typing
  const [editTitle, setEditTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const beginTitle = () => { setDraftTitle(project.name); setEditTitle(true) }
  const saveTitle = async () => {
    const v = draftTitle.trim(); setEditTitle(false)
    if (!v || v === project.name) return
    await updateProject(project.id, { name: v }); await reload()
  }
  const setStatus = async (k) => {
    setOpen(false)
    if (k === project.status) return
    // Putting on hold is a gated flow, not a bare label flip — collect a reason
    // + resurface date first (HoldSheet), then write status + hold together.
    if (k === 'on-hold') { setHoldOpen(true); return }
    // Leaving hold clears the hold payload so a stale reason/date can't linger.
    const patch = project.hold ? { status: k, hold: null } : { status: k }
    await updateProject(project.id, patch); await reload()
  }
  const commitHold = async ({ reason, resurfaceOn, setAt }) => {
    await updateProject(project.id, { status: 'on-hold', hold: { reason, resurfaceOn, setAt } })
    await createUpdate(project.id, `On hold — ${reason}${resurfaceOn ? ` · resurface ${fmtDate(resurfaceOn)}` : ''}`)
    await reload()
  }
  const setDue = async (d) => { await updateProject(project.id, { due: d || null }); await reload() }
  const reassignArea = async (areaId) => {
    setAreaOpen(false); setNewPillar(null)
    if (areaId === project.area) return
    await updateProject(project.id, { areaId }); await reload()
  }
  const createPillar = async () => {
    const nm = (newPillar || '').trim(); setNewPillar(null)
    if (!nm) return
    const id = await createArea(nm, areas.length)
    await updateProject(project.id, { areaId: id }); await reload()
  }
  return <div>
    <div style={{ position: 'relative', display: 'inline-flex', marginBottom: 10 }}>
      <div onClick={() => setAreaOpen((o) => !o)} title="Change pillar" style={{ display: 'inline-flex', alignItems: 'center',
        gap: 5, fontFamily: f.ui, fontSize: 12, fontWeight: 600, color: areaOpen ? t.t1 : t.t3, cursor: 'pointer',
        background: areaOpen ? t.sel : 'transparent', borderRadius: 7, padding: '4px 8px' }}
        onMouseEnter={(e) => { if (!areaOpen) e.currentTarget.style.color = t.t2 }}
        onMouseLeave={(e) => { if (!areaOpen) e.currentTarget.style.color = t.t3 }}>
        <Icon n="folder" s={13} /><span>{project.areaName || 'Unfiled'}</span><Icon n="chevron-down" s={12} /></div>
      {areaOpen && <Popover onClose={() => { setAreaOpen(false); setNewPillar(null) }} width={232} maxHeight={320}>
        <div style={{ fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing,
          textTransform: 'uppercase', color: t.t3, padding: '4px 10px 6px' }}>Move to pillar</div>
        {areas.map((a) => <PopRow key={a.id} icon={a.id === project.area ? 'check' : 'folder'} label={a.name}
          hint={(a.projects.length || 0) + ''} on={a.id === project.area} onClick={() => reassignArea(a.id)} />)}
        <div style={{ height: 1, background: t.line, margin: '6px 4px' }} />
        {newPillar == null
          ? <PopRow icon="plus" label="New pillar…" onClick={() => setNewPillar('')} />
          : <div style={{ padding: '4px 8px 6px' }}>
              <input autoFocus value={newPillar} onChange={(e) => setNewPillar(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createPillar(); if (e.key === 'Escape') setNewPillar(null) }}
                onBlur={createPillar} placeholder="New pillar name…"
                style={{ width: '100%', border: '1px solid ' + t.line2, borderRadius: 7, outline: 0, background: t.card,
                  fontFamily: f.ui, fontSize: 12.5, color: t.t1, padding: '6px 9px' }} /></div>}
        <div style={{ height: 1, background: t.line, margin: '6px 4px' }} />
        <PopRow icon="arrow-up-right" label={'Open ' + (project.areaName || 'pillar')} onClick={() => { setAreaOpen(false); go({ screen: 'area', id: project.area }) }} />
      </Popover>}
    </div>

    {editTitle
      ? <input autoFocus value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditTitle(false) }}
          className="selectable" style={{ width: '100%', border: 0, borderBottom: '2px solid ' + t.accentLine, outline: 0,
            background: 'transparent', fontFamily: f.title, fontSize: 30, fontWeight: f.titleW, letterSpacing: f.titleSpacing,
            color: t.t1, lineHeight: 1.1, padding: '0 0 2px' }} />
      : <div onClick={beginTitle} title="Click to rename" style={{ fontFamily: f.title, fontSize: 30, fontWeight: f.titleW,
          letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.1, textWrap: 'pretty', cursor: 'text', borderRadius: 6 }}>{project.name}</div>}

    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
      <span style={{ position: 'relative' }}>
        <StatusPill id={project.status} open={open} onClick={() => setOpen((o) => !o)} />
        {open && <Popover onClose={() => setOpen(false)} width={210}>
          {Object.keys(STATUS).map((k) => <PopRow key={k} dot={statusSkin(t, k).dot} label={STATUS[k].label}
            hint={STATUS[k].hint} on={project.status === k} onClick={() => setStatus(k)} />)}
        </Popover>}
      </span>
      {project.priority ? <Priority level={project.priority} /> : null}
      <DatePill value={project.due || null} onChange={setDue} label="Due" empty="+ Due date" />
    </div>
    {holdOpen && <HoldSheet project={project} onConfirm={commitHold} onClose={() => setHoldOpen(false)} />}
  </div>
}


// ── A single task row — tap toggles done, hold opens TaskSheet, ──
//    grip handle is the only draggable affordance. On the pull board it also
//    carries a quiet lane-move button (↑ Now / ↓ Backlog) so the board is usable
//    by tap on a phone, where HTML5 drag doesn't fire.
function TaskRow({ x, onToggle, onOpen, onDragStart, onDragOver, onDrop, onDragEnd, dragging, noDrag, onLane, laneUp, onDismiss }) {
  const { t, f, go } = useApp()
  const { noteById } = useData()
  const { pressing, handlers } = useLongPress(() => onOpen(x.id), () => onToggle(x.id), 450)
  const [grip, setGrip] = useState(false)
  const due = x.dueDate ? fmtDate(x.dueDate) : x.due
  const srcMeeting = x.srcMeeting ? noteById(x.srcMeeting) : null
  const dragProps = noDrag ? {} : {
    draggable: grip,
    onDragStart: (e) => onDragStart(e, x.id),
    onDragOver: (e) => onDragOver(e, x.id),
    onDrop: (e) => onDrop(e, x.id),
    onDragEnd,
  }
  return <div {...handlers} {...dragProps}
    className="task-row" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px 11px 8px',
      borderRadius: 10, cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation',
      position: 'relative', overflow: 'hidden', background: t.card, opacity: dragging ? 0.4 : noDrag ? 0.72 : 1,
      border: '1px solid ' + (pressing ? t.line2 : t.line),
      transform: pressing ? 'scale(0.99)' : 'scale(1)', transition: 'border-color .2s, transform .2s, opacity .15s' }}>
    {pressing && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', transformOrigin: 'left',
      background: t.accentBg, animation: 'taskHold 0.45s linear forwards', pointerEvents: 'none' }} />}
    {noDrag
      ? <span style={{ width: 16, flex: 'none' }} />
      : <span className="task-grip" onClick={(e) => e.stopPropagation()} title="Drag to reorder"
          onMouseEnter={() => setGrip(true)} onMouseLeave={() => setGrip(false)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, flex: 'none', zIndex: 1, cursor: 'grab' }}>
          <Icon n="grip-vertical" s={15} c={t.t3} /></span>}
    <span style={{ width: 17, height: 17, borderRadius: 5, flex: 'none', position: 'relative', zIndex: 1,
      border: '1.5px solid ' + (x.done ? t.accent : t.t3), background: x.done ? t.accent : 'transparent' }}>
      {x.done && <Icon n="check" s={12} c={t.onAccent} style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}</span>
    <span style={{ flex: 1, minWidth: 0, zIndex: 1, fontFamily: f.body, fontSize: 14.5, color: x.done ? t.t3 : t.t1,
      textDecoration: x.done ? 'line-through' : 'none' }}>{x.label}</span>
    {x.priority && !x.done && <span style={{ zIndex: 1, display: 'inline-flex' }}><Priority level={x.priority} /></span>}
    {x.waiting && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, zIndex: 1, fontFamily: f.ui, fontSize: 11,
      fontWeight: 600, color: t.t2, background: t.tagBg, borderRadius: 6, padding: '2px 8px' }}>
      <Icon n="player-pause" s={11} />{x.waiting}</span>}
    {due && <span style={{ fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.risk, zIndex: 1, fontVariantNumeric: 'tabular-nums' }}>{due}</span>}
    {x.next && !x.done && <span style={{ fontFamily: f.label, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', zIndex: 1,
      textTransform: 'uppercase', color: t.accent }}>Next</span>}
    {x.srcMeeting && !x.done && <span onClick={(e) => { e.stopPropagation(); if (srcMeeting) go({ screen: 'note', id: x.srcMeeting }) }}
      title={srcMeeting ? 'From meeting: ' + srcMeeting.title : 'From a meeting'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', zIndex: 1, cursor: srcMeeting ? 'pointer' : 'default',
        fontFamily: f.ui, fontSize: 10.5, fontWeight: 600, color: t.t3, background: t.tagBg, borderRadius: 6, padding: '2px 7px', maxWidth: 130 }}>
      <Icon n="users" s={11} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>meeting</span></span>}
    {onLane && !x.done && <button onClick={(e) => { e.stopPropagation(); onLane(x.id) }}
      title={laneUp ? 'Pull into Now' : 'Send to Backlog'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
      flex: 'none', zIndex: 1, fontFamily: f.ui, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
      color: laneUp ? t.accent : t.t3, background: 'transparent', border: '1px solid ' + (laneUp ? t.accentLine : t.line2),
      borderRadius: 7, padding: '3px 8px', transition: 'border-color .14s, color .14s, background .14s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = laneUp ? t.accentBg : t.sel }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
      <Icon n={laneUp ? 'arrow-up' : 'arrow-down'} s={12} />{laneUp ? 'Now' : 'Backlog'}</button>}
    {onDismiss && !x.done && <button onClick={(e) => { e.stopPropagation(); onDismiss(x.id) }} title="Dismiss this task"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', zIndex: 1, width: 24, height: 24,
        borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: t.t3, cursor: 'pointer', transition: 'background .14s, color .14s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.riskBg; e.currentTarget.style.color = t.risk }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.t3 }}>
      <Icon n="x" s={14} /></button>}
  </div>
}

// ── Task pull board — Now / Backlog lanes (Cal Newport pull, one level down
//    from the project-level pull). Lane lives in task_status ('now' = Now lane,
//    anything else open = Backlog); intra-lane order is `sort`. Drag between and
//    within lanes, or tap ↑ Now / ↓ Backlog (phone-friendly). Now is soft-WIP-
//    capped: over the line flags red, never blocks. Existing open tasks are
//    Backlog by default (nothing is 'now'), so no migration write is needed.
const isNow = (x) => x.taskStatus === 'now'
const isScheduled = (x) => x.workType === 'scheduled' // parked for a meeting → hidden from the board
function Tasks({ project, reload }) {
  const { t, f } = useApp()
  const { recordUndo, patchTask, addTask, removeTask } = useData()
  const [nowCap, setNowCap] = usePersisted('course.nowCap', 3)
  // React owns lane order; re-seed whenever the persisted tasks change — keyed on
  // the mutable fields too, not just ids, so a sheet edit (due/status/lane) shows
  // live without a refresh. (Drag preview is safe: project.tasks only changes on drop.)
  const tasksSig = (project.tasks || []).map((x) => {
    const d = x.dueDate ? `${x.dueDate.y}-${x.dueDate.m}-${x.dueDate.d}` : (x.due || '')
    return `${x.id}:${x.done ? 1 : 0}:${x.next ? 1 : 0}:${x.taskStatus || ''}:${d}:${x.workType || ''}:${x.priority || ''}:${x.waiting || ''}:${x.label}:${x.notes || ''}:${x.project || ''}`
  }).join('|')
  const [nowList, setNowList] = useState([])
  const [backlog, setBacklog] = useState([])
  // Mirror the live lane split in a ref so the drop handler persists the final
  // order synchronously — React state closures aren't flushed yet when a native
  // drag ends, and a cross-lane drag unmounts the row (so its dragend may never
  // fire). The ref is the source of truth for persist(); state is just render.
  const listRef = useRef({ now: [], back: [] })
  const finalizing = useRef(false)
  useEffect(() => {
    const open = (project.tasks || []).filter((x) => !x.done && !isScheduled(x)) // scheduled tasks park in their own section
    // Priority drives placement: P1 → Now; Backlog is banded P2 → P3 → the rest.
    // Within a band, keep the stored drag order (stable sort over the db order),
    // so manual reordering still holds inside a priority tier.
    const nw = open.filter((x) => x.priority === 1 || isNow(x))
    const band = (x) => (x.priority === 2 ? 0 : x.priority === 3 ? 1 : 2)
    const bk = open.filter((x) => !(x.priority === 1 || isNow(x)))
      .map((x, i) => [x, i]).sort((a, b) => band(a[0]) - band(b[0]) || a[1] - b[1]).map((p) => p[0])
    setNowList(nw); setBacklog(bk); listRef.current = { now: nw, back: bk }
  }, [tasksSig]) // eslint-disable-line react-hooks/exhaustive-deps

  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [sheetTask, setSheetTask] = useState(null)
  const [drag, setDrag] = useState(null) // { id, from: 'now' | 'backlog' }
  const [showDone, setShowDone] = useState(false)
  const [showScheduled, setShowScheduled] = useState(false)

  const allOpen = [...nowList, ...backlog]
  const findTask = (id) => allOpen.find((o) => o.id === id) || (project.tasks || []).find((o) => o.id === id) || null

  const toggle = async (id) => {
    const x = findTask(id); if (!x) return
    const prevDone = x.done
    if (isNow(x)) setNowList((l) => l.filter((o) => o.id !== id)) // optimistic: completing clears the lane
    else setBacklog((l) => l.filter((o) => o.id !== id))
    await patchTask(id, { done: !prevDone })
    recordUndo(async () => { await patchTask(id, { done: prevDone }) })
  }
  // P1 also pulls the task into Now (its priority means "now"). The rest of the
  // priority-driven placement (P2 top of Backlog, P3 under the last P2) is done
  // durably by the seed sort below, so it holds no matter where priority was set.
  const patch = async (id, p) => {
    const cur = findTask(id)
    const p2 = 'priority' in p && p.priority === 1 ? { ...p, taskStatus: 'now', next: false, waiting: null } : p
    const inverse = cur ? Object.fromEntries(Object.keys(p2).map((k) => [k, cur[k] ?? null])) : null
    await patchTask(id, p2)
    if (inverse) recordUndo(async () => { await patchTask(id, inverse) })
  }
  const remove = async (id) => {
    const prev = findTask(id)
    setSheetTask(null); await removeTask(id)
    if (prev) recordUndo(async () => { await addTask(prev.project || project.id, prev) })
  }
  const reassign = async (target) => {
    if (!sheetTask || !target) return
    const id = sheetTask.id
    const prevProject = sheetTask.project || project.id, prevArea = sheetTask.area || null
    if (target.project && target.project === prevProject) return
    if (target.area && target.area === prevArea && !sheetTask.project) return
    setSheetTask(null)
    await updateTask(id, target.area ? { project: null, area: target.area } : { project: target.project, area: null })
    await reload()
    recordUndo(async () => { await updateTask(id, { project: prevProject, area: prevArea }); await reload() })
  }
  const commit = async () => {
    const v = text.trim(); setText(''); setAdding(false)
    if (!v) return
    // New tasks land in Backlog (the user pulls a few up), at the end.
    await addTask(project.id, { label: v, taskStatus: 'backlog', sort: (project.tasks || []).length })
  }

  // Persist the current lane split + intra-lane order. Only lane-changed tasks
  // get a task_status write; sort is rewritten for the whole project (Now first,
  // then Backlog, then the untouched done tasks) so both orderings survive reload.
  const persist = async () => {
    const nowIds = listRef.current.now.map((o) => o.id), backIds = listRef.current.back.map((o) => o.id)
    const wasNow = new Set((project.tasks || []).filter((x) => !x.done && isNow(x)).map((x) => x.id))
    const origNow = [...wasNow], origBack = (project.tasks || []).filter((x) => !x.done && !isNow(x)).map((x) => x.id)
    const orderSame = nowIds.join(',') === origNow.join(',') && backIds.join(',') === origBack.join(',')
    if (orderSame) return
    const changes = []
    nowIds.forEach((id) => { if (!wasNow.has(id)) changes.push(updateTask(id, { taskStatus: 'now', next: false, waiting: null })) })
    backIds.forEach((id) => { if (wasNow.has(id)) changes.push(updateTask(id, { taskStatus: 'backlog' })) })
    if (changes.length) await Promise.all(changes)
    const doneIds = (project.tasks || []).filter((x) => x.done).map((x) => x.id)
    await reorderTasks([...nowIds, ...backIds, ...doneIds])
    await reload()
  }

  // Tap affordance: move one task across lanes (phone-friendly; drag is the enhancement).
  const moveLane = async (id, toLane) => {
    const src = toLane === 'now' ? backlog : nowList
    const item = src.find((o) => o.id === id); if (!item) return
    if (toLane === 'now') { setBacklog((l) => l.filter((o) => o.id !== id)); setNowList((l) => [...l, item]) }
    else { setNowList((l) => l.filter((o) => o.id !== id)); setBacklog((l) => [item, ...l]) }
    await updateTask(id, toLane === 'now' ? { taskStatus: 'now', next: false, waiting: null } : { taskStatus: 'backlog' })
    const nowIds = (toLane === 'now' ? [...nowList.map((o) => o.id), id] : nowList.filter((o) => o.id !== id).map((o) => o.id))
    const backIds = (toLane === 'now' ? backlog.filter((o) => o.id !== id).map((o) => o.id) : [id, ...backlog.map((o) => o.id)])
    const doneIds = (project.tasks || []).filter((x) => x.done).map((x) => x.id)
    await reorderTasks([...nowIds, ...backIds, ...doneIds]); await reload()
  }

  // HTML5 drag, handle-gated. Moves within and across the two lanes.
  const onDragStart = (from) => (e, id) => { setDrag({ id, from }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id) } catch {} }
  const moveInto = (toLane, toIndex) => {
    if (!drag) return
    const item = (drag.from === 'now' ? nowList : backlog).find((o) => o.id === drag.id)
    if (!item) return
    const nl = nowList.filter((o) => o.id !== drag.id)
    const bl = backlog.filter((o) => o.id !== drag.id)
    const target = toLane === 'now' ? nl : bl
    const idx = toIndex == null ? target.length : Math.max(0, Math.min(toIndex, target.length))
    target.splice(idx, 0, item)
    setNowList(nl); setBacklog(bl); listRef.current = { now: nl, back: bl }
    if (drag.from !== toLane) setDrag({ id: drag.id, from: toLane })
  }
  const onRowOver = (lane) => (e, overId) => {
    e.preventDefault()
    if (!drag || overId === drag.id) return
    const list = lane === 'now' ? nowList : backlog
    const idx = list.findIndex((o) => o.id === overId)
    if (idx < 0) return
    moveInto(lane, idx)
  }
  const onLaneOver = (lane) => (e) => { e.preventDefault(); if (drag) moveInto(lane, null) }
  // Commit on drop (fires reliably on the drop target even when the source row
  // unmounted mid-drag) and again on dragend as a fallback; the guard makes the
  // second a no-op. persist() reads listRef, so order is already flushed.
  const finalize = async () => {
    if (finalizing.current) return
    finalizing.current = true
    setDrag(null)
    try { await persist() } finally { finalizing.current = false }
  }
  const onDrop = (e) => { e.preventDefault(); finalize() }
  const onDragEnd = () => { finalize() }

  const laneHandlers = (lane) => ({ onDragStart: onDragStart(lane), onDragOver: onRowOver(lane), onDrop, onDragEnd })
  const doneTasks = (project.tasks || []).filter((x) => x.done)
  const scheduledTasks = (project.tasks || []).filter((x) => !x.done && isScheduled(x))
  const over = nowList.length > nowCap
  const nowH = laneHandlers('now'), backH = laneHandlers('back')

  return <div>
    {/* Now lane */}
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 11, gap: 10 }}>
      <Label style={{ whiteSpace: 'nowrap' }}>Now</Label>
      <span style={{ fontFamily: f.ui, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        color: over ? t.risk : t.t3 }}>{nowList.length} of {nowCap} pulled</span>
      {over && <span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 600, color: t.risk, background: t.riskBg,
        border: '1px solid ' + t.riskLine, borderRadius: 6, padding: '1px 7px' }}>over your line</span>}
      <div style={{ flex: 1 }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <button onClick={() => setNowCap((c) => Math.max(1, c - 1))} title="Lower the Now limit" style={stepBtn(t)}><Icon n="minus" s={13} /></button>
        <button onClick={() => setNowCap((c) => c + 1)} title="Raise the Now limit" style={stepBtn(t)}><Icon n="plus" s={13} /></button>
      </span>
    </div>
    <div onDragOver={onLaneOver('now')} onDrop={onDrop} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
      {nowList.map((x) => <TaskRow key={x.id} x={x} onToggle={toggle} onOpen={(id) => setSheetTask(findTask(id))}
        {...nowH} dragging={drag?.id === x.id} onLane={(id) => moveLane(id, 'back')} laneUp={false} />)}
      {nowList.length < nowCap && <div onDragOver={onLaneOver('now')} onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 10,
        border: '1.5px dashed ' + t.line2, fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>
        <Icon n="arrow-up" s={14} c={t.t3} />
        <span>Slot open. Pull a task up from Backlog, or tap ↑ Now on one below.</span></div>}
    </div>

    {/* Backlog lane */}
    <div style={{ marginTop: 20 }}>
      <SectionHead label={`Backlog · ${backlog.length}`} action="Drag or tap ↑ Now · hold for details" />
      <div onDragOver={onLaneOver('back')} onDrop={onDrop} style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 8 }}>
        {backlog.map((x) => <TaskRow key={x.id} x={x} onToggle={toggle} onOpen={(id) => setSheetTask(findTask(id))}
          {...backH} dragging={drag?.id === x.id} onLane={(id) => moveLane(id, 'now')} laneUp onDismiss={remove} />)}
      </div>
      <div style={{ marginTop: 6 }}>
        {adding ? <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderRadius: 10,
          border: '1px solid ' + t.line2, background: t.card }}>
          <span style={{ width: 17, height: 17, borderRadius: 5, border: '1.5px dashed ' + t.t3, flex: 'none' }} />
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(''); setAdding(false) } }}
            placeholder="New task…" style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: f.body, fontSize: 14.5, color: t.t1 }} />
        </div> : <div onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 11,
          padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: f.ui, fontSize: 13, color: t.t3 }}
          onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <span style={{ width: 17, height: 17, borderRadius: 5, border: '1.5px dashed ' + t.t3, flex: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon n="plus" s={11} /></span>
          <span style={{ whiteSpace: 'nowrap' }}>New task</span></div>}
      </div>
    </div>

    {scheduledTasks.length > 0 && <div style={{ marginTop: 14 }}>
      <div onClick={() => setShowScheduled((s) => !s)} style={{ display: 'flex', alignItems: 'center', gap: 7,
        fontFamily: f.ui, fontSize: 12, fontWeight: 600, color: t.t3, cursor: 'pointer', padding: '6px 8px', borderRadius: 8 }}
        onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon n={showScheduled ? 'chevron-down' : 'chevron-right'} s={13} c={t.t3} />
        <Icon n="calendar-event" s={14} c={t.t3} />
        <span style={{ flex: 1 }}>Scheduled</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{scheduledTasks.length}</span>
      </div>
      {showScheduled && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        {scheduledTasks.map((x) => <TaskRow key={x.id} x={x} noDrag onToggle={toggle} onOpen={(id) => setSheetTask(findTask(id))} />)}
      </div>}
    </div>}

    {doneTasks.length > 0 && <div style={{ marginTop: 14 }}>
      <div onClick={() => setShowDone((s) => !s)} style={{ display: 'flex', alignItems: 'center', gap: 7,
        fontFamily: f.ui, fontSize: 12, fontWeight: 600, color: t.t3, cursor: 'pointer', padding: '6px 8px', borderRadius: 8 }}
        onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon n={showDone ? 'chevron-down' : 'chevron-right'} s={13} c={t.t3} />
        <Icon n="circle-check" s={14} c={t.t3} />
        <span style={{ flex: 1 }}>Complete</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{doneTasks.length}</span>
      </div>
      {showDone && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        {doneTasks.map((x) => <TaskRow key={x.id} x={x} noDrag onToggle={toggle} onOpen={(id) => setSheetTask(findTask(id))} />)}
      </div>}
    </div>}
    {sheetTask && (() => { const live = findTask(sheetTask.id) || sheetTask
      return <TaskSheet task={live} projectId={project.id}
        onPatch={(p) => patch(sheetTask.id, p)} onDelete={remove} onReassign={reassign} onClose={() => setSheetTask(null)} /> })()}
  </div>
}
// small square stepper button for the Now WIP cap
const stepBtn = (t) => ({ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
  flex: 'none', border: '1px solid ' + t.line2, background: 'transparent', color: t.t2, cursor: 'pointer' })

// ── Capture — one open input: paste a transcript, drop a file, or jot a note.
//    Classification happens after submit and never blocks. A transcript-shaped
//    or long entry becomes a Meeting (synthesized, its Nate-owned action items
//    flow into Backlog on reload); short text becomes a Note; a file becomes a
//    File; anything ambiguous is filed with a ? and dropped into the inbox to
//    resolve with one tap (reusing the existing inbox primitive).
// The kinds a pasted/typed capture can be. Ordered for the confirm bar. Only
// 'transcript' runs meeting synthesis; the rest file as notes (tagged with the
// type) so nothing gets wrongly turned into a meeting.
const CAP_TYPES = [
  ['note', 'Note', 'file-text'],
  ['update', 'Update', 'activity'],
  ['email', 'Email', 'mail'],
  ['teams', 'Teams', 'message-circle'],
  ['doc', 'Working doc', 'file-text'],
  ['table', 'Table', 'table'],
  ['transcript', 'Transcript', 'users'],
]
const CAP_LABEL = Object.fromEntries(CAP_TYPES.map(([id, label]) => [id, label]))

// Guess what a capture is — biased AWAY from meeting. The user almost never
// pastes a real transcript here, so 'transcript' needs a strong multi-speaker
// signal, and even then the confirm bar lets them override before it files.
function classifyCapture(text, sawTable) {
  const s = (text || '').trim(); const lower = s.toLowerCase()
  if (sawTable || /(^|\n)\s*\|.*\|.*\|/.test(s)) return 'table'
  if (/(^|\n)\s*(from|to|cc|subject|sent):\s/i.test(s) || /\bon .+ wrote:\s*$/im.test(s)) return 'email'
  const chatLines = (s.match(/(^|\n)[A-Z][\w .'-]{1,28}\s+\d{1,2}:\d{2}\b/g) || []).length
  if (chatLines >= 2) return 'teams'
  const speakerTurns = (s.match(/(^|\n)\s*[A-Z][\w .'-]{1,28}:\s/g) || []).length
  if (speakerTurns >= 4) return 'transcript'
  if (/\b(update|status|fyi|heads[- ]up|shipped|blocked|in progress|next steps?|eta)\b/i.test(lower) && s.split(/\s+/).length <= 90) return 'update'
  return 'note'
}

// Turn capture text into note blocks, converting any GFM table region (Excel
// paste is normalized to one by handleTablePaste) into a { table: rows } block
// so it renders as a real table when the note is opened.
function textToBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []; let para = [], tbl = []
  const flushPara = () => { const p = para.join('\n').trim(); if (p) blocks.push({ p }); para = [] }
  const flushTbl = () => {
    if (tbl.length >= 2) {
      const rows = tbl
        .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/\\\|/g, '|').trim()))
        .filter((r, i) => !(i === 1 && r.every((c) => /^:?-{2,}:?$/.test(c)))) // drop |---| separator
      blocks.push({ table: rows })
    } else para.push(...tbl)
    tbl = []
  }
  const isTblRow = (l) => /^\s*\|.*\|\s*$/.test(l)
  for (const l of lines) {
    if (isTblRow(l)) { if (!tbl.length) flushPara(); tbl.push(l) }
    else { if (tbl.length) flushTbl(); para.push(l) }
  }
  flushTbl(); flushPara()
  return blocks.length ? blocks : [{ p: String(text || '').trim() }]
}
function Capture({ project, reload }) {
  const { t, f } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [status, setStatus] = useState(null)
  const [sawTable, setSawTable] = useState(false)
  const [pending, setPending] = useState(null) // confirm-type step: the guessed type id
  const fileRef = useRef(null)
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const flash = (m) => { setStatus(m); setTimeout(() => setStatus(null), 5000) }

  const doFiles = async (files) => {
    const list = Array.from(files || []); if (!list.length || busy) return
    setBusy(true); setStatus('Uploading…')
    try { for (const file of list) await uploadAsset(file, { projectId: project.id, onExtracted: reload }); await reload(); flash(list.length + ' file' + (list.length === 1 ? '' : 's') + ' added to the library.') }
    catch (e) { flash('Upload failed: ' + (e?.message || e)) } finally { setBusy(false) }
  }
  // Excel/Sheets paste → GFM markdown table in the box (so it reads as a table
  // and stores as one). Falls through to a normal paste otherwise.
  const onPaste = (e) => { if (handleTablePaste(e, text, setText)) setSawTable(true) }

  // Step 1: don't file blindly — classify and ask the user to confirm the type
  // (so a pasted email/update/table never gets auto-turned into a meeting).
  const submit = () => {
    const s = text.trim(); if (!s || busy) return
    setPending(classifyCapture(s, sawTable))
  }

  // Step 2: file it as the confirmed type. Only 'transcript' synthesizes a meeting.
  const fileAs = async (type) => {
    const s = text.trim(); if (!s || busy) return
    setBusy(true); setPending(null)
    try {
      if (type === 'transcript') {
        setStatus('Reading the transcript and pulling action items…')
        let synth = {}
        try { synth = await synthesizeMeeting({ transcript: s }) } catch {}
        const ttl = (synth.title || s.split('\n')[0].slice(0, 60) || 'Meeting').trim()
        await createNote({ kind: 'meeting', title: ttl, project: project.id, area: project.area || null, date: today, updated: 'now', status: 2,
          transcript: s, summary: synth.summary || '', nextSteps: synth.nextSteps || null, tags: synth.tags || [],
          actions: (synth.actions || []).map((a) => ({ text: a.text, owner: a.owner || 'me', src: 'this meeting' })) })
        setText(''); setSawTable(false); await reload(); flash('Transcript synthesized. Any action items are landing in Backlog.')
      } else {
        const ttl = s.split('\n')[0].replace(/^\|/, '').replace(/\|.*$/, '').trim().slice(0, 60) || CAP_LABEL[type] || 'Note'
        await createNote({ kind: 'note', title: ttl, project: project.id, area: project.area || null, date: today, updated: 'now', status: 2, body: textToBlocks(s), tags: [type] })
        setText(''); setSawTable(false); await reload(); flash((CAP_LABEL[type] || 'Note') + ' saved to the library.')
      }
    } catch (e) { flash('Could not file that: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  return <div onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true) }} onDragLeave={() => setDrag(false)}
    onDrop={(e) => { e.preventDefault(); setDrag(false); doFiles(e.dataTransfer.files) }}
    style={{ border: '1px solid ' + (drag ? t.accent : t.line2), background: drag ? t.accentBg : t.card, borderRadius: 12, padding: 12, transition: 'border-color .14s, background .14s' }}>
    <textarea value={text} onChange={(e) => { setText(e.target.value); if (pending) setPending(null); if (!e.target.value.trim()) setSawTable(false) }} onPaste={onPaste}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
      placeholder="Throw something in: paste an email, Teams thread, a table, an update, or jot a note."
      style={{ width: '100%', minHeight: 66, border: 0, outline: 0, resize: 'vertical', background: 'transparent', fontFamily: f.body, fontSize: 14.5, lineHeight: 1.55, color: t.t1 }} />
    {pending && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 8, paddingTop: 10, borderTop: '1px solid ' + t.line }}>
      <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t2, marginRight: 2 }}>File as</span>
      {CAP_TYPES.map(([id, label, icon]) => { const on = pending === id
        return <span key={id} onClick={() => setPending(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
          fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: on ? t.onAccent : t.t2,
          background: on ? t.accent : t.sel, border: '1px solid ' + (on ? t.accent : 'transparent'), borderRadius: 8, padding: '5px 10px' }}>
          <Icon n={icon} s={12} />{label}</span> })}
      <div style={{ flex: 1 }} />
      <Btn kind="ghost" size="sm" onClick={() => setPending(null)}>Cancel</Btn>
      <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : (pending === 'transcript' ? 'wand' : 'corner-down-left')} onClick={busy ? undefined : () => fileAs(pending)}>{pending === 'transcript' ? 'Synthesize' : 'File as ' + CAP_LABEL[pending]}</Btn>
    </div>}
    <div style={{ display: pending ? 'none' : 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <button onClick={() => fileRef.current?.click()} title="Attach a file" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t2, background: 'transparent', border: '1px solid ' + t.line2, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
        <Icon n="paperclip" s={14} />Attach</button>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { doFiles(e.target.files); e.target.value = '' }} />
      <span style={{ flex: 1, minWidth: 0, fontFamily: f.ui, fontSize: 11, color: t.t3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status || 'Confirm the type before it files. ⌘↵'}</span>
      <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : 'corner-down-left'} onClick={busy ? undefined : submit}>Throw in</Btn>
    </div>
  </div>
}

// ── Library — one chronological stream of everything captured, filterable by
//    type. Replaces the old Meetings / Notes / Files / Artifacts sections. Type
//    is a filter, not a container. Claude-made deliverables appear as File
//    entries (no separate chip); tapping any row opens the full entry.
const shortDate = (at) => { const d = at ? new Date(at) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '' }
const LIB_TYPES = [['all', 'All'], ['meeting', 'Meeting'], ['file', 'File'], ['note', 'Note']]
const LIB_BADGE = { meeting: ['users', 'Meeting'], file: ['file-text', 'File'], note: ['file-text', 'Note'] }
function Library({ project, meetings, docNotes, reload }) {
  const { t, f, go } = useApp()
  const { assetsForProject } = useData()
  const [filter, setFilter] = useState('all')

  const remove = async (it, e) => {
    e.stopPropagation()
    if (!it.del || !window.confirm('Delete “' + it.title + '”? This can’t be undone.')) return
    try { await it.del(); if (reload) await reload() } catch (err) { window.alert('Could not delete: ' + (err?.message || err)) }
  }

  const noteTs = (n) => { const d = Date.parse(n.date || ''); return Number.isNaN(d) ? (Date.parse(n.updatedAt || '') || 0) : d }
  const items = []
  meetings.forEach((n) => items.push({ key: 'n' + n.id, type: 'meeting', title: n.title, ts: noteTs(n), dateLabel: n.date, sub: (n.people || []).join(', '), q: n.tags, onClick: () => go({ screen: 'note', id: n.id }), del: () => deleteNote(n.id) }))
  docNotes.forEach((n) => items.push({ key: 'n' + n.id, type: 'note', title: n.title, ts: noteTs(n), dateLabel: n.date, sub: (n.people || []).join(', '), q: n.tags, onClick: () => go({ screen: 'note', id: n.id }), del: () => deleteNote(n.id) }))
  ;(project.artifacts || []).forEach((a) => items.push({ key: 'a' + a.id, type: 'file', title: a.title || 'Untitled', ts: Date.parse(a.at) || 0, dateLabel: shortDate(a.at), sub: a.provenance || '', onClick: () => go({ screen: 'artifact', id: a.id }), del: () => deleteArtifact(a.id) }))
  assetsForProject(project.id).forEach((a) => items.push({ key: 'f' + a.id, type: 'file', title: a.filename, ts: Date.parse(a.at) || 0, dateLabel: shortDate(a.at), sub: a.kind, onClick: async () => { try { const u = await signedUrl(a.storagePath); if (u) window.open(u, '_blank') } catch {} } }))
  items.sort((x, y) => y.ts - x.ts)
  const counts = { all: items.length, meeting: 0, file: 0, note: 0 }
  items.forEach((i) => { counts[i.type] += 1 })
  const shown = filter === 'all' ? items : items.filter((i) => i.type === filter)

  return <div>
    <SectionHead label={`Library · ${items.length}`} />
    <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
      {LIB_TYPES.map(([id, label]) => {
        const on = filter === id; const n = counts[id]
        if (id !== 'all' && n === 0) return null
        return <span key={id} onClick={() => setFilter(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: on ? t.onAccent : t.t2,
          background: on ? t.accent : t.sel, border: '1px solid ' + (on ? t.accent : 'transparent'), borderRadius: 8, padding: '5px 11px' }}>
          {label}<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: on ? t.onAccent : t.t3 }}>{n}</span></span>
      })}
    </div>
    {shown.length ? <Card style={{ padding: 0, overflow: 'hidden' }}>
      {shown.map((it, i) => { const [icon, label] = LIB_BADGE[it.type]
        return <div key={it.key} onClick={it.onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
          cursor: 'pointer', borderTop: i ? '1px solid ' + t.line : 'none' }}
          onMouseEnter={(e) => e.currentTarget.style.background = t.sel} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon n={icon} s={16} c={t.t3} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2, fontFamily: f.ui, fontSize: 11, color: t.t3 }}>
              <span>{label}</span>
              {it.dateLabel && <><span style={{ opacity: 0.5 }}>·</span><span>{it.dateLabel}</span></>}
              {it.sub && <><span style={{ opacity: 0.5 }}>·</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sub}</span></>}
              {(it.q || []).includes('?') && <span title="Unsorted (resolve it in the inbox)" style={{ color: t.risk, fontWeight: 700 }}>?</span>}
            </div>
          </div>
          {it.del && <button onClick={(e) => remove(it, e)} title="Delete from library"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 26, height: 26,
              borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: t.t3, cursor: 'pointer', transition: 'background .14s, color .14s' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.riskBg; e.currentTarget.style.color = t.risk }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.t3 }}>
            <Icon n="trash-2" s={14} /></button>}
          <Icon n="chevron-right" s={15} c={t.t3} />
        </div> })}
    </Card> : <div style={{ fontFamily: f.body, fontSize: 13.5, color: t.t3, fontStyle: 'italic', padding: '6px 2px' }}>
      Nothing here yet. Throw something in above.</div>}
  </div>
}

// ── Artifacts — project deliverables + Claude composer ──────────
function Artifacts({ project, notes, meetings = [], reload, compact = false }) {
  const { t, f, go, aiName, mcpMode } = useApp()
  const { projectDigest, areaDigest } = useData()
  // Label for the generator: in MCP mode the work runs on claude.ai, not the engine.
  const genName = mcpMode ? 'Claude.ai' : aiName
  const rows = project.artifacts || []
  // Generation scope: 'project' (full project context) | 'pillar' (whole area).
  const hasPillar = !!project.area
  const [genScope, setGenScope] = useState('project')
  const [composing, setComposing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [mTitle, setMTitle] = useState('')
  const [mBody, setMBody] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [typeId, setTypeId] = useState(COMPOSE_TYPES[0].id)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [newId, setNewId] = useState(null)
  // update-doc form
  const [docSrc, setDocSrc] = useState('paste') // 'existing' | 'paste'
  const [docArtId, setDocArtId] = useState(rows[0]?.id || null)
  const [docTitle, setDocTitle] = useState('')
  const [docBody, setDocBody] = useState('')
  const [meetingId, setMeetingId] = useState(meetings[0]?.id || null)
  const [uInstr, setUInstr] = useState('')

  const runUpdate = async () => {
    const art = rows.find((r) => r.id === docArtId)
    const mtg = meetings.find((m) => m.id === meetingId)
    const dTitle = docSrc === 'existing' ? (art?.title || 'Document') : (docTitle.trim() || 'Document')
    const dBody = docSrc === 'existing' ? (art?.body || '') : docBody
    if (!dBody.trim() || !mtg) { setToast('Pick a document and a meeting.'); setTimeout(() => setToast(null), 3000); return }
    setUpdating(false); setBusy(true)
    try {
      const tx = mtg.transcript || [mtg.summary, (mtg.body || []).map((b) => b.p || (b.ul ? b.ul.join('; ') : (b.ol ? b.ol.join('; ') : ''))).join(' ')].filter(Boolean).join('\n')
      const noteText = (mtg.body || []).map((b) => b.p || (b.ul ? b.ul.map((i) => '- ' + i).join('\n') : (b.ol ? b.ol.map((i, k) => (k + 1) + '. ' + i).join('\n') : ''))).filter(Boolean).join('\n')
      const { guide, usage } = await updateGuide({ documentTitle: dTitle, document: dBody, meetingTitle: mtg.title, transcript: tx, notes: noteText, instructions: uInstr.trim() })
      const title = `Update guide — ${dTitle}`
      const cost = usdRough(usage)
      const id = await createArtifact(project.id, { title, artType: 'update-guide', body: guide, provenance: `✦ ${aiName} · update guide · from ${mtg.title}${cost ? ' · ' + cost : ''}` })
      await reload(); setUInstr(''); go({ screen: 'artifact', id })
      setTimeout(() => setToast(null), 4500); setTimeout(() => setNewId(null), 6000)
    } catch (e) { setToast('Couldn’t build guide — ' + String(e?.message || e)); setTimeout(() => setToast(null), 4500) }
    finally { setBusy(false) }
  }

  const addManual = async () => {
    const ttl = mTitle.trim() || 'Untitled'; const bod = mBody
    setAdding(false); setMTitle(''); setMBody('')
    try { const id = await createArtifact(project.id, { title: ttl, artType: 'file', body: bod, provenance: 'Added' }); await reload(); go({ screen: 'artifact', id }) }
    catch (e) { setToast('Couldn’t add — ' + String(e?.message || e)); setTimeout(() => setToast(null), 4000) }
  }
  const removeArtifact = async (id, title) => {
    if (!window.confirm(`Delete “${title || 'this artifact'}”?`)) return
    try { await deleteArtifact(id); await reload() } catch (e) { window.alert('Could not delete: ' + (e?.message || e)) }
  }
  const copyArtifact = (body) => { try { navigator.clipboard.writeText(body || '') } catch {} }

  const run = async () => {
    const type = COMPOSE_TYPES.find((c) => c.id === typeId) || COMPOSE_TYPES[0]
    const pillarScope = hasPillar && genScope === 'pillar'
    // MCP mode: hand off to claude.ai on the subscription. Claude reads the project
    // via the Course Plus connector and saves the artifact back with create_artifact
    // — nothing composed or billed here.
    if (mcpMode) {
      setComposing(false); setPrompt('')
      const opened = openInClaude(composePrompt({
        typeName: type.name, typeId, projectId: project.id, projectName: project.name,
        instructions: prompt.trim(), scope: pillarScope ? 'pillar' : 'project', areaName: project.areaName,
      }))
      setToast(opened ? 'Opened Claude.ai — it’ll save the ' + type.name.toLowerCase() + ' back here'
        : 'Prompt copied — popup blocked, paste it into claude.ai')
      setTimeout(() => setToast(null), 6000)
      return
    }
    setComposing(false); setBusy(true)
    try {
      let usage = null
      // Always give the model the full project picture. At pillar scope, append
      // the whole-area digest so it can reach across sibling projects.
      const pillar = hasPillar && genScope === 'pillar'
      const projCtx = projectDigest(project.id)
      const contextText = pillar ? `${projCtx}\n\n=== WIDER PILLAR ===\n${areaDigest(project.area)}` : projCtx
      const contextLabel = pillar ? (project.areaName || 'pillar') : project.name
      const body = await composeDeliverable(typeId, prompt.trim(), project.name, notes, {
        contextText, contextLabel, scope: pillar ? 'pillar' : 'project', onUsage: (u) => { usage = u },
      })
      const n = notes.length
      const title = `${project.name} — ${type.name}`
      const cost = usdRough(usage)
      const scopeTag = pillar ? `${project.areaName || 'pillar'} pillar` : 'project'
      const id = await createArtifact(project.id, {
        title, artType: typeId, body, provenance: `✦ ${aiName} · ${scopeTag} context · from ${n} notes${cost ? ' · ' + cost : ''}`, fromCount: n,
      })
      await reload(); setPrompt(''); go({ screen: 'artifact', id })
    } catch (e) {
      setToast('Couldn’t compose — ' + String(e?.message || e))
      setTimeout(() => setToast(null), 4500)
    } finally { setBusy(false) }
  }

  return <div style={{ position: 'relative' }}>
    <SectionHead label={compact ? 'Add to library' : (rows.length ? 'Artifacts · ' + rows.length : 'Artifacts')} />
    {!composing && !adding && !updating && !busy && <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
      <Btn kind="outline" size="sm" icon="plus" onClick={() => { setAdding(true); setComposing(false); setUpdating(false) }}>Add file</Btn>
      <Btn kind="outline" size="sm" icon="file-diff" onClick={() => { setUpdating(true); setAdding(false); setComposing(false); setDocArtId(rows[0]?.id || null); setMeetingId(meetings[0]?.id || null) }}>Update doc from meeting</Btn>
      <Btn kind="outline" size="sm" icon="sparkles" onClick={() => { setComposing(true); setAdding(false); setUpdating(false) }}>Generate with {genName}</Btn>
    </div>}

    {updating && <div style={{ background: t.card, border: '1px solid ' + t.accentLine, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon n="file-diff" s={14} c={t.accent} />
        <span style={{ fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent }}>Update doc from a meeting</span>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>{aiName} returns what to edit & where — not a rewrite</span>
      </div>
      {/* document source */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Document</span>
        {[['existing', 'Existing artifact'], ['paste', 'Paste']].map(([id, label]) => {
          const on = docSrc === id; const disabled = id === 'existing' && rows.length === 0
          return <span key={id} onClick={() => !disabled && setDocSrc(id)} style={{ fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, color: on ? t.onAccent : t.t2, background: on ? t.accent : t.sel, borderRadius: 7, padding: '4px 10px' }}>{label}</span>
        })}
      </div>
      {docSrc === 'existing'
        ? <select value={docArtId || ''} onChange={(e) => setDocArtId(e.target.value)} style={{ width: '100%', marginBottom: 8, border: '1px solid ' + t.line2, borderRadius: 8, background: t.bg, fontFamily: f.ui, fontSize: 13, color: t.t1, padding: '7px 9px' }}>
            {rows.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        : <>
            <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Document title…"
              style={{ width: '100%', marginBottom: 6, border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.bg, fontFamily: f.ui, fontSize: 13, color: t.t1, padding: '7px 9px' }} />
            <textarea value={docBody} onChange={(e) => setDocBody(e.target.value)} onPaste={(e) => handleCsvPaste(e, docBody, setDocBody)} placeholder="Paste the current document here…"
              style={{ width: '100%', minHeight: 110, marginBottom: 8, border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, resize: 'vertical', background: t.bg, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.5, color: t.t1, padding: '9px 11px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} />
          </>}
      {/* meeting source */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>From meeting</span>
        {meetings.length
          ? <select value={meetingId || ''} onChange={(e) => setMeetingId(e.target.value)} style={{ flex: 1, minWidth: 160, border: '1px solid ' + t.line2, borderRadius: 8, background: t.bg, fontFamily: f.ui, fontSize: 13, color: t.t1, padding: '7px 9px' }}>
              {meetings.map((m) => <option key={m.id} value={m.id}>{m.title}{m.transcript ? '' : ' (no transcript)'}</option>)}
            </select>
          : <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3 }}>No meetings on this project yet — add one first.</span>}
      </div>
      <textarea value={uInstr} onChange={(e) => setUInstr(e.target.value)} placeholder="Optional — extra instructions…"
        style={{ width: '100%', minHeight: 42, border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, resize: 'vertical', background: t.bg, fontFamily: f.body, fontSize: 13, color: t.t1, padding: '8px 10px' }} />
      <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
        <Btn kind="primary" size="sm" icon="file-diff" onClick={runUpdate}>Build edit guide</Btn>
        <Btn kind="ghost" size="sm" onClick={() => setUpdating(false)}>Cancel</Btn>
      </div>
    </div>}

    {adding && <div style={{ background: t.card, border: '1px solid ' + t.line2, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <input autoFocus value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="Title (e.g. Pricing CSV, Cover email)…"
        style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontFamily: f.title, fontSize: 17, fontWeight: f.titleW, color: t.t1, marginBottom: 8 }} />
      <textarea value={mBody} onChange={(e) => setMBody(e.target.value)} className="selectable"
        onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false) }}
        onPaste={(e) => handleCsvPaste(e, mBody, setMBody)}
        placeholder="Paste raw content — paste a table from Excel/Sheets and it becomes CSV. Stored verbatim."
        style={{ width: '100%', minHeight: 120, border: '1px solid ' + t.line2, borderRadius: 9, outline: 0, resize: 'vertical',
          background: t.bg, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.55, color: t.t1, padding: '9px 11px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} />
      <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
        <Btn kind="primary" size="sm" icon="check" onClick={addManual}>Add artifact</Btn>
        <Btn kind="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Btn>
      </div>
    </div>}

    {composing && <div style={{ background: t.card, border: '1px solid ' + t.accentLine, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <Icon n="sparkles" s={14} c={t.accent} />
        <span style={{ fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent }}>Ask {genName}</span>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>
          {genScope === 'pillar'
            ? `full context of this project + the whole ${project.areaName || 'pillar'} pillar`
            : `full context of this project — ${notes.length} note${notes.length === 1 ? '' : 's'}, status, tasks & milestones`}
        </span>
      </div>
      {/* Context scope — how far past this project the model may reach */}
      {hasPillar && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Context</span>
        {[['project', 'This project'], ['pillar', `Whole ${project.areaName || 'pillar'} pillar`]].map(([id, label]) => {
          const on = genScope === id
          return <span key={id} onClick={() => setGenScope(id)} title={id === 'pillar' ? 'Also feed every sibling project in the pillar (summary level)' : 'Everything in this project'}
            style={{ fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: on ? t.onAccent : t.t2,
              background: on ? t.accent : t.sel, borderRadius: 7, padding: '4px 10px' }}>{label}</span>
        })}
      </div>}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 9 }}>
        {COMPOSE_TYPES.map((c) => {
          const on = c.id === typeId
          return <span key={c.id} onClick={() => setTypeId(c.id)} title={c.desc} style={{ display: 'inline-flex', alignItems: 'center',
            gap: 6, fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: on ? t.onAccent : t.t2,
            background: on ? t.accent : t.sel, border: '1px solid ' + (on ? t.accent : 'transparent'),
            borderRadius: 8, padding: '6px 11px' }}><Icon n={c.icon} s={13} />{c.name}</span>
        })}
      </div>
      <textarea autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); if (e.key === 'Escape') setComposing(false) }}
        placeholder={typeId === 'csv' ? 'What columns do you want? Any extra instructions…' : `Optional — extra instructions for ${aiName}…`}
        style={{ width: '100%', minHeight: 54, border: '1px solid ' + t.line2, borderRadius: 9, outline: 0, resize: 'vertical',
          background: t.bg, fontFamily: f.body, fontSize: 13.5, lineHeight: 1.5, color: t.t1, padding: '9px 11px' }} />
      <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
        <Btn kind="primary" size="sm" icon="sparkles" onClick={run}>{mcpMode ? 'Generate in Claude.ai' : 'Generate'}</Btn>
        <Btn kind="ghost" size="sm" onClick={() => setComposing(false)}>Cancel</Btn>
      </div>
    </div>}

    {busy && <Card style={{ padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 13,
      borderColor: t.accentLine, background: t.accentBg }}>
      <Icon n="loader-2" s={20} c={t.accent} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 13, fontWeight: 600, color: t.t1 }}>{aiName} is working…</div>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 1 }}>{genScope === 'pillar' ? `Reading the whole ${project.areaName || 'pillar'} pillar` : `Reading all of ${project.name}`} · composing</div>
      </div>
    </Card>}

    {!compact && (rows.length ? <Card style={{ padding: '4px 0', overflow: 'hidden' }}>
      {rows.map((a, i) => {
        const isNew = a.id === newId
        const type = COMPOSE_TYPES.find((c) => c.id === a.artType)
        const icon = a.artType === 'update-guide' ? 'file-diff' : a.artType === 'file' ? 'file-text' : (type?.icon || 'file-export')
        return <div key={a.id} onClick={() => go({ screen: 'artifact', id: a.id })}
          className={isNew ? 'just-landed' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderTop: i ? '1px solid ' + t.line : 'none' }}
          onMouseEnter={(e) => { if (!isNew) e.currentTarget.style.background = t.sel }}
          onMouseLeave={(e) => { if (!isNew) e.currentTarget.style.background = 'transparent' }}>
          <Icon n={icon} s={16} c={t.accent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontFamily: f.ui, fontSize: 11, color: t.t3 }}>
              <span>{a.provenance || 'Composed'}</span>{a.at && <Fragment><span style={{ opacity: 0.5 }}>·</span><span>{timeAgo(a.at)}</span></Fragment>}
            </div>
          </div>
          {isNew && <span style={{ fontFamily: f.label, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.onAccent, background: t.accent, borderRadius: 6, padding: '2px 7px' }}>New</span>}
          <Icon n="chevron-right" s={15} c={t.t3} />
        </div>
      })}
    </Card> : !busy && <div onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
      borderRadius: 11, cursor: 'pointer', border: '1px dashed ' + t.line2, fontFamily: f.ui, fontSize: 13, color: t.t3 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.sel; e.currentTarget.style.color = t.t2 }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.t3 }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px dashed ' + t.t3, flex: 'none', display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}><Icon n="plus" s={12} /></span>No artifacts yet — add a file or generate one</div>)}

    {toast && <div style={{ position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 470, animation: 'toast-in .2s ease-out',
      display: 'flex', alignItems: 'center', gap: 10, background: t.card, border: '1px solid ' + t.accentLine,
      borderRadius: 12, boxShadow: t.shadow, padding: '11px 15px', maxWidth: '90vw' }}>
      <Icon n="sparkles" s={16} c={t.accent} />
      <span style={{ fontFamily: f.ui, fontSize: 13, color: t.t1 }}>{aiName} added <b style={{ fontWeight: 600 }}>{toast}</b> to Artifacts</span></div>}
  </div>
}

// ── Right rail: Scoped Ask ───────────────────────────────────────
function ScopedAsk({ project }) {
  const { t, f, go } = useApp()
  const [q, setQ] = useState('')
  const submit = (e) => {
    e.preventDefault()
    const query = q.trim(); if (!query) return
    // scope is the project NAME (Ask screen pools by name); project id passed too
    go({ screen: 'ask', query, project: project.id, scope: project.name })
  }
  return <Card style={{ padding: 14, background: t.panel }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
      <Icon n="sparkles" s={14} c={t.accent} />
      <span style={{ fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing,
        textTransform: 'uppercase', color: t.t3 }}>Ask within {project.name}</span>
    </div>
    <form onSubmit={submit} style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.card,
      border: '1px solid ' + t.line2, borderRadius: 9, padding: '0 11px', height: 38 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. what's blocking the close?"
        style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: f.ui, fontSize: 12.5, color: t.t1 }} />
      <button type="submit" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: t.accent, display: 'flex' }}>
        <Icon n="arrow-right" s={16} /></button>
    </form>
  </Card>
}

// ── Right rail: Related — reason-labelled neighbours ────────────
function Related({ project, owned, linked }) {
  const { t, f, go } = useApp()
  const { noteByTitle, allProjects } = useData()
  const seen = new Set(owned.map((n) => n.title))
  const rel = []
  owned.forEach((n) => (n.related || []).forEach((r) => {
    if (r && r.title && !seen.has(r.title) && !rel.find((x) => x.title === r.title)) {
      const target = noteByTitle(r.title)
      rel.push({ ...r, id: target ? target.id : null })
    }
  }))
  // fall back to sibling projects in the same area
  const siblings = allProjects().filter((p) => p.area === project.area && p.id !== project.id)

  if (!rel.length && !linked.length && !siblings.length) return null

  return <div>
    <SectionHead label="Related" />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {linked.map((n) => <div key={n.id} onClick={() => go({ screen: 'note', id: n.id })} style={{ display: 'flex',
        alignItems: 'flex-start', gap: 9, padding: '9px 10px', borderRadius: 9, cursor: 'pointer' }}
        onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon n="arrows-split" s={14} c={areaColor(t, n.area || project.area)} style={{ marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: f.body, fontSize: 13, color: t.t1, lineHeight: 1.35 }}>{n.title}</div>
          <div style={{ fontFamily: f.ui, fontSize: 10.5, color: t.t3, marginTop: 1 }}>cross-project meeting</div>
        </div></div>)}
      {rel.slice(0, 5).map((r, i) => <div key={'r' + i} onClick={() => r.id && go({ screen: 'note', id: r.id })}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px', borderRadius: 9, cursor: r.id ? 'pointer' : 'default' }}
        onMouseEnter={(e) => { if (r.id) e.currentTarget.style.background = t.sel }}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon n={(KIND[r.kind] || KIND.note).icon} s={14} c={t.t3} style={{ marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: f.body, fontSize: 13, color: t.t1, lineHeight: 1.35 }}>{r.title}</div>
          <div style={{ fontFamily: f.ui, fontSize: 10.5, color: t.t3, marginTop: 1 }}>{r.reason || 'related note'}</div>
        </div></div>)}
      {!rel.length && siblings.slice(0, 5).map((p) => <div key={p.id} onClick={() => go({ screen: 'project', id: p.id })}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px', borderRadius: 9, cursor: 'pointer' }}
        onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <AreaDot areaId={p.area} s={8} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: f.body, fontSize: 13, color: t.t1, lineHeight: 1.35 }}>{p.name}</div>
          <div style={{ fontFamily: f.ui, fontSize: 10.5, color: t.t3, marginTop: 1 }}>same area · {project.areaName}</div>
        </div></div>)}
    </div>
  </div>
}

// ── Screen ───────────────────────────────────────────────────────
export function ProjectScreen() {
  const { route, isMobile } = useApp()
  const { projectById, allProjects, ownedNotes, linkedMeetings, reload, assetsForProject } = useData()
  const project = projectById(route.id) || allProjects()[0]

  if (!project) return null

  const owned = ownedNotes(project.id)
  const linked = linkedMeetings(project.id)
  const genNotes = [...owned, ...linked]
  const meetings = [...owned.filter((n) => n.kind === 'meeting'), ...linked]
  const docNotes = owned.filter((n) => n.kind === 'note' || n.kind === 'knowledge' || n.kind === 'brainstorm')

  // Three regions, one scrolling column: the task pull board, one capture input,
  // and one filterable library. (Where-it-stands, milestones, the briefing block,
  // and the action-items holding pen were removed in the surface rebuild.)
  const main = <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
    <Tasks project={project} reload={reload} />
    <Capture project={project} reload={reload} />
    <Library project={project} meetings={meetings} docNotes={docNotes} reload={reload} />
    <Artifacts project={project} notes={genNotes} meetings={meetings} reload={reload} compact />
  </div>

  const rail = <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
    <ScopedAsk project={project} />
    <Related project={project} owned={owned} linked={linked} />
  </div>

  return <div style={{ maxWidth: 1080, margin: '0 auto', padding: isMobile ? '24px 16px 90px' : '30px 36px 90px' }}>
    <ProjectHeader project={project} reload={reload} />
    <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 36, marginTop: 28 }}>
      {main}
      <div style={{ marginTop: isMobile ? 26 : 0 }}>{rail}</div>
    </div>
  </div>
}
