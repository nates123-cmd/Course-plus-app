// Mic recorder hook. Captures up to MAX_SECONDS, streams chunks to IndexedDB so
// an accidental reload mid-recording is recoverable. Returns a Blob on stop.
import { useEffect, useRef, useState } from 'react'

export const MAX_SECONDS = 2 * 60 * 60 // 2 hours

function pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const m of cands) if (window.MediaRecorder?.isTypeSupported?.(m)) return m
  return '' // let the browser default
}

// Tab/system-audio capture (Pindrop-style) — Chrome/Edge desktop only. Lets a
// browser Teams/Zoom/Meet call record BOTH sides, not just the mic.
export const tabAudioSupported = typeof navigator !== 'undefined'
  && !!navigator.mediaDevices?.getDisplayMedia

// ── tiny IndexedDB chunk store (crash recovery) ──────────────────────
const DB = 'scribe-rec', STORE = 'chunks'
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { autoIncrement: true })
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
}
async function idbAppend(blob) {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).add(blob)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
}
async function idbAll() {
  const db = await idb()
  return new Promise((res, rej) => {
    const out = []; const cur = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
    cur.onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue() } else res(out) }
    cur.onerror = () => rej(cur.error)
  })
}
async function idbClear() {
  const db = await idb()
  return new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = () => res() })
}

export async function getRecovered() {
  try { const c = await idbAll(); if (!c.length) return null; return new Blob(c, { type: c[0].type || 'audio/webm' }) } catch { return null }
}
export const clearRecovered = idbClear

export function useRecorder() {
  const [status, setStatus] = useState('idle') // idle | recording | paused
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState(null)
  // interrupted = the tab went background while recording → browser may have
  // suspended audio capture, so the transcript can be incomplete. Surfaced to UI.
  const [interrupted, setInterrupted] = useState(false)
  // tabMixed = the recording is actually capturing tab/system audio (user shared
  // a tab WITH audio), not just the mic. Drives the "capturing call audio" UI.
  const [tabMixed, setTabMixed] = useState(false)
  // storageWarn = a crash-recovery chunk failed to persist (usually the device's
  // storage quota is full). The recording itself continues in memory, but a
  // reload mid-recording would no longer be recoverable — surface it.
  const [storageWarn, setStorageWarn] = useState(false)
  const mr = useRef(null), stream = useRef(null), chunks = useRef([]), timer = useRef(null), wakeLock = useRef(null)
  // Web Audio graph: mic (+ optional tab) → analyser (live waveform) + a
  // MediaStreamDestination that MediaRecorder actually records.
  const audioCtx = useRef(null), analyser = useRef(null)
  const micStream = useRef(null), tabStream = useRef(null)

  const tick = () => { timer.current = setInterval(() => setSeconds((s) => {
    if (s + 1 >= MAX_SECONDS) { try { mr.current?.stop() } catch {} }
    return s + 1
  }), 1000) }
  const stopTick = () => { clearInterval(timer.current); timer.current = null }

  // Keep the screen awake while recording — on mobile a sleeping screen
  // suspends MediaRecorder, which is the usual cause of a truncated transcript.
  const acquireWake = async () => {
    try { if ('wakeLock' in navigator) wakeLock.current = await navigator.wakeLock.request('screen') } catch {}
  }
  const releaseWake = () => { try { wakeLock.current?.release?.() } catch {} wakeLock.current = null }

  // Flag background-while-recording; re-acquire the wake lock when visible again.
  useEffect(() => {
    const onVis = () => {
      const live = mr.current && mr.current.state === 'recording'
      if (document.visibilityState === 'hidden') { if (live) setInterrupted(true) }
      else if (live) acquireWake()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Tear down every capture source + the audio graph. Safe to call repeatedly.
  const teardown = () => {
    try { micStream.current?.getTracks().forEach((t) => t.stop()) } catch {}
    try { tabStream.current?.getTracks().forEach((t) => t.stop()) } catch {}
    try { stream.current?.getTracks().forEach((t) => t.stop()) } catch {}
    try { audioCtx.current?.close() } catch {}
    micStream.current = tabStream.current = audioCtx.current = analyser.current = stream.current = null
  }

  // Build the stream MediaRecorder records. Always routes through an
  // AudioContext so we get a live AnalyserNode for the waveform; if opts.tabAudio
  // and the user shares a tab WITH audio, mic + tab are mixed into one track.
  const buildStream = async (opts) => {
    // Request the display picker FIRST — getDisplayMedia is the stricter call for
    // user-activation, so prompt for it before the mic to keep the gesture valid.
    let tab = null
    if (opts?.tabAudio && tabAudioSupported) {
      try {
        // getDisplayMedia needs a video request to surface the audio checkbox;
        // we drop the video track immediately and keep only the audio.
        tab = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        tab.getVideoTracks().forEach((t) => t.stop())
        if (!tab.getAudioTracks().length) { tab.getTracks().forEach((t) => t.stop()); tab = null }
      } catch { tab = null } // user cancelled the picker / shared without audio → mic-only
    }
    tabStream.current = tab
    setTabMixed(!!tab)
    // Clean capture → better transcripts: cancel room echo (also stops feedback
    // when tab audio plays through speakers), suppress hum, auto-level volume,
    // mono (no stereo gain for speech, half the bytes).
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    micStream.current = mic
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ctx = new AC(); audioCtx.current = ctx
      const an = ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.7
      analyser.current = an
      const dest = ctx.createMediaStreamDestination()
      ctx.createMediaStreamSource(mic).connect(an)   // mic → analyser
      ctx.createMediaStreamSource(mic).connect(dest)  // mic → recording
      if (tab) {
        const tsrc = ctx.createMediaStreamSource(tab)
        tsrc.connect(an); tsrc.connect(dest)          // tab → analyser + recording
      }
      return dest.stream
    } catch {
      // AudioContext unavailable → record the raw mic, no waveform.
      analyser.current = null; audioCtx.current = null
      return mic
    }
  }

  const start = async (opts) => {
    setError(null)
    try {
      await idbClear()
      const s = await buildStream(opts)
      stream.current = s
      const mime = pickMime()
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) {
          chunks.current.push(e.data)
          // Persist for crash recovery; flag (don't throw) if storage is full.
          idbAppend(e.data).catch((err) => { if (/quota/i.test(String(err?.name || err))) setStorageWarn(true) })
        }
      }
      mr.current = rec
      rec.start(5000) // flush a chunk every 5s
      setSeconds(0); setInterrupted(false); setStorageWarn(false); setStatus('recording'); tick(); acquireWake()
    } catch (e) { teardown(); setError(e); setStatus('idle') }
  }

  const pause = () => { if (mr.current?.state === 'recording') { mr.current.pause(); stopTick(); releaseWake(); setStatus('paused') } }
  const resume = () => { if (mr.current?.state === 'paused') { mr.current.resume(); tick(); acquireWake(); setStatus('recording') } }

  const stop = () => new Promise((resolve) => {
    const rec = mr.current
    stopTick(); releaseWake()
    if (!rec || rec.state === 'inactive') { teardown(); setStatus('idle'); setTabMixed(false); return resolve(null) }
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
      teardown()
      setStatus('idle'); setTabMixed(false); resolve(blob)
    }
    rec.stop()
  })

  // The live AnalyserNode (or null) — the waveform reads it directly via rAF so
  // the 60fps amplitude updates never churn React state.
  const getAnalyser = () => analyser.current

  // Stop tracks if the component unmounts mid-recording.
  useEffect(() => () => { stopTick(); releaseWake(); teardown() }, [])

  return { status, seconds, error, interrupted, tabMixed, storageWarn, start, pause, resume, stop, getAnalyser }
}

export const fmtClock = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
