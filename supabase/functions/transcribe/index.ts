// Scribe/Course transcription proxy. Keeps the AssemblyAI key server-side.
//   POST { op:'start', path, speaker_labels?, speakers_expected?, language_detection? }
//        -> { id }   (path = scribe-audio object key)
//   POST { op:'poll',  id }  -> { status, text?, utterances?, error? }
// JWT-gated at the gateway (verify_jwt). Signing uses the service-role key so
// AssemblyAI can fetch the private audio object via a short-lived signed URL.
//
// Diarization params are OPTIONAL and backward-compatible: callers that send
// nothing get the original behavior (speaker_labels:true). Course passes
// speakers_expected (known head-count → fixes over/under-counting) and can turn
// diarization off for a clean single-stream transcript.

const AAI = 'https://api.assemblyai.com/v2/transcript'
const SB_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function signedUrl(path: string): Promise<string> {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/scribe-audio/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 7200 }),
  })
  if (!r.ok) throw new Error(`sign ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const { signedURL } = await r.json()
  return `${SB_URL}/storage/v1${signedURL}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!AAI_KEY) return json({ error: 'ASSEMBLYAI_API_KEY not configured on the edge function' }, 500)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }

  try {
    if (body.op === 'start') {
      if (!body.path) return json({ error: 'path required' }, 400)
      const audio_url = await signedUrl(String(body.path))
      const diarize = body.speaker_labels !== false // default on (back-compat)
      const params: Record<string, unknown> = {
        audio_url, punctuate: true, format_text: true, speaker_labels: diarize,
      }
      // Known head-count dramatically improves diarization (fixes over/under count).
      const n = Number(body.speakers_expected)
      if (diarize && Number.isInteger(n) && n >= 1 && n <= 10) params.speakers_expected = n
      // Opt-in multilingual detection (e.g. mixed English/Spanish meetings).
      // Otherwise pin English: since Universal-3.5 Pro became the default model
      // (Sept 2026), omitting language_code turns automatic language detection
      // ON, and a quiet/near-silent recording then fails outright with
      // "Language detection cannot be performed on files with no spoken audio"
      // instead of returning whatever could be transcribed.
      if (body.language_detection) params.language_detection = true
      else params.language_code = 'en'
      const r = await fetch(AAI, {
        method: 'POST',
        headers: { authorization: AAI_KEY, 'content-type': 'application/json' },
        body: JSON.stringify(params),
      })
      const d = await r.json()
      if (!r.ok) return json({ error: d?.error || `assemblyai ${r.status}` }, 502)
      return json({ id: d.id, status: d.status })
    }

    if (body.op === 'poll') {
      if (!body.id) return json({ error: 'id required' }, 400)
      const r = await fetch(`${AAI}/${body.id}`, { headers: { authorization: AAI_KEY } })
      const d = await r.json()
      if (!r.ok) return json({ error: d?.error || `assemblyai ${r.status}` }, 502)
      return json({
        status: d.status,
        text: d.text ?? null,
        utterances: d.utterances ?? null,
        error: d.error ?? null,
      })
    }

    return json({ error: 'unknown op' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
