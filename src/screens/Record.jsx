// Record.jsx — the Meeting composer (Direction B). A meeting is a first-class
// page you build up: title + metadata (pillar, multiple projects, people), a
// pre-meeting agenda, your live notes (the highest-signal input), and a
// transcript that comes EITHER from in-app recording OR from a pasted transcript
// (Copilot/Teams — better speakers, no cost). Synthesis → bullet summary +
// action items + smart tags, weighting your notes above the transcript.
// Session state lives in RecorderContext (above the router) so it survives nav.
import { useState, useEffect } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, Card, Label, Tag, Avatar, AreaDot, areaColor, Popover, PopRow, Markish, STATUS } from '../kit'
import { fmtClock } from '../lib/recorder'
import { markdownToBlocks } from '../lib/blocks'
import { createTask } from '../lib/db'
import { TaskSheet, useLongPress } from './TaskSheet'
import { useRecorderCtx } from '../RecorderContext'
import { MdEditor } from '../components/MdEditor'

// Stable speaker hue from a fixed palette, keyed by speaker label.
const SPEAKER_KEYS = ['accent', 'area_arrow', 'area_brain', 'area_sds', 'good']
function speakerColor(t, sp) {
  let h = 0; const s = String(sp || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return t[SPEAKER_KEYS[h % SPEAKER_KEYS.length]] || t.t2
}

// keyword scan → guess which projects a meeting touches (supports multiple)
const PROJECT_KEYWORDS = {
  csp: /\b(csp|citrix|novation|telemetry|arrowsphere|emea|pricing tier|amendment)\b/gi,
  sgs: /\b(sgs|tracker|l[eé]na[iï]g|ed lewis|nathalie|mattia|diane)\b/gi,
  maggetti: /\b(maggetti|proposal|listing|retainer|mitch|cover email)\b/gi,
  accenture: /\b(accenture|haritha|revised scope)\b/gi,
}
function guessProjects(text, has) {
  const scored = []
  for (const id of Object.keys(PROJECT_KEYWORDS)) {
    if (!has(id)) continue
    const m = (text || '').match(PROJECT_KEYWORDS[id])
    if (m && m.length) scored.push({ id, score: m.length })
  }
  return scored.sort((a, b) => b.score - a.score)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function todayLabel() { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }


// One relabelable speaker row. key=sp so it remounts (resets) after a rename.
function SpeakerRow({ sp, people, onRename }) {
  const { t, f } = useApp()
  const [val, setVal] = useState(sp)
  const commit = () => { const v = val.trim(); if (v && v !== sp) onRename(sp, v) }
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
    <Avatar name={val || sp} s={26} />
    <input value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} className="selectable"
      style={{ width: 150, border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 13, fontWeight: 600, color: t.t1, padding: '5px 10px' }} />
    {people.filter((p) => p && p !== val).slice(0, 5).map((p) => <span key={p} onClick={() => { setVal(p); onRename(sp, p) }} title={'Label as ' + p}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.t2, background: t.sel, borderRadius: 7, padding: '4px 9px', cursor: 'pointer' }}>
      <Icon n="user" s={11} c={t.t3} />{p}</span>)}
  </div>
}

function SpeakerLabeler({ speakers, people, onRename }) {
  const { t, f } = useApp()
  return <div style={{ marginTop: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <Label style={{ margin: 0 }}>Speakers · {speakers.length}</Label>
      <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>name each — applies to the transcript &amp; action-item owners{people.length ? ' · tap a person to assign' : ''}</span>
    </div>
    <Card style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {speakers.map((sp) => <SpeakerRow key={sp} sp={sp} people={people} onRename={onRename} />)}
    </Card>
  </div>
}

// Animated input-level meter — bars only animate while live
function Levels({ live, color, faint, bars = 36, h = 44 }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: h }}>
    {Array.from({ length: bars }).map((_, i) => <span key={i} style={{
      width: 3, borderRadius: 3, flex: 'none', background: live ? color : faint,
      height: live ? '100%' : 6, transformOrigin: 'center',
      animation: live ? `wave 1s ease-in-out ${(i % 9) * 0.08 + (i * 0.013)}s infinite` : 'none',
      opacity: live ? 0.9 : 0.5 }} />)}
  </div>
}

// A synthesized action-item row — tap toggles checked, hold opens the Task Sheet.
function RecActionRow({ a, first, onToggle, onOpen, onDismiss }) {
  const { t, f } = useApp()
  const { projectById } = useData()
  const { pressing, handlers } = useLongPress(() => onOpen(a.id), () => onToggle(a.id), 450)
  const [hov, setHov] = useState(false)
  const proj = a.project ? projectById(a.project) : null
  const due = a.dueDate || a.due
  return <div {...handlers} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 16px',
    borderTop: first ? 'none' : '1px solid ' + t.line, cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none',
    touchAction: 'manipulation', background: pressing ? t.sel : 'transparent', transition: 'background .15s' }}>
    <span style={{ width: 16, height: 16, borderRadius: 5, flex: 'none', marginTop: 1, position: 'relative',
      border: '1.5px solid ' + (a.done ? t.accent : t.t3), background: a.done ? t.accent : 'transparent' }}>
      {a.done && <Icon n="check" s={11} c={t.onAccent} style={{ position: 'absolute', inset: 0, margin: 'auto' }} />}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: f.body, fontSize: 14, color: a.done ? t.t3 : t.t1, textDecoration: a.done ? 'line-through' : 'none' }}>{a.label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3, fontFamily: f.ui, fontSize: 11, color: t.t3, flexWrap: 'wrap' }}>
        <span>{a.owner}</span>
        {proj && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>· <AreaDot areaId={proj.area} s={6} />{proj.name}</span>}
        {due && <span style={{ color: t.risk, fontWeight: 600 }}>· {typeof due === 'string' ? due : (due.m != null ? `${MONTHS[due.m]} ${due.d}` : '')}</span>}
      </div>
    </div>
    <span onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onDismiss(a.id) }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} title="Dismiss — remove this action"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 7, flex: 'none',
        cursor: 'pointer', background: hov ? t.riskBg : 'transparent', transition: 'background .14s' }}>
      <Icon n="x" s={15} c={hov ? t.risk : t.t3} /></span>
  </div>
}

export function RecordScreen() {
  const { t, f, go, route, isMobile, aiName } = useApp()
  const { allProjects, projectById, areaOfProject, areas, areaById, reload } = useData()
  const rec = useRecorderCtx()
  const projects = allProjects()
  // Pickers prioritize active → on-hold → ideas (archived last).
  const STATUS_RANK = { active: 0, sent: 1, 'on-hold': 2, idea: 3, archived: 4 }
  const pickerProjects = [...projects].sort((a, b) => (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5))

  const [homeOpen, setHomeOpen] = useState(false)
  const [pillarOpen, setPillarOpen] = useState(false)
  const [projOpen, setProjOpen] = useState(false)
  const [actions, setActions] = useState([])
  const [sheetId, setSheetId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [personDraft, setPersonDraft] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [showNext, setShowNext] = useState(false)
  const addAction = () => { const v = actionDraft.trim(); setActionDraft(''); if (v) setActions((xs) => [...xs, { id: 'm' + Date.now() + Math.round(Math.random() * 1e4), label: v, owner: 'me', done: false, manual: true }]) }

  const { phase, seconds, title, home, pillar, people, agenda, notes, source, detail, lines, transcriptText, synth, error, cost, warn, speakers: speakerCount, diarize, engine, browserWhisperSupported, tStatus, modelPct } = rec
  const tuneLocked = phase !== 'idle' && phase !== 'recording' && phase !== 'paused'
  const usd = (n) => '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(2))
  const homeProj = projectById(home)
  // pillar drives the project list; default Arrow. A chosen project's area wins.
  const effectivePillar = home ? (areaOfProject(home)?.id || null) : (pillar || (areaById('arrow') ? 'arrow' : (areas[0]?.id || null)))
  const destAreaId = effectivePillar
  const destArea = destAreaId ? areaById(destAreaId) : null
  const destLabel = homeProj ? homeProj.name : destArea ? destArea.name : 'Library'
  const pillarProjects = pickerProjects.filter((p) => p.area === effectivePillar)

  // seed title/home from the route when starting fresh
  useEffect(() => {
    if (phase !== 'idle') return
    const patch = {}
    if (route.project) patch.home = route.project
    if (route.title != null && !title) patch.title = route.title
    if (!route.project && !home && !pillar && areaById('arrow')) patch.pillar = 'arrow' // most meetings are Arrow
    if (Object.keys(patch).length) rec.setMeta(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // seed editable draft action items once synthesis completes
  useEffect(() => {
    if (phase === 'done') setActions((prev) => {
      const manual = prev.filter((a) => a.manual)
      const have = new Set(manual.map((a) => (a.label || '').trim().toLowerCase()))
      const ai = (synth.actions || []).map((a, i) => ({ id: 'ra' + i, label: a.text, owner: a.owner || 'me', done: false }))
        .filter((a) => !have.has((a.label || '').trim().toLowerCase()))
      return [...manual, ...ai]
    })
    else if (phase === 'idle') setActions([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Whenever a home project is set, make sure it's in "Projects discussed".
  useEffect(() => {
    if (home && !(rec.projects || []).includes(home)) rec.setProjects([...new Set([home, ...(rec.projects || [])])])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home])

  // Re-label a pasted transcript when participant names change (names make
  // "Name:" detection reliable and keep timestamps from looking like speakers).
  useEffect(() => {
    if (source === 'paste' && transcriptText && (phase === 'ready' || phase === 'idle')) rec.setTranscriptFromPaste(transcriptText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people])

  const synthBusy = phase === 'synth'
  const transcribed = phase === 'ready' || phase === 'synth' || phase === 'done'
  const speakers = transcribed ? [...new Set(lines.map((l) => l.sp))] : []
  const live = phase === 'recording'
  const linked = rec.projects || []
  const addProj = (id) => rec.setProjects(linked.includes(id) ? linked : [...linked, id])
  const removeProj = (id) => rec.setProjects(linked.filter((x) => x !== id))
  const addPerson = () => { const nm = personDraft.trim(); setPersonDraft(''); if (nm && !people.includes(nm)) rec.setMeta({ people: [...people, nm] }) }
  const removePerson = (nm) => rec.setMeta({ people: people.filter((x) => x !== nm) })
  const guesses = phase === 'done'
    ? guessProjects(lines.map((l) => l.text).join(' ') + ' ' + (notes || ''), (id) => !!projectById(id)).filter((g) => !linked.includes(g.id))
    : []
  const sheetAction = actions.find((x) => x.id === sheetId)
  const canSynth = !!(transcriptText || (notes || '').trim())
  const showSynthBar = phase === 'ready' || phase === 'synth' || (phase === 'idle' && (notes || '').trim() && !transcribed)
  const isRecordMode = source === 'record'

  const transcribingText = engine === 'browser'
    ? (tStatus === 'loading-model'
        ? 'Downloading Whisper model (first time only)…' + (modelPct > 0 ? ` ${modelPct}%` : '')
        : 'Transcribing on this device…')
    : 'Transcribing…'
  const statusText = phase === 'recording' ? 'Recording — audio captured'
    : phase === 'paused' ? 'Paused' : phase === 'transcribing' ? transcribingText
    : phase === 'ready' ? 'Transcribed — ready to synthesize' : phase === 'synth' ? 'Synthesizing…'
    : phase === 'done' ? 'Synthesized' : 'Ready to record'

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const allLinked = [...new Set([home, ...linked].filter(Boolean))]
      const note = {
        kind: 'meeting', title: (title || '').trim() || 'Untitled meeting',
        project: home || null, area: destAreaId || null,
        projects: allLinked, people: people || [], tags: synth.tags || [],
        terms: [], summary: synth.summary || '', transcript: transcriptText || null,
        agenda: (agenda || '').trim() || null, nextSteps: synth.nextSteps || null,
        date: todayLabel(), updated: 'now', status: 2,
        actions: actions.map((a) => ({ text: a.label || a.text, owner: a.owner || 'you', src: 'this meeting' })),
      }
      if ((notes || '').trim()) note.body = markdownToBlocks(notes)
      const noteId = await rec.finalizeNote(note)
      if (home) for (const a of actions) { if (a.done) await createTask(home, { label: a.label, srcMeeting: noteId, next: false }) }
      rec.clear(); await reload()
      go(home ? { screen: 'project', id: home } : { screen: 'note', id: noteId })
    } catch (e) { rec.setError(String(e?.message || e)); setSaving(false) }
  }

  const pad = isMobile ? '26px 18px 90px' : '30px 36px 90px'
  const editorBox = { background: t.card, border: '1px solid ' + t.line, borderRadius: 14, overflow: 'hidden' }

  return <div data-screen-label="Meeting" style={{ maxWidth: 880, margin: '0 auto', padding: pad }}>
    <div onClick={() => go({ screen: 'overview' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: f.ui, fontSize: 12.5, color: t.t3, cursor: 'pointer', marginBottom: 18 }}
      onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
      <Icon n="chevron-left" s={15} />Work</div>

    {phase === 'recording' || phase === 'paused' ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
      <Icon n="pin" s={13} c={t.t3} />Leave this page and recording keeps going in a floating window.</div> : null}

    {error && <Card style={{ marginBottom: 14, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9, borderColor: t.riskLine, background: t.riskBg }}>
      <Icon n="alert-triangle" s={16} c={t.risk} />
      <span style={{ flex: 1, fontFamily: f.ui, fontSize: 12.5, color: t.t1 }}>{error}</span>
      <span onClick={() => rec.setError(null)} style={{ cursor: 'pointer', display: 'inline-flex', color: t.t3 }}><Icon n="x" s={15} /></span></Card>}

    {warn && <Card style={{ marginBottom: 14, padding: '11px 14px', display: 'flex', alignItems: 'flex-start', gap: 9, borderColor: t.riskLine, background: t.riskBg }}>
      <Icon n="alert-triangle" s={16} c={t.risk} style={{ marginTop: 1 }} />
      <span style={{ flex: 1, fontFamily: f.ui, fontSize: 12.5, lineHeight: 1.5, color: t.t1 }}>{warn}</span>
      <span onClick={() => rec.setWarn(null)} style={{ cursor: 'pointer', display: 'inline-flex', color: t.t3 }}><Icon n="x" s={15} /></span></Card>}

    {(phase === 'recording' || phase === 'paused') && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
      <Icon n="eye" s={13} c={t.t3} />Keep this tab in front and the screen on — backgrounding can pause audio capture.</div>}

    {rec.recoveredBlob && <Card style={{ marginBottom: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 11, borderColor: t.accentLine, background: t.accentBg, flexWrap: 'wrap' }}>
      <Icon n="microphone" s={18} c={t.accent} />
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontFamily: f.ui, fontSize: 13, fontWeight: 600, color: t.t1 }}>Interrupted recording found</div>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Audio from a recording that didn’t finish (~{Math.max(1, Math.round(rec.recoveredBlob.size / 1048576))} MB) — recover it to transcribe.</div>
      </div>
      <Btn kind="primary" size="sm" icon="wand" onClick={() => rec.recoverAudio()}>Recover</Btn>
      <Btn kind="ghost" size="sm" onClick={() => rec.dismissRecovered()}>Discard</Btn>
    </Card>}

    {/* header + title */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
      <Icon n="users" s={18} c={t.accent} />
      <span style={{ fontFamily: f.label, fontSize: 10.5, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent }}>Meeting</span>
      {(title || notes || agenda || transcriptText) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 10.5, color: t.t3 }}>
        <Icon n="cloud-check" s={12} c={t.t3} />Auto-saved · recovers if you leave</span>}
    </div>
    <input value={title} onChange={(e) => rec.setMeta({ title: e.target.value })} placeholder="Name this meeting…" className="selectable"
      style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15 }} />

    {/* save-to: pillar (drives the project list) · project */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Save to</span>
      {/* pillar — defaults to Arrow */}
      <span style={{ position: 'relative' }}>
        <span onClick={() => setPillarOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: destArea ? t.t1 : t.t3, background: t.sel, borderRadius: 8, padding: '5px 11px', cursor: 'pointer' }}>
          <Icon n="folder" s={13} c={t.t3} />{destArea ? destArea.name : 'Library'}<Icon n="chevron-down" s={12} c={t.t3} /></span>
        {pillarOpen && <Popover onClose={() => setPillarOpen(false)} width={220} maxHeight={300}>
          <PopRow icon="stack-2" label="Library only (no pillar)" on={!destArea} onClick={() => { rec.setMeta({ pillar: null, home: null }); setPillarOpen(false) }} />
          {areas.map((a) => <PopRow key={a.id} dot={areaColor(t, a.id)} label={a.name} hint={(a.projects.length || 0) + ''} on={effectivePillar === a.id}
            onClick={() => { const keep = home && areaOfProject(home)?.id === a.id; rec.setMeta({ pillar: a.id, home: keep ? home : null }); setPillarOpen(false) }} />)}
        </Popover>}
      </span>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>·</span>
      {/* project — only this pillar's projects */}
      <span style={{ position: 'relative' }}>
        <span onClick={() => setHomeOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: homeProj ? t.t1 : t.t3, background: homeProj ? t.sel : 'transparent', border: homeProj ? 'none' : '1px solid ' + t.line, borderRadius: 8, padding: '5px 11px', cursor: 'pointer' }}>
          {homeProj ? homeProj.name : 'No project'}<Icon n="chevron-down" s={12} c={t.t3} /></span>
        {homeOpen && <Popover onClose={() => setHomeOpen(false)} width={232} maxHeight={300}>
          <PopRow icon="ban" label="No project — pillar only" on={!home} onClick={() => { rec.setMeta({ home: null }); setHomeOpen(false) }} />
          {pillarProjects.map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={STATUS[p.status] ? STATUS[p.status].label : ''} on={home === p.id}
            onClick={() => { rec.setMeta({ home: p.id }); rec.setProjects([...new Set([p.id, ...linked])]); setHomeOpen(false) }} />)}
          {pillarProjects.length === 0 && <div style={{ padding: '8px 10px', fontFamily: f.ui, fontSize: 12, color: t.t3 }}>No projects in {destArea ? destArea.name : 'this pillar'}.</div>}
        </Popover>}
      </span>
    </div>

    {/* people (attendees + speakers) */}
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <Label style={{ margin: 0 }}>People</Label>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>who's here / who spoke — also labels a pasted transcript</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {people.map((nm) => <span key={nm} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 20, padding: '4px 7px 4px 11px' }}>
          <Icon n="user" s={12} c={t.t2} />{nm}
          <span onClick={() => removePerson(nm)} title="Remove" style={{ display: 'inline-flex', cursor: 'pointer', color: t.t3 }}><Icon n="x" s={12} /></span></span>)}
        <input value={personDraft} onChange={(e) => setPersonDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson() } }} onBlur={addPerson}
          placeholder="Add a name…" className="selectable"
          style={{ width: 130, border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 12.5, color: t.t1, padding: '5px 10px' }} />
      </div>
    </div>

    {/* projects discussed */}
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <Label style={{ margin: 0 }}>Projects discussed</Label>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>tag any that come up — you can pick several</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {linked.map((id) => { const p = projectById(id); if (!p) return null
          return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '5px 7px 5px 10px' }}>
            <AreaDot areaId={p.area} s={7} />{p.name}
            <span onClick={() => removeProj(id)} title="Remove" style={{ display: 'inline-flex', cursor: 'pointer', color: t.t3 }}><Icon n="x" s={13} /></span></span> })}
        <span style={{ position: 'relative' }}>
          <span onClick={() => setProjOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.accent, background: t.accentBg, border: '1px solid ' + t.accentLine, borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
            <Icon n="plus" s={13} />Add project</span>
          {projOpen && <Popover onClose={() => setProjOpen(false)} width={232} maxHeight={280}>
            {pickerProjects.filter((p) => !linked.includes(p.id)).map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={p.areaName} onClick={() => { addProj(p.id); setProjOpen(false) }} />)}
            {pickerProjects.filter((p) => !linked.includes(p.id)).length === 0 && <div style={{ padding: '8px 10px', fontFamily: f.ui, fontSize: 12, color: t.t3 }}>All projects added.</div>}
          </Popover>}
        </span>
      </div>
    </div>

    {/* live notes — highest signal. Full markdown editor (headings, tables,
        bold, lists) — same formatting as every other notes section. */}
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Label style={{ margin: 0 }}>My notes</Label>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>what you write down — weighted above the transcript</span>
      </div>
      <MdEditor value={notes} onChange={(v) => rec.setMeta({ notes: v })} minHeight={420} />
    </div>

    {/* action items — yours; Claude appends your action items on synthesize */}
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
        <Label style={{ margin: 0 }}>My action items{actions.length ? ' · ' + actions.length : ''}</Label>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>add your own · check to push to tasks · × to dismiss · synthesize adds more</span>
      </div>
      {actions.length > 0 && <Card style={{ padding: '4px 0', marginBottom: 8 }}>
        {actions.map((a, i) => <RecActionRow key={a.id} a={a} first={i === 0}
          onToggle={(id) => setActions((xs) => xs.map((x) => x.id === id ? { ...x, done: !x.done } : x))}
          onOpen={(id) => setSheetId(id)}
          onDismiss={(id) => setActions((xs) => xs.filter((x) => x.id !== id))} />)}
      </Card>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: '1px solid ' + t.line2, background: t.card }}>
        <Icon n="plus" s={15} c={t.t3} />
        <input value={actionDraft} onChange={(e) => setActionDraft(e.target.value)} onBlur={addAction}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAction() } }}
          placeholder="Add an action item for yourself…" className="selectable"
          style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: f.body, fontSize: 14, color: t.t1 }} />
      </div>
    </div>

    {/* transcript — record OR paste */}
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <Label style={{ margin: 0 }}>Transcript</Label>
        <div style={{ display: 'inline-flex', background: t.sel, borderRadius: 9, padding: 2 }}>
          {[['paste', 'Paste', 'clipboard'], ['record', 'Record', 'microphone']].map(([id, label, icon]) => {
            const on = source === id
            return <span key={id} onClick={() => { if (!tuneLocked || phase === 'idle') rec.setMeta({ source: id }) }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: on ? t.t1 : t.t3, background: on ? t.card : 'transparent', border: '1px solid ' + (on ? t.line2 : 'transparent'), borderRadius: 7, padding: '4px 11px' }}>
              <Icon n={icon} s={13} c={on ? t.accent : t.t3} />{label}</span>
          })}
        </div>
        {source === 'paste' && <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>paste from Copilot / Teams — better speakers, no cost</span>}
      </div>

      {source === 'paste'
        ? <div style={editorBox}>
            <textarea value={transcriptText} onChange={(e) => rec.setTranscriptFromPaste(e.target.value)} className="selectable"
              placeholder={'Paste a transcript here…\n\nName: what they said\nOther name: their reply'}
              style={{ width: '100%', minHeight: 150, border: 0, outline: 0, resize: 'vertical', background: 'transparent', fontFamily: f.body, fontSize: 14, lineHeight: 1.6, color: t.t1, padding: '14px 16px' }} />
          </div>
        : <>
            {/* engine picker — cloud (speaker labels) vs on-device Whisper (private, free) */}
            {browserWhisperSupported && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Transcribe with</span>
              <div style={{ display: 'inline-flex', background: t.sel, borderRadius: 9, padding: 2 }}>
                {[['cloud', 'Cloud · speaker labels', 'cloud'], ['browser', 'On device · private', 'device-laptop']].map(([id, label, icon]) => {
                  const on = engine === id
                  const locked = phase !== 'idle' && phase !== 'recording' && phase !== 'paused'
                  return <span key={id} onClick={() => { if (!locked) rec.setMeta({ engine: id }) }} title={id === 'browser' ? 'Runs in your browser — nothing leaves this device, no cost, no speaker labels' : 'AssemblyAI — identifies who said what'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12, fontWeight: 600, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.6 : 1, color: on ? t.t1 : t.t3, background: on ? t.card : 'transparent', border: '1px solid ' + (on ? t.line2 : 'transparent'), borderRadius: 7, padding: '4px 11px' }}>
                    <Icon n={icon} s={13} c={on ? t.accent : t.t3} />{label}</span>
                })}
              </div>
              {engine === 'browser' && <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>first use downloads a ~40MB model, then it's offline &amp; free</span>}
            </div>}
            {/* recorder card */}
            <Card style={{ padding: '22px 24px', background: t.panel }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                {phase === 'recording' || phase === 'paused' ? (
                  <button onClick={() => rec.stopAndTranscribe()} title="Stop recording" style={{ width: 60, height: 60, borderRadius: 30, flex: 'none', cursor: 'pointer', border: '1px solid ' + t.riskLine, background: t.riskBg, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {live && <span className="rec-pulse" style={{ position: 'absolute', inset: -1, borderRadius: 31 }} />}
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: t.risk }} /></button>
                ) : phase === 'transcribing' ? (
                  <div style={{ width: 60, height: 60, borderRadius: 30, flex: 'none', border: '1px solid ' + t.line2, background: t.card, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon n="loader-2" s={24} c={t.t3} /></div>
                ) : (
                  <button onClick={() => rec.start()} title={phase === 'idle' ? 'Start recording' : 'Record again'} style={{ width: 60, height: 60, borderRadius: 30, flex: 'none', cursor: 'pointer', border: '1px solid ' + t.accentLine, background: t.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon n="microphone" s={26} c={t.accent} /></button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: f.meta, fontSize: 30, fontWeight: 600, color: phase === 'idle' ? t.t3 : t.t1, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>{fmtClock(seconds)}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 500, color: live ? t.risk : t.t2 }}>
                      {live && <span style={{ width: 7, height: 7, borderRadius: 4, background: t.risk }} />}{statusText}</span>
                  </div>
                  <div style={{ marginTop: 6 }}><Levels live={live} color={t.accent} faint={t.line2} /></div>
                </div>
                {(phase === 'recording' || phase === 'paused') && <div style={{ flex: 'none' }}>
                  {phase === 'recording' ? <Btn kind="outline" size="sm" icon="player-pause" onClick={() => rec.pause()}>Pause</Btn>
                    : <Btn kind="outline" size="sm" icon="player-play" onClick={() => rec.resume()}>Resume</Btn>}
                </div>}
              </div>
            </Card>
            {/* tuning — speaker labels only exist on the cloud engine */}
            {engine === 'cloud' && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span onClick={() => !tuneLocked && rec.setMeta({ diarize: !diarize })} title="Identify who said what"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: diarize ? t.t1 : t.t3, background: t.sel, borderRadius: 8, padding: '5px 10px', cursor: tuneLocked ? 'default' : 'pointer', opacity: tuneLocked ? 0.6 : 1 }}>
                <Icon n="users" s={13} c={diarize ? t.accent : t.t3} />Speaker labels {diarize ? 'on' : 'off'}</span>
              {diarize && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
                <input type="number" min={1} max={10} disabled={tuneLocked} value={speakerCount ?? ''} placeholder="auto"
                  onChange={(e) => { const v = parseInt(e.target.value, 10); rec.setMeta({ speakers: Number.isInteger(v) && v >= 1 ? v : null }) }}
                  style={{ width: 52, border: '1px solid ' + t.line2, borderRadius: 7, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 12, color: t.t1, padding: '3px 7px' }} />
                <span>expected speakers</span></span>}
            </div>}
          </>}
    </div>

    {/* speakers — only after synthesize; AI has guessed names (People-led, else inferred).
        On-device Whisper has no diarization, so there's nothing to label. */}
    {phase === 'done' && engine === 'cloud' && speakers.length > 0 && <SpeakerLabeler speakers={speakers} people={people} onRename={(from, to) => rec.renameSpeaker(from, to)} />}

    {/* recorded transcript preview (record mode) */}
    {isRecordMode && (phase === 'transcribing' || (transcribed && lines.length > 0)) && <div style={{ marginTop: 18 }}>
      <div style={{ ...editorBox, padding: '6px 0', maxHeight: 320, overflowY: 'auto' }}>
        {phase === 'transcribing'
          ? <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <Icon n="loader-2" s={24} c={t.accent} />
              <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, marginTop: 10 }}>Transcribing audio…</div></div>
          : lines.map((l, i) => <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 18px', borderTop: i ? '1px solid ' + t.line : 'none', animation: 'lineIn .3s ease-out' }}>
              <Avatar name={l.sp} s={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: f.ui, fontSize: 12.5, fontWeight: 700, color: speakerColor(t, l.sp) }}>{l.sp}</span>
                  {l.at && <span style={{ fontFamily: f.meta, fontSize: 10.5, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{l.at}</span>}
                </div>
                <div className="selectable" style={{ fontFamily: f.body, fontSize: 14, lineHeight: 1.55, color: t.t1, marginTop: 3, textWrap: 'pretty' }}>{l.text}</div>
              </div></div>)}
      </div>
    </div>}

    {/* synthesize bar */}
    {showSynthBar && <Card style={{ marginTop: 18, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, borderColor: t.accentLine, background: t.accentBg, flexWrap: 'wrap' }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.card, border: '1px solid ' + t.accentLine }}><Icon n="sparkles" s={17} c={t.accent} /></span>
      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>Synthesize</div>
        <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 1 }}>{transcriptText ? `${lines.length} turns${speakers.length ? ' · ' + speakers.length + ' speakers' : ''} · ` : ''}summary, action items & tags</div>
      </div>
      {/* detail level */}
      <div style={{ display: 'inline-flex', background: t.card, border: '1px solid ' + t.accentLine, borderRadius: 9, padding: 2 }}>
        {[['low', 'Brief'], ['medium', 'Medium'], ['high', 'Detailed']].map(([id, label]) => {
          const on = detail === id
          return <span key={id} onClick={() => rec.setMeta({ detail: id })} title={id === 'high' ? 'In-depth — best for building an artifact' : id === 'low' ? 'Highest-level — key points only' : 'Balanced overview'}
            style={{ fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', color: on ? t.onAccent : t.t2, background: on ? t.accent : 'transparent', borderRadius: 7, padding: '4px 10px' }}>{label}</span>
        })}
      </div>
      <Btn kind="primary" size="sm" icon={synthBusy ? 'loader-2' : 'wand'} onClick={() => !synthBusy && canSynth && rec.synthesize()}>{synthBusy ? 'Synthesizing…' : 'Synthesize'}</Btn>
      <Btn kind="outline" size="sm" icon={saving ? 'loader-2' : 'check'} onClick={() => !saving && !synthBusy && save()}>{saving ? 'Saving…' : `Save to ${destLabel}`}</Btn>
    </Card>}

    {/* synthesized result */}
    {phase === 'done' && <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {cost && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: f.ui, fontSize: 11.5, color: t.t3, background: t.card, border: '1px solid ' + t.line, borderRadius: 10, padding: '8px 13px' }}>
        <Icon n="coin" s={14} c={t.t3} />
        <span style={{ fontWeight: 600, color: t.t2 }}>Cost {usd(cost.total)}</span>
        {cost.transcribe > 0 && <span>· transcribe {usd(cost.transcribe)} ({fmtClock(seconds)})</span>}
        <span>· synthesis {usd(cost.claude)}{cost.usage ? ` (${cost.usage.input_tokens}+${cost.usage.output_tokens} tok)` : ''}</span>
        {cost.estimated && <span style={{ fontStyle: 'italic' }}>· est.</span>}
      </div>}
      {synth.summary && <Card style={{ padding: '16px 18px', background: t.accentBg, borderColor: t.accentLine }}>
        <Label style={{ color: t.accent, marginBottom: 10 }}>Summary</Label>
        <Markish text={synth.summary} /></Card>}
      {synth.nextSteps && synth.nextSteps.trim() && <div>
        <div onClick={() => setShowNext((s) => !s)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
          borderRadius: showNext ? '11px 11px 0 0' : 11, cursor: 'pointer', background: t.card, border: '1px solid ' + t.line, fontFamily: f.ui, fontSize: 13, fontWeight: 600, color: t.t1 }}>
          <Icon n={showNext ? 'chevron-down' : 'chevron-right'} s={14} c={t.t3} />
          <Icon n="bulb" s={15} c={t.accent} />Suggested next steps
          <span style={{ flex: 1 }} /><span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 500, color: t.t3 }}>{aiName}’s take</span></div>
        {showNext && <div style={{ padding: '14px 16px', background: t.card, border: '1px solid ' + t.line, borderTop: 'none', borderRadius: '0 0 11px 11px' }}>
          <Markish text={synth.nextSteps} /></div>}
      </div>}
      {guesses.length > 0 && <div>
        <Label style={{ marginBottom: 9 }}>Suggested projects to link · {guesses.length}</Label>
        <Card style={{ padding: '4px 0' }}>
          {guesses.map((g, i) => { const p = projectById(g.id); if (!p) return null
            return <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', borderTop: i ? '1px solid ' + t.line : 'none' }}>
              <AreaDot areaId={p.area} s={8} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1 }}>{p.name}</div>
                <div style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, marginTop: 2 }}>{p.areaName} · {g.score} mention{g.score === 1 ? '' : 's'}</div>
              </div>
              <Btn kind="outline" size="sm" icon="link" onClick={() => addProj(g.id)}>Link</Btn>
            </div> })}
        </Card>
      </div>}
      {(synth.tags || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
        <Label style={{ marginRight: 4 }}>Tags</Label>{synth.tags.map((tg) => <Tag key={tg}>{tg}</Tag>)}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, flexWrap: 'wrap' }}>
        <Btn kind="primary" icon={saving ? 'loader-2' : 'check'} onClick={save}>{saving ? 'Saving…' : `Save to ${destLabel}`}</Btn>
        <Btn kind="ghost" onClick={() => rec.discard()}>Discard</Btn>
        {(notes || '').trim() && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginLeft: 'auto' }}><Icon n="note" s={13} />Your notes are weighted highest</span>}
      </div>
      {sheetAction && <TaskSheet task={sheetAction} projectId={sheetAction.project || home}
        onPatch={(p) => setActions((xs) => xs.map((x) => x.id === sheetId ? { ...x, ...p } : x))}
        onDelete={() => { setActions((xs) => xs.filter((x) => x.id !== sheetId)); setSheetId(null) }}
        onReassign={(pid) => setActions((xs) => xs.map((x) => x.id === sheetId ? { ...x, project: pid } : x))}
        onClose={() => setSheetId(null)} />}
    </div>}
  </div>
}
