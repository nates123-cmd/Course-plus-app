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

// House style appended to EVERY system prompt (the deterministic houseStyle()
// sanitizer below also enforces these on the way out, in case the model slips).
export const HOUSE_STYLE =
  ' House style (always): never use em dashes or en dashes — use a hyphen "-" instead. ' +
  'Always write "Arrowsphere" (one word, capital A) — never "aerosphere" or any other spelling.'

const DEFAULT_SYSTEM =
  'You are a writing and reference assistant inside a personal work app called Course. ' +
  'Return only the requested content - no preamble, no commentary.' + HOUSE_STYLE

// Deterministic enforcement of HOUSE_STYLE on generated text. Runs on every
// proxy response so the rules hold even when the model ignores the instruction.
// Only touches Claude OUTPUT — the user's own typed notes are never rewritten.
export function houseStyle(text) {
  if (!text || typeof text !== 'string') return text
  return text
    .replace(/\s*[—–]\s*/g, ' - ')                 // em / en dash -> spaced hyphen
    .replace(/\b[aA][eé]rosphere\b/g, 'Arrowsphere') // common misspelling
    .replace(/\barrowsphere\b/gi, 'Arrowsphere')     // normalize any casing
}

// Per-model price, USD per 1M tokens (input, output). Update if pricing changes.
// Gemini prices are the standard (cache-miss) rates — approximate.
export const MODEL_PRICING = {
  'claude-haiku-4-5':  { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8':   { in: 15, out: 75 },
  'gemini-2.5-flash-lite':  { in: 0.10, out: 0.40 },
  'gemini-2.5-flash':  { in: 0.30, out: 2.50 },
  'gemini-2.5-pro':  { in: 1.25, out: 10 },
}

// AI engine preference (set by the TopBar toggle, read at call time so flipping
// the switch re-routes the very next AI call). 'claude' | 'gemini'.
export function aiProvider() {
  try { return localStorage.getItem('course.ai') === 'gemini' ? 'gemini' : 'claude' } catch { return 'claude' }
}

// Resolve a capability tier ('light' | 'heavy') to a concrete model id for the
// currently-selected engine. Callers ask for a tier, not a vendor model, so the
// same call works on either engine. The shared `claude` proxy routes by id.
// Gemini heavy = 2.5-PRO (not flash): flash is far terser/shallower than Claude
// Sonnet, so a "thorough briefing" came out thin or empty. Pro is the genuine
// Sonnet-class model and still cheaper than Sonnet ($1.25/$10 vs $3/$15).
export function pickModel(tier = 'light') {
  if (aiProvider() === 'gemini') return tier === 'heavy' ? 'gemini-2.5-pro' : 'gemini-2.5-flash-lite'
  return tier === 'heavy' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5'
}

// Dollar cost for a usage record { model, input_tokens, output_tokens }.
export function claudeCost(u) {
  if (!u) return 0
  const p = MODEL_PRICING[u.model] || MODEL_PRICING['claude-haiku-4-5']
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out) / 1e6
}

// Low-level POST to the shared proxy. Takes the request body verbatim (system,
// messages, model, max_tokens) so callers control single- vs multi-turn shape.
async function postClaude(body) {
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
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error('claude proxy ' + res.status + ': ' + detail.slice(0, 200))
  }
  return res.json()
}

// Pull text out of the proxy response (string, {text}, or {content:[blocks]}),
// then apply house style so every surface gets the same enforced output.
function responseText(data) {
  const raw = typeof data === 'string' ? data
    : data?.text ? data.text
    : Array.isArray(data?.content) ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    : JSON.stringify(data)
  return houseStyle(raw)
}

// Multi-turn chat. messages = [{role:'user'|'assistant', content}]. Returns text.
export async function claudeChat(messages, opts = {}) {
  const { system = DEFAULT_SYSTEM, max_tokens = 1024, model = pickModel('light'), onUsage } = opts
  const data = await postClaude({ system: system || DEFAULT_SYSTEM, messages, model, max_tokens })
  const text = responseText(data)
  if (onUsage) {
    const u = data && typeof data === 'object' ? data.usage : null
    if (u && (u.input_tokens != null || u.output_tokens != null)) {
      onUsage({ model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, estimated: false })
    } else {
      const inChars = (system || '').length + messages.reduce((a, m) => a + (m.content || '').length, 0)
      onUsage({ model, input_tokens: Math.ceil(inChars / 4), output_tokens: Math.ceil((text || '').length / 4), estimated: true })
    }
  }
  return text
}

export async function claudeComplete(prompt, opts = {}) {
  const {
    system = DEFAULT_SYSTEM,
    max_tokens = 1024,
    model = pickModel('light'),
    onUsage,
  } = opts

  const data = await postClaude({
    system: system || DEFAULT_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    model,
    max_tokens,
  })
  const text = responseText(data)

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

// Vision / document extraction — send raw content blocks (image / document)
// straight through the proxy, which forwards `messages` VERBATIM to Anthropic.
// HARD-PINS a Claude model and ignores the gemini toggle: the gemini path
// can't take content blocks and would 400. `blocks` is the user-turn content
// array, e.g. [{type:'image',source:{…}}, {type:'text',text:'…'}]. Returns text.
export async function claudeVision(blocks, opts = {}) {
  const {
    system = 'You transcribe and interpret images and documents into clean markdown. Return only the transcription / interpretation - no preamble, no commentary.' + HOUSE_STYLE,
    max_tokens = 4096,
    model = 'claude-haiku-4-5',
    onUsage,
  } = opts
  const data = await postClaude({ system, messages: [{ role: 'user', content: blocks }], model, max_tokens })
  const text = responseText(data)
  if (onUsage) {
    const u = data && typeof data === 'object' ? data.usage : null
    if (u && (u.input_tokens != null || u.output_tokens != null)) {
      onUsage({ model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, estimated: false })
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
