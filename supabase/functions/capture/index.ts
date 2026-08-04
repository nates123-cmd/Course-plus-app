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
// Responses are always a single short line of text/plain, because the string is
// rendered verbatim in a watch notification. A failed insert must never look
// like a success: a dropped thought you think you saved is the worst outcome
// this system can produce. For the same reason the line now names the outcome
// ("Stock: butter -> shopping list") rather than just acknowledging receipt —
// if a capture is misrouted, that notification is where it gets caught.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { route } from '../_shared/router/index.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const OWNER_ID = Deno.env.get('OWNER_ID') || '' // Nate's auth.users uuid — rows file under him
const CAPTURE_KEY = Deno.env.get('CAPTURE_KEY') || '' // shared secret guarding the endpoint

const MAX_BYTES = 8 * 1024 // dictation should never approach this

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

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

  const text = new TextDecoder().decode(raw).trim()
  if (!text) return line('Empty capture', 400)

  // route() is contractually total: it never throws and always lands the text
  // somewhere, falling back to cp_inbox on any failure. A throw here would
  // mean a bug in that contract, not a lost capture, but the capture is what
  // matters — so report honestly rather than pretending it saved.
  try {
    const outcome = await route(admin, OWNER_ID, text, 'watch')
    return line(outcome)
  } catch (err) {
    console.error('router threw:', err instanceof Error ? err.message : err)
    return line('Not saved: router error', 500)
  }
})
