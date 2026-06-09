// Client for the suite's shared Claude proxy edge function (JWT-gated `claude`).
//   POST { messages: [...], system?, model?, max_tokens? }  -> { text, content }
//   model in {'claude-haiku-4-5','claude-sonnet-4-6','claude-opus-4-8'}; cap 4096.
//
// Uses a plain fetch (NOT supabase.functions.invoke). invoke() attaches
// x-client-info / x-supabase-api-version headers that are NOT in the shared
// proxy's Access-Control-Allow-Headers, so the browser passes the OPTIONS
// preflight (200) but then blocks the POST — surfacing as "failed to send a
// request to the edge function". Sending only authorization/content-type/apikey
// (all allow-listed) fixes it without changing the shared proxy.
import { supabase } from './supabase'

const DEFAULT_SYSTEM =
  'You are a writing and reference assistant inside a personal notes app called Scribe. ' +
  'Return only the requested content — no preamble, no commentary.'

export async function claudeComplete(prompt, opts = {}) {
  const {
    system = DEFAULT_SYSTEM,
    max_tokens = 1024,
    model = 'claude-haiku-4-5',
  } = opts

  const url = import.meta.env.VITE_SUPABASE_URL
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  const { data: { session } } = await supabase.auth.getSession()

  const res = await fetch(url + '/functions/v1/claude', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anon,
      Authorization: 'Bearer ' + (session?.access_token || anon),
    },
    body: JSON.stringify({
      system: system || DEFAULT_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      model,
      max_tokens,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error('claude proxy ' + res.status + ': ' + detail.slice(0, 200))
  }
  const data = await res.json()
  if (typeof data === 'string') return data
  if (data?.text) return data.text
  if (Array.isArray(data?.content)) {
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
  return JSON.stringify(data)
}

// Strip ```json fences and return the first JSON value found. Returns null on
// failure — caller decides whether to fall back.
export function extractJSON(raw) {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  try { return JSON.parse(s) } catch {}
  const obj = s.match(/\{[\s\S]*\}/)
  const arr = s.match(/\[[\s\S]*\]/)
  const candidate = arr && obj
    ? (arr.index < obj.index ? arr[0] : obj[0])
    : (arr?.[0] || obj?.[0])
  if (!candidate) return null
  try { return JSON.parse(candidate) } catch { return null }
}
