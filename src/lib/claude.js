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
  'You are a writing and reference assistant inside a personal work app called Course. ' +
  'Return only the requested content — no preamble, no commentary.'

// Per-model price, USD per 1M tokens (input, output). Update if pricing changes.
export const MODEL_PRICING = {
  'claude-haiku-4-5':  { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8':   { in: 15, out: 75 },
}

// Dollar cost for a usage record { model, input_tokens, output_tokens }.
export function claudeCost(u) {
  if (!u) return 0
  const p = MODEL_PRICING[u.model] || MODEL_PRICING['claude-haiku-4-5']
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out) / 1e6
}

export async function claudeComplete(prompt, opts = {}) {
  const {
    system = DEFAULT_SYSTEM,
    max_tokens = 1024,
    model = 'claude-haiku-4-5',
    onUsage,
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
  const text = typeof data === 'string' ? data
    : data?.text ? data.text
    : Array.isArray(data?.content) ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    : JSON.stringify(data)

  // Report token usage if the caller wants it. Prefer the real usage the proxy
  // passes through; otherwise estimate (~4 chars/token) so cost is still shown.
  if (onUsage) {
    const u = data && typeof data === 'object' ? data.usage : null
    if (u && (u.input_tokens != null || u.output_tokens != null)) {
      onUsage({ model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, estimated: false })
    } else {
      const inChars = (system || '').length + (typeof prompt === 'string' ? prompt.length : JSON.stringify(prompt).length)
      onUsage({ model, input_tokens: Math.ceil(inChars / 4), output_tokens: Math.ceil((text || '').length / 4), estimated: true })
    }
  }
  return text
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
