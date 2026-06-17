// Task Sheet — long-press (~450ms) any task row to edit status / due / work type
// / waiting-on / notes, delete, reassign project, or push to Apple Reminders.
// Ported from the prototype's course-task-sheet.jsx; patches are in real task
// shape (the parent persists via updateTask). Tap still toggles done.
import { useState, useEffect, useRef } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, IconBtn, Btn, Popover, PopRow, AreaDot, areaColor, DatePill, fmtDate, TODAY } from '../kit'

// ── useLongPress — tap vs hold, movement-cancel + suppressed click ──
export function useLongPress(onLong, onTap, ms = 450) {
  const timer = useRef(null); const fired = useRef(false); const origin = useRef(null)
  const [pressing, setPressing] = useState(false)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } setPressing(false) }
  const start = (e) => {
    if (e.button === 2) return
    if (e.target && e.target.closest && e.target.closest('.task-grip')) return
    fired.current = false
    const pt = (e.touches && e.touches[0]) ? e.touches[0] : e
    origin.current = { x: pt.clientX, y: pt.clientY }
    setPressing(true)
    timer.current = setTimeout(() => { fired.current = true; setPressing(false); timer.current = null
      try { if (navigator.vibrate) navigator.vibrate(9) } catch {}
      onLong() }, ms)
  }
  const move = (e) => {
    if (!origin.current) return
    const pt = (e.touches && e.touches[0]) ? e.touches[0] : e
    if (Math.abs(pt.clientX - origin.current.x) > 9 || Math.abs(pt.clientY - origin.current.y) > 9) clear()
  }
  const end = () => clear()
  const click = (e) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; return } onTap && onTap(e) }
  return { pressing, handlers: {
    onMouseDown: start, onMouseMove: move, onMouseUp: end, onMouseLeave: end,
    onTouchStart: start, onTouchMove: move, onTouchEnd: end, onTouchCancel: end,
    onContextMenu: (e) => e.preventDefault(), onClick: click,
  } }
}

// derive a single status chip from real task flags
export function taskStatus(x) {
  if (x.done) return 'done'
  if (x.taskStatus === 'waiting' || x.waiting) return 'waiting'
  if (x.taskStatus === 'in-progress') return 'in_progress'
  if (x.next) return 'next'
  return 'none'
}
const STATUS_OPTS = [
  { id: 'none', label: 'None', icon: 'circle-dotted' },
  { id: 'next', label: 'Next', icon: 'arrow-up-right' },
  { id: 'in_progress', label: 'In progress', icon: 'progress' },
  { id: 'waiting', label: 'Waiting', icon: 'player-pause' },
  { id: 'done', label: 'Done', icon: 'circle-check' },
]
const WORK_OPTS = [{ id: 'deep', label: 'Deep work' }, { id: 'admin', label: 'Admin' }, { id: 'scheduled', label: 'Scheduled' }]
const addDays = (base, n) => { const dt = new Date(base.y, base.m, base.d + n); return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() } }
const nextMonday = (base) => { const dow = new Date(base.y, base.m, base.d).getDay(); return addDays(base, ((8 - dow) % 7) || 7) }

function FieldLabel({ children }) {
  const { t, f } = useApp()
  return <div style={{ fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.t3, marginBottom: 8 }}>{children}</div>
}
function Chip({ active, onClick, children, tone }) {
  const { t, f } = useApp()
  const accent = tone || t.accent
  return <span onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap', color: active ? t.onAccent : t.t2, background: active ? accent : t.sel,
    border: '1px solid ' + (active ? accent : 'transparent'), borderRadius: 8, padding: '7px 12px', transition: 'background .12s, color .12s' }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = t.tagBg }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = t.sel }}>{children}</span>
}

export function TaskSheet({ task, projectId, onPatch, onDelete, onClose, onReassign }) {
  const { t, f, go, isMobile } = useApp()
  const { projectById, allProjects, areas, areaName } = useData()
  const project = projectById(projectId)
  // Pillar-only task (no project): show its pillar instead of "No project".
  const pillarId = !project ? (task.area || null) : null
  const pillarName = pillarId ? areaName(pillarId) : null
  const [mounted, setMounted] = useState(false)
  const [projOpen, setProjOpen] = useState(false)
  const [title, setTitle] = useState(task.label || '')
  const [pushed, setPushed] = useState(false)
  const titleRef = useRef(null)
  // The long-press that opened this sheet emits a synthetic mouse/click event on
  // release (esp. on touch). Stay "unarmed" briefly so that stray event can't
  // dismiss the sheet the instant it appears.
  const armed = useRef(false)

  useEffect(() => { const r = requestAnimationFrame(() => setMounted(true)); const a = setTimeout(() => { armed.current = true }, 300); return () => { cancelAnimationFrame(r); clearTimeout(a) } }, [])
  const close = () => { setMounted(false); setTimeout(onClose, 180) }
  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') close() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [])

  const status = taskStatus(task)
  const setStatus = (id) => {
    if (id === 'done') onPatch({ done: true })
    else if (id === 'next') onPatch({ done: false, next: true, taskStatus: 'next', waiting: null })
    else if (id === 'in_progress') onPatch({ done: false, next: false, taskStatus: 'in-progress', waiting: null })
    else if (id === 'waiting') onPatch({ done: false, next: false, taskStatus: 'waiting' })
    else onPatch({ done: false, next: false, taskStatus: 'none', waiting: null })
  }
  const commitTitle = () => { const v = title.trim(); if (v && v !== task.label) onPatch({ label: v }); else if (!v) setTitle(task.label) }
  const autosize = (el) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
  useEffect(() => { autosize(titleRef.current) }, [])

  const pushReminders = () => {
    const d = task.dueDate ? fmtDate(task.dueDate) : (task.due || '')
    const input = [task.label || '', d, project?.name || ''].join('|')
    try { window.location.href = 'shortcuts://run-shortcut?name=CourseAddReminder&input=text&text=' + encodeURIComponent(input) } catch {}
    setPushed(true)
  }

  const row = (label, control) => <div style={{ padding: '14px 20px', borderTop: '1px solid ' + t.line }}><FieldLabel>{label}</FieldLabel>{control}</div>

  return <div onClick={() => { if (armed.current) close() }} style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(0,0,0,0.44)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', opacity: mounted ? 1 : 0, transition: 'opacity .18s ease' }}>
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '96vw', background: t.card, border: '1px solid ' + t.line,
      borderRadius: isMobile ? '20px 20px 0 0' : '18px 18px 0 0', boxShadow: t.shadow, overflow: 'hidden', maxHeight: '86vh',
      display: 'flex', flexDirection: 'column', transform: mounted ? 'translateY(0)' : 'translateY(24px)', transition: 'transform .2s cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '9px 0 2px', flex: 'none' }}>
        <span style={{ width: 38, height: 4, borderRadius: 3, background: t.line2 }} /></div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 16px 16px' }}>
          <span onClick={() => onPatch({ done: !task.done })} style={{ width: 22, height: 22, borderRadius: 7, flex: 'none', marginTop: 2, position: 'relative', cursor: 'pointer', border: '1.5px solid ' + (task.done ? t.accent : t.t3), background: task.done ? t.accent : 'transparent' }}>
            {task.done && <Icon n="check" s={15} c={t.onAccent} style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}</span>
          <textarea ref={titleRef} value={title} rows={1} onChange={(e) => { setTitle(e.target.value); autosize(e.target) }} onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }} className="selectable"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, resize: 'none', background: 'transparent', fontFamily: f.body, fontSize: 17, fontWeight: 500, lineHeight: 1.35, color: task.done ? t.t3 : t.t1, textDecoration: task.done ? 'line-through' : 'none', padding: 0, marginTop: 1 }} />
          <IconBtn n="x" s={19} onClick={close} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 16px', flexWrap: 'wrap' }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span onClick={() => onReassign && setProjOpen((o) => !o)} title={onReassign ? 'Change project or pillar' : undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '5px 11px', cursor: onReassign ? 'pointer' : 'default' }}>
              {project ? <><AreaDot areaId={project.area} s={7} />{project.name}</>
                : pillarName ? <><AreaDot areaId={pillarId} s={7} />{pillarName} <span style={{ color: t.t3, fontWeight: 500 }}>· pillar</span></>
                : <span style={{ color: t.t3, fontWeight: 500 }}>No project</span>}
              {onReassign && <Icon n="chevron-down" s={13} c={t.t3} />}</span>
            {projOpen && <Popover onClose={() => setProjOpen(false)} width={252} maxHeight={340}>
              <div style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.t3, padding: '7px 12px 4px' }}>Pillar only</div>
              {(areas || []).map((a) => <PopRow key={'a-' + a.id} dot={areaColor(t, a.id)} label={a.name} hint="pillar" on={!project && pillarId === a.id}
                onClick={() => { setProjOpen(false); onReassign({ area: a.id }) }} />)}
              <div style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.t3, padding: '9px 12px 4px', borderTop: '1px solid ' + t.line, marginTop: 4 }}>Projects</div>
              {allProjects().map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={p.areaName} on={!!project && p.id === projectId}
                onClick={() => { setProjOpen(false); onReassign({ project: p.id }) }} />)}</Popover>}
          </span>
          {project && <span onClick={() => { go({ screen: 'project', id: projectId }); onClose() }} title="Open project"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11.5, color: t.t3, cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
            <Icon n="arrow-up-right" s={13} />Open</span>}
          {task.srcMeeting && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
            <Icon n="users" s={13} />from meeting</span>}
        </div>
        {row('Status', <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {STATUS_OPTS.map((s) => <Chip key={s.id} active={status === s.id} onClick={() => setStatus(s.id)} tone={s.id === 'done' ? t.good : t.accent}><Icon n={s.icon} s={14} />{s.label}</Chip>)}
        </div>)}
        {row('Due', (() => {
          const d = task.dueDate || null
          const eq = (a) => d && a && d.y === a.y && d.m === a.m && d.d === a.d
          const today = { ...TODAY }, tomorrow = addDays(TODAY, 1), nextWk = nextMonday(TODAY)
          return <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <DatePill value={d} onChange={(v) => onPatch({ dueDate: v || null })} label="" empty="+ Pick a date" bottom="calc(100% + 8px)" />
            <Chip active={eq(today)} onClick={() => onPatch({ dueDate: today })} tone={t.risk}>Today</Chip>
            <Chip active={eq(tomorrow)} onClick={() => onPatch({ dueDate: tomorrow })} tone={t.risk}>Tomorrow</Chip>
            <Chip active={eq(nextWk)} onClick={() => onPatch({ dueDate: nextWk })} tone={t.risk}>Next week</Chip>
            {typeof task.due === 'string' && !d && <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3 }}>was “{task.due}”</span>}
          </div>
        })())}
        {row('Work type', <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {WORK_OPTS.map((w) => <Chip key={w.id} active={task.workType === w.id} onClick={() => onPatch({ workType: task.workType === w.id ? null : w.id })}>{w.label}</Chip>)}
        </div>)}
        {row('Waiting on', <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: t.sel, borderRadius: 9, padding: '0 12px', height: 38 }}>
          <Icon n="player-pause" s={15} c={t.t3} />
          <input value={task.waiting || ''} onChange={(e) => onPatch({ waiting: e.target.value || null })} placeholder="A person or dependency…"
            style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: f.ui, fontSize: 13, color: t.t1 }} /></div>)}
        {row('Notes', <textarea value={task.notes || ''} onChange={(e) => onPatch({ notes: e.target.value || null })} placeholder="Add detail…" rows={2} className="selectable"
          style={{ width: '100%', border: '1px solid ' + t.line2, outline: 'none', resize: 'vertical', background: t.bg, borderRadius: 9, padding: '9px 11px', fontFamily: f.body, fontSize: 13.5, lineHeight: 1.5, color: t.t1 }} />)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px', borderTop: '1px solid ' + t.line, background: t.panel, flex: 'none' }}>
        <button onClick={() => onDelete(task.id)} title="Delete task" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.risk, background: 'transparent', border: '1px solid transparent', borderRadius: 9, padding: '8px 11px', cursor: 'pointer' }}
          onMouseEnter={(e) => e.currentTarget.style.background = t.riskBg} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon n="trash" s={15} />Delete</button>
        <div style={{ flex: 1 }} />
        {pushed ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.good }}><Icon n="circle-check" s={16} />Sent to Reminders</span>
          : <Btn kind="outline" size="sm" icon="brand-apple" onClick={pushReminders}>Push to Reminders</Btn>}
        <Btn kind="primary" size="sm" icon="check" onClick={close}>Done</Btn>
      </div>
    </div>
  </div>
}
