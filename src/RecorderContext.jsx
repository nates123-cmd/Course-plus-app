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
import { useRecorder, fmtClock, getRecovered, clearRecovered, tabAudioSupported } from './lib/recorder'
import { transcribeAudio } from './lib/transcribe'
import { transcribeInBrowser, transcribeInBrowserDetailed, browserWhisperSupported } from './lib/whisper'
import { labelChunks, enrollVoiceprint, hasVoiceprint, clearVoiceprint, diarizeSupported } from './lib/diarize'
import { synthesizeMeeting } from './lib/ai'
import { claudeCost } from './lib/claude'
import { createNote, updateNote, deleteNote } from './lib/db'
import { markdownToBlocks, blocksToText } from './lib/blocks'

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

const emptySynth = { summary: '', actions: [], terms: [], people: [], tags: [], nextSteps: '' }

export function RecorderProvider({ go, children }) {
  const recorder = useRecorder()
  const { status, seconds, interrupted, tabMixed, storageWarn, getAnalyser } = recorder

  // Pin the current moment (dedupe within the same second). Works live + paused.
  const addPin = () => setPins((p) => p.some((x) => x.at === seconds) ? p : [...p, { at: seconds, label: '' }].sort((a, b) => a.at - b.at))
  const removePin = (at) => setPins((p) => p.filter((x) => x.at !== at))
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
  const [seriesId, setSeriesId] = useState(null) // bound recurring-meeting series, or null
  const [people, setPeople] = useState([])     // attendees + speakers (combined)
  const [agenda, setAgenda] = useState('')     // pre-meeting prep notes
  const [notes, setNotes] = useState('')       // live notes (highest-signal)
  const [source, setSource] = useState('paste') // transcript source: 'paste' | 'record'
  const [detail, setDetail] = useState('low') // synthesis depth: low | medium | high (Brief is the default)
  // transcription tuning (record mode only)
  const [speakers, setSpeakers] = useState(null) // expected speaker count (null = auto)
  const [diarize, setDiarize] = useState(true)   // speaker labels on/off
  // engine: 'cloud' = AssemblyAI edge fn (speaker labels). 'browser' = on-device
  // Whisper (private, free, no speaker labels). Falls back to cloud if unsupported.
  const [engine, setEngine] = useState('cloud')
  // tabAudio: also capture tab/system audio (browser calls) when supported.
  const [tabAudio, setTabAudio] = useState(false)
  // On-device speaker labeling (Me vs Computer) for the browser engine — needs a
  // one-time voice enrollment ([[lib/diarize]]). hasVoice tracks the stored
  // voiceprint; labelSpeakers is the per-session toggle (on once enrolled).
  const [hasVoice, setHasVoice] = useState(() => hasVoiceprint())
  const [labelSpeakers, setLabelSpeakers] = useState(() => hasVoiceprint())
  const [enrollStatus, setEnrollStatus] = useState('') // '' | 'loading-model' | 'embedding'
  const [labelPct, setLabelPct] = useState(0)           // per-segment labeling progress %
  // pins: timestamps (seconds) the user flagged mid-recording as "this matters".
  // Feed the synthesis as anchors + render as jump chips on the transcript.
  const [pins, setPins] = useState([]) // [{ at: seconds, label: '' }]
  const [tStatus, setTStatus] = useState('') // browser-engine sub-status: ''|'loading-model'|'transcribing'
  const [modelPct, setModelPct] = useState(0) // on-device model download %
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
    if ('seriesId' in patch) setSeriesId(patch.seriesId)
    if ('people' in patch) setPeople(patch.people)
    if ('agenda' in patch) setAgenda(patch.agenda)
    if ('notes' in patch) setNotes(patch.notes)
    if ('source' in patch) setSource(patch.source)
    if ('detail' in patch) setDetail(patch.detail)
    if ('speakers' in patch) setSpeakers(patch.speakers)
    if ('diarize' in patch) setDiarize(patch.diarize)
    if ('engine' in patch) setEngine(browserWhisperSupported ? patch.engine : 'cloud')
    if ('tabAudio' in patch) setTabAudio(tabAudioSupported ? !!patch.tabAudio : false)
  }

  // Run the chosen transcription engine on a blob → { text, lines }.
  // - cloud  : AssemblyAI, speaker-labeled (lines=null → parseLines downstream).
  // - browser: on-device Whisper. If speaker labeling is on + a voiceprint is
  //   enrolled, also runs WavLM diarization → labeled turns (Me / Computer).
  const runEngine = async (blob) => {
    setTStatus(''); setModelPct(0); setLabelPct(0)
    if (engine === 'browser' && browserWhisperSupported) {
      setTStatus('loading-model')
      const onModelProgress = ({ progress }) => setModelPct(Math.round(progress || 0))
      if (labelSpeakers && hasVoiceprint()) {
        const { text, audio, chunks } = await transcribeInBrowserDetailed(blob, { onStatus: setTStatus, onModelProgress })
        try {
          const turns = await labelChunks(audio, chunks, {
            meLabel: 'Me', themLabel: 'Computer', onStatus: setTStatus,
            onProgress: (p) => setLabelPct(Math.round(p * 100)),
          })
          if (turns && turns.length) {
            const lines = turns.map((tn, i) => ({ ...tn, at: fmtClock(i * 8 + 2) }))
            return { text: turns.map((tn) => `${tn.sp}: ${tn.text}`).join('\n\n'), lines }
          }
        } catch { /* labeling failed → fall back to the plain transcript */ }
        return { text, lines: null }
      }
      const text = await transcribeInBrowser(blob, { onStatus: setTStatus, onModelProgress })
      return { text, lines: null }
    }
    const text = await transcribeAudio(blob, { onStatus: () => setProc('transcribing'), speakersExpected: speakers, diarize })
    return { text, lines: null }
  }

  // Enroll / clear the user's voiceprint (one-time ~10s clip).
  const enrollVoice = async (blob) => {
    try {
      await enrollVoiceprint(blob, { onStatus: setEnrollStatus, onModelProgress: ({ progress }) => setModelPct(Math.round(progress || 0)) })
      setHasVoice(true); setLabelSpeakers(true); return true
    } catch (e) { setEnrollStatus(''); setError(humanize(e)); return false }
  }
  const clearVoice = () => { clearVoiceprint(); setHasVoice(false); setLabelSpeakers(false) }
  // On-device output has no diarization — render it as one un-attributed turn.
  const linesFor = (text) => engine === 'browser'
    ? (text ? [{ sp: 'Transcript', text, at: fmtClock(2) }] : [])
    : parseLines(text, people).map((l, i) => ({ ...l, at: fmtClock(i * 8 + 2) }))

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
          setProjects(d.projects || []); setSeriesId(d.seriesId ?? null); setPeople(d.people || []); setAgenda(d.agenda || '')
          setNotes(d.notes || ''); setSource(d.source || 'paste')
          if (d.engine) setEngine(browserWhisperSupported ? d.engine : 'cloud')
          setTranscriptText(d.transcriptText || ''); setLines(d.lines || []); setSynth(d.synth || emptySynth)
          setPins(Array.isArray(d.pins) ? d.pins : [])
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
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, home, pillar, projects, seriesId, people, agenda, notes, source, engine, transcriptText, lines, synth, pins, draftNoteId: draftIdRef.current })) } catch {}
    }, 500)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, home, pillar, projects, people, agenda, notes, source, engine, transcriptText, lines, synth, pins])

  // The note fields shared by autosave + finalize.
  const noteFields = (incomplete) => ({
    kind: 'meeting', title: title.trim() || 'Untitled meeting',
    project: home || null, area: home ? (areaOfProject(home)?.id || null) : (pillar || null),
    projects: [...new Set([home, ...projects].filter(Boolean))],
    people: people || [], agenda: agenda.trim() || null, transcript: transcriptText || null,
    seriesId: seriesId || null,
    body: notes.trim() ? markdownToBlocks(notes) : [],
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
      const { text, lines: dl } = await runEngine(blob)
      setTranscriptText(text)
      setLines(dl || linesFor(text))
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
    setProjects(n.projects || []); setSeriesId(n.seriesId || null); setPeople(n.people || []); setAgenda(n.agenda || '')
    setNotes(blocksToText(n.body || [])); setSource(n.transcript ? 'record' : 'paste')
    setTranscriptText(n.transcript || '')
    setLines(n.transcript ? parseLines(n.transcript, n.people || []).map((l, i) => ({ ...l, at: fmtClock(i * 8 + 2) })) : [])
    // Restore prior synthesis so reopening a finished meeting keeps its summary/
    // actions/tags/next-steps — and re-saving from the composer doesn't wipe them.
    const synthesized = !n.incomplete && !!(n.summary || (n.actions || []).length || (n.tags || []).length || (n.nextSteps && n.nextSteps.trim()))
    setSynth(synthesized
      ? { summary: n.summary || '', actions: (n.actions || []).map((a) => ({ text: a.text, owner: a.owner || 'me' })), terms: [], people: [], tags: n.tags || [], nextSteps: n.nextSteps || '' }
      : emptySynth)
    setCost(null); setError(null); setWarn(null)
    setProc(synthesized ? 'done' : (n.transcript ? 'ready' : PROC_IDLE))
  }

  const start = async () => {
    setError(null); setWarn(null)
    setLines([]); setTranscriptText(''); setSynth(emptySynth); setCost(null)
    setTStatus(''); setModelPct(0)
    setProc(PROC_IDLE)
    await recorder.start({ tabAudio })
  }
  const pause = () => recorder.pause()
  const resume = () => recorder.resume()

  // Parse a speaker-labeled transcript into turns. The hard part is real
  // Teams/Copilot output: "Kim Gehdes  10:23" — the timestamp must be stripped
  // off the speaker LABEL so every "Kim Gehdes <time>" collapses to ONE speaker
  // (not 59). We strip a leading or trailing timestamp from the label only (never
  // from the spoken text), reject a colon that's actually part of a time, and
  // match against the People list when given. Identical names = same speaker.
  const TIME_SRC = '\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:\\s*[ap]\\.?m\\.?)?'
  const LEAD_TIME = new RegExp('^[\\[(]?\\s*(?:' + TIME_SRC + ')\\s*[\\])]?[\\s\\-–—]*', 'i')
  const TRAIL_TIME = new RegExp('[\\s\\-–—]*[\\[(]?\\s*(?:' + TIME_SRC + ')\\s*[\\])]?\\s*$', 'i')
  const TIME_ANYWHERE = new RegExp(TIME_SRC, 'i')
  const isTimeOnly = (s) => new RegExp('^[\\[(]?\\s*(?:' + TIME_SRC + ')\\s*[\\])]?$', 'i').test(String(s).trim())
  const stripTime = (s) => String(s).replace(LEAD_TIME, '').replace(TRAIL_TIME, '').replace(/[[\]()]/g, '').replace(/\s{2,}/g, ' ').trim()
  const parseLines = (text, names = []) => {
    const people = (names || []).map((n) => String(n).trim()).filter(Boolean)
    const lows = people.map((n) => n.toLowerCase())
    const matchName = (label) => {
      const l = stripTime(label).toLowerCase().replace(/[:,]+$/, '').trim()
      if (!l) return null
      for (let i = 0; i < lows.length; i++) {
        const nl = lows[i]
        if (l === nl || l.startsWith(nl + ' ') || l.startsWith(nl + ',')) return people[i]
        const lf = l.split(/\s+/)[0], nf = nl.split(/\s+/)[0]
        if (lf && lf === nf) return people[i]
      }
      if (/^speaker\s+\S+$/i.test(l)) return label.replace(/[:,]+$/, '').trim()
      return null
    }
    // heuristic name (no People list): Title-Case-ish, ≤4 words, not a sentence
    const heuristicName = (label) => {
      const nm = stripTime(label).replace(/[:,]+$/, '').trim()
      if (!nm || !/^[A-Za-z]/.test(nm) || nm.split(/\s+/).length > 4 || /[.!?]$/.test(nm) || isTimeOnly(nm)) return null
      if (!/^[A-Z]/.test(nm)) return null // names start capitalized; rejects "we meet at"
      return nm
    }
    const nameFromLabel = (label) => people.length ? matchName(label) : heuristicName(label)

    const raw = (text || '').replace(/\r/g, '')
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    const out = []
    for (const rawLine of lines) {
      const line = rawLine.replace(LEAD_TIME, '').trim() // drop a leading timestamp
      if (!line || isTimeOnly(rawLine)) continue
      let who = null, rest = ''
      // a) "Name: text" — but only if the colon isn't part of a timestamp
      const ci = line.indexOf(':')
      if (ci > 0 && ci <= 48 && !TIME_ANYWHERE.test(line.slice(Math.max(0, ci - 2), ci + 4))) {
        const w = nameFromLabel(line.slice(0, ci))
        if (w) { who = w; rest = line.slice(ci + 1).trim() }
      }
      // b) "Name  10:23" or bare "Name" — strip a trailing timestamp, see if a name
      if (!who) {
        const noTrail = line.replace(TRAIL_TIME, '').trim()
        const hadTrailTime = noTrail !== line
        if (hadTrailTime || people.length) {
          const w = nameFromLabel(noTrail)
          if (w && stripTime(noTrail).split(/\s+/).length <= 4) { who = w; rest = '' }
        }
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
      const { text, lines: dl } = await runEngine(blob)
      // diarized turns when available; else rough evenly-spaced timestamps
      const withAt = dl || linesFor(text)
      setLines(withAt)
      // Never persist an empty transcript when we actually have labeled turns:
      // rebuild the text from the lines so the saved note keeps the words.
      const txt = text || withAt.map((l) => (l.sp ? `${l.sp}: ${l.text}` : l.text)).join('\n\n')
      setTranscriptText(txt)
      // Completeness check: ~120 wpm is normal speech. If the transcript is far
      // short of what the elapsed time implies (or the tab went background), the
      // audio capture likely paused — warn so the user doesn't trust a partial.
      const words = (txt || '').split(/\s+/).filter(Boolean).length
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
      const speakerLabels = [...new Set(lines.map((l) => l.sp))]
      const pinStamps = pins.map((p) => fmtClock(p.at))
      const s = await synthesizeMeeting({ liveNotes: notes, agenda, transcript: transcriptText, people, speakerLabels, detail, pins: pinStamps })
      setSynth({ summary: s.summary || '', actions: s.actions || [], terms: [], people: [], tags: s.tags || [], nextSteps: s.nextSteps || '' })
      // Apply Claude's speaker-name guesses (leads with the People list; else inferred).
      if (s.speakers && typeof s.speakers === 'object') {
        for (const [label, name] of Object.entries(s.speakers)) { if (name && String(name).trim() && label !== name) renameSpeaker(label, name) }
      }
      // Paste path is free; only cloud in-app recording incurs AssemblyAI cost
      // (on-device Whisper is free).
      const transcribe = source === 'record' && engine === 'cloud' ? (seconds / 3600) * TRANSCRIBE_USD_PER_HOUR : 0
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
    setLines([]); setTranscriptText(''); setSynth(emptySynth); setCost(null); setPins([])
    setProjects([]); setPeople([]); setAgenda(''); setNotes(''); setPillar(null); setWarn(null); setSource('paste')
  }

  // clear() — full teardown after a save/discard (drops title + the draft copies).
  const clear = () => {
    reset()
    setTitle(''); setSeriesId(null)
    draftIdRef.current = null; draftSavedRef.current = false
    setRecoveredBlob(null)
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    clearRecovered().catch(() => {})
  }

  const value = useMemo(() => ({
    phase, seconds, error, warn, interrupted,
    title, home, pillar, projects, seriesId, people, agenda, notes, source, detail, lines, transcriptText, synth, cost,
    speakers, diarize, recoveredBlob,
    engine, browserWhisperSupported, tStatus, modelPct,
    diarizeSupported, hasVoice, labelSpeakers, setLabelSpeakers, enrollVoice, clearVoice, enrollStatus, labelPct,
    tabAudio, tabAudioSupported, tabMixed, storageWarn, getAnalyser,
    pins, addPin, removePin,
    setMeta, setProjects, setError, setWarn, setTranscriptFromPaste,
    start, pause, resume, stopAndTranscribe, synthesize, reset, clear,
    finalizeNote, discard, recoverAudio, dismissRecovered, loadDraftFromNote, renameSpeaker,
  }), [phase, seconds, error, warn, interrupted, title, home, pillar, projects, seriesId, people, agenda, notes, source, detail, lines, transcriptText, synth, cost, speakers, diarize, recoveredBlob, engine, tStatus, modelPct, hasVoice, labelSpeakers, enrollStatus, labelPct, tabAudio, tabMixed, storageWarn, pins])

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

  return <div style={{ position: 'fixed', zIndex: 460, width: 'min(286px, calc(100vw - 32px))',
    right: 'max(16px, env(safe-area-inset-right))', bottom: 'calc(16px + env(safe-area-inset-bottom))',
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
      <Btn kind="outline" size="sm" icon="pin" onClick={(e) => { e.stopPropagation(); rec.addPin() }} title="Mark this moment">Pin</Btn>
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
