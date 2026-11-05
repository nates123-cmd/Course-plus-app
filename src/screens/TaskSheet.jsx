// Task Sheet — long-press (~450ms) any task row to edit status / due / work type
// / waiting-on / notes, delete, reassign project, or push to Apple Reminders.
// Ported from the prototype's course-task-sheet.jsx; patches are in real task
// shape (the parent persists via updateTask). Tap still toggles done.
import { useState, useEffect, useRef } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, IconBtn, Btn, Popover, FloatPop, PopRow, AreaDot, areaColor, DatePill, fmtDate, TODAY } from '../kit'
import { PRESETS, matchPreset, recurrenceLabel, normalizeRule, nextDate, todayYmd } from '../lib/recurrence'
import { normalizeTitle } from '../lib/seriesAgenda'
import { resolveFreeText, encodePersonLink, parsePersonLink, meetingLabel, isPersonLink, isPendingLink, encodePending, pendingText } from '../lib/meetingMatch'
import { loadMeetingCatalog, hintFor, aiMeetingList } from '../lib/meetingCatalog'
import { aiPick } from '../lib/meetingRouter'
import { MeetingSource } from '../components/MeetingSource'
import { routeToMeeting } from '../lib/ai'

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

// derive a single status chip from real task flags. `task_status` doubles as the
// pull-board lane: 'now' = pulled into the Now lane (the old "in progress"), any
// other open value = Icebox. next/waiting stay their own columns.
export function taskStatus(x) {
  if (x.done) return 'done'
  if (x.taskStatus === 'now') return 'now'
  if (x.taskStatus === 'waiting' || x.waiting) return 'waiting'
  if (x.next) return 'next'
  return 'none'
}
const STATUS_OPTS = [
  { id: 'none', label: 'None', icon: 'circle-dotted' },
  { id: 'now', label: 'Now', icon: 'player-play' },
  { id: 'next', label: 'Next', icon: 'arrow-up-right' },
  { id: 'waiting', label: 'Waiting', icon: 'player-pause' },
  { id: 'done', label: 'Done', icon: 'circle-check' },
]
const WORK_OPTS = [{ id: 'deep', label: 'Deep work' }, { id: 'admin', label: 'Admin' }, { id: 'scheduled', label: 'Scheduled' }]
const PRIO_OPTS = [{ id: 1, label: 'P1', tone: 'risk' }, { id: 2, label: 'P2', tone: 'accent' }, { id: 3, label: 'P3', tone: 't3' }]
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
    border: '1px solid ' + (active ? accent : 'transparent'), borderRadius: 'calc(8px * var(--rs))', padding: '7px 12px', transition: 'background .12s, color .12s' }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = t.tagBg }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = t.sel }}>{children}</span>
}

// ── Repeats ────────────────────────────────────────────────────────
// Presets cover what a task actually repeats on; Custom opens the full rule
// (interval, weekday set, day of month, what it counts from, and an end).
// Completing the task is what creates the next one, so the preview below shows
// the date the successor would land on — the rule is otherwise hard to picture.
const WD_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const END_NEVER = 'never', END_ON = 'on', END_AFTER = 'after'

function RepeatField({ task, onPatch }) {
  const { t, f } = useApp()
  const rule = normalizeRule(task.recurrence)
  const anchor = task.dueDate || null
  const [custom, setCustom] = useState(false)
  const preset = rule ? matchPreset(rule, anchor) : null
  // Open the editor automatically for a rule no preset chip can represent,
  // otherwise the sheet would show "Custom" lit with nothing to read it by.
  useEffect(() => { if (rule && !preset) setCustom(true) }, [rule && !preset])

  const set = (patch) => onPatch({ recurrence: { ...(rule || { freq: 'weekly', interval: 1, from: 'due' }), ...patch } })
  const clear = () => { setCustom(false); onPatch({ recurrence: null }) }
  const preview = rule ? nextDate(rule, anchor || todayYmd()) : null
  const endMode = !rule ? END_NEVER : rule.until ? END_ON : rule.count ? END_AFTER : END_NEVER

  const numField = (value, onChange, width = 54) => <input type="number" min={1} value={value}
    onChange={(e) => onChange(Math.max(1, Math.round(Number(e.target.value) || 1)))}
    style={{ width, border: '1px solid ' + t.line2, borderRadius: 'calc(8px * var(--rs))', outline: 0, background: t.bg,
      fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, padding: '6px 8px' }} />

  return <div>
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      {PRESETS.map((p) => <Chip key={p.id} active={preset === p.id}
        onClick={() => { setCustom(false); preset === p.id ? clear() : onPatch({ recurrence: p.build(anchor) }) }}>{p.label}</Chip>)}
      <Chip active={!!rule && !preset} onClick={() => { setCustom((o) => !o); if (!rule) onPatch({ recurrence: { freq: 'weekly', interval: 1, from: 'due' } }) }}>
        <Icon n="adjustments-horizontal" s={13} />Custom</Chip>
      {rule && <Chip onClick={clear} tone={t.risk}><Icon n="x" s={13} />Clear</Chip>}
    </div>

    {rule && custom && <div style={{ marginTop: 12, padding: 12, background: t.sel, borderRadius: 'calc(10px * var(--rs))', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>Every</span>
        {numField(rule.interval, (n) => set({ interval: n }))}
        {[['daily', 'days'], ['weekly', 'weeks'], ['monthly', 'months'], ['yearly', 'years']].map(([id, lbl]) =>
          <Chip key={id} active={rule.freq === id} onClick={() => set({ freq: id })}>{lbl}</Chip>)}
      </div>

      {rule.freq === 'weekly' && <div style={{ display: 'flex', gap: 5 }}>
        {WD_LETTERS.map((L, i) => {
          const on = (rule.weekdays || []).includes(i)
          return <span key={i} onClick={() => {
            const cur = rule.weekdays || []
            set({ weekdays: on ? cur.filter((d) => d !== i) : [...cur, i] })
          }} style={{ width: 32, height: 32, borderRadius: 'calc(8px * var(--rs))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontFamily: f.ui, fontSize: 12.5, fontWeight: 700,
            color: on ? t.onAccent : t.t2, background: on ? t.accent : t.bg, border: '1px solid ' + (on ? t.accent : t.line2) }}>{L}</span>
        })}
      </div>}

      {rule.freq === 'monthly' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>On</span>
        {numField(rule.monthDay === 'last' ? (anchor ? anchor.d : 1) : (rule.monthDay ?? (anchor ? anchor.d : 1)), (n) => set({ monthDay: Math.min(31, n) }), 58)}
        <Chip active={rule.monthDay === 'last'} onClick={() => set({ monthDay: rule.monthDay === 'last' ? (anchor ? anchor.d : 1) : 'last' })}>Last day</Chip>
      </div>}

      <div>
        <FieldLabel>Counts from</FieldLabel>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <Chip active={rule.from !== 'completion'} onClick={() => set({ from: 'due' })}>Its due date</Chip>
          <Chip active={rule.from === 'completion'} onClick={() => set({ from: 'completion' })}>When I finish it</Chip>
        </div>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, lineHeight: 1.5, marginTop: 7 }}>
          {rule.from === 'completion'
            ? 'Late once, late always — the next one is counted off the day you tick this off.'
            : 'Keeps its place on the calendar even if you finish it late.'}
        </div>
      </div>

      <div>
        <FieldLabel>Ends</FieldLabel>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip active={endMode === END_NEVER} onClick={() => onPatch({ recurrence: { ...rule, until: null, count: null } })}>Never</Chip>
          <Chip active={endMode === END_AFTER} onClick={() => onPatch({ recurrence: { ...rule, until: null, count: rule.count || 5 } })}>After…</Chip>
          {endMode === END_AFTER && <>{numField(rule.count || 5, (n) => onPatch({ recurrence: { ...rule, until: null, count: n } }))}
            <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>times</span></>}
          <Chip active={endMode === END_ON} onClick={() => onPatch({ recurrence: { ...rule, count: null, until: rule.until || preview } })}>On date…</Chip>
          {endMode === END_ON && <DatePill value={rule.until || null} onChange={(v) => onPatch({ recurrence: { ...rule, count: null, until: v || null } })}
            label="" empty="+ End date" />}
        </div>
      </div>
    </div>}

    {rule && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontFamily: f.ui, fontSize: 11.5, color: t.t3, lineHeight: 1.5 }}>
      <Icon n="repeat" s={13} c={t.accent} />
      <span><b style={{ color: t.t2, fontWeight: 600 }}>{recurrenceLabel(rule)}</b>
        {preview && <> · next one lands {fmtDate(preview)}</>}</span>
    </div>}
    {rule && !anchor && <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, lineHeight: 1.5, marginTop: 6 }}>
      No due date yet, so the first repeat counts from the day you complete it.
    </div>}
  </div>
}

export function TaskSheet({ task, projectId, onPatch, onDelete, onClose, onReassign }) {
  const { t, f, go, isMobile } = useApp()
  const { projectById, allProjects, areas, areaName, activeSeries, routeTaskMeeting } = useData()
  const project = projectById(projectId)
  // Pillar-only task (no project): show its pillar instead of "No project".
  const pillarId = !project ? (task.area || null) : null
  const pillarName = pillarId ? areaName(pillarId) : null
  const [mounted, setMounted] = useState(false)
  const [projOpen, setProjOpen] = useState(false)
  const [mtgOpen, setMtgOpen] = useState(false)
  const [agenda, setAgenda] = useState({ week: [], recurring: [], all: [] }) // meetings from the Agenda (placed_blocks) + series
  const [mtgText, setMtgText] = useState('')
  const [source, setSource] = useState(false)
  const mtgAnchor = useRef(null)
  const [title, setTitle] = useState(task.label || '')
  // Groups have no table of their own — the set of groups in a project is just
  // the distinct labels its tasks carry, so naming a new one here creates it and
  // clearing the last task off one makes it disappear.
  const [groupNew, setGroupNew] = useState(null) // null = closed, '' = typing
  const projectGroups = [...new Set(((project && project.tasks) || [])
    .map((x) => x.groupLabel).filter(Boolean))].sort()
  const commitGroup = () => {
    const name = (groupNew || '').trim()
    if (name) onPatch({ groupLabel: name })
    setGroupNew(null)
  }
  const [pushed, setPushed] = useState(false)
  const titleRef = useRef(null)
  // The long-press that opened this sheet emits a synthetic mouse/click event on
  // release (esp. on touch). Stay "unarmed" briefly so that stray event can't
  // dismiss the sheet the instant it appears.
  const armed = useRef(false)

  useEffect(() => { const r = requestAnimationFrame(() => setMounted(true)); const a = setTimeout(() => { armed.current = true }, 300); return () => { cancelAnimationFrame(r); clearTimeout(a) } }, [])
  const close = () => { closeMtg(); setMounted(false); setTimeout(onClose, 180) }
  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') close() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [])

  const status = taskStatus(task)
  const setStatus = (id) => {
    // 'now' pulls the task into the Now lane; the rest leave it in Icebox with
    // their respective hint. taskStatus carries the lane, next/waiting the hints.
    if (id === 'done') onPatch({ done: true })
    else if (id === 'now') onPatch({ done: false, next: false, taskStatus: 'now', waiting: null })
    else if (id === 'next') onPatch({ done: false, next: true, taskStatus: 'backlog', waiting: null })
    else if (id === 'waiting') onPatch({ done: false, next: false, taskStatus: 'waiting' })
    else onPatch({ done: false, next: false, taskStatus: 'backlog', waiting: null })
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

  // "Scheduled" work type = to be discussed in a meeting → must be assigned one.
  // The meetings come from the AGENDA (`placed_blocks` where type='meeting',
  // shared with Today) plus the series. We store the chosen meeting's title in
  // task.meetingId (readable, survives Today regenerating the block), or a
  // person link ("@Jon: JS/NS 1:1 | …", see lib/meetingMatch) for "the next
  // meeting with Jon", which lands in whichever of those comes first.
  //
  // Reads five weeks ahead so a weekly or fortnightly meeting shows up as
  // recurring (its title appears more than once) and so "next meeting with X"
  // can find a 1:1 that isn't this week. Fetched only once Scheduled is in play.
  const wantsMeetings = task.workType === 'scheduled' || mtgOpen
  useEffect(() => {
    if (!wantsMeetings || agenda.loaded) return
    let live = true
    loadMeetingCatalog(activeSeries || []).then((c) => { if (live) setAgenda(c) })
      .catch((e) => { console.warn('[course+] meeting catalog', e); if (live) setAgenda({ loaded: true, all: [], recurring: [], week: [] }) })
    return () => { live = false }
  }, [wantsMeetings]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickMeeting = (title) => { setMtgOpen(false); setMtgText(''); onPatch({ workType: 'scheduled', meetingId: title }) }
  const pickPerson = (name, meetings) => pickMeeting(encodePersonLink(name, meetings.map((m) => m.title)))
  // Typed but not picked: save the words now, route in the background (see
  // DataContext.routeTaskMeeting). Never lost to a closed popover or sheet.
  const pickText = (text) => {
    const v = (text || '').trim()
    setMtgOpen(false); setMtgText('')
    if (v.length < 2) return
    if (!routeTaskMeeting(task.id, v)) onPatch({ workType: 'scheduled', meetingId: encodePending(v) })
  }
  // Closing with words typed and no meeting yet counts as "go find it".
  const closeMtg = () => { if (mtgOpen && mtgText.trim().length >= 2 && !task.meetingId) pickText(mtgText); else { setMtgOpen(false); setMtgText('') } }
  const sameMeeting = (title) => !isPersonLink(task.meetingId) && normalizeTitle(task.meetingId || '') === normalizeTitle(title)
  const chooseWork = (id) => {
    if (task.workType === id) { onPatch(id === 'scheduled' ? { workType: null, meetingId: null } : { workType: null }); return }
    onPatch(id === 'scheduled' ? { workType: 'scheduled' } : { workType: id, meetingId: null })
    if (id === 'scheduled' && !task.meetingId) setMtgOpen(true) // make them assign a meeting
  }

  return <div onClick={() => { if (armed.current) close() }} style={{ position: 'fixed', inset: 0, zIndex: 450, background: 'rgba(0,0,0,0.44)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', opacity: mounted ? 1 : 0, transition: 'opacity .18s ease' }}>
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '96vw', background: t.card, border: '1px solid ' + t.line,
      borderRadius: isMobile ? '20px 20px 0 0' : '18px 18px 0 0', boxShadow: t.shadow, overflow: 'hidden', maxHeight: '86vh',
      display: 'flex', flexDirection: 'column', transform: mounted ? 'translateY(0)' : 'translateY(24px)', transition: 'transform .2s cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '9px 0 2px', flex: 'none' }}>
        <span style={{ width: 38, height: 4, borderRadius: 'calc(3px * var(--rs))', background: t.line2 }} /></div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 16px 16px' }}>
          <span onClick={() => onPatch({ done: !task.done })} style={{ width: 22, height: 22, borderRadius: 'calc(7px * var(--rs))', flex: 'none', marginTop: 2, position: 'relative', cursor: 'pointer', border: '1.5px solid ' + (task.done ? t.accent : t.t3), background: task.done ? t.accent : 'transparent' }}>
            {task.done && <Icon n="check" s={15} c={t.onAccent} style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}</span>
          <textarea ref={titleRef} value={title} rows={1} onChange={(e) => { setTitle(e.target.value); autosize(e.target) }} onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }} className="selectable"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, resize: 'none', background: 'transparent', fontFamily: f.body, fontSize: 17, fontWeight: 500, lineHeight: 1.35, color: task.done ? t.t3 : t.t1, textDecoration: task.done ? 'line-through' : 'none', padding: 0, marginTop: 1 }} />
          <IconBtn n="x" s={19} onClick={close} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 16px', flexWrap: 'wrap' }}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <span onClick={() => onReassign && setProjOpen((o) => !o)} title={onReassign ? 'Change project or pillar' : undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 'calc(8px * var(--rs))', padding: '5px 11px', cursor: onReassign ? 'pointer' : 'default' }}>
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
          {task.srcMeeting && <span onClick={() => setSource(true)} title="Where this came from"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 11.5, color: t.t3, cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
            <Icon n="users" s={13} />from meeting<Icon n="info-circle" s={12} /></span>}
        </div>
        {row('Status', <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {STATUS_OPTS.map((s) => <Chip key={s.id} active={status === s.id} onClick={() => setStatus(s.id)} tone={s.id === 'done' ? t.good : t.accent}><Icon n={s.icon} s={14} />{s.label}</Chip>)}
        </div>)}
        {row('Due', (() => {
          const d = task.dueDate || null
          const eq = (a) => d && a && d.y === a.y && d.m === a.m && d.d === a.d
          const today = { ...TODAY }, tomorrow = addDays(TODAY, 1), nextWk = nextMonday(TODAY)
          return <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <DatePill value={d} onChange={(v) => onPatch({ dueDate: v || null })} label="" empty="+ Pick a date" />
            <Chip active={eq(today)} onClick={() => onPatch({ dueDate: today })} tone={t.risk}>Today</Chip>
            <Chip active={eq(tomorrow)} onClick={() => onPatch({ dueDate: tomorrow })} tone={t.risk}>Tomorrow</Chip>
            <Chip active={eq(nextWk)} onClick={() => onPatch({ dueDate: nextWk })} tone={t.risk}>Next week</Chip>
            {typeof task.due === 'string' && !d && <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3 }}>was “{task.due}”</span>}
            {task.taskStatus === 'deferred' && d && !task.done && <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
              <Icon n="player-play" s={12} c={t.accent} />Out of Now until {fmtDate(d)}, then it moves back into Now.</div>}
          </div>
        })())}
        {row('Repeats', <RepeatField task={task} onPatch={onPatch} />)}
        {row('Priority', <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {PRIO_OPTS.map((p) => <Chip key={p.id} active={task.priority === p.id} tone={t[p.tone]} onClick={() => onPatch({ priority: task.priority === p.id ? null : p.id })}>{p.label}</Chip>)}
        </div>)}
        {row('Work type', <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {WORK_OPTS.map((w) => <Chip key={w.id} active={task.workType === w.id} onClick={() => chooseWork(w.id)}>{w.label}</Chip>)}
        </div>)}
        {row('Group', <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {projectGroups.map((g) => <Chip key={g} active={task.groupLabel === g}
            onClick={() => onPatch({ groupLabel: task.groupLabel === g ? null : g })}>{g}</Chip>)}
          {groupNew === null
            ? <Chip onClick={() => setGroupNew('')}><Icon n="plus" s={13} />{projectGroups.length ? 'New group' : 'Group these'}</Chip>
            : <input autoFocus value={groupNew} onChange={(e) => setGroupNew(e.target.value)}
                onBlur={commitGroup}
                onKeyDown={(e) => { if (e.key === 'Enter') commitGroup(); if (e.key === 'Escape') setGroupNew(null) }}
                placeholder="Group name…" style={{ width: 150, border: '1px solid ' + t.line2, borderRadius: 'calc(8px * var(--rs))', outline: 0,
                  background: t.bg, fontFamily: f.ui, fontSize: 12.5, color: t.t1, padding: '6px 10px' }} />}
        </div>)}
        {task.workType === 'scheduled' && row('Scheduled for', (() => {
          const assigned = task.meetingId || null
          return <span style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span ref={mtgAnchor} onClick={() => setMtgOpen((o) => !o)} title="Which meeting on your agenda will this be discussed in?"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderRadius: 'calc(8px * var(--rs))', padding: '6px 11px',
                color: assigned ? t.t1 : t.risk, background: assigned ? t.sel : t.riskBg, border: '1px solid ' + (assigned ? 'transparent' : t.riskLine) }}>
              <Icon n={isPendingLink(assigned) ? 'sparkles' : isPersonLink(assigned) ? 'user' : 'calendar-event'} s={14} />{assigned ? meetingLabel(assigned) : 'Pick a meeting'}<Icon n="chevron-down" s={13} c={t.t3} /></span>
            {isPersonLink(assigned) && (() => { const pl = parsePersonLink(assigned)
              return pl.titles.length > 0 && <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, lineHeight: 1.5, marginTop: 7 }}>
                Comes up in whichever is first: {pl.titles.join(', ')}.</div> })()}
            {isPendingLink(assigned) && <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, lineHeight: 1.5, marginTop: 7 }}>
              Working it out in the background. If it isn't on your calendar yet, it links once it shows up.</div>}
            {mtgOpen && <FloatPop anchorRef={mtgAnchor} onClose={closeMtg} width={320} estHeight={380} maxHeight={380}>
              <MeetingPicker agenda={agenda} text={mtgText} setText={setMtgText} hintFor={hintFor} sameMeeting={sameMeeting}
                onPick={pickMeeting} onPickPerson={pickPerson} onPickText={pickText} assigned={task.meetingId} task={task} projectName={project?.name || pillarName || ""} />
            </FloatPop>}
          </span>
        })())}
        {row('Waiting on', <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: t.sel, borderRadius: 'calc(9px * var(--rs))', padding: '0 12px', height: 38 }}>
          <Icon n="player-pause" s={15} c={t.t3} />
          <input value={task.waiting || ''} onChange={(e) => onPatch({ waiting: e.target.value || null })} placeholder="A person or dependency…"
            style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: f.ui, fontSize: 13, color: t.t1 }} /></div>)}
        {row('Notes', <textarea value={task.notes || ''} onChange={(e) => onPatch({ notes: e.target.value || null })} placeholder="Add detail…" rows={2} className="selectable"
          style={{ width: '100%', border: '1px solid ' + t.line2, outline: 'none', resize: 'vertical', background: t.bg, borderRadius: 'calc(9px * var(--rs))', padding: '9px 11px', fontFamily: f.body, fontSize: 13.5, lineHeight: 1.5, color: t.t1 }} />)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px', borderTop: '1px solid ' + t.line, background: t.panel, flex: 'none' }}>
        <button onClick={() => onDelete(task.id)} title="Delete task" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.risk, background: 'transparent', border: '1px solid transparent', borderRadius: 'calc(9px * var(--rs))', padding: '8px 11px', cursor: 'pointer' }}
          onMouseEnter={(e) => e.currentTarget.style.background = t.riskBg} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon n="trash" s={15} />Delete</button>
        <div style={{ flex: 1 }} />
        {pushed ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.good }}><Icon n="circle-check" s={16} />Sent to Reminders</span>
          : <Btn kind="outline" size="sm" icon="brand-apple" onClick={pushReminders}>Push to Reminders</Btn>}
        <Btn kind="primary" size="sm" icon="check" onClick={close}>Done</Btn>
      </div>
    </div>
    {source && task.srcMeeting && <MeetingSource noteId={task.srcMeeting} label={task.label} detail={task.notes} onClose={() => setSource(false)} />}
  </div>
}

// The Scheduled picker. Claude does the routing: it reads plain language
// ("bring it up when I see Jon", "the pricing working session", "standup
// tomorrow") against the calendar, and on open with nothing typed it reads the
// task itself ("Ask Jon what ..." -> Jon). Its answer leads as "Suggested" and
// is what Enter picks. Local matching (lib/meetingMatch) stays underneath as an
// instant preview while Claude thinks, and as the fallback if it fails.
// Untyped and before a suggestion: recurring meetings, then the rest of this week.
const AI_DEBOUNCE_MS = 700

function MeetingPicker({ agenda, text, setText, hintFor, sameMeeting, onPick, onPickPerson, onPickText, assigned, task, projectName }) {
  const { t, f } = useApp()
  const q = text.trim()
  const { person, matches } = q ? resolveFreeText(q, agenda.all) : { person: null, matches: [] }
  // AI state is keyed by the text it answered, so a stale reply never shows
  // against newer typing. '' = the on-open suggestion from the task itself.
  const [ai, setAi] = useState({ q: null, status: 'idle', result: null })
  const seq = useRef(0)
  const aiHere = ai.q === q ? ai : { status: q ? 'pending' : 'idle', result: null }
  const head = (label) => <div style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.t3, padding: '9px 12px 4px' }}>{label}</div>
  const pl = parsePersonLink(assigned)
  const { person: aiPerson, meetings: aiMeetings } = aiPick(aiHere.result, agenda.all)

  const runAI = async (forText) => {
    const id = ++seq.current
    setAi({ q: forText, status: 'loading', result: null })
    const now = new Date()
    const today = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    try {
      const result = await routeToMeeting(forText, aiMeetingList(agenda.all),
        { taskLabel: task?.label || '', taskNotes: task?.notes || '', waiting: task?.waiting || '', projectName, today })
      if (id !== seq.current) return
      setAi({ q: forText, status: result ? 'done' : 'none', result })
    } catch (e) {
      if (id !== seq.current) return
      console.warn('[course+] routeToMeeting', e)
      setAi({ q: forText, status: 'error', result: null })
    }
  }

  // As you type: ask Claude once you pause. Nothing typed: suggest from the
  // task, once, unless it's already assigned.
  useEffect(() => {
    if (!agenda.loaded || !agenda.all.length) return
    if (!q) { if (!assigned && task?.label && ai.q !== '') runAI(''); return }
    if (q.length < 2) return
    const h = setTimeout(() => runAI(q), AI_DEBOUNCE_MS)
    return () => clearTimeout(h)
  }, [q, agenda.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickAI = () => {
    if (aiPerson) { onPickPerson(aiPerson, aiMeetings); return true }
    if (aiMeetings.length) { onPick(aiMeetings[0].title); return true }
    return false
  }
  const pickLocal = () => {
    if (person) { onPickPerson(person.name, person.meetings); return true }
    if (matches.length) { onPick(matches[0].title); return true }
    return false
  }
  // Enter = Claude's answer if it's in. Otherwise the words are saved as they
  // are and routed in the background, so nothing waits on the popover staying
  // open, and a meeting that isn't on the calendar yet still gets linked later.
  const onEnter = () => {
    if (!q) return
    if (aiHere.status === 'done' && pickAI()) return
    if ((aiHere.status === 'none' || aiHere.status === 'error') && person && !person.weak) { pickLocal(); return }
    onPickText(q)
  }

  const meetingRow = (m, k) => <PopRow key={k + m.id} icon={m.recurring ? 'repeat' : 'users'} label={m.title} hint={hintFor(m)} on={sameMeeting(m.title)} onClick={() => onPick(m.title)} />
  const personBlock = (name, list, label) => <>
    {head(label)}
    <PopRow icon="user" label={'Next meeting with ' + name}
      hint={list.length > 1 ? 'whichever is first' : 'recommended'} on={!!pl && pl.name.toLowerCase() === name.toLowerCase()}
      onClick={() => onPickPerson(name, list)} />
    {list.map((m) => meetingRow(m, 'p' + label))}
  </>
  const note = (s, icon) => <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontFamily: f.ui, fontSize: 11.5, color: t.t3, lineHeight: 1.45 }}>
    {icon && <Icon n={icon} s={12} c={t.t3} />}{s}</div>
  const thinking = aiHere.status === 'loading' || aiHere.status === 'pending'
  const showAI = aiHere.status === 'done' && aiMeetings.length > 0
  // Local preview only while Claude is thinking, or when it came up empty.
  const showLocal = q && !showAI && (person || matches.length)

  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 4px 4px', padding: '0 10px', height: 36, borderRadius: 'calc(8px * var(--rs))', background: t.sel }}>
      <Icon n="sparkles" s={14} c={thinking ? t.accent : t.t3} />
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Say it: bring this up when I see Jon"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }}
        style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontFamily: f.ui, fontSize: 13, color: t.t1 }} />
    </div>
    {!agenda.loaded && note('Loading your calendar…')}
    {showAI && <>
      {aiPerson ? personBlock(aiPerson, aiMeetings, q ? 'Suggested' : 'Suggested from the task')
        : <>{head(q ? 'Suggested' : 'Suggested from the task')}{aiMeetings.map((m) => meetingRow(m, 'a'))}</>}
      {aiHere.result.reason && note(aiHere.result.reason, 'sparkles')}
    </>}
    {agenda.loaded && thinking && (q || (!assigned && task?.label)) && note(q ? 'Working out which meeting…' : 'Reading the task…', 'sparkles')}
    {showLocal && <>
      {person && personBlock(person.name, person.meetings, 'Meetings with ' + person.name)}
      {matches.length > 0 && <>{head('Matching meetings')}{matches.map((m) => meetingRow(m, 'q'))}</>}
    </>}
    {q.length >= 2 && !showAI && <div style={{ borderTop: showLocal ? '1px solid ' + t.line : 0, marginTop: showLocal ? 4 : 0 }}>
      <PopRow icon="sparkles" label={`Find “${q}” in the background`}
        hint={aiHere.status === 'none' ? 'not on your calendar yet, links when it is' : 'Enter, or just close'} onClick={() => onPickText(q)} /></div>}
    {q && agenda.loaded && aiHere.status === 'error' && note('AI routing failed, showing word matches. Check your connection.')}
    {!q && agenda.recurring.length > 0 && <>{head('Recurring')}
      {agenda.recurring.map((m) => <PopRow key={'c' + m.id} icon="repeat" label={m.title} hint={m.date ? 'next ' + hintFor({ ...m, recurring: false }) : 'series'} on={sameMeeting(m.title)} onClick={() => onPick(m.title)} />)}</>}
    {!q && agenda.week.length > 0 && <>{head('This week')}
      {agenda.week.map((b) => <PopRow key={'w' + b.id} icon="users" label={b.title} hint={hintFor(b)} on={sameMeeting(b.title)} onClick={() => onPick(b.title)} />)}</>}
    {!q && agenda.loaded && !agenda.recurring.length && !agenda.week.length && note('No meetings in the next five weeks and no series yet. Schedule one in Today, or hold a meeting on the Agenda to make it a series.')}
    {assigned && <div style={{ borderTop: '1px solid ' + t.line, marginTop: 4 }}><PopRow icon="x" label="Clear assignment" onClick={() => onPick(null)} /></div>}
  </div>
}
