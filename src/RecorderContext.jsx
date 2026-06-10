// RecorderContext.jsx — lifts the real mic recorder to app level so a live
// recording session survives navigation (the prototype used an external
// RecorderStore; here React state lives above the router). Holds the recorder
// hook plus session meta (title, home project, discussed projects, scratch
// notes, transcript lines, synthesized fields) and the phase machine that
// drives both the full Record screen and the FloatingRecorder mini-window.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './ctx'
import { useData } from './DataContext'
import { Icon, Btn } from './kit'
import { useRecorder, fmtClock, getRecovered, clearRecovered } from './lib/recorder'
import { transcribeAudio } from './lib/transcribe'
import { synthesizeMeeting } from './lib/ai'
import { claudeCost } from './lib/claude'
import { createNote, updateNote, deleteNote } from './lib/db'
import { textToBlocks, blocksToText } from './lib/blocks'

const DRAFT_KEY = 'course.meetingDraft'

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
  const { areaOfProject, reload } = useData()

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

  // ── Recovery & autosave ─────────────────────────────────────────
  const draftIdRef = useRef(null)       // stable cp_notes id for this draft
  const draftSavedRef = useRef(false)   // has the incomplete note been written?
  const hydratedRef = useRef(false)
  const [recoveredBlob, setRecoveredBlob] = useState(null) // orphaned interrupted-recording audio

  const meaningful = () => !!(title.trim() || notes.trim() || agenda.trim() || transcriptText.trim())

  // Hydrate the draft from localStorage + detect recovered audio — once.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        if (d && (d.title || d.notes || d.agenda || d.transcriptText)) {
          setTitle(d.title || ''); setHome(d.home ?? null); setPillar(d.pillar ?? null)
          setProjects(d.projects || []); setPeople(d.people || []); setAgenda(d.agenda || '')
          setNotes(d.notes || ''); setSource(d.source || 'paste')
          setTranscriptText(d.transcriptText || ''); setLines(d.lines || []); setSynth(d.synth || emptySynth)
          draftIdRef.current = d.draftNoteId || null
          draftSavedRef.current = !!d.draftNoteId
          setProc(d.transcriptText ? 'ready' : PROC_IDLE)
        }
      }
    } catch {}
    getRecovered().then((b) => { if (b && b.size) setRecoveredBlob(b) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the draft to localStorage (synchronous safety copy) on every change.
  useEffect(() => {
    if (!hydratedRef.current) return
    const has = meaningful() || people.length || projects.length
    if (!has) { try { localStorage.removeItem(DRAFT_KEY) } catch {} ; return }
    const id = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, home, pillar, projects, people, agenda, notes, source, transcriptText, lines, synth, draftNoteId: draftIdRef.current })) } catch {}
    }, 500)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, home, pillar, projects, people, agenda, notes, source, transcriptText, lines, synth])

  // The note fields shared by autosave + finalize.
  const noteFields = (incomplete) => ({
    kind: 'meeting', title: title.trim() || 'Untitled meeting',
    project: home || null, area: home ? (areaOfProject(home)?.id || null) : (pillar || null),
    projects: [...new Set([home, ...projects].filter(Boolean))],
    people: people || [], agenda: agenda.trim() || null, transcript: transcriptText || null,
    body: notes.trim() ? textToBlocks(notes) : [],
    date: (() => { const d = new Date(); const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` })(),
    updated: 'now', status: incomplete ? 0 : 2, incomplete,
  })

  // Debounced best-effort DB autosave as a flagged incomplete meeting.
  useEffect(() => {
    if (!hydratedRef.current || !meaningful() || proc === 'done') return
    const id = setTimeout(async () => {
      try {
        if (!draftIdRef.current) draftIdRef.current = (crypto?.randomUUID?.() || 'draft-' + Date.now())
        const fields = noteFields(true)
        if (!draftSavedRef.current) { await createNote({ ...fields, id: draftIdRef.current }); draftSavedRef.current = true }
        else await updateNote(draftIdRef.current, fields)
      } catch {} // RLS / offline → localStorage still holds the draft
    }, 6000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, home, pillar, projects, people, agenda, notes, transcriptText, proc])

  // Warn before leaving while there's unsaved meeting content.
  useEffect(() => {
    const dirty = phase === 'recording' || phase === 'paused' || meaningful()
    if (!dirty) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, title, notes, agenda, transcriptText])

  // Finalize: persist the COMPLETE note (clearing the incomplete flag), reusing
  // the draft row so there's no duplicate. Returns the note id.
  const finalizeNote = async (fields) => {
    const id = draftIdRef.current || (crypto?.randomUUID?.() || 'note-' + Date.now())
    const full = { ...fields, incomplete: false }
    if (draftSavedRef.current) await updateNote(id, full)
    else await createNote({ ...full, id })
    draftIdRef.current = id; draftSavedRef.current = true
    return id
  }

  // Discard: delete the autosaved incomplete row (if any) + wipe the draft.
  const discard = async () => {
    try { if (draftSavedRef.current && draftIdRef.current) { await deleteNote(draftIdRef.current); await reload() } } catch {}
    clear()
  }

  // Recover the audio from an interrupted recording → transcribe into the draft.
  const recoverAudio = async () => {
    const blob = recoveredBlob; setRecoveredBlob(null)
    if (!blob) return
    setSource('record'); setError(null); setProc('transcribing')
    try {
      const text = await transcribeAudio(blob, { onStatus: () => setProc('transcribing'), speakersExpected: speakers, diarize })
      setTranscriptText(text)
      setLines(parseLines(text, people).map((l, i) => ({ ...l, at: fmtClock(i * 8 + 2) })))
      setProc('ready')
    } catch (e) { setError(humanize(e)); setProc('ready') }
    clearRecovered().catch(() => {})
  }
  const dismissRecovered = () => { setRecoveredBlob(null); clearRecovered().catch(() => {}) }

  // Rename a diarized speaker (e.g. "Speaker A" → "Nate") everywhere: the line
  // labels AND the raw transcript, so synthesis + the saved note use real names.
  const renameSpeaker = (from, to) => {
    const nm = String(to || '').trim()
    if (!nm || nm === from) return
    setLines((ls) => {
      const next = ls.map((l) => (l.sp === from ? { ...l, sp: nm } : l))
      setTranscriptText(next.map((l) => `${l.sp}: ${l.text}`).join('\n\n'))
      return next
    })
  }

  // Resume a saved (incomplete) meeting note back into the composer.
  const loadDraftFromNote = (n) => {
    if (!n) return
    draftIdRef.current = n.id; draftSavedRef.current = true
    setTitle(n.title || ''); setHome(n.project || null); setPillar(n.project ? null : (n.area || null))
    setProjects(n.projects || []); setPeople(n.people || []); setAgenda(n.agenda || '')
    setNotes(blocksToText(n.body || [])); setSource(n.transcript ? 'record' : 'paste')
    setTranscriptText(n.transcript || '')
    setLines(n.transcript ? parseLines(n.transcript, n.people || []).map((l, i) => ({ ...l, at: fmtClock(i * 8 + 2) })) : [])
    setSynth(emptySynth); setCost(null); setError(null); setWarn(null)
    setProc(n.transcript ? 'ready' : PROC_IDLE)
  }

  const start = async () => {
    setError(null); setWarn(null)
    setLines([]); setTranscriptText(''); setSynth(emptySynth); setCost(null)
    setProc(PROC_IDLE)
    await recorder.start()
  }
  const pause = () => recorder.pause()
  const resume = () => recorder.resume()

  // Parse a speaker-labeled transcript into turns. Strongly NAME-DRIVEN: when
  // participant names are known, only a line whose leading label matches a known
  // person (exact, first-name, or "First Last") starts a turn — so timestamps
  // ("0:23", "00:14:05", "12:05 PM") are never read as speakers. Handles both
  // "Name: text", "Name 0:23 / text on next line", and a bare "Name" line. Pure
  // timestamp lines are dropped. Falls back to a strict heuristic with no names.
  const stripTime = (s) => String(s).replace(/\b\d{1,2}:\d{2}(:\d{2})?(\s*[ap]\.?m\.?)?\b/gi, '').replace(/[[\]()]/g, '').replace(/\s{2,}/g, ' ').trim()
  const isTimeOnly = (s) => /^[[(]?\s*\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(?:[ap]\.?m\.?)?\s*[)\]]?$/i.test(String(s).trim())
  const parseLines = (text, names = []) => {
    const people = (names || []).map((n) => String(n).trim()).filter(Boolean)
    const lows = people.map((n) => n.toLowerCase())
    const matchName = (label) => {
      const l = stripTime(label).toLowerCase().replace(/[:,]+$/, '').trim()
      if (!l) return null
      for (let i = 0; i < lows.length; i++) {
        const nl = lows[i]
        if (l === nl || l.startsWith(nl + ' ') || l.startsWith(nl + ',')) return people[i]
        // first-name match either direction (People "Mattia" vs label "Mattia Rossi")
        const lf = l.split(/\s+/)[0], nf = nl.split(/\s+/)[0]
        if (lf && lf === nf) return people[i]
      }
      // generic "Speaker A/1" labels still count as turns
      if (/^speaker\s+\S+$/i.test(l)) return label.replace(/[:,]+$/, '').trim()
      return null
    }
    const raw = (text || '').replace(/\r/g, '')
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    const out = []
    for (const line of lines) {
      if (isTimeOnly(line)) continue // drop pure timestamp lines
      let who = null, rest = ''
      const ci = line.indexOf(':')
      if (ci > 0 && ci <= 48) {
        const w = people.length ? matchName(line.slice(0, ci)) : null
        if (w) { who = w; rest = line.slice(ci + 1).trim() }
        else if (!people.length) {
          const nm = stripTime(line.slice(0, ci))
          if (/[A-Za-z]/.test(nm) && nm.split(/\s+/).length <= 4 && !/[.!?]$/.test(nm)) { who = nm; rest = line.slice(ci + 1).trim() }
        }
      }
      if (!who && people.length) {
        // no colon — a bare "Name" or "Name 0:23" line (text follows on next lines)
        const w = matchName(line)
        if (w && stripTime(line).split(/\s+/).length <= 4) { who = w; rest = stripTime(line.replace(new RegExp('^' + w, 'i'), '')).trim() }
      }
      if (who) out.push({ sp: who, text: rest })
      else if (out.length) out[out.length - 1].text += (out[out.length - 1].text ? ' ' : '') + line
      else out.push({ sp: people.length ? 'Speaker' : 'Speaker A', text: line })
    }
    // merge consecutive turns by the same speaker, drop empty turns
    const merged = []
    for (const t of out) {
      if (merged.length && merged[merged.length - 1].sp === t.sp) merged[merged.length - 1].text += (t.text ? ' ' + t.text : '')
      else merged.push({ ...t })
    }
    return merged.filter((x) => (x.text || '').trim())
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
      clearRecovered().catch(() => {}) // audio captured into the transcript; no longer "interrupted"
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

  // clear() — full teardown after a save/discard (drops title + the draft copies).
  const clear = () => {
    reset()
    setTitle('')
    draftIdRef.current = null; draftSavedRef.current = false
    setRecoveredBlob(null)
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    clearRecovered().catch(() => {})
  }

  const value = useMemo(() => ({
    phase, seconds, error, warn, interrupted,
    title, home, pillar, projects, people, agenda, notes, source, lines, transcriptText, synth, cost,
    speakers, diarize, recoveredBlob,
    setMeta, setProjects, setError, setWarn, setTranscriptFromPaste,
    start, pause, resume, stopAndTranscribe, synthesize, reset, clear,
    finalizeNote, discard, recoverAudio, dismissRecovered, loadDraftFromNote, renameSpeaker,
  }), [phase, seconds, error, warn, interrupted, title, home, pillar, projects, people, agenda, notes, source, lines, transcriptText, synth, cost, speakers, diarize, recoveredBlob])

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
