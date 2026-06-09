// Record.jsx — Scribe live recording surface. Recreates Direction B's
// RecordScreen (title + scope, projects-discussed multi-select, recorder card
// with mic/stop + big timer + animated level meter, notes scratchpad, detected
// speakers, speaker-labeled transcript, synthesize bar, and the synthesized
// result: summary, editable action items, suggested links, terms, save/discard).
// All recording state/actions come from RecorderContext; the session lives above
// the router so it survives navigation (see RecorderContext.jsx + FloatingRecorder).
import { useState, useEffect } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, Card, Label, Tag, Avatar, AreaDot, areaColor, Popover, PopRow } from '../kit'
import { fmtClock } from '../lib/recorder'
import { createNote, createTask } from '../lib/db'
import { TaskSheet, useLongPress } from './TaskSheet'
import { useRecorderCtx } from '../RecorderContext'

// Stable speaker hue from a fixed palette, keyed by speaker label.
const SPEAKER_KEYS = ['accent', 'area_arrow', 'area_brain', 'area_sds', 'good']
function speakerColor(t, sp) {
  let h = 0
  const s = String(sp || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return t[SPEAKER_KEYS[h % SPEAKER_KEYS.length]] || t.t2
}

// keyword scan → guess which projects a meeting touches (supports multiple)
const PROJECT_KEYWORDS = {
  csp:       /\b(csp|citrix|novation|telemetry|arrowsphere|emea|pricing tier|amendment)\b/gi,
  sgs:       /\b(sgs|tracker|l[eé]na[iï]g|ed lewis|nathalie|mattia|diane)\b/gi,
  maggetti:  /\b(maggetti|proposal|listing|retainer|mitch|cover email)\b/gi,
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

// Today as "Mon D, YYYY"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function todayLabel() { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }

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
function RecActionRow({ a, first, onToggle, onOpen }) {
  const { t, f } = useApp()
  const { projectById } = useData()
  const { pressing, handlers } = useLongPress(() => onOpen(a.id), () => onToggle(a.id), 450)
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
    <Icon n="dots" s={15} c={t.t3} />
  </div>
}

export function RecordScreen() {
  const { t, f, go, route, isMobile } = useApp()
  const { allProjects, projectById, areaOfProject, reload } = useData()
  const rec = useRecorderCtx()
  const projects = allProjects()

  const [homeOpen, setHomeOpen] = useState(false)
  const [projOpen, setProjOpen] = useState(false)
  const [actions, setActions] = useState([])
  const [sheetId, setSheetId] = useState(null)
  const [saving, setSaving] = useState(false)

  const { phase, seconds, title, home, notes, lines, transcriptText, synth, error } = rec
  const homeProj = projectById(home) || projects[0]

  // seed title/home from the route only when starting fresh (don't clobber a live session)
  useEffect(() => {
    if (phase !== 'idle') return
    const patch = {}
    if (route.project) patch.home = route.project
    if (route.title != null && !title) patch.title = route.title
    if (Object.keys(patch).length) rec.setMeta(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // seed editable draft action items once synthesis completes
  useEffect(() => {
    if (phase === 'done') {
      setActions((synth.actions || []).map((a, i) => ({ id: 'ra' + i, label: a.text, owner: a.owner || 'you', done: false })))
    } else if (phase === 'idle') {
      setActions([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const synthBusy = phase === 'synth'
  const transcribed = phase === 'ready' || phase === 'synth' || phase === 'done'
  const speakers = transcribed ? [...new Set(lines.map((l) => l.sp))] : []
  const live = phase === 'recording'
  const linked = rec.projects || []
  const addProj = (id) => rec.setProjects(linked.includes(id) ? linked : [...linked, id])
  const removeProj = (id) => rec.setProjects(linked.filter((x) => x !== id))
  const guesses = phase === 'done'
    ? guessProjects(lines.map((l) => l.text).join(' ') + ' ' + (notes || ''), (id) => !!projectById(id)).filter((g) => !linked.includes(g.id))
    : []
  const sheetAction = actions.find((x) => x.id === sheetId)

  const statusText = phase === 'recording' ? 'Recording — audio captured'
    : phase === 'paused' ? 'Paused'
    : phase === 'transcribing' ? 'Transcribing…'
    : phase === 'ready' ? 'Transcribed — ready to synthesize'
    : phase === 'synth' ? 'Synthesizing…'
    : phase === 'done' ? 'Synthesized'
    : 'Ready to record'

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const allLinked = [...new Set([home, ...linked])]
      const note = {
        kind: 'meeting', title: (title || '').trim() || 'Untitled meeting',
        project: home, area: areaOfProject(home)?.id || null,
        projects: allLinked, people: synth.people || [], tags: synth.tags || [],
        terms: synth.terms || [], summary: synth.summary || '', transcript: transcriptText,
        date: todayLabel(), updated: 'now', status: 2,
        actions: actions.map((a) => ({ text: a.label || a.text, owner: a.owner || 'you', src: 'this meeting' })),
      }
      if ((notes || '').trim()) note.body = [{ p: notes }]
      const noteId = await createNote(note)
      // checked action items become real tasks on the home project
      for (const a of actions) {
        if (a.done) await createTask(home, { label: a.label, srcMeeting: noteId, next: false })
      }
      rec.clear()
      await reload()
      go({ screen: 'project', id: home })
    } catch (e) {
      rec.setError(String(e?.message || e))
      setSaving(false)
    }
  }

  const pad = isMobile ? '26px 18px 90px' : '30px 36px 90px'

  return <div data-screen-label="Record meeting" style={{ maxWidth: 880, margin: '0 auto', padding: pad }}>
    {/* breadcrumb / exit — leaving keeps the session running in the floating window */}
    <div onClick={() => go({ screen: 'overview' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: f.ui, fontSize: 12.5, color: t.t3, cursor: 'pointer', marginBottom: 18 }}
      onMouseEnter={(e) => e.currentTarget.style.color = t.t1}
      onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
      <Icon n="chevron-left" s={15} />Work</div>

    {phase !== 'idle' && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14, fontFamily: f.ui,
      fontSize: 11.5, color: t.t3 }}><Icon n="pin" s={13} c={t.t3} />Leave this page and recording keeps going in a floating window.</div>}

    {error && <Card style={{ marginBottom: 14, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9,
      borderColor: t.riskLine, background: t.riskBg }}>
      <Icon n="alert-triangle" s={16} c={t.risk} />
      <span style={{ flex: 1, fontFamily: f.ui, fontSize: 12.5, color: t.t1 }}>{error}</span>
      <span onClick={() => rec.setError(null)} style={{ cursor: 'pointer', display: 'inline-flex', color: t.t3 }}><Icon n="x" s={15} /></span>
    </Card>}

    {/* title + scope */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
      <Icon n="microphone" s={18} c={t.accent} />
      <span style={{ fontFamily: f.label, fontSize: 10.5, fontWeight: 600, letterSpacing: f.labelSpacing,
        textTransform: 'uppercase', color: t.accent }}>Record · Scribe</span>
    </div>
    <input value={title} onChange={(e) => rec.setMeta({ title: e.target.value })} placeholder="Name this meeting…"
      className="selectable"
      style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontFamily: f.title,
        fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15 }} />

    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Save to</span>
      <span style={{ position: 'relative' }}>
        <span onClick={() => setHomeOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
          fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8,
          padding: '5px 11px', cursor: 'pointer' }}>
          {homeProj && <AreaDot areaId={homeProj.area} s={7} />}{homeProj ? homeProj.name : 'Pick a project'}<Icon n="chevron-down" s={12} c={t.t3} /></span>
        {homeOpen && <Popover onClose={() => setHomeOpen(false)} width={220} maxHeight={300}>
          {projects.map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={p.areaName}
            on={home === p.id} onClick={() => { rec.setMeta({ home: p.id }); setHomeOpen(false) }} />)}
        </Popover>}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
        <Icon n="users" s={13} />Speaker labels on</span>
    </div>

    {/* projects discussed — multiple */}
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <Label style={{ margin: 0 }}>Projects discussed</Label>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>tag any that come up — you can pick several</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {linked.map((id) => { const p = projectById(id); if (!p) return null
          return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5,
            fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '5px 7px 5px 10px' }}>
            <AreaDot areaId={p.area} s={7} />{p.name}
            <span onClick={() => removeProj(id)} title="Remove" style={{ display: 'inline-flex', cursor: 'pointer', color: t.t3 }}><Icon n="x" s={13} /></span>
          </span> })}
        <span style={{ position: 'relative' }}>
          <span onClick={() => setProjOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
            fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.accent, background: t.accentBg,
            border: '1px solid ' + t.accentLine, borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
            <Icon n="plus" s={13} />Add project</span>
          {projOpen && <Popover onClose={() => setProjOpen(false)} width={232} maxHeight={280}>
            {projects.filter((p) => !linked.includes(p.id)).map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)}
              label={p.name} hint={p.areaName} onClick={() => { addProj(p.id); setProjOpen(false) }} />)}
            {projects.filter((p) => !linked.includes(p.id)).length === 0 &&
              <div style={{ padding: '8px 10px', fontFamily: f.ui, fontSize: 12, color: t.t3 }}>All projects added.</div>}
          </Popover>}
        </span>
      </div>
    </div>

    {/* recorder */}
    <Card style={{ marginTop: 22, padding: '22px 24px', background: t.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {phase === 'recording' || phase === 'paused' ? (
          <button onClick={() => rec.stopAndTranscribe()} title="Stop recording" style={{ width: 60, height: 60, borderRadius: 30, flex: 'none',
            cursor: 'pointer', border: '1px solid ' + t.riskLine, background: t.riskBg, display: 'flex',
            alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {live && <span className="rec-pulse" style={{ position: 'absolute', inset: -1, borderRadius: 31 }} />}
            <span style={{ width: 18, height: 18, borderRadius: 4, background: t.risk }} /></button>
        ) : phase === 'transcribing' ? (
          <div style={{ width: 60, height: 60, borderRadius: 30, flex: 'none', border: '1px solid ' + t.line2,
            background: t.card, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon n="loader-2" s={24} c={t.t3} /></div>
        ) : (
          <button onClick={() => rec.start()} title={phase === 'idle' ? 'Start recording' : 'Record again'}
            style={{ width: 60, height: 60, borderRadius: 30, flex: 'none', cursor: 'pointer',
            border: '1px solid ' + t.accentLine, background: t.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon n="microphone" s={26} c={t.accent} /></button>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: f.meta, fontSize: 30, fontWeight: 600, color: phase === 'idle' ? t.t3 : t.t1,
              fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>{fmtClock(seconds)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5,
              fontWeight: 500, color: live ? t.risk : t.t2 }}>
              {live && <span style={{ width: 7, height: 7, borderRadius: 4, background: t.risk }} />}{statusText}</span>
          </div>
          <div style={{ marginTop: 6 }}><Levels live={live} color={t.accent} faint={t.line2} /></div>
        </div>

        {(phase === 'recording' || phase === 'paused') && <div style={{ flex: 'none' }}>
          {phase === 'recording'
            ? <Btn kind="outline" size="sm" icon="player-pause" onClick={() => rec.pause()}>Pause</Btn>
            : <Btn kind="outline" size="sm" icon="player-play" onClick={() => rec.resume()}>Resume</Btn>}
        </div>}
      </div>
    </Card>

    {/* notes scratchpad */}
    <div style={{ marginTop: 22 }}>
      <Label style={{ marginBottom: 10 }}>Notes</Label>
      <div style={{ background: t.card, border: '1px solid ' + t.line, borderRadius: 14 }}>
        <textarea value={notes} onChange={(e) => rec.setMeta({ notes: e.target.value })} className="selectable"
          placeholder="Jot notes as you go — these stay with the meeting and feed the synthesis…"
          style={{ width: '100%', minHeight: 110, border: 0, outline: 0, resize: 'vertical', background: 'transparent',
            fontFamily: f.body, fontSize: 14.5, lineHeight: 1.6, color: t.t1, padding: '14px 16px' }} />
      </div>
    </div>

    {/* speakers detected */}
    {speakers.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
      <Label>{speakers.length} speaker{speakers.length === 1 ? '' : 's'}</Label>
      {speakers.map((sp) => <span key={sp} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui,
        fontSize: 11.5, fontWeight: 600, color: t.t1, background: t.card, border: '1px solid ' + t.line, borderRadius: 20, padding: '3px 11px 3px 4px' }}>
        <Avatar name={sp} s={18} />{sp}</span>)}
    </div>}

    {/* transcript */}
    <div style={{ marginTop: 22 }}>
      <Label style={{ marginBottom: 10 }}>Transcript</Label>
      <div style={{ background: t.card, border: '1px solid ' + t.line, borderRadius: 14,
        padding: transcribed ? '6px 0' : 0, maxHeight: 360, overflowY: 'auto' }}>
        {phase === 'transcribing'
          ? <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <Icon n="loader-2" s={24} c={t.accent} />
              <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, marginTop: 10 }}>Transcribing audio…</div>
              <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 3 }}>Separating speakers and cleaning up the text.</div>
            </div>
          : !transcribed
            ? <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                <Icon n="wave-sine" s={26} c={t.t3} />
                <div style={{ fontFamily: f.body, fontSize: 14, color: t.t2, marginTop: 10 }}>
                  {live || phase === 'paused' ? 'Recording — transcript ready when you stop.' : 'Press record to start.'}</div>
                <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 3 }}>
                  {live || phase === 'paused' ? 'Audio is captured now and transcribed once you stop.' : 'Audio is transcribed after you stop, with speaker labels.'}</div>
              </div>
            : lines.map((l, i) => <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 18px',
                borderTop: i ? '1px solid ' + t.line : 'none', animation: 'lineIn .3s ease-out' }}>
                <Avatar name={l.sp} s={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: f.ui, fontSize: 12.5, fontWeight: 700, color: speakerColor(t, l.sp) }}>{l.sp}</span>
                    {l.at && <span style={{ fontFamily: f.meta, fontSize: 10.5, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{l.at}</span>}
                  </div>
                  <div className="selectable" style={{ fontFamily: f.body, fontSize: 14, lineHeight: 1.55, color: t.t1, marginTop: 3, textWrap: 'pretty' }}>{l.text}</div>
                </div>
              </div>)}
      </div>
    </div>

    {/* synthesize bar */}
    {(phase === 'ready' || phase === 'synth') && <Card style={{ marginTop: 18, padding: '14px 18px', display: 'flex',
      alignItems: 'center', gap: 14, borderColor: t.accentLine, background: t.accentBg }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, flex: 'none', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: t.card, border: '1px solid ' + t.accentLine }}><Icon n="sparkles" s={17} c={t.accent} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>Synthesize this recording</div>
        <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 1 }}>{lines.length} turns · {speakers.length} speakers · {fmtClock(seconds)} → summary, action items & terms</div>
      </div>
      <Btn kind="primary" size="sm" icon={synthBusy ? 'loader-2' : 'wand'} onClick={() => !synthBusy && rec.synthesize()}>{synthBusy ? 'Synthesizing…' : 'Synthesize'}</Btn>
    </Card>}

    {/* synthesized result */}
    {phase === 'done' && <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {synth.summary && <Card style={{ padding: '16px 18px', background: t.accentBg, borderColor: t.accentLine }}>
        <Label style={{ color: t.accent, marginBottom: 8 }}>Summary</Label>
        <div className="selectable" style={{ fontFamily: f.body, fontSize: 15, lineHeight: 1.6, color: t.t1, textWrap: 'pretty' }}>{synth.summary}</div>
      </Card>}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
          <Label style={{ margin: 0 }}>Action items · {actions.length}</Label>
          <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>tap to check · hold to edit, schedule or assign</span>
        </div>
        {actions.length > 0 ? <Card style={{ padding: '4px 0' }}>
          {actions.map((a, i) => <RecActionRow key={a.id} a={a} first={i === 0}
            onToggle={(id) => setActions((xs) => xs.map((x) => x.id === id ? { ...x, done: !x.done } : x))}
            onOpen={(id) => setSheetId(id)} />)}
        </Card> : <Card style={{ padding: '14px 16px', fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>No action items detected.</Card>}
      </div>
      {guesses.length > 0 && <div>
        <Label style={{ marginBottom: 9 }}>Suggested projects to link · {guesses.length}</Label>
        <Card style={{ padding: '4px 0' }}>
          {guesses.map((g, i) => { const p = projectById(g.id); if (!p) return null
            return <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px',
              borderTop: i ? '1px solid ' + t.line : 'none' }}>
              <AreaDot areaId={p.area} s={8} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1 }}>{p.name}</div>
                <div style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, marginTop: 2 }}>{p.areaName} · {g.score} mention{g.score === 1 ? '' : 's'} in transcript</div>
              </div>
              <Btn kind="outline" size="sm" icon="link" onClick={() => addProj(g.id)}>Link</Btn>
            </div> })}
        </Card>
      </div>}
      {(synth.terms || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
        <Label style={{ marginRight: 4 }}>Terms</Label>{synth.terms.map((tm) => <Tag key={tm}>{tm}</Tag>)}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, flexWrap: 'wrap' }}>
        <Btn kind="primary" icon={saving ? 'loader-2' : 'check'} onClick={save}>{saving ? 'Saving…' : `Save to ${homeProj ? homeProj.name : 'project'}`}</Btn>
        <Btn kind="ghost" onClick={() => rec.reset()}>Discard & re-record</Btn>
        {(notes || '').trim() && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui,
          fontSize: 11.5, color: t.t3, marginLeft: 'auto' }}><Icon n="note" s={13} />Your notes are included</span>}
      </div>
      {sheetAction && <TaskSheet task={sheetAction} projectId={sheetAction.project || home}
        onPatch={(p) => setActions((xs) => xs.map((x) => x.id === sheetId ? { ...x, ...p } : x))}
        onDelete={() => { setActions((xs) => xs.filter((x) => x.id !== sheetId)); setSheetId(null) }}
        onReassign={(pid) => setActions((xs) => xs.map((x) => x.id === sheetId ? { ...x, project: pid } : x))}
        onClose={() => setSheetId(null)} />}
    </div>}
  </div>
}
