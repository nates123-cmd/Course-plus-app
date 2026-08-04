// supabase/functions/capture/index.ts
//
// Watch Capture — plain-REST drop point for dictated text from an Apple Watch
// Shortcut. POST the raw dictated string as text/plain with an x-capture-key
// header; the text lands as one untriaged row in cp_inbox and nothing else
// happens to it. No parsing, no project inference, no Whisper — dictation is
// done on-device by Apple before it ever reaches us.
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
// this system can produce.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const OWNER_ID = Deno.env.get('OWNER_ID') || '' // Nate's auth.users uuid — rows file under him
const CAPTURE_KEY = Deno.env.get('CAPTURE_KEY') || '' // shared secret guarding the endpoint

const MAX_BYTES = 8 * 1024 // dictation should never approach this
const TITLE_MAX = 80       // cp_inbox.title is the headline in the Inbox list

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

// cp_inbox.id is text with no default and the primary key is (user_id, id),
// so the id is ours to mint. Prefix keeps watch rows greppable in the table.
const newId = () => `watch-${crypto.randomUUID()}`

function titleFor(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= TITLE_MAX) return flat
  const cut = flat.slice(0, TITLE_MAX)
  const sp = cut.lastIndexOf(' ')
  return (sp > 40 ? cut.slice(0, sp) : cut) + '...'
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

  // user_id defaults to auth.uid(), which is null under the service key, so it
  // must be supplied explicitly or the not-null constraint rejects the row.
  const { error } = await admin.from('cp_inbox').insert({
    id: newId(),
    user_id: OWNER_ID,
    title: titleFor(text), // title is not-null and drives the Inbox headline
    snippet: text,         // full dictated text, untouched
    src: 'watch',
  })

  if (error) {
    console.error('cp_inbox insert failed:', error.message)
    return line('Not saved: ' + error.message.slice(0, 60), 500)
  }

  const words = text.split(/\s+/).filter(Boolean).length
  return line(`Captured — ${words} word${words === 1 ? '' : 's'}`)
})
