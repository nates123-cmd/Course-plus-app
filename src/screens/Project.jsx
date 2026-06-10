// Project detail — THE home surface (Direction B). Header (area breadcrumb,
// status, priority, due) · on-demand Claude Briefing · append-only Updates ·
// drag-to-reorder Tasks (long-press → TaskSheet) · rolled-up action items ·
// Documents (Meetings / Notes / Artifacts) with a Claude composer · right rail
// (scoped Ask · Milestones · Related). Every mutation is a real db write
// followed by reload(); React state stays the source of truth for ordering.
import { Fragment, useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import {
  Icon, Btn, IconBtn, StatusPill, Priority, AreaDot, Card, Label, Tag,
  Popover, PopRow, STATUS, statusSkin, areaColor, KIND, DatePill, fmtDate, isReference,
} from '../kit'
import { briefingFor, composeDeliverable } from '../lib/ai'
import { COMPOSE_TYPES } from '../data'
import {
  createTask, updateTask, deleteTask, reorderTasks,
  createMilestone, updateMilestone, createUpdate, createArtifact, updateProject, createArea,
} from '../lib/db'
import { TaskSheet, useLongPress } from './TaskSheet'

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
function SectionHead({ label, action, onAction, onAdd }) {
  const { t, f } = useApp()
  return <div style={{ display: 'flex', alignItems: 'center', marginBottom: 11, gap: 10 }}>
    <Label style={{ whiteSpace: 'nowrap' }}>{label}</Label>
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
  const [newPillar, setNewPillar] = useState(null) // null = closed, '' = typing
  const [editTitle, setEditTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const beginTitle = () => { setDraftTitle(project.name); setEditTitle(true) }
  const saveTitle = async () => {
    const v = draftTitle.trim(); setEditTitle(false)
    if (!v || v === project.name) return
    await updateProject(project.id, { name: v }); await reload()
  }
  const setStatus = async (k) => { setOpen(false); if (k !== project.status) { await updateProject(project.id, { status: k }); await reload() } }
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
  </div>
}

// ── Briefing — on-demand Claude call, never auto-runs ────────────
function Briefing({ project, notes }) {
  const { t, f } = useApp()
  const [text, setText] = useState(null) // cached prose
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const run = async () => {
    setBusy(true)
    try { setText((await briefingFor(project.name, notes)) || 'No notes to brief from yet.') }
    catch (e) { setText('Couldn’t compose a briefing — ' + String(e?.message || e)) }
    finally { setBusy(false) }
  }

  if (!text) return <Card style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
    <span style={{ width: 34, height: 34, borderRadius: 9, flex: 'none', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: t.accentBg, border: '1px solid ' + t.accentLine }}>
      <Icon n="sparkles" s={17} c={t.accent} /></span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>Briefing</div>
      <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 1 }}>A synthesis of where this stands — run it when you want it.</div>
    </div>
    <Btn kind="outline" size="sm" icon={busy ? 'loader-2' : 'sparkles'} onClick={busy ? undefined : run}>{busy ? 'Reading…' : '✦ Generate briefing'}</Btn>
  </Card>

  return <Card style={{ padding: '16px 18px', borderColor: t.accentLine, background: t.accentBg }}>
    <div onClick={() => setCollapsed((c) => !c)} style={{ display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: collapsed ? 0 : 9, cursor: 'pointer' }}>
      <Icon n="sparkles" s={14} c={t.accent} />
      <span style={{ fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing,
        textTransform: 'uppercase', color: t.accent }}>Briefing</span>
      {collapsed && <span style={{ flex: 1, minWidth: 0, fontFamily: f.body, fontSize: 13, color: t.t3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>}
      <div style={{ flex: collapsed ? 'none' : 1 }} />
      <span onClick={(e) => { e.stopPropagation(); if (!busy) run() }} style={{ display: 'inline-flex', alignItems: 'center',
        gap: 5, fontFamily: f.ui, fontSize: 11.5, color: t.t2, cursor: 'pointer' }}>
        <Icon n={busy ? 'loader-2' : 'refresh'} s={13} />{busy ? 'Refreshing' : 'Refresh'}</span>
      <Icon n={collapsed ? 'chevron-down' : 'chevron-up'} s={15} c={t.t3} />
    </div>
    {!collapsed && <Fragment>
      <div style={{ fontFamily: f.body, fontSize: 14.5, lineHeight: 1.62, color: t.t1, textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{text}</div>
      <div style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, marginTop: 11 }}>Synthesized from {notes.length} documents · just now</div>
    </Fragment>}
  </Card>
}

// ── Updates — append-only "where it stands" timeline ────────────
function Updates({ project, reload }) {
  const { t, f } = useApp()
  const items = project.updates || []
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const post = async () => {
    const v = text.trim()
    if (!v) { setAdding(false); setText(''); return }
    setBusy(true)
    try { await createUpdate(project.id, v); await reload(); setText(''); setAdding(false) }
    finally { setBusy(false) }
  }

  return <div>
    <SectionHead label={`Where it stands · ${items.length}`} action={adding ? null : '+ Update'} onAction={() => setAdding(true)} />
    {adding && <div style={{ background: t.card, border: '1px solid ' + t.line2, borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); if (e.key === 'Escape') { setText(''); setAdding(false) } }}
        placeholder="Where does this stand right now?"
        style={{ width: '100%', minHeight: 64, border: 0, outline: 0, resize: 'vertical', background: 'transparent',
          fontFamily: f.body, fontSize: 14, lineHeight: 1.55, color: t.t1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ flex: 1, fontFamily: f.ui, fontSize: 10.5, color: t.t3 }}>⌘↵ to post</span>
        <Btn kind="ghost" size="sm" onClick={() => { setText(''); setAdding(false) }}>Cancel</Btn>
        <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : 'corner-down-left'} onClick={busy ? undefined : post}>Post update</Btn>
      </div>
    </div>}
    {items.length === 0 && !adding
      ? <div style={{ fontFamily: f.body, fontSize: 13.5, color: t.t3, fontStyle: 'italic', padding: '4px 2px' }}>
          No updates yet — log where this stands.</div>
      : <div style={{ paddingLeft: 4 }}>
          {items.map((u, i) => {
            const last = i === items.length - 1; const newest = i === 0
            return <div key={u.id} style={{ display: 'flex', gap: 13, position: 'relative', paddingBottom: last ? 0 : 16 }}>
              {!last && <span style={{ position: 'absolute', left: 4, top: 14, bottom: 0, width: 1.5, background: t.line }} />}
              <span style={{ width: 9, height: 9, borderRadius: 5, flex: 'none', marginTop: 4, zIndex: 1,
                background: newest ? t.accent : t.line2, border: '2px solid ' + (newest ? t.accent : t.line2) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: f.meta, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
                  color: newest ? t.accent : t.t3, marginBottom: 3 }}>{timeAgo(u.at)}</div>
                <div style={{ fontFamily: f.body, fontSize: 14, lineHeight: 1.58, color: t.t1, textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{u.body}</div>
              </div>
            </div>
          })}
        </div>}
  </div>
}

// ── A single task row — tap toggles done, hold opens TaskSheet, ──
//    grip handle is the only draggable affordance.
function TaskRow({ x, onToggle, onOpen, onDragStart, onDragOver, onDrop, onDragEnd, dragging, noDrag }) {
  const { t, f } = useApp()
  const { pressing, handlers } = useLongPress(() => onOpen(x.id), () => onToggle(x.id), 450)
  const [grip, setGrip] = useState(false)
  const due = x.dueDate ? fmtDate(x.dueDate) : x.due
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
    {x.waiting && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, zIndex: 1, fontFamily: f.ui, fontSize: 11,
      fontWeight: 600, color: t.t2, background: t.tagBg, borderRadius: 6, padding: '2px 8px' }}>
      <Icon n="player-pause" s={11} />{x.waiting}</span>}
    {due && <span style={{ fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.risk, zIndex: 1, fontVariantNumeric: 'tabular-nums' }}>{due}</span>}
    {x.next && !x.done && <span style={{ fontFamily: f.label, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', zIndex: 1,
      textTransform: 'uppercase', color: t.accent }}>Next</span>}
  </div>
}

// ── Tasks — drag-to-reorder + inline add + long-press TaskSheet ──
function Tasks({ project, reload }) {
  const { t, f } = useApp()
  // React owns order; seed from project, re-seed whenever the persisted set changes.
  const [order, setOrder] = useState(project.tasks || [])
  const idsKey = (project.tasks || []).map((x) => x.id).join(',')
  useEffect(() => { setOrder(project.tasks || []) }, [idsKey])

  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [sheetTask, setSheetTask] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [showDone, setShowDone] = useState(false)

  const toggle = async (id) => {
    const x = order.find((o) => o.id === id); if (!x) return
    setOrder((os) => os.map((o) => o.id === id ? { ...o, done: !o.done } : o)) // optimistic
    await updateTask(id, { done: !x.done }); await reload()
  }
  const patch = async (id, p) => { await updateTask(id, p); await reload() }
  const remove = async (id) => { setSheetTask(null); await deleteTask(id); await reload() }
  const reassign = async (newPid) => {
    if (!sheetTask || newPid === project.id) return
    const id = sheetTask.id; setSheetTask(null)
    await updateTask(id, { project: newPid }); await reload()
  }
  const commit = async () => {
    const v = text.trim(); setText(''); setAdding(false)
    if (!v) return
    await createTask(project.id, { label: v, sort: order.length }); await reload()
  }

  // HTML5 drag-to-reorder, handle-gated (only the grip flips draggable on)
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
  const onDrop = (e) => { e.preventDefault() }
  const onDragEnd = async () => {
    setDragId(null)
    const ids = order.map((o) => o.id)
    const orig = (project.tasks || []).map((o) => o.id)
    if (ids.join(',') !== orig.join(',')) { await reorderTasks(ids); await reload() }
  }

  const openTasks = order.filter((x) => !x.done)
  const doneTasks = order.filter((x) => x.done)
  const findTask = (id) => order.find((o) => o.id === id) || null
  return <div>
    <SectionHead label={`Tasks · ${openTasks.length} open`} action="Drag to reorder · hold for details" />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {openTasks.map((x) => <TaskRow key={x.id} x={x} onToggle={toggle} onOpen={(id) => setSheetTask(findTask(id))}
        onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} dragging={dragId === x.id} />)}
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
    {doneTasks.length > 0 && <div style={{ marginTop: 10 }}>
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
    {sheetTask && <TaskSheet task={sheetTask} projectId={project.id}
      onPatch={(p) => patch(sheetTask.id, p)} onDelete={remove} onReassign={reassign} onClose={() => setSheetTask(null)} />}
  </div>
}

// ── A rolled-up action item — promote to task or dismiss ────────
function ActionRow({ a, first, onPromote, onDismiss }) {
  const { t, f, go } = useApp()
  const [hov, setHov] = useState(false)
  return <div style={{ position: 'relative', borderTop: first ? 'none' : '1px solid ' + t.line }}>
    <div style={{ background: t.card, display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 16px' }}>
      <span onClick={onDismiss} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} title="Dismiss"
        style={{ width: 18, height: 18, borderRadius: 9, flex: 'none', marginTop: 1, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: hov ? t.riskBg : 'transparent', transition: 'background .14s' }}>
        {hov ? <Icon n="x" s={13} c={t.risk} /> : <span style={{ width: 6, height: 6, borderRadius: 3, background: t.accent }} />}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, lineHeight: 1.4 }}>{a.text}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontFamily: f.ui, fontSize: 11.5, color: t.t3, flexWrap: 'wrap' }}>
          <span onClick={() => go({ screen: 'note', id: a.mid })} style={{ display: 'inline-flex', alignItems: 'center',
            gap: 4, color: t.t2, cursor: 'pointer' }}><Icon n="users" s={12} />{a.meeting}</span>
          {a.owner && <Fragment><span style={{ opacity: 0.5 }}>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon n="user" s={12} />{a.owner}</span></Fragment>}
          {a.linked && <Tag>linked</Tag>}
        </div>
      </div>
      <button onClick={onPromote} title="Promote to task" style={{ display: 'inline-flex', alignItems: 'center',
        gap: 5, flex: 'none', fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.accent, background: 'transparent',
        border: '1px solid ' + t.accentLine, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
        onMouseEnter={(e) => e.currentTarget.style.background = t.accentBg}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Icon n="arrow-bar-up" s={13} />To task</button>
    </div>
  </div>
}

// ── Open action items rolled up from this project's meetings ────
function ActionItems({ project, reload }) {
  const { actionsForProject } = useData()
  const items = actionsForProject(project.id)
  const [dismissed, setDismissed] = useState([]) // local-only
  const open = items.filter((a) => !dismissed.includes(a.text))
  if (!open.length) return null

  const promote = async (a) => {
    setDismissed((xs) => [...xs, a.text])
    await createTask(project.id, { label: a.text, srcMeeting: a.mid, sort: (project.tasks || []).length }); await reload()
  }
  const dismiss = (a) => setDismissed((xs) => [...xs, a.text])

  return <div>
    <SectionHead label={`Open action items · ${open.length}`} />
    <Card style={{ padding: '4px 0', overflow: 'hidden' }}>
      {open.map((a, i) => <ActionRow key={a.text} a={a} first={i === 0} onPromote={() => promote(a)} onDismiss={() => dismiss(a)} />)}
    </Card>
  </div>
}

// ── Document row → opens the note screen ─────────────────────────
function DocRow({ n, first }) {
  const { t, f, go } = useApp()
  return <div onClick={() => go({ screen: 'note', id: n.id })} style={{ display: 'flex', alignItems: 'center', gap: 12,
    padding: '11px 16px', cursor: 'pointer', borderTop: first ? 'none' : '1px solid ' + t.line }}
    onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
    <Icon n={(KIND[n.kind] || KIND.note).icon} s={16} c={t.t3} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2, fontFamily: f.ui, fontSize: 11, color: t.t3 }}>
        {n.date && <span>{n.date}</span>}
        {n.people && n.people.length > 0 && <Fragment><span style={{ opacity: 0.5 }}>·</span><span>{n.people.join(', ')}</span></Fragment>}
        {n.rawWords && <Fragment><span style={{ opacity: 0.5 }}>·</span><span>{n.rawWords} words</span></Fragment>}
      </div>
    </div>
    {isReference(n) && <Icon n="bookmark" s={13} c={t.accent} title="Reference" />}
    <Icon n="chevron-right" s={15} c={t.t3} />
  </div>
}

function DocSection({ label, notes, kind, project }) {
  const { t, f, openCapture } = useApp()
  const add = () => openCapture({ kind, home: project.id })
  return <div>
    <SectionHead label={notes.length ? `${label} · ${notes.length}` : label} onAdd={add} />
    {notes.length ? <Card style={{ padding: 0, overflow: 'hidden' }}>
      {notes.map((n, i) => <DocRow key={n.id} n={n} first={i === 0} />)}
    </Card> : <div onClick={add} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
      borderRadius: 11, cursor: 'pointer', border: '1px dashed ' + t.line2, fontFamily: f.ui, fontSize: 13, color: t.t3 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.sel; e.currentTarget.style.color = t.t2 }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.t3 }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px dashed ' + t.t3, flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon n="plus" s={12} /></span>
      Add {label.toLowerCase().replace(/s$/, '')}</div>}
  </div>
}

// ── Artifacts — project deliverables + Claude composer ──────────
function Artifacts({ project, notes, reload }) {
  const { t, f, go } = useApp()
  const rows = project.artifacts || []
  const [composing, setComposing] = useState(false)
  const [typeId, setTypeId] = useState(COMPOSE_TYPES[0].id)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [newId, setNewId] = useState(null)

  const run = async () => {
    setComposing(false); setBusy(true)
    try {
      const type = COMPOSE_TYPES.find((c) => c.id === typeId) || COMPOSE_TYPES[0]
      const body = await composeDeliverable(typeId, prompt.trim(), project.name, notes)
      const n = notes.length
      const title = `${project.name} — ${type.name}`
      const id = await createArtifact(project.id, {
        title, artType: typeId, body, provenance: `✦ Claude · from ${n} notes`, fromCount: n,
      })
      await reload()
      setNewId(id); setToast(title); setPrompt('')
      setTimeout(() => setToast(null), 4500)
      setTimeout(() => setNewId(null), 6000)
    } catch (e) {
      setToast('Couldn’t compose — ' + String(e?.message || e))
      setTimeout(() => setToast(null), 4500)
    } finally { setBusy(false) }
  }

  return <div style={{ position: 'relative' }}>
    <SectionHead label={rows.length ? 'Artifacts · ' + rows.length : 'Artifacts'}
      action={composing || busy ? null : '✦ Generate with Claude'} onAction={() => setComposing(true)} />

    {composing && <div style={{ background: t.card, border: '1px solid ' + t.accentLine, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <Icon n="sparkles" s={14} c={t.accent} />
        <span style={{ fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent }}>Ask Claude</span>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>reads this project's {notes.length} notes, drops the result here</span>
      </div>
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
        placeholder="Optional — extra instructions for Claude…"
        style={{ width: '100%', minHeight: 54, border: '1px solid ' + t.line2, borderRadius: 9, outline: 0, resize: 'vertical',
          background: t.bg, fontFamily: f.body, fontSize: 13.5, lineHeight: 1.5, color: t.t1, padding: '9px 11px' }} />
      <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
        <Btn kind="primary" size="sm" icon="sparkles" onClick={run}>Generate</Btn>
        <Btn kind="ghost" size="sm" onClick={() => setComposing(false)}>Cancel</Btn>
      </div>
    </div>}

    {busy && <Card style={{ padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 13,
      borderColor: t.accentLine, background: t.accentBg }}>
      <Icon n="loader-2" s={20} c={t.accent} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 13, fontWeight: 600, color: t.t1 }}>Claude is working…</div>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 1 }}>Reading {notes.length} notes in {project.name} · composing</div>
      </div>
    </Card>}

    {rows.length ? <Card style={{ padding: '4px 0', overflow: 'hidden' }}>
      {rows.map((a, i) => {
        const isNew = a.id === newId
        const type = COMPOSE_TYPES.find((c) => c.id === a.artType)
        return <div key={a.id} onClick={() => go({ screen: 'note', id: a.id })}
          className={isNew ? 'just-landed' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer',
            borderTop: i ? '1px solid ' + t.line : 'none' }}
          onMouseEnter={(e) => { if (!isNew) e.currentTarget.style.background = t.sel }}
          onMouseLeave={(e) => { if (!isNew) e.currentTarget.style.background = 'transparent' }}>
          <Icon n={type?.icon || 'file-export'} s={16} c={t.accent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontFamily: f.ui, fontSize: 11, color: t.t3 }}>
              <span>{a.provenance || 'Composed'}</span>{a.at && <Fragment><span style={{ opacity: 0.5 }}>·</span><span>{timeAgo(a.at)}</span></Fragment>}
            </div>
          </div>
          {isNew && <span style={{ fontFamily: f.label, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: t.onAccent, background: t.accent, borderRadius: 6, padding: '2px 7px' }}>New</span>}
          <Icon n="chevron-right" s={15} c={t.t3} />
        </div>
      })}
    </Card> : !busy && <div onClick={() => setComposing(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
      borderRadius: 11, cursor: 'pointer', border: '1px dashed ' + t.line2, fontFamily: f.ui, fontSize: 13, color: t.t3 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.sel; e.currentTarget.style.color = t.t2 }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.t3 }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px dashed ' + t.t3, flex: 'none', display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}><Icon n="plus" s={12} /></span>No artifacts yet — generate one with Claude</div>}

    {toast && <div style={{ position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 470, animation: 'toast-in .2s ease-out',
      display: 'flex', alignItems: 'center', gap: 10, background: t.card, border: '1px solid ' + t.accentLine,
      borderRadius: 12, boxShadow: t.shadow, padding: '11px 15px', maxWidth: '90vw' }}>
      <Icon n="sparkles" s={16} c={t.accent} />
      <span style={{ fontFamily: f.ui, fontSize: 13, color: t.t1 }}>Claude added <b style={{ fontWeight: 600 }}>{toast}</b> to Artifacts</span></div>}
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

// ── Right rail: Milestones ───────────────────────────────────────
function Milestones({ project, reload }) {
  const { t, f } = useApp()
  const ms = project.milestones || []
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')

  // legacy: a milestone's date may live as free text in `sub` ("Oct 3")
  const parseSub = (s) => {
    if (!s) return null
    const mm = /^([A-Za-z]{3,})\s+(\d{1,2})$/.exec(String(s).trim())
    if (!mm) return null
    const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mm[1].slice(0, 3).toLowerCase())
    return idx < 0 ? null : { m: idx, d: parseInt(mm[2], 10) }
  }
  const cycle = async (m) => {
    const next = m.state === 'done' ? 'upcoming' : m.state === 'current' ? 'done' : 'current'
    await updateMilestone(m.id, { state: next }); await reload()
  }
  const setMDate = async (m, d) => {
    const patch = { due: d || null }
    if (m.sub && parseSub(m.sub)) patch.sub = null // migrate legacy text-date out of sub
    await updateMilestone(m.id, patch); await reload()
  }
  const commit = async () => {
    const v = label.trim(); setLabel(''); setAdding(false)
    if (!v) return
    await createMilestone(project.id, { label: v, sort: ms.length }); await reload()
  }

  return <div>
    <SectionHead label="Milestones" action={adding ? null : '+ Add'} onAction={() => setAdding(true)} />
    <div style={{ paddingLeft: 4 }}>
      {ms.map((m, i) => {
        const last = i === ms.length - 1 && !adding
        const c = m.state === 'done' ? t.good : m.state === 'current' ? t.accent : t.line2
        const theDate = m.due || parseSub(m.sub)
        const note = m.sub && !parseSub(m.sub) ? m.sub : null
        return <div key={m.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: last ? 0 : 18 }}>
          {!last && <span style={{ position: 'absolute', left: 5, top: 16, bottom: 2, width: 1.5, background: t.line }} />}
          <span onClick={() => cycle(m)} title="Click to cycle status"
            style={{ width: 12, height: 12, borderRadius: 6, flex: 'none', marginTop: 2, zIndex: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: m.state === 'upcoming' ? t.bg : c, border: '2px solid ' + c,
              boxShadow: m.state === 'current' ? '0 0 0 3px ' + t.accentBg : 'none' }}>
            {m.state === 'done' && <Icon n="check" s={8} c={t.onAccent} />}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div onClick={() => cycle(m)} title="Click to cycle status"
              style={{ fontFamily: f.body, fontSize: 13.5, lineHeight: 1.35, cursor: 'pointer',
                color: m.state === 'upcoming' ? t.t3 : t.t1, fontWeight: m.state === 'current' ? 600 : 400 }}>{m.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                <DatePill value={theDate} onChange={(d) => setMDate(m, d)} label="" empty="+ date"
                  icon="calendar" variant="accent" bottom="calc(100% + 6px)" /></span>
              {note && <span style={{ fontFamily: f.ui, fontSize: 11, color: m.state === 'current' ? t.accent : t.t3 }}>{note}</span>}
            </div>
          </div>
        </div>
      })}

      {adding && <div style={{ display: 'flex', gap: 12, position: 'relative' }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, flex: 'none', marginTop: 2, border: '2px dashed ' + t.line2, background: t.bg }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setLabel(''); setAdding(false) } }}
            placeholder="Milestone…" style={{ width: '100%', border: '1px solid ' + t.line2, borderRadius: 8,
              outline: 0, background: t.card, fontFamily: f.body, fontSize: 13.5, color: t.t1, padding: '6px 9px' }} />
          <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
            <Btn kind="primary" size="sm" onClick={commit}>Add</Btn>
            <Btn kind="ghost" size="sm" onClick={() => { setLabel(''); setAdding(false) }}>Cancel</Btn>
          </div>
        </div>
      </div>}
    </div>
  </div>
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
  const { projectById, allProjects, ownedNotes, linkedMeetings, reload } = useData()
  const project = projectById(route.id) || allProjects()[0]

  if (!project) return null

  const owned = ownedNotes(project.id)
  const linked = linkedMeetings(project.id)
  const briefingNotes = [...owned, ...linked]
  const meetings = [...owned.filter((n) => n.kind === 'meeting'), ...linked]
  const docNotes = owned.filter((n) => n.kind === 'note' || n.kind === 'knowledge' || n.kind === 'brainstorm')

  const main = <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
    <Briefing project={project} notes={briefingNotes} />
    <Updates project={project} reload={reload} />
    <Tasks project={project} reload={reload} />
    <ActionItems project={project} reload={reload} />
    <DocSection label="Meetings" notes={meetings} kind="meeting" project={project} />
    <DocSection label="Notes" notes={docNotes} kind="note" project={project} />
    <Artifacts project={project} notes={briefingNotes} reload={reload} />
  </div>

  const rail = <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
    <ScopedAsk project={project} />
    <Milestones project={project} reload={reload} />
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
