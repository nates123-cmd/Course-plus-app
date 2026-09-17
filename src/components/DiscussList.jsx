// DiscussList — the one "To discuss in this meeting" checklist, shown wherever a
// meeting is (Agenda week view, the composer, a series page). Two kinds of row
// share it:
//   task — a cp_task marked Scheduled and assigned to this meeting. Derived, so
//          ticking it marks the task DONE and it drops out everywhere at once.
//   item — a manual talking point (cp_agenda_items). Ticking it records which
//          meeting covered it; an unticked one carries to the next occurrence.
// Feeding it: type a talking point, or pull an existing open task in ("From
// tasks" sets workType=scheduled + meetingId on the task, the same thing the
// task sheet's Scheduled chip does).
import { useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Label, Popover, PopRow, AreaDot } from '../kit'

// Markdown snapshot of the list at a moment (saved into the meeting note's
// agenda so the record survives the tasks/items moving on).
export function discussMarkdown(rows, checked = {}) {
  if (!rows.length) return ''
  return '## To discuss\n' + rows.map((r) => `- [${checked[r.id] ? 'x' : ' '}] ${r.label}${r.where ? ` _(${r.where})_` : ''}`).join('\n')
}

export function DiscussList({ titles, addTitle, noteId = null, compact = false, onOpenTask, header = true, checked: extChecked, onChecked }) {
  const { t, f, go } = useApp()
  const { discussListFor, addAgendaItem, patchAgendaItem, removeAgendaItem, patchTask, allProjects, looseTasks } = useData()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [q, setQ] = useState('')
  // Rows ticked in THIS view stay visible, struck through, until you leave —
  // a done task vanishes from the derived list otherwise, and mid-meeting you
  // want to see what you've covered. Parent can own this (the composer does,
  // so its save snapshot knows what was ticked).
  const [ownChecked, setOwnChecked] = useState({})
  const checked = extChecked || ownChecked
  const setChecked = (fn) => { const next = fn(checked); if (onChecked) onChecked(next); else setOwnChecked(next) }
  const [struck, setStruck] = useState([]) // rows gone from the live list but still shown ticked

  const live = discussListFor(titles)
  const liveIds = new Set(live.map((r) => r.id))
  const rows = [...live, ...struck.filter((r) => !liveIds.has(r.id) && checked[r.id])]
  const total = rows.length

  const tick = async (r) => {
    const on = !checked[r.id]
    setChecked((c) => ({ ...c, [r.id]: on }))
    if (on) setStruck((s) => (s.some((x) => x.id === r.id) ? s : [...s, r]))
    try {
      if (r.kind === 'task') await patchTask(r.id, { done: on })
      else await patchAgendaItem(r.id, on ? { done: true, noteId } : { done: false, noteId: null })
    } catch {}
  }
  const remove = async (r) => {
    setStruck((s) => s.filter((x) => x.id !== r.id))
    try {
      if (r.kind === 'task') await patchTask(r.id, { workType: null, meetingId: null }) // un-assign, never delete the task
      else await removeAgendaItem(r.id)
    } catch {}
  }
  const add = async () => {
    const v = draft.trim(); setDraft('')
    if (!v || !addTitle) return
    try { await addAgendaItem({ meetingTitle: addTitle, label: v, sort: total }) } catch {}
  }
  const openRow = (r) => {
    if (r.kind !== 'task') return
    if (onOpenTask) onOpenTask(r.task, r.pid)
    else if (r.pid) go({ screen: 'project', id: r.pid })
  }

  // "From tasks" — every open task not already on this list, filtered as you type.
  const projects = allProjects()
  const candidates = (() => {
    const needle = q.trim().toLowerCase()
    const all = [...projects.flatMap((p) => (p.tasks || []).map((x) => ({ ...x, where: p.name, pid: p.id }))),
      ...looseTasks().map((x) => ({ ...x, where: x.areaName, pid: null }))]
    return all.filter((x) => !x.done && !liveIds.has(x.id) && (!needle || (x.label || '').toLowerCase().includes(needle))).slice(0, needle ? 40 : 14)
  })()
  const pull = async (tk) => {
    setPickOpen(false); setQ('')
    if (!addTitle) return
    try { await patchTask(tk.id, { workType: 'scheduled', meetingId: addTitle }) } catch {}
  }
  const areaOf = (r) => r.task?.area || projects.find((p) => p.id === r.pid)?.area || null

  const rowPad = compact ? '6px 0' : '9px 16px'
  const inputStyle = { flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontFamily: f.body, fontSize: compact ? 13 : 14, color: t.t1, padding: 0 }
  const linkBtn = { display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.t3, cursor: 'pointer', whiteSpace: 'nowrap' }

  return <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
    {header && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '0 0 4px' : '10px 16px 6px' }}>
      <Icon n="list-check" s={compact ? 13 : 15} c={t.accent} />
      <Label style={{ margin: 0, color: t.accent, fontSize: compact ? 9.5 : undefined }}>To discuss{compact ? '' : ' in this meeting'}{total ? ` · ${total}` : ''}</Label>
    </div>}
    {rows.map((r) => {
      const on = !!checked[r.id]
      return <div key={r.kind + r.id} style={{ display: 'flex', alignItems: 'center', gap: compact ? 9 : 11, padding: rowPad, borderTop: compact ? 'none' : '1px solid ' + t.line }}>
        <span onClick={() => tick(r)} title={r.kind === 'task' ? 'Covered — marks the task done' : 'Covered'}
          style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, borderRadius: 5, flex: 'none', cursor: 'pointer', position: 'relative', border: '1.5px solid ' + (on ? t.accent : t.t3), background: on ? t.accent : 'transparent' }}>
          {on && <Icon n="check" s={compact ? 11 : 13} c={t.onAccent} style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}</span>
        <span onClick={() => openRow(r)} style={{ flex: 1, minWidth: 0, fontFamily: f.body, fontSize: compact ? 13 : 14, color: on ? t.t3 : t.t1, textDecoration: on ? 'line-through' : 'none', cursor: r.kind === 'task' ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compact ? 'nowrap' : 'normal' }}>{r.label}</span>
        {r.kind === 'task'
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11, color: t.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140, flex: 'none' }}>
              {areaOf(r) && <AreaDot areaId={areaOf(r)} s={6} />}{r.where}</span>
          : <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, flex: 'none' }}>point</span>}
        <span onClick={() => remove(r)} title={r.kind === 'task' ? 'Take off this meeting (keeps the task)' : 'Remove'}
          style={{ display: 'inline-flex', cursor: 'pointer', color: t.t3, opacity: 0.55 }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.55}><Icon n="x" s={13} /></span>
      </div>
    })}
    {/* feeders: type a point, or pull a task in */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '4px 0 0' : '8px 16px 8px', borderTop: compact || !rows.length ? 'none' : '1px solid ' + t.line }}>
      {adding || !compact
        ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: compact ? 9 : 11 }}>
            <Icon n="plus" s={compact ? 14 : 16} c={t.t3} />
            <input value={draft} autoFocus={adding} onChange={(e) => setDraft(e.target.value)} className="selectable"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') { setDraft(''); setAdding(false) } }}
              onBlur={() => { add(); if (compact) setAdding(false) }}
              placeholder={addTitle ? 'Add a talking point…' : 'Name the meeting first'} disabled={!addTitle} style={inputStyle} /></div>
        : <span onClick={() => setAdding(true)} style={{ ...linkBtn, flex: 1 }}
            onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
            <Icon n="plus" s={13} />{rows.length ? 'Add a talking point' : 'Add something to discuss'}</span>}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <span onClick={() => addTitle && setPickOpen((o) => !o)} title="Pull an existing task onto this meeting" style={{ ...linkBtn, color: pickOpen ? t.t1 : t.t3 }}
          onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = pickOpen ? t.t1 : t.t3}>
          <Icon n="arrow-down-left" s={13} />From tasks</span>
        {pickOpen && <Popover onClose={() => { setPickOpen(false); setQ('') }} align="right" width={300} maxHeight={340}>
          <input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Find a task…" className="selectable"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.bg, fontFamily: f.ui, fontSize: 12.5, color: t.t1, padding: '6px 9px', marginBottom: 4 }} />
          {candidates.map((x) => <PopRow key={x.id} icon="circle" label={x.label} hint={x.where} onClick={() => pull(x)} />)}
          {candidates.length === 0 && <div style={{ padding: '8px 10px', fontFamily: f.ui, fontSize: 12, color: t.t3 }}>No open tasks match.</div>}
        </Popover>}
      </span>
    </div>
  </div>
}
