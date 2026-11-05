// supabase/functions/capture/index.ts
//
// Watch Capture — plain-REST drop point for dictated text from an Apple Watch
// Shortcut. POST the raw dictated string as text/plain with an x-capture-key
// header. Dictation is done on-device by Apple before it ever reaches us.
//
// The text is then ROUTED (see ../_shared/router/): classified into the app it
// belongs to and written as a real record — a Course+ task, a Stock shopping
// item, an Ink thought, a Break look-up — instead of always landing as an
// untriaged cp_inbox row. Anything unroutable, low-confidence, or that fails
// on the way to its destination still falls back to cp_inbox, which is exactly
// what this endpoint did before the router existed.
//
// This is deliberately NOT the MCP endpoint: that speaks JSON-RPC with a
// session envelope, which Shortcuts cannot assemble. This is a separate,
// dumber path into the same database.
//
// Auth: shared secret in CAPTURE_KEY, compared in constant time. Deployed with
// --no-verify-jwt because Shortcuts carries no Supabase JWT.
//
// Responses are a single short line of text/plain, because the string is
// rendered verbatim in a watch notification. The Suite app sends
// `accept: application/json` and gets the same line plus the routed items, so
// the phone can learn the phrase it just saw ("low on …" -> stock_low).
//
// Suite also skips the classifier once it has learned a phrase: a JSON body
// `{"text": "peanut butter", "kind": "stock_low"}` goes straight to that
// writer (applyItem), no model call, which is what keeps the bar fast. A failed insert must never look
// like a success: a dropped thought you think you saved is the worst outcome
// this system can produce. For the same reason the line now names the outcome
// ("Stock: butter -> shopping list") rather than just acknowledging receipt —
// if a capture is misrouted, that notification is where it gets caught.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { applyItem, routeDetailed } from '../_shared/router/index.ts'
import type { Kind, RoutedItem } from '../_shared/router/classify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const OWNER_ID = Deno.env.get('OWNER_ID') || '' // Nate's auth.users uuid — rows file under him
const CAPTURE_KEY = Deno.env.get('CAPTURE_KEY') || '' // shared secret guarding the endpoint

const MAX_BYTES = 8 * 1024 // dictation should never approach this

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

/** Kinds a caller may force without a classifier. `unknown`/`question` write nothing, so no. */
const APPLY_KINDS = new Set<Kind>([
  'course_task', 'course_note', 'stock_out', 'stock_low', 'stock_staple', 'stock_idea',
  'ink_thought', 'break_lookup', 'break_flashcard', 'cue_add',
])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

// One short line, always text/plain. Nothing here is read by a browser.
function line(body: string, status = 200): Response {
  return new Response(body + '\n', {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

// Constant-time secret comparison. Both sides are hashed to a fixed 32 bytes
// first so that differing lengths do not leak through an early return.
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return line('POST only', 405)

  if (!SUPABASE_URL || !SERVICE_KEY || !OWNER_ID || !CAPTURE_KEY) {
    return line('Server misconfigured', 500)
  }

  const presented = req.headers.get('x-capture-key') || ''
  if (!(await secretMatches(presented, CAPTURE_KEY))) return line('Auth failed', 401)

  // Read raw bytes so the size cap is measured in bytes, not code points.
  let raw: ArrayBuffer
  try {
    raw = await req.arrayBuffer()
  } catch {
    return line('Could not read capture', 400)
  }
  if (raw.byteLength > MAX_BYTES) return line('Capture too long', 413)

  const wantsJSON = (req.headers.get('accept') || '').includes('application/json')
  const isJSONBody = (req.headers.get('content-type') || '').includes('application/json')
  let text = new TextDecoder().decode(raw).trim()

  // Forced kind: Suite already knows where this goes. No classifier, no inbox
  // fallback — he is looking at the screen, so an error is shown, not hidden.
  let forced: Kind | null = null
  if (isJSONBody) {
    let body: { text?: unknown; kind?: unknown }
    try {
      body = JSON.parse(text)
    } catch {
      return line('Bad JSON', 400)
    }
    text = typeof body.text === 'string' ? body.text.trim() : ''
    if (typeof body.kind === 'string') {
      if (!APPLY_KINDS.has(body.kind as Kind)) return line(`Unknown kind: ${body.kind}`, 400)
      forced = body.kind as Kind
    }
  }
  if (!text) return line('Empty capture', 400)

  // route() is contractually total: it never throws and always lands the text
  // somewhere, falling back to cp_inbox on any failure. A throw here would
  // mean a bug in that contract, not a lost capture, but the capture is what
  // matters — so report honestly rather than pretending it saved.
  try {
    // Where the capture came from, for provenance labels and the inbox id.
    // Allow-listed: anything else (including no header, the watch Shortcut)
    // stays 'watch', which is what every capture was labelled before.
    const hdr = req.headers.get('x-capture-src')
    const src = hdr === 'reminders' || hdr === 'suite' ? hdr : 'watch'

    if (forced) {
      const item: RoutedItem = {
        kind: forced, text, title: null, back: null, project: null, due: null, media: null, confidence: 1,
      }
      try {
        const out = await applyItem(admin, OWNER_ID, item, text, src)
        return wantsJSON ? jsonResponse({ line: out, items: [{ kind: forced, text, confidence: 1 }] }) : line(out)
      } catch (err) {
        const msg = `Not saved: ${err instanceof Error ? err.message : 'writer error'}`
        return wantsJSON ? jsonResponse({ line: msg, items: [] }, 500) : line(msg, 500)
      }
    }

    const outcome = await routeDetailed(admin, OWNER_ID, text, src)
    if (!wantsJSON) return line(outcome.line)
    return jsonResponse({
      line: outcome.line,
      items: outcome.items.map((i) => ({
        kind: i.kind,
        text: i.text ?? '',
        line: i.line,
        confidence: i.confidence,
        table: i.table,
        record_id: i.record_id,
        demoted: i.demoted_reason ?? null,
      })),
    })
  } catch (err) {
    console.error('router threw:', err instanceof Error ? err.message : err)
    return line('Not saved: router error', 500)
  }
})
