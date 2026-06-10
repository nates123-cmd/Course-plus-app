// RecorderContext.jsx — lifts the real mic recorder to app level so a live
// recording session survives navigation (the prototype used an external
// RecorderStore; here React state lives above the router). Holds the recorder
// hook plus session meta (title, home project, discussed projects, scratch
// notes, transcript lines, synthesized fields) and the phase machine that
// drives both the full Record screen and the FloatingRecorder mini-window.
import { createContext, useContext, useMemo, useState } from 'react'
import { useApp } from './ctx'
import { useData } from './DataContext'
import { Icon, Btn } from './kit'
import { useRecorder, fmtClock } from './lib/recorder'
import { transcribeAudio } from './lib/transcribe'
import { synthesizeMeeting } from './lib/ai'
import { claudeCost } from './lib/claude'

// AssemblyAI async transcription, USD per hour (Best/Universal tier, speaker
// diarization on). Nano tier (no good diarization) is ~$0.12/hr.
const TRANSCRIBE_USD_PER_HOUR = 0.27

const RecorderCtx = createContext(null)
export function useRecorderCtx() { return useContext(RecorderCtx) }

// phase: idle | recording | paused | transcribing | ready | synth | done
// recording/paused are owned by the recorder hook (status). The rest are the
// post-stop processing stages, tracked here in `proc`.
const PROC_IDLE = 'idle'

const emptySynth = { summary: '', actions: [], terms: [], people: [], tags: [] }

export function RecorderProvider({ go, children }) {
  const recorder = useRecorder()
  const { status, seconds, interrupted } = recorder

  // post-recording processing phase (idle when not in a processing stage)
  const [proc, setProc] = useState(PROC_IDLE) // idle | transcribing | ready | synth | done
  const [error, setError] = useState(null)
  const [warn, setWarn] = useState(null) // soft warning (e.g. likely-truncated transcript)

  // session meta
  const [title, setTitle] = useState('')
  const [home, setHome] = useState(null)      // home project id, or null (pillar-only)
  const [pillar, setPillar] = useState(null)  // area id when no home project
  const [projects, setProjects] = useState([]) // discussed/linked project ids
  const [people, setPeople] = useState([])     // attendees + speakers (combined)
  const [agenda, setAgenda] = useState('')     // pre-meeting prep notes
  const [notes, setNotes] = useState('')       // live notes (highest-signal)
  const [source, setSource] = useState('paste') // transcript source: 'paste' | 'record'
  // transcription tuning (record mode only)
  const [speakers, setSpeakers] = useState(null) // expected speaker count (null = auto)
  const [diarize, setDiarize] = useState(true)   // speaker labels on/off
  const [lines, setLines] = useState([]) // [{ sp, text, at }]
  const [transcriptText, setTranscriptText] = useState('')
  const [synth, setSynth] = useState(emptySynth)
  const [cost, setCost] = useState(null) // { transcribe, claude, total, usage, estimated }

  // The effective phase: recorder status wins while live/paused, otherwise the
  // processing stage. When the recorder is idle and we haven't started any
  // processing, the session is idle.
  const phase = status === 'recording' || status === 'paused' ? status : proc

  // setMeta(patch) — patch any combination of session meta fields.
  const setMeta = (patch) => {
    if (!patch) return
    if ('title' in patch) setTitle(patch.title)
    if ('home' in patch) setHome(patch.home)
    if ('pillar' in patch) setPillar(patch.pillar)
    if ('projects' in patch) setProjects(patch.projects)
    if ('people' in patch) setPeople(patch.people)
    if ('agenda' in patch) setAgenda(patch.agenda)
    if ('notes' in patch) setNotes(patch.notes)
    if ('source' in patch) setSource(patch.source)
    if ('speakers' in patch) setSpeakers(patch.speakers)
    if ('diarize' in patch) setDiarize(patch.diarize)
  }

  const start = async () => {
    setError(null); setWarn(null)
    setLines([]); setTranscriptText(''); setSynth(emptySynth); setCost(null)
    setProc(PROC_IDLE)
    await recorder.start()
  }
  const pause = () => recorder.pause()
  const resume = () => recorder.resume()

  // Parse a speaker-labeled transcript into lines. Handles AssemblyAI's
  // "Speaker A: …" and Copilot/Teams' "Name: …". When the meeting's participant
  // names are known, ONLY those (or "Speaker X") start a new turn — this is the
  // reliable path and stops timestamps ("10:23:") from being read as speakers.
  // Without known names, a heuristic requires a letter and rejects time patterns.
  const isTimestamp = (s) => /^\[?\(?\d{1,2}:\d{2}(:\d{2})?\.?\d*\s*(?:[ap]\.?m\.?)?\)?\]?$/i.test(s.trim())
  const parseLines = (text, names = []) => {
    const known = new Set((names || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean))
    const raw = (text || '').replace(/\r/g, '')
    const chunks = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    const speaker = /^([^:]{1,40}?)\s*:\s*(.*)$/
    const out = []
    chunks.forEach((line) => {
      const m = line.match(speaker)
      let starts = false
      if (m) {
        const name = m[1].trim(); const low = name.toLowerCase()
        if (known.size) starts = known.has(low) || /^speaker\s+\S+$/i.test(name)
        else starts = /[A-Za-z]/.test(name) && name.split(/\s+/).length <= 4 && !/[.!?]$/.test(name) && !isTimestamp(name)
      }
      if (starts) out.push({ sp: m[1].trim(), text: m[2].trim() })
      else if (out.length) out[out.length - 1].text += ' ' + line
      else out.push({ sp: known.size ? 'Speaker' : 'Speaker A', text: line })
    })
    return out
  }

  // Stop the recorder → blob, then transcribe (speaker-labeled) and parse.
  const stopAndTranscribe = async () => {
    setError(null)
    let blob = null
    try { blob = await recorder.stop() } catch (e) { setError(humanize(e)); setProc(PROC_IDLE); return }
    if (!blob || !blob.size) { setError('No audio was captured.'); setProc(PROC_IDLE); return }
    setProc('transcribing')
    try {
      const text = await transcribeAudio(blob, { onStatus: () => setProc('transcribing'),
        speakersExpected: speakers, diarize })
      const parsed = parseLines(text, people)
      // attach rough timestamps (we don't get word-level offsets back here)
      const withAt = parsed.map((l, i) => ({ ...l, at: fmtClock(i * 8 + 2) }))
      setLines(withAt)
      setTranscriptText(text)
      // Completeness check: ~120 wpm is normal speech. If the transcript is far
      // short of what the elapsed time implies (or the tab went background), the
      // audio capture likely paused — warn so the user doesn't trust a partial.
      const words = (text || '').split(/\s+/).filter(Boolean).length
      const expected = (seconds / 60) * 120
      if (seconds > 120 && (interrupted || words < expected * 0.4)) {
        const mins = Math.round(seconds / 60)
        setWarn(`This transcript looks short — ~${words.toLocaleString()} words for a ${mins}-min recording. ` +
          (interrupted ? 'The tab went to the background mid-recording, ' : 'Audio capture likely paused, ') +
          'so it may be missing audio. Keep this tab in front (and the screen on) while recording.')
      } else setWarn(null)
      setSource('record')
      setProc('ready')
    } catch (e) {
      setError(humanize(e))
      setProc(PROC_IDLE)
    }
  }

  // Paste path — a transcript from Copilot / Teams (real names, no AssemblyAI).
  const setTranscriptFromPaste = (text) => {
    const t = (text || '').trim()
    setSource('paste'); setWarn(null)
    if (!t) { setTranscriptText(''); setLines([]); setProc(PROC_IDLE); return }
    setTranscriptText(t)
    setLines(parseLines(t, people).map((l, i) => ({ ...l, at: fmtClock(i * 8 + 2) })))
    setProc('ready')
  }

  // Synthesize → bullet summary + actions + tags, weighting the user's live notes.
  const synthesize = async () => {
    if (!transcriptText && !notes.trim()) return
    setError(null)
    setProc('synth')
    try {
      const s = await synthesizeMeeting({ liveNotes: notes, agenda, transcript: transcriptText, people })
      setSynth({ summary: s.summary || '', actions: s.actions || [], terms: [], people: [], tags: s.tags || [] })
      // Paste path is free; only in-app recording incurs AssemblyAI cost.
      const transcribe = source === 'record' ? (seconds / 3600) * TRANSCRIBE_USD_PER_HOUR : 0
      const claude = claudeCost(s.usage)
      setCost({ transcribe, claude, total: transcribe + claude, usage: s.usage || null, estimated: !!(s.usage && s.usage.estimated) })
      setProc('done')
    } catch (e) {
      setError(humanize(e))
      setProc('ready') // fall back so the user can retry synth
    }
  }

  // reset() — back to idle, keep title/home so the user can re-record.
  const reset = () => {
    setProc(PROC_IDLE)
    setError(null)
    setLines([]); setTranscriptText(''); setSynth(emptySynth); setCost(null)
    setProjects([]); setPeople([]); setAgenda(''); setNotes(''); setPillar(null); setWarn(null); setSource('paste')
  }

  // clear() — full teardown after a save (also drops title).
  const clear = () => {
    reset()
    setTitle('')
  }

  const value = useMemo(() => ({
    phase, seconds, error, warn, interrupted,
    title, home, pillar, projects, people, agenda, notes, source, lines, transcriptText, synth, cost,
    speakers, diarize,
    setMeta, setProjects, setError, setWarn, setTranscriptFromPaste,
    start, pause, resume, stopAndTranscribe, synthesize, reset, clear,
  }), [phase, seconds, error, warn, interrupted, title, home, pillar, projects, people, agenda, notes, source, lines, transcriptText, synth, cost, speakers, diarize])

  return <RecorderCtx.Provider value={value}>{children}</RecorderCtx.Provider>
}

function humanize(e) {
  const msg = String(e?.message || e || 'Something went wrong')
  if (/not signed in/i.test(msg)) return 'Sign in to transcribe recordings.'
  if (/permission|denied|getUserMedia/i.test(msg)) return 'Microphone access was blocked.'
  return msg
}

// ── Floating mini-recorder — shown on every screen except Record while live ──
export function FloatingRecorder() {
  const { t, f, route, go } = useApp()
  const { projectById } = useData()
  const rec = useRecorderCtx()
  if (!rec) return null
  const { phase, seconds, title, home } = rec
  if (phase === 'idle' || route.screen === 'record' || route.screen === 'meeting') return null

  const live = phase === 'recording'
  const homeProj = projectById(home)
  const label = (title || '').trim() || 'Untitled meeting'
  const status = live ? 'Recording' : phase === 'paused' ? 'Paused'
    : phase === 'transcribing' ? 'Transcribing…' : phase === 'ready' ? 'Ready to synthesize'
    : phase === 'synth' ? 'Synthesizing…' : 'Synthesized — tap to save'
  const busy = phase === 'transcribing' || phase === 'synth'
  const open = () => go({ screen: 'record', project: home, title })

  return <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 460, width: 286,
    background: t.card, border: '1px solid ' + (live ? t.riskLine : t.line2), borderRadius: 14,
    boxShadow: t.shadow, overflow: 'hidden' }}>
    <div onClick={open} title="Return to recording" style={{ display: 'flex', alignItems: 'center', gap: 11,
      padding: '11px 13px', cursor: 'pointer', background: live ? t.riskBg : 'transparent' }}>
      <span className={live ? 'rec-pulse' : undefined} style={{ position: 'relative', width: 34, height: 34, borderRadius: 9, flex: 'none', display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: t.card, border: '1px solid ' + (live ? t.riskLine : t.line) }}>
        {busy ? <Icon n="loader-2" s={17} c={t.accent} />
          : <Icon n="microphone" s={17} c={live ? t.risk : t.t2} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: f.meta, fontSize: 14, fontWeight: 600, color: t.t1, fontVariantNumeric: 'tabular-nums' }}>{fmtClock(seconds)}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11,
            fontWeight: 600, color: live ? t.risk : t.t3 }}>
            {live && <span style={{ width: 6, height: 6, borderRadius: 3, background: t.risk }} />}
            {status}</span>
        </div>
        <div style={{ fontFamily: f.ui, fontSize: 12, fontWeight: 500, color: t.t2, marginTop: 1, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}{homeProj ? ' · ' + homeProj.name : ''}</div>
      </div>
      <Icon n="arrow-up-right" s={15} c={t.t3} />
    </div>
    {(phase === 'recording' || phase === 'paused') && <div style={{ display: 'flex', alignItems: 'center', gap: 7,
      padding: '9px 13px', borderTop: '1px solid ' + t.line }}>
      {live ? <Btn kind="outline" size="sm" icon="player-pause" onClick={(e) => { e.stopPropagation(); rec.pause() }}>Pause</Btn>
        : <Btn kind="outline" size="sm" icon="player-play" onClick={(e) => { e.stopPropagation(); rec.resume() }}>Resume</Btn>}
      <div style={{ flex: 1 }} />
      <button onClick={(e) => { e.stopPropagation(); rec.stopAndTranscribe() }} title="Stop & transcribe"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600,
          color: t.risk, background: t.riskBg, border: '1px solid ' + t.riskLine, borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}>
        <span style={{ width: 11, height: 11, borderRadius: 3, background: t.risk }} />Stop</button>
    </div>}
  </div>
}
