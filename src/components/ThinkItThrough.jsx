// "Think it through" — the stuck-project thinking partner, ported from the
// original Course app (next-moves.jsx).
//
// Two turns, then it COMMITS something. That constraint is the whole design: a
// stalled project has exactly two honest resolutions — do a smaller thing, or
// stop pretending it's active. So turn 1 asks one diagnostic question grounded
// in the project's real state, and turn 2 resolves into either a tiny task
// written into the project, or a status change applied to it. No open-ended chat,
// no advice that evaporates.
//
// If Claude is unreachable the deterministic fallbacks in lib/ai.js take over, so
// this degrades to a working rules engine rather than an error.
import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, Card } from '../kit'
import { diagnoseStuck, resolveStuck, projectStateFor } from '../lib/ai'
import { updateProject, createUpdate } from '../lib/db'

const KIND_LABEL = { task: 'Add this task', pause: 'Put on hold', idea: 'Move to Backlog' }

export function ThinkItThrough({ project, idleDays, onClose, onHold }) {
  const { t, f } = useApp()
  const { addTask, reload, rememberQuestion } = useData()
  const [phase, setPhase] = useState('asking')   // asking | answering | resolving | resolved
  const [dx, setDx] = useState(null)             // { question, chips }
  const [typed, setTyped] = useState('')
  const [res, setRes] = useState(null)           // { reframe, resolution }
  const [applied, setApplied] = useState(false)

  const state = projectStateFor(project, { idleDays, updates: project.updates || [] })

  useEffect(() => {
    let dead = false
    ;(async () => {
      const d = await diagnoseStuck(state)
      if (dead) return
      setDx(d); setPhase('answering')
      rememberQuestion(project.id, d.question) // so a second visit doesn't reopen cold
    })()
    return () => { dead = true }
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (a) => {
    if (!a || !a.trim()) return
    setPhase('resolving')
    setRes(await resolveStuck(state, dx?.question || '', a.trim()))
    setPhase('resolved')
  }

  // Apply the resolution for real. A task goes straight into the project's
  // backlog; a status change is written + logged (which also counts as activity,
  // so the project stops nagging either way).
  const apply = async () => {
    const r = res?.resolution
    if (!r) return
    setApplied(true)
    if (r.kind === 'task') {
      await addTask(project.id, { label: r.label.slice(0, 80), taskStatus: 'now', next: true, sort: 0 })
      await createUpdate(project.id, `Think it through → added "${r.label}"`)
    } else if (r.kind === 'pause') {
      onClose(); onHold(project); return // hold needs a reason + date — hand off to the HoldSheet
    } else if (r.kind === 'idea') {
      await updateProject(project.id, project.hold ? { status: 'idea', hold: null } : { status: 'idea' })
      await createUpdate(project.id, `Think it through → moved to Backlog${r.label ? ` (${r.label})` : ''}`)
    }
    await reload()
    onClose()
  }

  const lbl = { fontFamily: f.label, fontSize: 9.5, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent, display: 'inline-flex', alignItems: 'center', gap: 5 }

  return (
    <Card style={{ padding: '14px 16px', marginTop: 10, border: '1px solid ' + t.accentLine, background: t.accentBg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={lbl}><Icon n="sparkles" s={11} />Think it through</span>
        <div style={{ flex: 1 }} />
        <Icon n="x" s={14} c={t.t3} onClick={onClose} style={{ cursor: 'pointer' }} />
      </div>

      {phase === 'asking' && (
        <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3, fontStyle: 'italic' }}>Looking at where this actually stands…</div>
      )}

      {(phase === 'answering' || phase === 'resolving') && dx && (
        <>
          <div style={{ fontFamily: f.body, fontSize: 14.5, color: t.t1, lineHeight: 1.5, textWrap: 'pretty' }}>{dx.question}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
            {dx.chips.map((c) => (
              <Btn key={c} kind="outline" size="sm" onClick={() => answer(c)} disabled={phase === 'resolving'}>{c}</Btn>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
            <input
              value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') answer(typed) }}
              placeholder="Or say it in your own words…"
              style={{ flex: 1, fontFamily: f.ui, fontSize: 13, padding: '7px 10px', borderRadius: 8,
                border: '1px solid ' + t.line, background: t.bg, color: t.t1, outline: 'none' }} />
            <Btn kind="ghost" size="sm" onClick={() => answer(typed)} disabled={!typed.trim() || phase === 'resolving'}>
              {phase === 'resolving' ? 'Thinking…' : 'Send'}
            </Btn>
          </div>
        </>
      )}

      {phase === 'resolved' && res && (
        <>
          <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, lineHeight: 1.5, textWrap: 'pretty' }}>{res.reframe}</div>
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: t.bg, border: '1px solid ' + t.line }}>
            <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>
              {res.resolution.kind === 'task' ? res.resolution.label : KIND_LABEL[res.resolution.kind] || res.resolution.label}
            </div>
            {res.resolution.hint && (
              <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 3 }}>{res.resolution.hint}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap' }}>
            <Btn kind="primary" size="sm" icon={res.resolution.kind === 'task' ? 'plus' : 'check'} onClick={apply} disabled={applied}>
              {applied ? 'Applying…' : (KIND_LABEL[res.resolution.kind] || 'Apply')}
            </Btn>
            <Btn kind="ghost" size="sm" onClick={() => { setRes(null); setTyped(''); setPhase('answering') }}>Not that</Btn>
          </div>
          {/* The escape hatch from the original — a task resolution should never
              trap you into pretending the project is alive. */}
          {res.resolution.kind === 'task' && (
            <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid ' + t.line }}>
              <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginBottom: 6 }}>Or, if this isn’t the season for it</div>
              <div style={{ display: 'flex', gap: 7 }}>
                <Btn kind="ghost" size="sm" onClick={() => { onClose(); onHold(project) }}>Put on hold</Btn>
                <Btn kind="ghost" size="sm" onClick={async () => {
                  await updateProject(project.id, project.hold ? { status: 'idea', hold: null } : { status: 'idea' })
                  await createUpdate(project.id, 'Think it through → moved to Backlog')
                  await reload(); onClose()
                }}>Move to Backlog</Btn>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
