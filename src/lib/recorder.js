// Mic recorder hook. Captures up to MAX_SECONDS, streams chunks to IndexedDB so
// an accidental reload mid-recording is recoverable. Returns a Blob on stop.
import { useEffect, useRef, useState } from 'react'

export const MAX_SECONDS = 2 * 60 * 60 // 2 hours

function pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const m of cands) if (window.MediaRecorder?.isTypeSupported?.(m)) return m
  return '' // let the browser default
}

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
  const mr = useRef(null), stream = useRef(null), chunks = useRef([]), timer = useRef(null)

  const tick = () => { timer.current = setInterval(() => setSeconds((s) => {
    if (s + 1 >= MAX_SECONDS) { try { mr.current?.stop() } catch {} }
    return s + 1
  }), 1000) }
  const stopTick = () => { clearInterval(timer.current); timer.current = null }

  const start = async () => {
    setError(null)
    try {
      await idbClear()
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = s
      const mime = pickMime()
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.current.push(e.data); idbAppend(e.data).catch(() => {}) } }
      mr.current = rec
      rec.start(5000) // flush a chunk every 5s
      setSeconds(0); setStatus('recording'); tick()
    } catch (e) { setError(e); setStatus('idle') }
  }

  const pause = () => { if (mr.current?.state === 'recording') { mr.current.pause(); stopTick(); setStatus('paused') } }
  const resume = () => { if (mr.current?.state === 'paused') { mr.current.resume(); tick(); setStatus('recording') } }

  const stop = () => new Promise((resolve) => {
    const rec = mr.current
    stopTick()
    if (!rec || rec.state === 'inactive') { setStatus('idle'); return resolve(null) }
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
      stream.current?.getTracks().forEach((t) => t.stop())
      setStatus('idle'); resolve(blob)
    }
    rec.stop()
  })

  // Stop tracks if the component unmounts mid-recording.
  useEffect(() => () => { stopTick(); stream.current?.getTracks().forEach((t) => t.stop()) }, [])

  return { status, seconds, error, start, pause, resume, stop }
}

export const fmtClock = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
