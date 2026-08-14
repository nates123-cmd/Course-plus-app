// Goals — the success record.
//
// A goal owns no work. It points at projects, and everything on it is derived
// from them: wins on one lane, hindrances on the other. Nothing here is a list
// you keep up to date, which is the whole point — finishing a task IS filing
// the win.
//
// Both lanes read the cp_goal_events ledger, which the reconciler refreshes on
// entry (lib/goals.js). Wins persist even if the task behind one is later
// deleted; hindrances are spans, so a blocker that cleared moves to a history
// list instead of vanishing. Derivation itself is shared with the Inbox
// (lib/nudges.js) so there is one definition of "stuck".
// No window.* except confirm/alert — useApp() for theme/route/nav, useData()
// for the spine, lib/goals.js for writes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Card, Tag, Btn, IconBtn, Label, Popover, PopRow, AreaDot, MONTHS, usePersisted } from '../kit'
import {
  listGoals, listEvents, createGoal, updateGoal, deleteGoal, reconcileAll,
  addManualWin, dismissEvent, deriveGoal, findGoalNotes, parseGoalsFromNote,
  applyGoalDrafts, suggestProjects, GOAL_STATUS,
} from '../lib/goals'

// ── date helpers (ISO timestamps, not the {y,m,d} chips fmtDate handles) ──
const D = (iso) => (iso ? new Date(iso) : null)
const shortDate = (iso) => { const d = D(iso); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : '' }
const monthKey = (iso) => { const d = D(iso); return d ? `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}` : '' }
const monthLabel = (key) => { const [y, m] = key.split('-'); return `${MONTHS[+m]} ${y}` }
const spanDays = (a, b) => {
  const s = D(a), e = b ? D(b) : new Date()
  if (!s) return null
  return Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86400000))
}

const WIN_ICON = { task: 'circle-check', artifact: 'file-export', update: 'flag-3', manual: 'star' }
const HINDER_ICON = { checkin: 'clock-exclamation', drift: 'arrow-forward-up', decay: 'hourglass', stall: 'zzz', blocked: 'hand-stop', waiting: 'player-pause' }
const HINDER_LABEL = { checkin: 'Check-in due', drift: 'Drifting', decay: 'Decaying', stall: 'Stalled', blocked: 'Blocked', waiting: 'On hold' }

// ── project link picker ────────────────────────────────────────────────
function ProjectPicker({ projects, selected, onToggle, onClose }) {
  return (
    <Popover onClose={onClose} width={280} maxHeight={320}>
      {projects.map((p) => (
        <PopRow key={p.id} label={p.name} hint={p.areaName} on={selected.includes(p.id)}
          icon={selected.includes(p.id) ? 'check' : 'folder'} onClick={() => onToggle(p.id)} />
      ))}
    </Popover>
  )
}

// ── goal create / edit form ────────────────────────────────────────────
function GoalEditor({ goal, projects, onSave, onCancel }) {
  const { t, f } = useApp()
  const [title, setTitle] = useState(goal?.title || '')
  const [blurb, setBlurb] = useState(goal?.blurb || '')
  const [weight, setWeight] = useState(goal?.weight ?? '')
  const [period, setPeriod] = useState(goal?.period || '')
  const [kind, setKind] = useState(goal?.kind || 'goal')
  const [status, setStatus] = useState(goal?.status || 'on-track')
  const [projectIds, setProjectIds] = useState(goal?.projectIds || [])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  const field = { fontFamily: f.ui, fontSize: 13.5, color: t.t1, background: t.panel,
    border: '1px solid ' + t.line, borderRadius: 9, padding: '9px 11px', outline: 'none', width: '100%' }

  const save = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave({
        title: title.trim(), blurb: blurb.trim(), kind, status, period: period.trim() || null,
        weight: weight === '' ? null : Math.max(0, Math.min(100, parseInt(weight, 10) || 0)),
        projectIds,
      })
    } finally { setBusy(false) }
  }

  return (
    <Card style={{ padding: 18, marginTop: 14, borderColor: t.accentLine }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title"
          style={{ ...field, fontSize: 15, fontWeight: 600 }} />
        <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={2}
          placeholder="What achieving it looks like" style={{ ...field, resize: 'vertical', fontFamily: f.body }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Weight %" inputMode="numeric" style={{ ...field, width: 110 }} />
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Period (FY26)" style={{ ...field, width: 150 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...field, width: 150 }}>
            <option value="goal">Goal</option>
            <option value="competency">Competency</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...field, width: 150 }}>
            {Object.entries(GOAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        <div style={{ position: 'relative' }}>
          <Label style={{ marginBottom: 6 }}>Projects that feed this</Label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {projectIds.map((id) => {
              const p = projects.find((x) => x.id === id)
              return <Tag key={id} onClick={() => setProjectIds(projectIds.filter((x) => x !== id))}>{p?.name || id} ×</Tag>
            })}
            <Btn size="sm" icon="plus" onClick={() => setPicking(!picking)}>Link project</Btn>
          </div>
          {picking && (
            <ProjectPicker projects={projects} selected={projectIds} onClose={() => setPicking(false)}
              onToggle={(id) => setProjectIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Btn kind="primary" size="sm" onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn>
          <Btn size="sm" onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </Card>
  )
}

// ── rows ───────────────────────────────────────────────────────────────
function WinRow({ win, onDismiss, onOpen }) {
  const { t, f } = useApp()
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', opacity: win.orphaned ? 0.55 : 1 }}>
      <Icon n={WIN_ICON[win.sourceKind] || 'circle-check'} s={15} c={t.good} style={{ marginTop: 2, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div onClick={onOpen} style={{ fontFamily: f.body, fontSize: 14, color: t.t1, lineHeight: 1.45,
          cursor: onOpen ? 'pointer' : 'default' }}>{win.title}</div>
        {(win.detail || win.orphaned) && (
          <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 2 }}>
            {win.detail}{win.orphaned ? (win.detail ? ' · source removed' : 'source removed') : ''}
          </div>
        )}
      </div>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, flex: 'none', marginTop: 2,
        fontVariantNumeric: 'tabular-nums' }}>{shortDate(win.at)}</span>
      {onDismiss && (
        <button title="Hide from the record" onClick={onDismiss} style={{ background: 'none', border: 0,
          cursor: 'pointer', color: t.t3, padding: 0, marginTop: 1, flex: 'none' }}><Icon n="eye-off" s={14} /></button>
      )}
    </div>
  )
}

function HindranceRow({ h, onOpen }) {
  const { t, f } = useApp()
  const open = !h.closedAt
  const days = spanDays(h.openedAt, h.closedAt)
  return (
    <div onClick={onOpen} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0',
      cursor: 'pointer', opacity: open ? 1 : 0.7 }}>
      <Icon n={HINDER_ICON[h.sourceKind] || 'alert-triangle'} s={15} c={open ? t.risk : t.t3}
        style={{ marginTop: 2, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, lineHeight: 1.45 }}>{h.title}</div>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 2 }}>
          {h.detail}
          {days != null && (open
            ? ` · open ${days}d`
            : ` · ${shortDate(h.openedAt)} → ${shortDate(h.closedAt)}, ${days}d`)}
        </div>
      </div>
      <Tag>{HINDER_LABEL[h.sourceKind] || h.sourceKind}</Tag>
    </div>
  )
}

// ── goal card ──────────────────────────────────────────────────────────
function GoalCard({ goal, events, derived, open, onToggle, onEdit, onDelete, onAddWin, onDismiss, go }) {
  const { t, f } = useApp()
  const [lane, setLane] = useState('wins')
  const [adding, setAdding] = useState(false)
  const [showCleared, setShowCleared] = useState(false)
  const [manual, setManual] = useState('')

  const wins = events.filter((e) => e.kind === 'win' && !e.dismissed)
  const hind = events.filter((e) => e.kind === 'hindrance' && !e.dismissed)
  const openHind = hind.filter((h) => !h.closedAt)
  const clearedHind = hind.filter((h) => h.closedAt)
  const last = wins[0]
  const tone = GOAL_STATUS[goal.status]?.tone === 'risk' ? t.risk : t.good

  // Wins grouped newest month first — a record reads as a history, not a list.
  const byMonth = useMemo(() => {
    const m = new Map()
    for (const w of wins) {
      const k = monthKey(w.at)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(w)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [events])

  const submitManual = async () => {
    if (!manual.trim()) return
    await onAddWin(manual.trim())
    setManual(''); setAdding(false)
  }

  return (
    <Card style={{ marginTop: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 3, background: tone, flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0, padding: '15px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div onClick={onToggle} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {goal.weight != null && (
                  <span style={{ fontFamily: f.ui, fontSize: 11.5, fontWeight: 700, color: t.accent,
                    background: t.accentBg, border: '1px solid ' + t.accentLine, borderRadius: 6,
                    padding: '1px 7px', fontVariantNumeric: 'tabular-nums' }}>{goal.weight}%</span>
                )}
                <span style={{ fontFamily: f.title, fontSize: 16.5, fontWeight: f.titleW, color: t.t1 }}>{goal.title}</span>
                <Tag>{GOAL_STATUS[goal.status]?.label || goal.status}</Tag>
                {goal.kind === 'competency' && <Tag>Competency</Tag>}
                {goal.period && <Tag>{goal.period}</Tag>}
              </div>
              {goal.blurb && <div style={{ fontFamily: f.body, fontSize: 13.5, color: t.t2, marginTop: 5, lineHeight: 1.5 }}>{goal.blurb}</div>}
            </div>
            <IconBtn n="pencil" s={16} title="Edit goal" onClick={onEdit} />
            <IconBtn n={open ? 'chevron-up' : 'chevron-down'} s={18} title={open ? 'Collapse' : 'Expand'} onClick={onToggle} />
          </div>

          {/* the two numbers that matter, always visible */}
          <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 11,
            cursor: 'pointer', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>
              <Icon n="trophy" s={14} c={t.good} />
              {wins.length} {wins.length === 1 ? 'win' : 'wins'}
              {last && <span style={{ color: t.t3 }}>· last {shortDate(last.at)}</span>}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5,
              color: openHind.length ? t.risk : t.t3 }}>
              <Icon n="alert-triangle" s={14} c={openHind.length ? t.risk : t.t3} />
              {openHind.length} {openHind.length === 1 ? 'hindrance' : 'hindrances'}
            </span>
            {derived.projects.map((p) => (
              <span key={p.id} onClick={(e) => { e.stopPropagation(); go({ screen: 'project', id: p.id }) }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
                <AreaDot area={p.area} />{p.name}
              </span>
            ))}
            {derived.missingIds.length > 0 && (
              <span title={derived.missingIds.join(', ')} style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, fontStyle: 'italic' }}>
                {derived.missingIds.length} link{derived.missingIds.length > 1 ? 's' : ''} no longer resolve — edit to clean up
              </span>
            )}
          </div>

          {open && (
            <div style={{ marginTop: 14, borderTop: '1px solid ' + t.line, paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                {[['wins', `Wins (${wins.length})`], ['hindrances', `Hindrances (${openHind.length})`]].map(([id, label]) => (
                  <span key={id} onClick={() => setLane(id)} style={{ fontFamily: f.ui, fontSize: 12.5, fontWeight: 600,
                    color: lane === id ? t.t1 : t.t3, background: lane === id ? t.sel : 'transparent',
                    borderRadius: 8, padding: '5px 11px', cursor: 'pointer' }}>{label}</span>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {lane === 'wins' && <Btn size="sm" icon="plus" onClick={() => setAdding(!adding)}>Log a win</Btn>}
                  <Btn size="sm" icon="trash" onClick={onDelete}>Delete</Btn>
                </div>
              </div>

              {lane === 'wins' ? (
                <>
                  {adding && (
                    <div style={{ display: 'flex', gap: 8, margin: '8px 0 4px' }}>
                      <input autoFocus value={manual} onChange={(e) => setManual(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') submitManual() }}
                        placeholder="Something that happened off-app"
                        style={{ flex: 1, fontFamily: f.ui, fontSize: 13.5, color: t.t1, background: t.panel,
                          border: '1px solid ' + t.line, borderRadius: 9, padding: '8px 11px', outline: 'none' }} />
                      <Btn kind="primary" size="sm" onClick={submitManual}>Add</Btn>
                    </div>
                  )}
                  {byMonth.length === 0 ? (
                    <div style={{ padding: '28px 0', textAlign: 'center', fontFamily: f.body, fontSize: 13.5,
                      color: t.t3, fontStyle: 'italic' }}>
                      Nothing recorded yet. Finish a task, ship an artifact, or move a linked project along and it lands here on its own.
                    </div>
                  ) : byMonth.map(([k, list]) => (
                    <div key={k} style={{ marginTop: 10 }}>
                      <Label style={{ marginBottom: 2 }}>{monthLabel(k)}</Label>
                      {list.map((w) => (
                        <WinRow key={w.id} win={w} onDismiss={() => onDismiss(w.id)}
                          onOpen={w.project ? () => go({ screen: 'project', id: w.project }) : undefined} />
                      ))}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {openHind.length === 0 && (
                    <div style={{ padding: '28px 0', textAlign: 'center', fontFamily: f.body, fontSize: 13.5,
                      color: t.t3, fontStyle: 'italic' }}>
                      Nothing is blocking this right now.
                    </div>
                  )}
                  {openHind.map((h) => (
                    <HindranceRow key={h.id} h={h} onOpen={() => h.project && go({ screen: 'project', id: h.project })} />
                  ))}
                  {clearedHind.length > 0 && (
                    <div style={{ marginTop: 12, borderTop: '1px solid ' + t.line, paddingTop: 8 }}>
                      <span onClick={() => setShowCleared(!showCleared)} style={{ display: 'inline-flex', alignItems: 'center',
                        gap: 6, fontFamily: f.ui, fontSize: 12, fontWeight: 600, color: t.t3, cursor: 'pointer' }}>
                        <Icon n={showCleared ? 'chevron-down' : 'chevron-right'} s={14} />
                        Cleared ({clearedHind.length})
                      </span>
                      {showCleared && clearedHind.map((h) => (
                        <HindranceRow key={h.id} h={h} onOpen={() => h.project && go({ screen: 'project', id: h.project })} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

// ── sync from the Library ──────────────────────────────────────────────
function SyncPanel({ candidates, projects, existing, onDone, onCancel }) {
  const { t, f } = useApp()
  const [pick, setPick] = useState(candidates[0]?.note?.id || null)
  const [drafts, setDrafts] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const note = candidates.find((c) => c.note.id === pick)?.note

  const parse = async () => {
    setBusy(true); setErr(null)
    try {
      const d = await parseGoalsFromNote(note)
      if (!d.length) throw new Error('No goals found in that note.')
      // Pre-wire each draft to the projects whose names it overlaps, seeded by
      // the ones the note itself already points at.
      const seed = [...(note.projects || []), note.project].filter(Boolean)
      setDrafts(d.map((x) => ({ ...x, projectIds: suggestProjects(x.title, projects, seed) })))
    } catch (e) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }

  const apply = async () => {
    setBusy(true); setErr(null)
    try { onDone(await applyGoalDrafts(drafts, existing, { sourceNote: note.id })) }
    catch (e) { setErr(e?.message || String(e)); setBusy(false) }
  }

  return (
    <Card style={{ padding: 18, marginTop: 14, borderColor: t.accentLine }}>
      <div style={{ fontFamily: f.title, fontSize: 16, fontWeight: f.titleW, color: t.t1 }}>Sync goals from the Library</div>
      <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 5 }}>
        Pick the document your goals are written in. Titles and weights come from the note; project links and status stay yours.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 14 }}>
        {candidates.map(({ note: n, hasContent }) => (
          <PopRow key={n.id} label={n.title} on={pick === n.id} onClick={() => { setPick(n.id); setDrafts(null); setErr(null) }}
            icon={pick === n.id ? 'check' : 'file-text'} hint={hasContent ? n.date : 'empty'} />
        ))}
      </div>

      {err && <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, background: t.riskBg,
        border: '1px solid ' + t.riskLine, borderRadius: 9, padding: '8px 11px', marginTop: 12 }}>{err}</div>}

      {drafts && (
        <div style={{ marginTop: 14 }}>
          <Label style={{ marginBottom: 6 }}>{drafts.length} goals found</Label>
          {drafts.map((d, i) => (
            <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid ' + t.line : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>{d.title}</span>
                {d.weight != null && <Tag>{d.weight}%</Tag>}
                {d.kind === 'competency' && <Tag>Competency</Tag>}
              </div>
              {d.blurb && <div style={{ fontFamily: f.body, fontSize: 12.5, color: t.t2, marginTop: 3 }}>{d.blurb}</div>}
              <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 3 }}>
                {d.projectIds.length
                  ? 'Links: ' + d.projectIds.map((id) => projects.find((p) => p.id === id)?.name).filter(Boolean).join(', ')
                  : 'No project matched by name - link it after.'}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {!drafts
          ? <Btn kind="primary" size="sm" icon="sparkles" onClick={parse}>{busy ? 'Reading…' : 'Read this note'}</Btn>
          : <Btn kind="primary" size="sm" icon="check" onClick={apply}>{busy ? 'Saving…' : `Import ${drafts.length} goals`}</Btn>}
        <Btn size="sm" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

// ── screen ─────────────────────────────────────────────────────────────
export function GoalsScreen() {
  const { t, f, go } = useApp()
  const { allProjects, projectById, notes, lastTouchAt } = useData()

  const [goals, setGoals] = useState([])
  const [events, setEvents] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [banner, setBanner] = useState(null)
  const [editing, setEditing] = useState(null) // goal id, or 'new'
  const [syncing, setSyncing] = useState(false)
  const [openIds, setOpenIds] = usePersisted('course.goalsOpen.v1', [])
  const reconciled = useRef(false) // StrictMode double-mount guard

  // Linking to an archived project is legitimate (finished work still counts),
  // so resolution sees everything — only the PICKER hides archived.
  const projects = useMemo(() => allProjects().filter((p) => p.status !== 'archived'), [allProjects])

  const refresh = async ({ reconcile = false } = {}) => {
    try {
      const g = await listGoals()
      if (reconcile && g.length) {
        const n = await reconcileAll(g, projectById, lastTouchAt)
        if (n) setBanner(`${n} new ${n === 1 ? 'entry' : 'entries'} recorded.`)
      }
      setGoals(g)
      setEvents(await listEvents(g.map((x) => x.id)))
      setState('ready'); setError(null)
    } catch (e) { setError(e); setState('error') }
  }

  // Reconcile on entry — this is the "don't have to manage it" part. Everything
  // finished since the last visit is filed before the screen paints its counts.
  useEffect(() => {
    if (reconciled.current) return
    reconciled.current = true
    refresh({ reconcile: true })
  }, [])

  const eventsFor = (id) => events.filter((e) => e.goal === id)
  const candidates = useMemo(() => findGoalNotes(notes), [notes])

  const saveGoal = async (id, patch) => {
    if (id === 'new') await createGoal({ ...patch, sort: goals.length })
    else await updateGoal(id, patch)
    setEditing(null)
    await refresh({ reconcile: true })
  }
  const removeGoal = async (g) => {
    const n = eventsFor(g.id).length
    if (!window.confirm(`Delete “${g.title}” and its ${n} recorded ${n === 1 ? 'entry' : 'entries'}? This can't be undone.`)) return
    try { await deleteGoal(g.id); await refresh() } catch (e) { window.alert('Could not delete: ' + (e?.message || e)) }
  }
  const toggleOpen = (id) => setOpenIds(openIds.includes(id) ? openIds.filter((x) => x !== id) : [...openIds, id])

  const totalWeight = goals.reduce((n, g) => n + (g.weight || 0), 0)
  const totalWins = events.filter((e) => e.kind === 'win' && !e.dismissed).length

  if (state === 'loading') {
    return <div data-screen-label="Goals" style={{ maxWidth: 980, margin: '0 auto', padding: '40px 36px 90px',
      fontFamily: f.ui, fontSize: 13.5, color: t.t3 }}>Loading goals…</div>
  }
  if (state === 'error') {
    return (
      <div data-screen-label="Goals" style={{ maxWidth: 980, margin: '0 auto', padding: '40px 36px 90px' }}>
        <div style={{ fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, color: t.t1 }}>Goals</div>
        <Card style={{ padding: 18, marginTop: 18, borderColor: t.riskLine, background: t.riskBg }}>
          <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, lineHeight: 1.55 }}>{error?.message || String(error)}</div>
        </Card>
      </div>
    )
  }

  return (
    <div data-screen-label="Goals" style={{ maxWidth: 980, margin: '0 auto', padding: '40px 36px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Goals</div>
          <div style={{ fontFamily: f.ui, fontSize: 13.5, color: t.t2, marginTop: 5 }}>
            {goals.length
              ? <>{goals.length} {goals.length === 1 ? 'goal' : 'goals'}{totalWeight ? ` · ${totalWeight}% weighted` : ''} · {totalWins} {totalWins === 1 ? 'win' : 'wins'} recorded</>
              : 'Your record of what actually got done.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {candidates.length > 0 && <Btn size="sm" icon="refresh" onClick={() => { setSyncing(true); setEditing(null) }}>Sync from Library</Btn>}
          <Btn kind="primary" size="sm" icon="plus" onClick={() => { setEditing('new'); setSyncing(false) }}>New goal</Btn>
        </div>
      </div>

      {banner && (
        <div onClick={() => setBanner(null)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16,
          fontFamily: f.ui, fontSize: 12.5, color: t.good, background: t.goodBg, border: '1px solid ' + t.line,
          borderRadius: 9, padding: '8px 12px', cursor: 'pointer' }}>
          <Icon n="trophy" s={14} c={t.good} />{banner}
        </div>
      )}

      {syncing && (
        <SyncPanel candidates={candidates} projects={projects} existing={goals}
          onCancel={() => setSyncing(false)}
          onDone={async ({ added, updated }) => {
            setSyncing(false)
            setBanner(`${added} added, ${updated} updated from the Library.`)
            await refresh({ reconcile: true })
          }} />
      )}

      {editing === 'new' && (
        <GoalEditor goal={null} projects={projects} onCancel={() => setEditing(null)} onSave={(p) => saveGoal('new', p)} />
      )}

      {goals.length === 0 && !syncing && editing !== 'new' && (
        <Card style={{ padding: 44, marginTop: 18, textAlign: 'center' }}>
          <Icon n="target-arrow" s={26} c={t.t3} />
          <div style={{ fontFamily: f.title, fontSize: 17, fontWeight: f.titleW, color: t.t1, marginTop: 10 }}>No goals yet</div>
          <div style={{ fontFamily: f.body, fontSize: 14, color: t.t2, marginTop: 7, maxWidth: 470,
            marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
            Point a goal at the projects that feed it. Every task you finish, artifact you ship and status you move on
            those projects files itself here, along with anything that got in the way.
          </div>
          {candidates.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Btn kind="primary" icon="sparkles" onClick={() => setSyncing(true)}>Import from “{candidates[0].note.title}”</Btn>
            </div>
          )}
        </Card>
      )}

      {goals.map((g) => (
        editing === g.id ? (
          <GoalEditor key={g.id} goal={g} projects={projects} onCancel={() => setEditing(null)} onSave={(p) => saveGoal(g.id, p)} />
        ) : (
          <GoalCard key={g.id} goal={g} events={eventsFor(g.id)} go={go}
            derived={deriveGoal(g, projectById, lastTouchAt)}
            open={openIds.includes(g.id)} onToggle={() => toggleOpen(g.id)}
            onEdit={() => { setEditing(g.id); setSyncing(false) }}
            onDelete={() => removeGoal(g)}
            onAddWin={async (title) => { await addManualWin(g.id, { title }); await refresh() }}
            onDismiss={async (id) => { await dismissEvent(id); await refresh() }} />
        )
      ))}
    </div>
  )
}
