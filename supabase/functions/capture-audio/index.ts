// supabase/functions/capture-audio/index.ts
//
// Long-form capture. Takes raw recorded audio from a wrist or phone client,
// hands it to AssemblyAI, and files the finished transcript as a meeting note
// in cp_notes.
//
// This is the counterpart to `capture`, which takes dictated text and is capped
// at whatever Apple's Dictate Text action will give you (about 60 seconds).
// Recording and transcription are split apart here precisely so that cap does
// not apply: the client only has to record and upload.
//
// Two paths, one function:
//   POST /capture-audio        raw audio bytes in, "queued" out
//   POST /capture-audio/hook   AssemblyAI calls this when the transcript is done
//
// The audio is never persisted on our side. It is streamed through to
// AssemblyAI and forgotten. The client is expected to keep its local copy until
// it sees a 200, because a recording that only ever existed in flight is a
// recording you can lose.
//
// Deployed with --no-verify-jwt. The shared CAPTURE_KEY is the auth mechanism.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const OWNER_ID = Deno.env.get('OWNER_ID') || ''
const CAPTURE_KEY = Deno.env.get('CAPTURE_KEY') || ''
const AAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY') || ''

const MAX_BYTES = 40 * 1024 * 1024 // ~40 MB. Watch AAC mono runs well under this for an hour.
const AAI = 'https://api.assemblyai.com/v2'
const TZ = 'America/New_York'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function line(body: string, status = 200): Response {
  return new Response(body + '\n', {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

// Constant-time compare. Both sides are hashed to a fixed 32 bytes first so a
// length difference cannot leak through an early return.
async function secretMatches(presented: string, expected: string): Promise<boolean> {
  if (!expected) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const x = new Uint8Array(a), y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(d)

// "Recording — Jul 26, 2:14 PM". 12-hour clock, which is the house style.
function titleFor(d: Date): string {
  const day = fmt(d, { month: 'short', day: 'numeric' })
  const time = fmt(d, { hour: 'numeric', minute: '2-digit', hour12: true })
  return `Recording ${day}, ${time}`
}

const mmss = (ms: number) => {
  const m = Math.round(ms / 60000)
  return m < 1 ? 'under a minute' : `${m} min`
}

// ── step 1: client uploads audio ───────────────────────────────────────
async function intake(req: Request): Promise<Response> {
  const presented = req.headers.get('x-capture-key') || ''
  if (!(await secretMatches(presented, CAPTURE_KEY))) return line('Auth failed', 401)

  let raw: ArrayBuffer
  try {
    raw = await req.arrayBuffer()
  } catch {
    return line('Could not read audio', 400)
  }
  if (!raw.byteLength) return line('Empty recording', 400)
  if (raw.byteLength > MAX_BYTES) return line('Recording too large', 413)

  // Hand the bytes to AssemblyAI. We keep no copy; the client holds the
  // original until it sees this call succeed.
  const up = await fetch(`${AAI}/upload`, {
    method: 'POST',
    headers: { authorization: AAI_KEY, 'content-type': 'application/octet-stream' },
    body: raw,
  })
  if (!up.ok) return line('Upload failed: ' + (await up.text()).slice(0, 60), 502)
  const { upload_url } = await up.json()

  // Speaker labels matter here: the target use is an in-person meeting, where
  // an undifferentiated wall of text is close to useless.
  const job = await fetch(`${AAI}/transcript`, {
    method: 'POST',
    headers: { authorization: AAI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      speaker_labels: true,
      webhook_url: `${SUPABASE_URL}/functions/v1/capture-audio/hook`,
      webhook_auth_header_name: 'x-capture-key',
      webhook_auth_header_value: CAPTURE_KEY,
    }),
  })
  if (!job.ok) return line('Transcribe failed: ' + (await job.text()).slice(0, 60), 502)

  const mb = (raw.byteLength / 1048576).toFixed(1)
  return line(`Sent ${mb} MB — transcribing`)
}

// ── step 2: AssemblyAI calls back when the transcript is ready ─────────
async function hook(req: Request): Promise<Response> {
  const presented = req.headers.get('x-capture-key') || ''
  if (!(await secretMatches(presented, CAPTURE_KEY))) return line('Auth failed', 401)

  const { transcript_id, status } = await req.json().catch(() => ({}))
  if (!transcript_id) return line('No transcript id', 400)
  if (status !== 'completed') {
    console.error('transcript did not complete:', transcript_id, status)
    return line('Noted', 200) // nothing to file, but do not make AssemblyAI retry
  }

  const r = await fetch(`${AAI}/transcript/${transcript_id}`, { headers: { authorization: AAI_KEY } })
  if (!r.ok) return line('Fetch failed', 502)
  const t = await r.json()

  const text: string = (t.text || '').trim()
  if (!text) return line('Empty transcript', 200)

  // Prefer speaker-labeled utterances; fall back to the flat text if labeling
  // did not run (single speaker, or the feature errored).
  const utts: any[] = Array.isArray(t.utterances) ? t.utterances : []
  const paras = utts.length
    ? utts.map((u) => `Speaker ${u.speaker}: ${(u.text || '').trim()}`)
    : text.split(/\n{2,}/).map((p: string) => p.trim()).filter(Boolean)

  const now = new Date()
  const { error } = await admin.from('cp_notes').insert({
    id: `rec-${crypto.randomUUID()}`,
    user_id: OWNER_ID, // auth.uid() is null under the service key
    kind: 'meeting',
    title: titleFor(now),
    tags: ['watch', 'recording'],
    date: fmt(now, { month: 'short', day: 'numeric', year: 'numeric' }),
    updated: 'now',
    status: 0, // Raw — it has not been reviewed or triaged yet
    transcript: text,
    body: paras.map((p) => ({ p })),
  })

  if (error) {
    console.error('cp_notes insert failed:', error.message)
    return line('Not saved: ' + error.message.slice(0, 60), 500) // let AssemblyAI retry
  }

  console.log(`filed transcript ${transcript_id}: ${text.split(/\s+/).length} words, ${mmss(t.audio_duration * 1000 || 0)}`)
  return line('Filed')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return line('POST only', 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !OWNER_ID || !CAPTURE_KEY || !AAI_KEY) {
    return line('Server misconfigured', 500)
  }
  const path = new URL(req.url).pathname
  return path.endsWith('/hook') ? await hook(req) : await intake(req)
})
