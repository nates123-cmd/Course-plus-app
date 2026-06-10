// Overview.jsx — the "Work" overview + per-Area screens (Direction B). Ported
// faithfully from the prototype's course-overview.jsx, rewired to the real data
// spine: useApp() for theme/route/nav, useData() for the area→project tree, and
// db.js for task writes. No window.* globals — everything is imported.
//
// Surface model: an "Open tasks" card rolls up each project's surfaced actions
// (its `next` task plus any due/waiting task, not done) across all projects,
// ranked due → next → waiting. Tap toggles done; press-and-hold opens TaskSheet.
// Below, projects are grouped by Area into responsive ProjectCard grids.
import { useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, StatusPill, Priority, AreaDot, Card, areaColor, statusSkin, fmtDate, TODAY, MONTHS, usePersisted } from '../kit'
import { TaskSheet, useLongPress } from './TaskSheet'
import { updateTask, deleteTask } from '../lib/db'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const todayLabel = () => {
  const d = new Date(TODAY.y, TODAY.m, TODAY.d)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[TODAY.m]} ${TODAY.d}`
}

// render a task's due cell — real shape is { dueDate:{y,m,d} } | { due:'Thu' }
const dueText = (x) => (x.dueDate ? fmtDate(x.dueDate) : x.due) || null
const projDueText = (p) => (p.due ? `${MONTHS[p.due.m]} ${p.due.d}` : null)

function taskProgress(p) {
  const tasks = p.tasks || []
  return { done: tasks.filter((x) => x.done).length, total: tasks.length }
}

// ── ProjectCard ─────────────────────────────────────────────────
// Left status accent bar + name + Priority/StatusPill + meta row, then either a
// surfaced Next action line or, when on hold, the waiting-on / check-in line.
function ProjectCard({ p }) {
  const { t, f, go } = useApp()
  const { actionsForProject } = useData()
  const { done, total } = taskProgress(p)
  const next = (p.tasks || []).find((x) => x.next && !x.done)
  const onHold = p.status === 'on-hold'
  const openActions = actionsForProject(p.id).filter((a) => /you|open|in progress/i.test(a.owner || '')).length
  const dueLabel = projDueText(p)
  const sk = statusSkin(t, p.status)
  const accent = p.status === 'idea' ? areaColor(t, p.area) : sk.dot

  return <Card hover onClick={() => go({ screen: 'project', id: p.id })}
    style={{ padding: 0, overflow: 'hidden', opacity: onHold ? 0.82 : 1, display: 'flex' }}>
    <span style={{ width: 3, flex: 'none', background: accent }} />
    <div style={{ flex: 1, minWidth: 0, padding: '14px 16px 13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontFamily: f.title, fontSize: 16.5, fontWeight: f.titleW, letterSpacing: f.titleSpacing,
          color: t.t1, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
        {p.priority && <Priority level={p.priority} />}
        <StatusPill id={p.status} size="sm" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, fontFamily: f.ui,
        fontSize: 12, color: t.t3, flexWrap: 'wrap', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon n="square-check" s={13} /><span>{`${done}/${total} tasks`}</span></span>
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

      {onHold && p.hold && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 11,
        paddingTop: 10, borderTop: '1px solid ' + t.line, fontFamily: f.ui, fontSize: 12, color: t.t3 }}>
        <Icon n="player-pause" s={13} />Waiting on {p.hold.waitingOn} · check {p.hold.checkIn}</div>}
    </div>
  </Card>
}

// ── one cross-project open-task row ─────────────────────────────
function OpenTaskRow({ x, first, onToggle, onOpen }) {
  const { t, f, go } = useApp()
  const { pressing, handlers } = useLongPress(() => onOpen(x), () => onToggle(x), 450)
  const due = dueText(x)
  const stop = {
    onMouseDown: (e) => e.stopPropagation(), onTouchStart: (e) => e.stopPropagation(),
    onClick: (e) => { e.stopPropagation(); go({ screen: 'project', id: x.projectId }) },
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
  const { reload } = useData()
  const [filter, setFilter] = usePersisted('course.openTasksFilter.v2', 'focus')

  const all = []
  const seen = new Set()
  projects.forEach((p) => (p.tasks || []).forEach((x) => {
    if (x.done) return
    if (!(x.next || x.due || x.dueDate || x.waiting)) return
    if (seen.has(x.id)) return
    seen.add(x.id)
    all.push({ ...x, projectId: p.id, projectName: p.name, area: p.area, projStatus: p.status })
  }))
  if (!all.length) return null

  const counts = Object.fromEntries(FILTERS.map((fl) => [fl.id, all.filter(fl.match).length]))
  const active = FILTERS.find((fl) => fl.id === filter) || FILTERS[0]
  const rows = all.filter(active.match)
  // due first (earliest date), then surfaced Next, then Waiting
  const rank = (x) => (x.dueDate ? 0 : x.due ? 1 : x.next ? 2 : 3)
  rows.sort((a, b) => rank(a) - rank(b) || (dnum(a.dueDate) || 9e8) - (dnum(b.dueDate) || 9e8))

  const toggle = async (x) => { await updateTask(x.id, { done: !x.done }); await reload() }
  const patch = async (p) => { if (!sheetTask) return; await updateTask(sheetTask.task.id, p); await reload() }
  const remove = async (id) => { await deleteTask(id); setSheetTask(null); await reload() }

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
    </div>
    {rows.length === 0
      ? <Card style={{ padding: '22px 16px', textAlign: 'center', fontFamily: f.ui, fontSize: 13, color: t.t3 }}>
          Nothing {active.label.toLowerCase() === 'all' ? 'open' : 'in ' + active.label.toLowerCase()} right now.</Card>
      : <Card style={{ padding: '4px 0', overflow: 'hidden' }}>
          {rows.map((x, i) => <OpenTaskRow key={x.projectId + x.id} x={x} first={i === 0} onToggle={toggle}
            onOpen={(r) => setSheetTask({ task: r, projectId: r.projectId })} />)}
        </Card>}
    {sheetTask && <TaskSheet task={sheetTask.task} projectId={sheetTask.projectId}
      onPatch={patch} onDelete={remove} onClose={() => setSheetTask(null)} />}
  </div>
}

// ── Work overview ───────────────────────────────────────────────
export function OverviewScreen() {
  const { t, f } = useApp()
  const { areas, allProjects } = useData()
  const [sheetTask, setSheetTask] = useState(null)
  const [ideasOpen, setIdeasOpen] = useState({})

  const liveRank = { active: 0, sent: 1, 'on-hold': 2 }
  const liveOf = (a) => a.projects.filter((p) => p.status !== 'idea' && p.status !== 'archived')
    .slice().sort((x, y) => (liveRank[x.status] ?? 3) - (liveRank[y.status] ?? 3))
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
        {live.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {live.map((p) => <ProjectCard key={p.id} p={{ ...p, area: a.id, areaName: a.name }} />)}
        </div>}
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
export function AreaScreen() {
  const { t, f, go, route } = useApp()
  const { areas } = useData()
  const a = areas.find((x) => x.id === route.id) || areas[0]
  if (!a) return null

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
    </div>
    <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 5 }}>
      {active.length} active{hold.length ? ` · ${hold.length} on hold` : ''}{ideas.length ? ` · ${ideas.length} idea${ideas.length === 1 ? '' : 's'}` : ''}</div>

    {group('Active', active)}
    {group('On hold', hold)}
    {group('Ideas', ideas)}
    {shown === 0 && <div style={{ textAlign: 'center', padding: '70px 0', fontFamily: f.body, fontSize: 15,
      color: t.t3, fontStyle: 'italic' }}>No projects in {a.name} yet.</div>}
  </div>
}
