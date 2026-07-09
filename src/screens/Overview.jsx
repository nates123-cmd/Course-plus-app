// Overview.jsx — the "Work" overview + per-Area screens (Direction B). Ported
// faithfully from the prototype's course-overview.jsx, rewired to the real data
// spine: useApp() for theme/route/nav, useData() for the area→project tree, and
// db.js for task writes. No window.* globals — everything is imported.
//
// Surface model: an "Open tasks" card rolls up each project's surfaced actions
// (its `next` task plus any due/waiting task, not done) across all projects,
// ranked due → next → waiting. Tap toggles done; press-and-hold opens TaskSheet.
// Below, projects are grouped by Area into responsive ProjectCard grids.
import { useState, useEffect } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, StatusPill, Priority, AreaDot, Card, areaColor, statusSkin, fmtDate, TODAY, MONTHS, usePersisted, holdView, holdDue, addDays, Popover, PopRow } from '../kit'
import { TaskSheet, useLongPress } from './TaskSheet'
import { AddTaskInline } from './AddTask'
import { updateTask, deleteTask, updateProject, createUpdate, reorderProjects, deleteAreaCascade } from '../lib/db'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const todayLabel = () => {
  const d = new Date(TODAY.y, TODAY.m, TODAY.d)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[TODAY.m]} ${TODAY.d}`
}

// render a task's due cell — real shape is { dueDate:{y,m,d} } | { due:'Thu' }
const dueText = (x) => (x.dueDate ? fmtDate(x.dueDate) : x.due) || null
const projDueText = (p) => (p.due ? `${MONTHS[p.due.m]} ${p.due.d}` : null)

function taskProgress(p) {
  const open = (p.tasks || []).filter((x) => !x.done)
  const dueToday = open.filter((x) => x.dueDate && x.dueDate.y === TODAY.y && x.dueDate.m === TODAY.m && x.dueDate.d === TODAY.d).length
  return { open: open.length, dueToday }
}

// ── ProjectCard ─────────────────────────────────────────────────
// Left status accent bar + name + Priority/StatusPill + meta row, then either a
// surfaced Next action line or, when on hold, the waiting-on / check-in line.
function ProjectCard({ p, drag }) {
  const { t, f, go } = useApp()
  const { actionsForProject } = useData()
  const { open, dueToday } = taskProgress(p)
  const next = (p.tasks || []).find((x) => x.next && !x.done)
  const onHold = p.status === 'on-hold'
  const hv = onHold ? holdView(p.hold) : null
  const dueNow = onHold && holdDue(p.hold)
  const openActions = actionsForProject(p.id).filter((a) => /you|open|in progress/i.test(a.owner || '')).length
  const dueLabel = projDueText(p)
  const sk = statusSkin(t, p.status)
  const accent = p.status === 'idea' ? areaColor(t, p.area) : sk.dot

  // Optional drag-to-reorder. The grip is the only draggable affordance (HTML5
  // DnD, handle-gated) so normal taps still open the project; the wrapper carries
  // the drag props and flips `draggable` on only while the grip is hovered.
  const [grip, setGrip] = useState(false)
  const dragging = drag && drag.dragging
  const dragProps = drag ? {
    draggable: grip,
    onDragStart: (e) => drag.onDragStart(e, p.id),
    onDragOver: (e) => drag.onDragOver(e, p.id),
    onDrop: (e) => drag.onDrop(e),
    onDragEnd: drag.onDragEnd,
  } : {}

  return <div {...dragProps} style={{ opacity: dragging ? 0.4 : 1, transition: 'opacity .15s' }}>
  <Card hover onClick={() => go({ screen: 'project', id: p.id })}
    style={{ padding: 0, overflow: 'hidden', opacity: onHold ? 0.82 : 1, display: 'flex' }}>
    <span style={{ width: 3, flex: 'none', background: accent }} />
    <div style={{ flex: 1, minWidth: 0, padding: '14px 16px 13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {drag && <span onClick={(e) => e.stopPropagation()} title="Drag to reorder"
          onMouseEnter={() => setGrip(true)} onMouseLeave={() => setGrip(false)}
          style={{ display: 'inline-flex', alignItems: 'center', flex: 'none', marginLeft: -4, cursor: 'grab' }}>
          <Icon n="grip-vertical" s={15} c={t.t3} /></span>}
        <span style={{ fontFamily: f.title, fontSize: 16.5, fontWeight: f.titleW, letterSpacing: f.titleSpacing,
          color: t.t1, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
        {p.priority && <Priority level={p.priority} />}
        <StatusPill id={p.status} size="sm" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, fontFamily: f.ui,
        fontSize: 12, color: t.t3, flexWrap: 'wrap', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon n="square-check" s={13} /><span>{`${open} open task${open === 1 ? '' : 's'}`}</span></span>
        {dueToday > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: t.risk, fontWeight: 600,
          background: t.riskBg, border: '1px solid ' + t.riskLine, borderRadius: 6, padding: '1px 7px' }}>
          <Icon n="alarm" s={13} c={t.risk} /><span>{`${dueToday} due today`}</span></span>}
        {openActions > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon n="checkup-list" s={13} /><span>{`${openActions} open item${openActions === 1 ? '' : 's'}`}</span></span>}
        {dueLabel && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
          color: p.status === 'active' ? t.risk : t.t3 }}><Icon n="flag" s={13} /><span>{`Due ${dueLabel}`}</span></span>}
      </div>

      {next && !onHold && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11,
        paddingTop: 10, borderTop: '1px solid ' + t.line }}>
        <span style={{ fontFamily: f.label, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: t.accent }}>Next</span>
        <span style={{ fontFamily: f.body, fontSize: 13, color: t.t2, flex: 1, minWidth: 0, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{next.label}</span>
        {dueText(next) && <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.risk, fontVariantNumeric: 'tabular-nums' }}>{dueText(next)}</span>}
      </div>}

      {onHold && hv && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 11,
        paddingTop: 10, borderTop: '1px solid ' + t.line, fontFamily: f.ui, fontSize: 12, color: t.t3 }}>
        <Icon n="player-pause" s={13} /><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hv.reason || 'On hold'}</span>
        {hv.resurfaceText && <span style={{ color: dueNow ? t.risk : t.t3, fontWeight: dueNow ? 600 : 400, whiteSpace: 'nowrap' }}>{dueNow ? 'resurfaced' : 'back ' + hv.resurfaceText}</span>}</div>}
    </div>
  </Card>
  </div>
}

// ── Reorderable live-project grid (one per Area on the Work overview) ──
// React owns the display order; drag mutates it optimistically and the new order
// persists via reorderProjects (sort = position). Idea/archived ids are appended
// so their sort slots survive the write. Re-seeds when the persisted set changes.
function LiveGrid({ a, live }) {
  const { reload } = useData()
  const [order, setOrder] = useState(live)
  const [dragId, setDragId] = useState(null)
  const sig = live.map((p) => `${p.id}:${p.status}:${p.priority || ''}:${p.name}`).join('|')
  useEffect(() => { setOrder(live) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const onDragStart = (e, id) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id) } catch {} }
  const onDragOver = (e, overId) => {
    e.preventDefault()
    if (dragId == null || overId === dragId) return
    setOrder((os) => {
      const from = os.findIndex((o) => o.id === dragId)
      const to = os.findIndex((o) => o.id === overId)
      if (from < 0 || to < 0 || from === to) return os
      const next = os.slice(); const [m] = next.splice(from, 1); next.splice(to, 0, m); return next
    })
  }
  const onDrop = (e) => e.preventDefault()
  const onDragEnd = async () => {
    setDragId(null)
    const ids = order.map((o) => o.id)
    const orig = live.map((o) => o.id)
    if (ids.join(',') === orig.join(',')) return
    const ideaIds = a.projects.filter((p) => p.status === 'idea').map((p) => p.id)
    const archIds = a.projects.filter((p) => p.status === 'archived').map((p) => p.id)
    try { await reorderProjects([...ids, ...ideaIds, ...archIds]); await reload() }
    catch (e) { window.alert('Could not reorder: ' + (e?.message || e)) }
  }

  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
    {order.map((p) => <ProjectCard key={p.id} p={{ ...p, area: a.id, areaName: a.name }}
      drag={{ dragging: dragId === p.id, onDragStart, onDragOver, onDrop, onDragEnd }} />)}
  </div>
}

// ── one cross-project open-task row ─────────────────────────────
function OpenTaskRow({ x, first, onToggle, onOpen }) {
  const { t, f, go } = useApp()
  const { pressing, handlers } = useLongPress(() => onOpen(x), () => onToggle(x), 450)
  const due = dueText(x)
  const stop = {
    onMouseDown: (e) => e.stopPropagation(), onTouchStart: (e) => e.stopPropagation(),
    onClick: (e) => { e.stopPropagation(); go(x.projectId ? { screen: 'project', id: x.projectId } : { screen: 'area', id: x.area }) },
  }
  return <div {...handlers} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
    borderTop: first ? 'none' : '1px solid ' + t.line, cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
    touchAction: 'manipulation', position: 'relative', overflow: 'hidden',
    background: pressing ? t.sel : 'transparent', transition: 'background .15s' }}>
    {pressing && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', transformOrigin: 'left',
      background: t.sel, animation: 'taskHold 0.45s linear forwards', pointerEvents: 'none' }} />}
    <span style={{ width: 17, height: 17, borderRadius: 5, flex: 'none', zIndex: 1,
      border: '1.5px solid ' + t.t3, background: 'transparent' }} />
    <span style={{ flex: 1, minWidth: 0, zIndex: 1, fontFamily: f.body, fontSize: 14.5, color: t.t1, overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.label}</span>
    {x.waiting && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none', zIndex: 1, fontFamily: f.ui,
      fontSize: 11, fontWeight: 600, color: t.t2, background: t.tagBg, borderRadius: 6, padding: '2px 8px' }}>
      <Icon n="player-pause" s={11} />{x.waiting}</span>}
    {due && <span style={{ flex: 'none', zIndex: 1, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.risk,
      fontVariantNumeric: 'tabular-nums' }}>{due}</span>}
    {x.next && !due && <span style={{ flex: 'none', zIndex: 1, fontFamily: f.label, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase', color: t.accent }}>Next</span>}
    <span {...stop} title="Open project" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none', zIndex: 1, maxWidth: 150,
      fontFamily: f.ui, fontSize: 11.5, fontWeight: 500, color: t.t2, background: t.sel, borderRadius: 7, padding: '3px 9px', cursor: 'pointer' }}
      onMouseEnter={(e) => e.currentTarget.style.color = t.t1}
      onMouseLeave={(e) => e.currentTarget.style.color = t.t2}>
      <AreaDot areaId={x.area} s={6} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.projectName}</span></span>
  </div>
}

// ── due-date helpers (relative to the app's real "today") ───────
const dnum = (d) => (d ? d.y * 10000 + d.m * 100 + d.d : null)
const TODAY_N = dnum(TODAY)
const WEEK_N = (() => { const d = new Date(TODAY.y, TODAY.m, TODAY.d + 7); return dnum({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }) })()

// Filters for the cross-project Open-tasks roll-up. Each is a predicate over a
// surfaced task row (real shape: { dueDate:{y,m,d} } | { due:'Thu' } | next |
// waiting | projStatus }). "Focus" is the default: what actually needs doing —
// anything due today/overdue, plus the surfaced Next action of any Active project.
const isDueToday = (x) => x.dueDate && dnum(x.dueDate) <= TODAY_N
const FILTERS = [
  { id: 'focus', label: 'Focus', match: (x) => isDueToday(x) || (x.next && x.projStatus === 'active') },
  { id: 'today', label: 'Today', match: isDueToday },                                          // due today + overdue
  { id: 'week', label: 'This week', match: (x) => x.dueDate && dnum(x.dueDate) <= WEEK_N },    // through the next 7 days
  { id: 'next', label: 'Next', match: (x) => !!x.next },
  { id: 'waiting', label: 'Waiting', match: (x) => !!x.waiting },
  { id: 'all', label: 'All', match: () => true },
]

// ── Open tasks card (cross-project) ─────────────────────────────
function OpenTasks({ projects, sheetTask, setSheetTask }) {
  const { t, f } = useApp()
  const { reload, looseTasks, areas } = useData()
  const [filter, setFilter] = usePersisted('course.openTasksFilter.v2', 'focus')
  const [pillar, setPillar] = usePersisted('course.openTasksPillar.v1', 'all')
  const [pillarOpen, setPillarOpen] = useState(false)

  const all = []
  const seen = new Set()
  const surfaced = (x) => x.next || x.due || x.dueDate || x.waiting
  projects.forEach((p) => (p.tasks || []).forEach((x) => {
    if (x.done || !surfaced(x) || seen.has(x.id)) return
    seen.add(x.id)
    all.push({ ...x, projectId: p.id, projectName: p.name, area: p.area, projStatus: p.status })
  }))
  // Pillar-only tasks (no project) — surfaced into the same roll-up, treated as active.
  looseTasks().forEach((x) => {
    if (x.done || !surfaced(x) || seen.has(x.id)) return
    seen.add(x.id)
    all.push({ ...x, projectId: null, projectName: x.areaName, projStatus: 'active' })
  })
  if (!all.length) {
    return <div style={{ marginTop: 30 }}>
      <AddTaskInline surfaceOnAdd onAdded={reload} />
    </div>
  }

  // Pillars present in the roll-up (only those with surfaced tasks), for the filter dropdown.
  const pillarIds = [...new Set(all.map((x) => x.area).filter(Boolean))]
  const pillarsPresent = areas.filter((a) => pillarIds.includes(a.id))
  // If the selected pillar no longer has any rows, fall back to all.
  const activePillar = pillar !== 'all' && pillarIds.includes(pillar) ? pillar : 'all'
  const scoped = activePillar === 'all' ? all : all.filter((x) => x.area === activePillar)
  const pillarName = activePillar === 'all' ? 'All pillars' : (areas.find((a) => a.id === activePillar)?.name || 'All pillars')

  const counts = Object.fromEntries(FILTERS.map((fl) => [fl.id, scoped.filter(fl.match).length]))
  const active = FILTERS.find((fl) => fl.id === filter) || FILTERS[0]
  const rows = scoped.filter(active.match)
  // due first (earliest date), then surfaced Next, then Waiting
  const rank = (x) => (x.dueDate ? 0 : x.due ? 1 : x.next ? 2 : 3)
  rows.sort((a, b) => rank(a) - rank(b) || (dnum(a.dueDate) || 9e8) - (dnum(b.dueDate) || 9e8))

  const toggle = async (x) => { await updateTask(x.id, { done: !x.done }); await reload() }
  const patch = async (p) => { if (!sheetTask) return; await updateTask(sheetTask.task.id, p); await reload() }
  const remove = async (id) => { await deleteTask(id); setSheetTask(null); await reload() }
  // target = { project: id } | { area: id } — moving to one clears the other.
  const reassign = async (target) => {
    if (!sheetTask || !target) return
    await updateTask(sheetTask.task.id, target.area ? { project: null, area: target.area } : { project: target.project, area: null })
    setSheetTask(null); await reload()
  }

  const chip = (fl) => {
    const on = filter === fl.id
    const n = counts[fl.id]
    if (fl.id !== 'all' && fl.id !== 'focus' && n === 0) return null
    return <span key={fl.id} onClick={() => setFilter(fl.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
      color: on ? t.onAccent : t.t2, background: on ? t.accent : t.sel, border: '1px solid ' + (on ? t.accent : 'transparent'),
      borderRadius: 8, padding: '5px 11px', transition: 'background .12s, color .12s' }}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = t.tagBg }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = t.sel }}>
      {fl.label}<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700,
        color: on ? t.onAccent : t.t3, opacity: on ? 0.85 : 1 }}>{n}</span></span>
  }

  return <div style={{ marginTop: 30 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
      <Icon n="checkup-list" s={16} c={t.t2} />
      <span style={{ fontFamily: f.title, fontSize: 16, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, whiteSpace: 'nowrap' }}>Open tasks</span>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, whiteSpace: 'nowrap' }}>{rows.length} {filter === 'all' ? 'on deck' : 'shown'}</span>
      <div style={{ flex: 1, height: 1, background: t.line }} />
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
      {FILTERS.map(chip)}
      {pillarsPresent.length > 1 && <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 'auto' }}>
        <span onClick={() => setPillarOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          color: activePillar === 'all' ? t.t2 : t.t1, background: t.sel, border: '1px solid ' + (activePillar === 'all' ? 'transparent' : t.line2),
          borderRadius: 8, padding: '5px 10px' }}
          onMouseEnter={(e) => e.currentTarget.style.background = t.tagBg}
          onMouseLeave={(e) => e.currentTarget.style.background = t.sel}>
          {activePillar !== 'all' && <AreaDot areaId={activePillar} s={7} />}
          {pillarName}<Icon n="chevron-down" s={13} c={t.t3} /></span>
        {pillarOpen && <Popover onClose={() => setPillarOpen(false)} width={220} maxHeight={320}>
          <PopRow icon={activePillar === 'all' ? 'check' : 'layout-grid'} label="All pillars"
            onClick={() => { setPillar('all'); setPillarOpen(false) }} />
          {pillarsPresent.map((a) => <PopRow key={a.id} icon={a.id === activePillar ? 'check' : 'folder'} label={a.name}
            onClick={() => { setPillar(a.id); setPillarOpen(false) }} />)}
        </Popover>}
      </span>}
    </div>
    {rows.length === 0
      ? <Card style={{ padding: '22px 16px', textAlign: 'center', fontFamily: f.ui, fontSize: 13, color: t.t3 }}>
          Nothing {active.label.toLowerCase() === 'all' ? 'open' : 'in ' + active.label.toLowerCase()} right now.</Card>
      : <Card style={{ padding: '4px 0', overflow: 'hidden' }}>
          {rows.map((x, i) => <OpenTaskRow key={(x.projectId || x.area) + x.id} x={x} first={i === 0} onToggle={toggle}
            onOpen={(r) => setSheetTask({ task: r, projectId: r.projectId })} />)}
        </Card>}
    <div style={{ marginTop: 8 }}><AddTaskInline surfaceOnAdd onAdded={reload} /></div>
    {sheetTask && (() => {
      // Re-derive the live task from reloaded data each render so patches (status
      // / due date) reflect in the open sheet — check project tasks, then the
      // pillar-only roll-up (mirrors Project.jsx's `live` lookup).
      let live = sheetTask.task
      let found = false
      for (const p of projects) { const hit = (p.tasks || []).find((x) => x.id === sheetTask.task.id); if (hit) { live = { ...hit, projectId: p.id, projectName: p.name, area: p.area, projStatus: p.status }; found = true; break } }
      if (!found) { const hit = looseTasks().find((x) => x.id === sheetTask.task.id); if (hit) live = { ...hit, projectId: null, projectName: hit.areaName, projStatus: 'active' } }
      return <TaskSheet task={live} projectId={sheetTask.projectId}
        onPatch={patch} onDelete={remove} onReassign={reassign} onClose={() => setSheetTask(null)} />
    })()}
  </div>
}

// ── Work overview ───────────────────────────────────────────────
// ── Resurfacing banner ──────────────────────────────────────────
// Held projects whose resurfaceOn date has arrived. This is the payoff of the
// hold flow: "on hold" was a timer, and the timer fired. Each forces a decision
// — reactivate (back to work), snooze (push the date out), or open to triage.
function ResurfaceBanner() {
  const { t, f, go } = useApp()
  const { allProjects, reload } = useData()
  const due = allProjects().filter((p) => p.status === 'on-hold' && holdDue(p.hold))
  if (!due.length) return null

  const reactivate = async (p) => {
    await updateProject(p.id, { status: 'active', hold: null })
    await createUpdate(p.id, 'Reactivated from hold')
    await reload()
  }
  const snooze = async (p, days) => {
    const hv = holdView(p.hold)
    await updateProject(p.id, { hold: { ...p.hold, resurfaceOn: addDays(TODAY, days), reason: hv?.reason || '' } })
    await reload()
  }

  return <Card style={{ padding: '15px 18px', marginTop: 22, border: '1px solid ' + t.riskLine, background: t.riskBg }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <Icon n="bell" s={15} c={t.risk} />
      <span style={{ fontFamily: f.label, fontSize: 11, fontWeight: 700, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.risk }}>
        Resurfacing · {due.length}</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {due.map((p) => { const hv = holdView(p.hold); return (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <span onClick={() => go({ screen: 'project', id: p.id })} style={{ fontFamily: f.body, fontSize: 14, fontWeight: 600, color: t.t1, cursor: 'pointer' }}>{p.name}</span>
            {hv?.reason && <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hv.reason}</div>}
          </div>
          <div style={{ display: 'flex', gap: 7, flex: 'none' }}>
            <Btn kind="primary" size="sm" icon="player-play" onClick={() => reactivate(p)}>Reactivate</Btn>
            <Btn kind="ghost" size="sm" icon="alarm" onClick={() => snooze(p, 7)}>+1 wk</Btn>
            <Btn kind="ghost" size="sm" onClick={() => snooze(p, 30)}>+1 mo</Btn>
          </div>
        </div>
      )})}
    </div>
  </Card>
}

// ── In-focus row — one pulled Now-lane task inside a project group ──
function NowRow({ x, first, onToggle, onOpen }) {
  const { t, f } = useApp()
  const { pressing, handlers } = useLongPress(() => onOpen(x), () => onToggle(x), 450)
  const due = dueText(x)
  return <div {...handlers} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', cursor: 'pointer',
    userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation', position: 'relative', overflow: 'hidden',
    borderTop: first ? 'none' : '1px solid ' + t.line, background: pressing ? t.sel : 'transparent', transition: 'background .15s' }}>
    {pressing && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', transformOrigin: 'left',
      background: t.sel, animation: 'taskHold 0.45s linear forwards', pointerEvents: 'none' }} />}
    <span style={{ width: 16, height: 16, borderRadius: 5, flex: 'none', zIndex: 1, border: '1.5px solid ' + t.t3, background: 'transparent' }} />
    <span style={{ flex: 1, minWidth: 0, zIndex: 1, fontFamily: f.body, fontSize: 14, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.label}</span>
    {x.waiting && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none', zIndex: 1, fontFamily: f.ui, fontSize: 11,
      fontWeight: 600, color: t.t2, background: t.tagBg, borderRadius: 6, padding: '2px 8px' }}><Icon n="player-pause" s={11} />{x.waiting}</span>}
    {due && <span style={{ flex: 'none', zIndex: 1, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.risk, fontVariantNumeric: 'tabular-nums' }}>{due}</span>}
  </div>
}

// ── In focus now (Phase 4) — the whole picture without opening each project:
// every active project's pulled Now-lane tasks, so the pull method's payoff (the
// items you committed to focus on) is the first thing seen on the Work overview.
// Project-level active state (status active | sent) governs which projects show.
function NowFocus({ projects }) {
  const { t, f, go } = useApp()
  const { reload } = useData()
  const [nowCap] = usePersisted('course.nowCap', 3)
  const [sheetTask, setSheetTask] = useState(null)

  const active = projects.filter((p) => p.status === 'active' || p.status === 'sent')
  if (!active.length) return null
  const nowOf = (p) => (p.tasks || []).filter((x) => x.taskStatus === 'now' && !x.done)
  const groups = active.map((p) => ({ p, now: nowOf(p) })).filter((g) => g.now.length)
  const totalNow = groups.reduce((n, g) => n + g.now.length, 0)
  const idle = active.length - groups.length

  const toggle = async (x) => { await updateTask(x.id, { done: !x.done }); await reload() }
  const patch = async (p) => { if (!sheetTask) return; await updateTask(sheetTask.task.id, p); await reload() }
  const remove = async (id) => { await deleteTask(id); setSheetTask(null); await reload() }
  const reassign = async (target) => {
    if (!sheetTask || !target) return
    await updateTask(sheetTask.task.id, target.area ? { project: null, area: target.area } : { project: target.project, area: null })
    setSheetTask(null); await reload()
  }

  return <div style={{ marginTop: 30 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
      <Icon n="player-play" s={16} c={t.accent} />
      <span style={{ fontFamily: f.title, fontSize: 16, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, whiteSpace: 'nowrap' }}>In focus now</span>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, whiteSpace: 'nowrap' }}>{totalNow} pulled across {groups.length} project{groups.length === 1 ? '' : 's'}</span>
      <div style={{ flex: 1, height: 1, background: t.line }} />
    </div>
    {groups.length === 0
      ? <Card style={{ padding: '18px 16px', textAlign: 'center', fontFamily: f.ui, fontSize: 13, color: t.t3 }}>
          Nothing pulled into Now yet. Open a project and pull a task up to put it in focus.</Card>
      : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {groups.map(({ p, now }) => {
            const over = now.length > nowCap
            return <Card key={p.id} style={{ padding: 0, overflow: 'hidden' }}>
              <div onClick={() => go({ screen: 'project', id: p.id })} style={{ display: 'flex', alignItems: 'center', gap: 8,
                padding: '11px 14px', cursor: 'pointer', borderBottom: '1px solid ' + t.line }}
                onMouseEnter={(e) => e.currentTarget.style.background = t.sel} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <AreaDot areaId={p.area} s={8} />
                <span style={{ flex: 1, minWidth: 0, fontFamily: f.title, fontSize: 14.5, fontWeight: f.titleW, letterSpacing: f.titleSpacing,
                  color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: over ? t.risk : t.t3 }}>{now.length}{over ? ' of ' + nowCap : ''} in Now</span>
                <Icon n="chevron-right" s={15} c={t.t3} />
              </div>
              <div style={{ padding: '4px 0' }}>
                {now.map((x, i) => <NowRow key={x.id} x={x} first={i === 0} onToggle={toggle}
                  onOpen={() => setSheetTask({ task: { ...x, projectId: p.id, projectName: p.name, area: p.area, projStatus: p.status }, projectId: p.id })} />)}
              </div>
            </Card>
          })}
        </div>}
    {idle > 0 && groups.length > 0 && <div style={{ marginTop: 10, fontFamily: f.ui, fontSize: 12, color: t.t3 }}>
      {idle} active project{idle === 1 ? '' : 's'} with nothing pulled into Now.</div>}
    {sheetTask && (() => {
      let live = sheetTask.task
      for (const p of projects) { const hit = (p.tasks || []).find((x) => x.id === sheetTask.task.id); if (hit) { live = { ...hit, projectId: p.id, projectName: p.name, area: p.area, projStatus: p.status }; break } }
      return <TaskSheet task={live} projectId={sheetTask.projectId} onPatch={patch} onDelete={remove} onReassign={reassign} onClose={() => setSheetTask(null)} />
    })()}
  </div>
}

export function OverviewScreen() {
  const { t, f } = useApp()
  const { areas, allProjects } = useData()
  const [sheetTask, setSheetTask] = useState(null)
  const [ideasOpen, setIdeasOpen] = useState({})

  // Live projects in the user's manual order (already sorted by `sort` from db);
  // no status re-rank so drag-to-reorder on the cards persists exactly as dropped.
  const liveOf = (a) => a.projects.filter((p) => p.status !== 'idea' && p.status !== 'archived')
  const ideasOf = (a) => a.projects.filter((p) => p.status === 'idea')

  const projects = allProjects().filter((p) => p.status !== 'archived')
  const totalActive = projects.filter((p) => p.status === 'active').length
  const populatedAreas = areas.filter((a) => liveOf(a).length || ideasOf(a).length)

  return <div data-screen-label="Work overview" style={{ maxWidth: 980, margin: '0 auto', padding: '34px 36px 80px' }}>
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
      <div>
        <div style={{ fontFamily: f.title, fontSize: 30, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Work</div>
        <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 4 }}>
          {totalActive} active project{totalActive === 1 ? '' : 's'} across {populatedAreas.length} area{populatedAreas.length === 1 ? '' : 's'}</div>
      </div>
      <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{todayLabel()}</span>
    </div>

    <ResurfaceBanner />

    <NowFocus projects={projects} />

    <OpenTasks projects={projects} sheetTask={sheetTask} setSheetTask={setSheetTask} />

    {populatedAreas.map((a) => {
      const live = liveOf(a)
      const ideas = ideasOf(a)
      const ideasShown = !!ideasOpen[a.id]
      return <div key={a.id} style={{ marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <span style={{ fontFamily: f.title, fontSize: 16, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, whiteSpace: 'nowrap' }}>{a.name}</span>
          <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, whiteSpace: 'nowrap' }}>{`${live.length} project${live.length === 1 ? '' : 's'}`}</span>
          <div style={{ flex: 1, height: 1, background: t.line }} />
        </div>
        {live.length > 0 && <LiveGrid a={a} live={live} />}
        {ideas.length > 0 && <div style={{ marginTop: live.length ? 12 : 0 }}>
          <div onClick={() => setIdeasOpen((o) => ({ ...o, [a.id]: !o[a.id] }))} style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
            fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t3, cursor: 'pointer', padding: '6px 9px', borderRadius: 8 }}
            onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon n={ideasShown ? 'chevron-down' : 'chevron-right'} s={13} c={t.t3} />
            <Icon n={ideasShown ? 'folder-open' : 'folder'} s={14} c={t.t3} />
            <span>Ideas</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: t.t3 }}>{ideas.length}</span>
          </div>
          {ideasShown && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginTop: 10 }}>
            {ideas.map((p) => <ProjectCard key={p.id} p={{ ...p, area: a.id, areaName: a.name }} />)}
          </div>}
        </div>}
      </div>
    })}
  </div>
}

// ── Single Area ─────────────────────────────────────────────────
// Pillar-only tasks for an Area — same long-press/open behavior as Open tasks.
function PillarTasks({ area }) {
  const { t, f } = useApp()
  const { reload, looseTasksInArea } = useData()
  const [sheetTask, setSheetTask] = useState(null)
  const tasks = looseTasksInArea(area.id)
  const open = tasks.filter((x) => !x.done)

  const toggle = async (x) => { await updateTask(x.id, { done: !x.done }); await reload() }
  const patch = async (p) => { if (!sheetTask) return; await updateTask(sheetTask.task.id, p); await reload() }
  const remove = async (id) => { await deleteTask(id); setSheetTask(null); await reload() }
  const reassign = async (target) => {
    if (!sheetTask || !target) return
    await updateTask(sheetTask.task.id, target.area ? { project: null, area: target.area } : { project: target.project, area: null })
    setSheetTask(null); await reload()
  }
  const row = (x) => ({ ...x, projectId: null, projectName: area.name, area: area.id, projStatus: 'active' })

  return <div style={{ marginTop: 28 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
      <span style={{ fontFamily: f.title, fontSize: 15, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, whiteSpace: 'nowrap' }}>Tasks</span>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>{open.length} open · no project</span>
      <div style={{ flex: 1, height: 1, background: t.line }} />
    </div>
    {open.length > 0 && <Card style={{ padding: '4px 0', overflow: 'hidden', marginBottom: 8 }}>
      {open.map((x, i) => <OpenTaskRow key={x.id} x={row(x)} first={i === 0} onToggle={toggle}
        onOpen={(r) => setSheetTask({ task: r, projectId: null })} />)}
    </Card>}
    <AddTaskInline defaultTarget={{ area: area.id }} lockTarget onAdded={reload} />
    {sheetTask && (() => {
      const hit = looseTasksInArea(area.id).find((x) => x.id === sheetTask.task.id)
      const live = hit ? row(hit) : sheetTask.task
      return <TaskSheet task={live} projectId={null} onPatch={patch} onDelete={remove} onReassign={reassign} onClose={() => setSheetTask(null)} />
    })()}
  </div>
}

export function AreaScreen() {
  const { t, f, go, route } = useApp()
  const { areas, reload } = useData()
  const [deleting, setDeleting] = useState(false)
  const a = areas.find((x) => x.id === route.id) || areas[0]
  if (!a) return null

  const removeArea = async () => {
    const n = a.projects.length
    const msg = n
      ? `Delete the area “${a.name}” and all ${n} project${n === 1 ? '' : 's'} in it (with their tasks, notes, and files)? This can’t be undone.`
      : `Delete the area “${a.name}”? This can’t be undone.`
    if (!window.confirm(msg)) return
    setDeleting(true)
    try { await deleteAreaCascade(a.id); await reload(); go({ screen: 'overview' }) }
    catch (e) { window.alert('Could not delete the area: ' + (e?.message || e)); setDeleting(false) }
  }

  const projs = a.projects.map((p) => ({ ...p, area: a.id, areaName: a.name }))
  const active = projs.filter((p) => ['active', 'sent'].includes(p.status))
  const hold = projs.filter((p) => p.status === 'on-hold')
  const ideas = projs.filter((p) => p.status === 'idea')
  const shown = active.length + hold.length + ideas.length

  const group = (label, items) => items.length ? <div style={{ marginTop: 28 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
      <span style={{ fontFamily: f.title, fontSize: 15, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>{items.length}</span>
      <div style={{ flex: 1, height: 1, background: t.line }} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {items.map((p) => <ProjectCard key={p.id} p={p} />)}
    </div>
  </div> : null

  return <div data-screen-label={'Area · ' + a.name} style={{ maxWidth: 980, margin: '0 auto', padding: '34px 36px 80px' }}>
    <div onClick={() => go({ screen: 'overview' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: f.ui, fontSize: 12.5, color: t.t3, cursor: 'pointer', marginBottom: 14 }}
      onMouseEnter={(e) => e.currentTarget.style.color = t.t1}
      onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
      <Icon n="chevron-left" s={15} />Work</div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <span style={{ fontFamily: f.title, fontSize: 30, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>{a.name}</span>
      <div style={{ flex: 1 }} />
      <button onClick={deleting ? undefined : removeArea} title="Delete this area"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none', fontFamily: f.ui, fontSize: 12.5, fontWeight: 600,
          color: t.t3, background: 'transparent', border: '1px solid ' + t.line2, borderRadius: 8, padding: '6px 11px', cursor: deleting ? 'default' : 'pointer', transition: 'color .14s, border-color .14s' }}
        onMouseEnter={(e) => { if (!deleting) { e.currentTarget.style.color = t.risk; e.currentTarget.style.borderColor = t.riskLine } }}
        onMouseLeave={(e) => { e.currentTarget.style.color = t.t3; e.currentTarget.style.borderColor = t.line2 }}>
        <Icon n={deleting ? 'loader-2' : 'trash-2'} s={14} />{deleting ? 'Deleting…' : 'Delete area'}</button>
    </div>
    <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 5 }}>
      {active.length} active{hold.length ? ` · ${hold.length} on hold` : ''}{ideas.length ? ` · ${ideas.length} idea${ideas.length === 1 ? '' : 's'}` : ''}</div>

    {group('Active', active)}
    {group('On hold', hold)}
    {group('Ideas', ideas)}
    <PillarTasks area={a} />
    {shown === 0 && <div style={{ textAlign: 'center', padding: '40px 0 10px', fontFamily: f.body, fontSize: 15,
      color: t.t3, fontStyle: 'italic' }}>No projects in {a.name} yet.</div>}
  </div>
}
