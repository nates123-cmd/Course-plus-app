// Upload mic audio to private storage, then transcribe via the `transcribe`
// edge function (AssemblyAI, server-side key, speaker diarization on).
import { supabase } from './supabase'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

const extFor = (type) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm')

// Supabase Storage rejects anything over the project's global file-size limit,
// which is capped at 50 MB on the Free plan. The storage error ("The object
// exceeded the maximum allowed size") says nothing about what to do next, so
// check first and say it in the app's own terms. New recordings run at 32 kbps
// (see AUDIO_BPS) so a full 2-hour session is ~29 MB; only older/imported audio
// should ever trip this.
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

async function callFn(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(url + '/functions/v1/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: 'Bearer ' + (session?.access_token || anon) },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || ('transcribe ' + res.status))
  return data
}

// Speaker-labeled transcript text from AssemblyAI utterances.
function formatUtterances(utterances, fallback) {
  if (!utterances || !utterances.length) return (fallback || '').trim()
  return utterances.map((u) => `Speaker ${u.speaker}: ${u.text}`).join('\n\n')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// blob -> transcript text. onStatus('uploading'|'queued'|'processing') for UI.
// opts: { speakersExpected, diarize, languageDetection } tune AssemblyAI.
export async function transcribeAudio(blob, { onStatus, speakersExpected, diarize, languageDetection } = {}) {
  if (!blob || !blob.size) throw new Error('empty recording')
  if (blob.size > UPLOAD_MAX_BYTES) {
    throw new Error(`This recording is ${(blob.size / 1048576).toFixed(0)} MB — cloud transcription tops out at ${UPLOAD_MAX_BYTES / 1048576} MB. `
      + 'Switch "Transcribe with" to "On device · private" — it runs in your browser with no upload and no size limit.')
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('not signed in')

  onStatus?.('uploading')
  const ext = extFor(blob.type || '')
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from('scribe-audio').upload(path, blob, {
    contentType: blob.type || 'audio/webm', upsert: false,
  })
  if (up.error) throw new Error('upload: ' + up.error.message)

  onStatus?.('queued')
  const startReq = { op: 'start', path }
  if (diarize === false) startReq.speaker_labels = false
  if (Number.isInteger(speakersExpected) && speakersExpected >= 1) startReq.speakers_expected = speakersExpected
  if (languageDetection) startReq.language_detection = true
  const { id } = await callFn(startReq)
  if (!id) throw new Error('no transcript id')

  // AssemblyAI has already pulled the audio by the time any terminal status
  // lands, and nothing in the app ever reads this object again — `path` is not
  // persisted on the note or anywhere else. Drop it on every exit path so the
  // bucket stops accumulating unreachable recordings; it had built up 1.3 GB of
  // them (82 files, none referenced by any row) before this cleanup existed.
  try {
    // Poll up to ~40 min. 2hr audio usually completes in a few minutes.
    for (let i = 0; i < 300; i++) {
      await sleep(8000)
      const d = await callFn({ op: 'poll', id })
      if (d.status === 'completed') return formatUtterances(d.utterances, d.text)
      if (d.status === 'error') throw new Error('transcription failed: ' + (d.error || 'unknown'))
      onStatus?.(d.status || 'processing')
    }
    throw new Error('transcription timed out')
  } finally {
    // Best effort — a failed cleanup must never mask the transcript or a real error.
    try { await supabase.storage.from('scribe-audio').remove([path]) } catch {}
  }
}
