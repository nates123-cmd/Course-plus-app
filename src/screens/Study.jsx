// Study — the work-side recall drill. Build a dive out of your own material
// (a meeting, a note, an artifact, a whole project), then explain it cold and
// get graded point by point against the record.
//
// This is Break's Active Recall reworked for work. What carries over: the shelf
// of dives, the three answer modes, the point-by-point grade. What is different:
//
//   - dives are built FROM the corpus, so a drill is about what a client
//     actually agreed to, not what the model knows about a subject
//   - the grader sees the source, so it can flag a confident WRONG claim, not
//     only a missing one — the failure that actually costs you in a meeting
//   - every run is kept, so "what am I still shaky on" is answerable
//   - drills scope to a project, because the real deadline is a meeting
//
// It shares no table, no deck, and no code with Break. Work stays here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, IconBtn, Btn, Card, Label, AreaDot, usePersisted } from '../kit'
import { listDives, createDive, deleteDive, logRun, listRuns } from '../lib/dives'
import { proposeDives, buildDiveFromTopic, gradeExplanation } from '../lib/study'
import { noteContext } from '../lib/ai'

const MODES = [
  ['mental', 'Think it through', 'Run it in your head, reveal the points, rate yourself honestly.'],
  ['type', 'Type it', 'Write the explanation from memory. Graded against the record.'],
  ['speak', 'Say it', 'Say it out loud like you would in the room. Transcribed here, then graded.'],
]
const BUCKETS = { miss: 'Missed it', hard: 'Shaky', easy: 'Solid' }

const fmtDay = (iso) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' }
}

// ── Shelf ────────────────────────────────────────────────────────
function BucketPill({ bucket }) {
  const { t, f } = useApp()
  if (!bucket) return null
  const skin = bucket === 'easy' ? { c: t.good, bg: t.goodBg } : bucket === 'miss' ? { c: t.risk, bg: t.riskBg } : { c: t.t2, bg: t.sel }
  return <span style={{ fontFamily: f.ui, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
    color: skin.c, background: skin.bg, borderRadius: 6, padding: '2px 7px' }}>{BUCKETS[bucket] || bucket}</span>
}

function Shelf({ dives, loading, loadError, onOpen, onDelete, onNew, filter, setFilter }) {
  const { t, f } = useApp()
  const { projectName, areaOfProject } = useData()

  // Filter chips are built from what is actually on the shelf — a project with
  // no drills is noise, and "Shaky" only earns a chip once something has missed.
  const projects = useMemo(() => {
    const seen = new Map()
    dives.forEach((d) => { if (d.project && !seen.has(d.project)) seen.set(d.project, projectName(d.project) || 'Project') })
    return [...seen.entries()]
  }, [dives, projectName])
  const shakyCount = dives.filter((d) => d.lastBucket === 'miss' || d.lastBucket === 'hard').length
  const untried = dives.filter((d) => !d.reviewCount).length

  const rows = dives.filter((d) => {
    if (filter === 'all') return true
    if (filter === 'shaky') return d.lastBucket === 'miss' || d.lastBucket === 'hard'
    if (filter === 'new') return !d.reviewCount
    return d.project === filter
  })

  const chip = (id, label, count) => (
    <span key={id} onClick={() => setFilter(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: filter === id ? t.t1 : t.t3,
      background: filter === id ? t.sel : 'transparent', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
      {label}{count ? <span style={{ fontSize: 11, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{count}</span> : null}</span>
  )

  return <div data-screen-label="Study" style={{ maxWidth: 980, margin: '0 auto', padding: '40px 36px 90px' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Study</div>
        <div style={{ fontFamily: f.ui, fontSize: 13.5, color: t.t2, marginTop: 5 }}>
          Explain it cold, before you have to. Drills built from your own meetings, notes, and projects.
        </div>
      </div>
      <Btn kind="primary" icon="plus" onClick={onNew}>New drill</Btn>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 20, flexWrap: 'wrap' }}>
      {chip('all', 'All', dives.length)}
      {shakyCount ? chip('shaky', 'Shaky', shakyCount) : null}
      {untried ? chip('new', 'Not tried', untried) : null}
      {projects.map(([id, name]) => chip(id, name))}
    </div>

    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 9 }}>
      {loading && <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3 }}>Loading your drills…</div>}
      {!loading && loadError && <Card style={{ padding: '20px 22px', borderColor: t.riskLine, background: t.riskBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: f.ui, fontSize: 13, fontWeight: 700, color: t.risk }}>
          <Icon n="alert-triangle" s={15} />Not set up yet</div>
        <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 7, lineHeight: 1.55 }}>{loadError}</div>
      </Card>}
      {!loading && !loadError && !dives.length && <Card style={{ padding: '26px 24px' }}>
        <div style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 600, color: t.t1 }}>Nothing to drill yet.</div>
        <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 6, lineHeight: 1.55, maxWidth: 560 }}>
          Point it at a meeting transcript, a note, or a whole project and it will pull out the things you would
          actually have to explain out loud. Then it makes you explain them, and tells you what you got wrong.
        </div>
        <div style={{ marginTop: 16 }}><Btn kind="primary" icon="plus" size="sm" onClick={onNew}>Build your first drill</Btn></div>
      </Card>}
      {!loading && dives.length > 0 && !rows.length &&
        <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3 }}>Nothing in this filter.</div>}
      {rows.map((d) => {
        // areaOfProject returns the area OBJECT, not an id.
        const areaId = d.area || (d.project ? areaOfProject(d.project)?.id : null)
        const meta = [
          d.sourceLabel || null,
          d.keyPoints.length + ' point' + (d.keyPoints.length === 1 ? '' : 's'),
          d.lastReviewedAt ? 'last ' + fmtDay(d.lastReviewedAt) : 'never run',
        ].filter(Boolean).join(' · ')
        return <Card key={d.id} hover onClick={() => onOpen(d)} style={{ padding: '14px 16px', cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {areaId ? <AreaDot areaId={areaId} s={8} /> : null}
            <span style={{ flex: 1, minWidth: 0, fontFamily: f.ui, fontSize: 14, fontWeight: 600, color: t.t1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
            <BucketPill bucket={d.lastBucket} />
            <IconBtn n="trash" s={15} title="Delete this drill"
              onClick={(e) => { e.stopPropagation(); onDelete(d) }} />
          </div>
          {d.summary ? <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2, marginTop: 5, lineHeight: 1.5 }}>{d.summary}</div> : null}
          <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 6 }}>{meta}</div>
        </Card>
      })}
    </div>
  </div>
}

// ── Build panel ──────────────────────────────────────────────────
// Three ways in, mirroring where work material actually lives: a document, a
// whole project, or nothing but a topic you know is coming.
function BuildPanel({ onClose, onSaved, initial }) {
  const { t, f } = useApp()
  const { notes, allProjects, projectDigest, projectById, noteById } = useData()
  const [tab, setTab] = useState(initial?.tab || 'doc')
  const [q, setQ] = useState('')
  const [pickedNote, setPickedNote] = useState(initial?.noteId || null)
  const [pickedProject, setPickedProject] = useState(initial?.projectId || null)
  const [topic, setTopic] = useState('')
  const [topicCtx, setTopicCtx] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [candidates, setCandidates] = useState(null)   // proposed dives awaiting a pick
  const [chosen, setChosen] = useState({})
  const [saving, setSaving] = useState(false)

  const projects = allProjects()
  const docs = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hit = s ? notes.filter((n) => (n.title || '').toLowerCase().includes(s)) : notes
    return hit.slice(0, 40)
  }, [notes, q])

  // The source text a drill gets built from, plus the label that lands on the
  // shelf row so you can see where a drill came from months later.
  const sourceFor = () => {
    if (tab === 'doc' && pickedNote) {
      const n = noteById(pickedNote)
      if (!n) return null
      return { text: noteContext(n), label: n.title, source: n.kind === 'meeting' ? 'meeting' : 'note',
        ref: n.id, project: n.project || null, area: n.area || null }
    }
    if (tab === 'project' && pickedProject) {
      const p = projectById(pickedProject)
      if (!p) return null
      // Project state alone is thin — fold in the docs filed under it so the
      // drill can reach the substance, not just the task list.
      const docsText = notes.filter((n) => n.project === p.id).slice(0, 6).map((n) => noteContext(n)).join('\n\n---\n\n')
      return { text: projectDigest(p.id) + (docsText ? '\n\nDOCUMENTS FILED HERE:\n' + docsText : ''),
        label: p.name, source: 'project', ref: null, project: p.id, area: p.area || null }
    }
    return null
  }

  const findDrills = async () => {
    const src = sourceFor()
    if (!src) { setErr('Pick something to build from first.'); return }
    setBusy(true); setErr(null)
    try {
      const found = await proposeDives(src.text, src.label)
      if (!found.length) throw new Error('nothing drillable found in that')
      setCandidates(found.map((d) => ({ ...d, ...{ source: src.source, sourceRef: src.ref, sourceLabel: src.label, project: src.project, area: src.area } })))
      setChosen(Object.fromEntries(found.map((_, i) => [i, true])))
    } catch (e) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const buildTopic = async () => {
    const title = topic.trim()
    if (!title) { setErr('Name the thing you have to be able to explain.'); return }
    setBusy(true); setErr(null)
    try {
      const d = await buildDiveFromTopic(title, topicCtx.trim() || null)
      if (!d.keyPoints.length) throw new Error('could not build a drill for that')
      setCandidates([{ ...d, source: 'manual', sourceRef: null, sourceLabel: topicCtx.trim() ? 'pasted context' : '', project: null, area: null }])
      setChosen({ 0: true })
    } catch (e) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const saveChosen = async () => {
    const keep = candidates.filter((_, i) => chosen[i])
    if (!keep.length) { onClose(); return }
    setSaving(true); setErr(null)
    try {
      for (const d of keep) await createDive(d)
      await onSaved()
      onClose()
    } catch (e) { setErr(String(e?.message || e)); setSaving(false) }
  }

  const tabBtn = (id, label, icon) => (
    <span key={id} onClick={() => { setTab(id); setCandidates(null); setErr(null) }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600,
        color: tab === id ? t.t1 : t.t3, background: tab === id ? t.sel : 'transparent', borderRadius: 8,
        padding: '6px 11px', cursor: 'pointer' }}><Icon n={icon} s={14} />{label}</span>
  )
  const pickRow = (id, label, hint, on, onClick) => (
    <div key={id} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px',
      borderRadius: 9, cursor: 'pointer', background: on ? t.accentBg : 'transparent',
      border: '1px solid ' + (on ? t.accentLine : 'transparent') }}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = t.sel }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent' }}>
      <Icon n={on ? 'circle-check' : 'circle'} s={15} c={on ? t.accent : t.t3} />
      <span style={{ flex: 1, minWidth: 0, fontFamily: f.ui, fontSize: 13, fontWeight: on ? 600 : 500, color: t.t1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hint ? <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, flex: 'none' }}>{hint}</span> : null}
    </div>
  )
  const inputStyle = { width: '100%', border: '1px solid ' + t.line2, borderRadius: 9, outline: 0,
    background: t.bg, fontFamily: f.ui, fontSize: 13, color: t.t1, padding: '9px 11px' }

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.42)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px 0' }}>
    <div onClick={(e) => e.stopPropagation()} style={{ flex: '0 0 620px', maxWidth: '95vw', maxHeight: '80vh',
      background: t.card, border: '1px solid ' + t.line, borderRadius: 16, boxShadow: t.shadow,
      display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px 14px', borderBottom: '1px solid ' + t.line, flex: 'none' }}>
        {tabBtn('doc', 'From a document', 'file-text')}
        {tabBtn('project', 'From a project', 'folder')}
        {tabBtn('topic', 'Just a topic', 'bulb')}
        <div style={{ flex: 1 }} />
        <IconBtn n="x" s={18} onClick={onClose} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px' }}>
        {candidates ? <>
          <Label>Found {candidates.length} drill{candidates.length === 1 ? '' : 's'} — keep the ones worth it</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
            {candidates.map((d, i) => <div key={i} onClick={() => setChosen((c) => ({ ...c, [i]: !c[i] }))}
              style={{ padding: '12px 14px', borderRadius: 11, cursor: 'pointer',
                background: chosen[i] ? t.accentBg : t.panel, border: '1px solid ' + (chosen[i] ? t.accentLine : t.line) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <Icon n={chosen[i] ? 'square-check' : 'square'} s={16} c={chosen[i] ? t.accent : t.t3} />
                <span style={{ flex: 1, fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>{d.title}</span>
                <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>{d.keyPoints.length} points</span>
              </div>
              {d.summary ? <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2, marginTop: 6, lineHeight: 1.5, paddingLeft: 25 }}>{d.summary}</div> : null}
            </div>)}
          </div>
        </> : tab === 'topic' ? <>
          <Label>What do you have to be able to explain?</Label>
          <input autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} className="selectable"
            placeholder="e.g. How the CSP margin model actually works"
            style={{ ...inputStyle, marginTop: 8 }} />
          <div style={{ marginTop: 14 }}><Label>Your own material on it (optional, but makes it real)</Label></div>
          <textarea value={topicCtx} onChange={(e) => setTopicCtx(e.target.value)} className="selectable"
            placeholder="Paste anything you have — the drill is built from this rather than from general knowledge."
            style={{ ...inputStyle, marginTop: 8, minHeight: 130, resize: 'vertical', lineHeight: 1.55 }} />
        </> : tab === 'project' ? <>
          <Label>Which project</Label>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {projects.map((p) => pickRow(p.id, p.name, p.areaName, pickedProject === p.id, () => setPickedProject(p.id)))}
          </div>
        </> : <>
          <Label>Which document</Label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search meetings, notes, docs…"
            className="selectable" style={{ ...inputStyle, marginTop: 8 }} />
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {docs.map((n) => pickRow(n.id, n.title, n.kind === 'meeting' ? 'Meeting' : n.date || '', pickedNote === n.id, () => setPickedNote(n.id)))}
            {!docs.length && <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, padding: '8px 2px' }}>No documents match.</div>}
          </div>
        </>}
        {err ? <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, marginTop: 12 }}>{err}</div> : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderTop: '1px solid ' + t.line, flex: 'none' }}>
        <span style={{ flex: 1, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
          {candidates ? 'Nothing is saved until you keep it.' : 'Reads your material and pulls out what you would have to explain.'}
        </span>
        {candidates
          ? <>
              <Btn kind="ghost" size="sm" onClick={() => { setCandidates(null); setErr(null) }}>Back</Btn>
              <Btn kind="primary" size="sm" icon={saving ? 'loader-2' : 'circle-check'} onClick={saveChosen}>
                {saving ? 'Saving…' : 'Keep selected'}</Btn>
            </>
          : <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : 'wand'} onClick={tab === 'topic' ? buildTopic : findDrills}>
              {busy ? 'Reading…' : tab === 'topic' ? 'Build drill' : 'Find drills'}</Btn>}
      </div>
    </div>
  </div>
}

// ── Session ──────────────────────────────────────────────────────
function PointRow({ text, hit }) {
  const { t, f } = useApp()
  const tag = hit == null ? null
    : <span style={{ fontFamily: f.ui, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: hit ? t.good : t.risk, marginRight: 9, flex: 'none' }}>{hit ? 'hit' : 'missed'}</span>
  return <div style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid ' + t.line,
    fontFamily: f.ui, fontSize: 13.5, color: t.t1, lineHeight: 1.5 }}>{tag}<span>{text}</span></div>
}

function Session({ dive, onExit, onChanged }) {
  const { t, f } = useApp()
  const { noteById, projectDigest } = useData()
  const [mode, setMode] = usePersisted('course.study.mode', 'type')
  const [phase, setPhase] = useState('setup')     // setup | answer | feedback
  const [revealed, setRevealed] = useState(false)
  const [answer, setAnswer] = useState('')
  const [graded, setGraded] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [runs, setRuns] = useState([])
  const [recording, setRecording] = useState(false)
  const recogRef = useRef(null)
  const finalRef = useRef('')

  const keyPoints = dive.keyPoints || []
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

  useEffect(() => { listRuns(dive.id).then(setRuns).catch(() => {}) }, [dive.id])
  useEffect(() => () => { try { recogRef.current && recogRef.current.stop() } catch {} }, [])

  // The source the grader checks against. Re-derived at grade time rather than
  // stored on the dive: notes get edited, and the record is whatever it says now.
  const sourceText = useCallback(() => {
    if (dive.sourceRef) { const n = noteById(dive.sourceRef); if (n) return noteContext(n) }
    if (dive.source === 'project' && dive.project) return projectDigest(dive.project)
    return ''
  }, [dive, noteById, projectDigest])

  const startRecording = () => {
    if (!SR) return
    finalRef.current = answer ? answer.trim() + ' ' : ''
    const r = new SR()
    r.continuous = true; r.interimResults = true; r.lang = 'en-US'
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript
        if (e.results[i].isFinal) finalRef.current += tr + ' '; else interim += tr
      }
      setAnswer((finalRef.current + interim).trim())
    }
    r.onerror = (ev) => { setErr('Mic error: ' + (ev.error || 'unknown')); stopRecording() }
    recogRef.current = r
    try { r.start(); setRecording(true); setErr(null) } catch (e) { setErr(String(e?.message || e)) }
  }
  const stopRecording = () => {
    setRecording(false)
    try { recogRef.current && recogRef.current.stop() } catch {}
  }

  const grade = async () => {
    const ans = answer.trim()
    if (!ans) { setErr('Nothing to grade yet.'); return }
    if (recording) stopRecording()
    setBusy(true); setErr(null)
    try {
      const g = await gradeExplanation({ prompt: dive.prompt, keyPoints, answer: ans, sourceText: sourceText() })
      setGraded(g)
      await logRun(dive, { mode, bucket: g.bucket, hits: g.hits, total: g.total, answer: ans, feedback: g.feedback, verdicts: g.verdicts })
      setPhase('feedback')
      listRuns(dive.id).then(setRuns).catch(() => {})
      onChanged && onChanged()
    } catch (e) { setErr('Grading failed - ' + String(e?.message || e)) }
    setBusy(false)
  }

  // Mental mode is self-graded: there is no answer text to check, so the run
  // records the rating and nothing else. Honest input in, honest history out.
  const selfRate = async (bucket) => {
    setBusy(true); setErr(null)
    try {
      await logRun(dive, { mode: 'mental', bucket, hits: null, total: keyPoints.length, answer: null, feedback: null, verdicts: [] })
      setGraded({ feedback: '', verdicts: [], corrections: [], bucket, hits: null, total: keyPoints.length })
      setPhase('feedback')
      listRuns(dive.id).then(setRuns).catch(() => {})
      onChanged && onChanged()
    } catch (e) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const restart = () => { setPhase('setup'); setAnswer(''); setGraded(null); setRevealed(false); setErr(null); finalRef.current = '' }

  const verdictFor = (i) => (graded?.verdicts || []).find((v) => v.index === i)
  const inputStyle = { width: '100%', border: '1px solid ' + t.line2, borderRadius: 11, outline: 0,
    background: t.bg, fontFamily: f.body, fontSize: 15, lineHeight: 1.6, color: t.t1, padding: '13px 15px', resize: 'vertical' }

  return <div data-screen-label="Study session" style={{ maxWidth: 780, margin: '0 auto', padding: '32px 36px 90px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <IconBtn n="arrow-left" s={19} title="Back to Study" onClick={onExit} />
      <span style={{ flex: 1, minWidth: 0, fontFamily: f.title, fontSize: 22, fontWeight: f.titleW,
        letterSpacing: f.titleSpacing, color: t.t1 }}>{dive.title}</span>
      <BucketPill bucket={dive.lastBucket} />
    </div>
    {dive.sourceLabel ? <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 6, marginLeft: 39 }}>
      from {dive.sourceLabel}</div> : null}

    {phase === 'setup' && <>
      <div style={{ marginTop: 24 }}><Label>How do you want to answer</Label></div>
      <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
        {MODES.map(([id, label]) => <span key={id} onClick={() => setMode(id)}
          style={{ fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: mode === id ? t.onAccent : t.t2,
            background: mode === id ? t.accent : t.sel, borderRadius: 9, padding: '7px 13px', cursor: 'pointer' }}>{label}</span>)}
      </div>
      <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, marginTop: 9, lineHeight: 1.5 }}>
        {(MODES.find((m) => m[0] === mode) || [])[2]}
        {mode === 'speak' && !SR ? ' Your browser has no speech recognition — you will get a box to type in instead.' : ''}
      </div>
      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Btn has no disabled prop — gate the handler instead of faking one. */}
        <Btn kind="primary" icon="player-play"
          onClick={() => { if (!keyPoints.length) return; setPhase('answer'); setErr(null) }}>Start</Btn>
        {!keyPoints.length && <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk }}>
          This drill has no key points - delete it and rebuild.</span>}
      </div>
      {runs.length > 0 && <div style={{ marginTop: 32 }}>
        <Label>History</Label>
        <div style={{ marginTop: 8 }}>{runs.map((r) => <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 0', borderBottom: '1px solid ' + t.line, fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>
          <span style={{ width: 58, flex: 'none', color: t.t3 }}>{fmtDay(r.at)}</span>
          <span style={{ width: 78, flex: 'none', color: t.t3 }}>{r.mode === 'mental' ? 'in your head' : r.mode === 'speak' ? 'spoken' : 'typed'}</span>
          <span style={{ flex: 1 }}>{r.total != null && r.hits != null ? `${r.hits} of ${r.total} points` : ''}</span>
          <BucketPill bucket={r.bucket} />
        </div>)}</div>
      </div>}
    </>}

    {phase === 'answer' && <>
      <Card style={{ marginTop: 22, padding: '18px 20px', background: t.panel }}>
        <div style={{ fontFamily: f.body, fontSize: 16.5, lineHeight: 1.55, color: t.t1 }}>{dive.prompt}</div>
      </Card>

      {mode === 'mental' && <div style={{ marginTop: 20 }}>
        {!revealed
          ? <Btn kind="outline" icon="eye" onClick={() => setRevealed(true)}>Reveal the points</Btn>
          : <>
              <Label>What a strong answer covers</Label>
              <div style={{ marginTop: 6 }}>{keyPoints.map((k, i) => <PointRow key={i} text={k.text} hit={null} />)}</div>
              <div style={{ marginTop: 18 }}><Label>How did you actually do</Label></div>
              <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
                {['miss', 'hard', 'easy'].map((b) => <Btn key={b} kind={b === 'easy' ? 'primary' : 'outline'} size="sm"
                  onClick={() => selfRate(b)}>{BUCKETS[b]}</Btn>)}
              </div>
            </>}
      </div>}

      {mode !== 'mental' && <div style={{ marginTop: 18 }}>
        {mode === 'speak' && SR && <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
          <Btn kind={recording ? 'outline' : 'primary'} icon={recording ? 'player-stop' : 'microphone'}
            onClick={() => (recording ? stopRecording() : startRecording())}>
            {recording ? 'Stop' : 'Start recording'}</Btn>
          <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>
            {recording ? 'Listening — say it the way you would in the room.' : answer ? 'Edit below if it misheard you, then grade.' : ''}</span>
        </div>}
        <textarea autoFocus={mode === 'type'} value={answer} onChange={(e) => setAnswer(e.target.value)} className="selectable"
          placeholder={mode === 'speak' ? 'Your words land here…' : 'Explain it from memory. Do not look anything up.'}
          style={{ ...inputStyle, minHeight: 200 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <Btn kind="primary" icon={busy ? 'loader-2' : 'circle-check'} onClick={grade}>{busy ? 'Grading…' : 'Grade it'}</Btn>
          <Btn kind="ghost" size="sm" onClick={restart}>Start over</Btn>
        </div>
      </div>}
      {err ? <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, marginTop: 12 }}>{err}</div> : null}
    </>}

    {phase === 'feedback' && graded && <>
      {graded.feedback ? <Card style={{ marginTop: 22, padding: '18px 20px' }}>
        <div style={{ fontFamily: f.body, fontSize: 15, lineHeight: 1.6, color: t.t1 }}>{graded.feedback}</div>
      </Card> : null}

      {graded.corrections?.length > 0 && <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12,
        background: t.riskBg, border: '1px solid ' + t.riskLine }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: f.ui, fontSize: 12,
          fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: t.risk }}>
          <Icon n="alert-triangle" s={14} />You said this, the record says otherwise</div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {graded.corrections.map((c, i) => <div key={i} style={{ fontFamily: f.ui, fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ color: t.t2 }}>You said: {c.said}</div>
            <div style={{ color: t.t1, fontWeight: 600, marginTop: 2 }}>Actually: {c.actual}</div>
          </div>)}
        </div>
      </div>}

      <div style={{ marginTop: 22 }}><Label>
        {graded.total != null && graded.hits != null ? `Key points — ${graded.hits} of ${graded.total}` : 'Key points'}</Label></div>
      <div style={{ marginTop: 6 }}>
        {keyPoints.map((k, i) => { const v = verdictFor(i); return <PointRow key={i} text={k.text} hit={v ? v.hit : null} /> })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22 }}>
        <Btn kind="primary" icon="check" onClick={onExit}>Done</Btn>
        <Btn kind="outline" icon="rotate" onClick={restart}>Run it again</Btn>
      </div>
    </>}
  </div>
}

// ── Screen ───────────────────────────────────────────────────────
export function StudyScreen() {
  const { route, go } = useApp()
  const [dives, setDives] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [filter, setFilter] = useState(route.project || 'all')
  const [building, setBuilding] = useState(route.build || null)
  const [active, setActive] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let rows = []
    try { rows = await listDives(); setLoadError(null) }
    catch (e) { setLoadError(String(e?.message || e)) }
    setDives(rows)
    setLoading(false)
    return rows
  }, [])

  useEffect(() => { load().then((rows) => {
    // Deep link straight into a drill (route.id), e.g. from a project.
    if (route.id) { const d = rows.find((x) => x.id === route.id); if (d) setActive(d) }
  }) }, [load, route.id])

  // Keep the open session's rollup fresh after a run so the shelf and the
  // session header agree without a full remount.
  const refreshActive = useCallback(async () => {
    const rows = await load()
    setActive((a) => (a ? rows.find((x) => x.id === a.id) || a : a))
  }, [load])

  const remove = async (d) => {
    if (!window.confirm(`Delete "${d.title}"? Its run history goes with it.`)) return
    try { await deleteDive(d.id); await load() } catch (e) { window.alert('Could not delete: ' + (e?.message || e)) }
  }

  if (active) return <Session dive={active} onExit={() => { setActive(null); if (route.id) go({ screen: 'study' }) }} onChanged={refreshActive} />

  return <>
    <Shelf dives={dives} loading={loading} loadError={loadError} filter={filter} setFilter={setFilter}
      onOpen={setActive} onDelete={remove} onNew={() => setBuilding({})} />
    {building && <BuildPanel initial={building} onClose={() => setBuilding(null)} onSaved={load} />}
  </>
}
