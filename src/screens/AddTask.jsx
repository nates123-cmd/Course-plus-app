// AddTaskInline — a "+ New task" affordance that lets you file a task under a
// PROJECT or, with no project, directly under a PILLAR (area). Used on the Work
// overview (Open tasks) and on each Area screen.
//
// Props:
//   defaultTarget : { project: id } | { area: id }   initial assignment
//   lockTarget    : boolean   hide the picker (e.g. on a specific Area screen)
//   surfaceOnAdd  : boolean   mark the new task `next` so it surfaces in Open tasks
//   onAdded       : () => void   called after a successful create (reload)
import { useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, Popover, PopRow, AreaDot, areaColor } from '../kit'
import { createTask } from '../lib/db'

export function AddTaskInline({ defaultTarget, lockTarget = false, surfaceOnAdd = false, onAdded }) {
  const { t, f } = useApp()
  const { areas, allProjects, projectById, areaName } = useData()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [target, setTarget] = useState(defaultTarget || null)
  const [pickOpen, setPickOpen] = useState(false)

  const targetLabel = () => {
    if (target?.project) { const p = projectById(target.project); return p ? { dot: p.area, name: p.name } : null }
    if (target?.area) return { dot: target.area, name: areaName(target.area) + ' · pillar' }
    return null
  }
  const tl = targetLabel()

  const commit = async () => {
    const v = text.trim()
    if (!v || !target) return // keep the bar open until there's a label + a target
    setText(''); setAdding(false)
    await createTask(target.project || null, {
      label: v, area: target.area || null, sort: 0, next: !!surfaceOnAdd,
    })
    onAdded && onAdded()
  }

  if (!adding) {
    return <div onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 9,
      padding: '8px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: f.ui, fontSize: 13, fontWeight: 600, color: t.t3 }}
      onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <span style={{ width: 17, height: 17, borderRadius: 5, border: '1.5px dashed ' + t.t3, flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon n="plus" s={11} /></span>
      <span style={{ whiteSpace: 'nowrap' }}>New task</span></div>
  }

  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
    border: '1px solid ' + t.line2, background: t.card, flexWrap: 'wrap' }}>
    <span style={{ width: 17, height: 17, borderRadius: 5, border: '1.5px dashed ' + t.t3, flex: 'none' }} />
    <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(''); setAdding(false) } }}
      placeholder="New task…" style={{ flex: 1, minWidth: 120, border: 0, outline: 0, background: 'transparent', fontFamily: f.body, fontSize: 14.5, color: t.t1 }} />
    {!lockTarget && <span style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
      <span onMouseDown={(e) => e.preventDefault()} onClick={() => setPickOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12, fontWeight: 600,
          color: tl ? t.t1 : t.t3, background: t.sel, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {tl ? <><AreaDot areaId={tl.dot} s={7} />{tl.name}</> : 'Choose…'}<Icon n="chevron-down" s={12} c={t.t3} /></span>
      {pickOpen && <Popover onClose={() => setPickOpen(false)} width={252} maxHeight={340}>
        <div style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.t3, padding: '7px 12px 4px' }}>Pillar only</div>
        {(areas || []).map((a) => <PopRow key={'a-' + a.id} dot={areaColor(t, a.id)} label={a.name} hint="pillar" on={target?.area === a.id}
          onClick={() => { setTarget({ area: a.id }); setPickOpen(false) }} />)}
        <div style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.t3, padding: '9px 12px 4px', borderTop: '1px solid ' + t.line, marginTop: 4 }}>Projects</div>
        {allProjects().map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={p.areaName} on={target?.project === p.id}
          onClick={() => { setTarget({ project: p.id }); setPickOpen(false) }} />)}</Popover>}
    </span>}
    <Btn kind="primary" size="sm" icon="check" onClick={commit}>Add</Btn>
  </div>
}
