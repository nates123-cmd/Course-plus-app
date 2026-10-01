// supabase/functions/reminder-triage/index.ts
//
// Triage for Apple Reminders that carry NO app prefix. Reminders is Nate's
// fastest phone capture, so the default list is part errands, part untriaged
// inbox. Prefixed reminders ("stock: ...") are routed automatically by the Mac
// agent through `capture`; everything else waits here for a tap, because the
// same list holds real errands that must never be filed on a guess.
//
// Two operations, both POST JSON:
//
//   { op: 'suggest', reminders: [{ id, title, notes? }] }
//     Called by the Mac sync agent (Today repo, tools/push-reminders.sh) on
//     every run with the open, undated, unprefixed reminders. Classifies the
//     ones that have no suggestion yet (at most MAX_PER_CALL per call, so a
//     backlog drains over a few runs instead of one slow call) and stores the
//     result on today_reminders.suggestion. Nothing is written to any app.
//
//   { op: 'apply', source_id, items: [RoutedItem, ...] }
//     Called by the Today app when Nate taps Move (or picks a destination).
//     Writes each item through the router's writers, queues a `complete` on
//     the reminder with a "Moved: ..." note (the Mac agent applies it in Apple
//     within ~5 min), and marks the row moved so it leaves the inbox at once.
//
// Auth (deployed with --no-verify-jwt, so both callers can reach it and the
// browser's CORS preflight is answered here):
//   - x-capture-key = CAPTURE_KEY        -> the Mac agent
//   - Authorization: Bearer <user JWT>   -> the Today app; must be OWNER_ID
// Either way rows are read and written as OWNER_ID with the service key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { applyItem, suggest } from '../_shared/router/index.ts'
import type { RoutedItem } from '../_shared/router/classify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const OWNER_ID = Deno.env.get('OWNER_ID') || ''
const CAPTURE_KEY = Deno.env.get('CAPTURE_KEY') || ''

/** Classifier calls per suggest request. A run every 5 min drains a backlog. */
const MAX_PER_CALL = 6

const APPLY_KINDS = new Set([
  'course_task',
  'course_note',
  'stock_out',
  'stock_staple',
  'stock_idea',
  'ink_thought',
  'break_lookup',
  'break_flashcard',
  'cue_add',
])

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-capture-key',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })

async function secretMatches(presented: string, expected: string): Promise<boolean> {
  if (!expected || !presented) return false
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

async function authorized(req: Request): Promise<boolean> {
  if (await secretMatches(req.headers.get('x-capture-key') || '', CAPTURE_KEY)) return true
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  const { data, error } = await admin.auth.getUser(token)
  return !error && data.user?.id === OWNER_ID
}

type Incoming = { id?: unknown; title?: unknown; notes?: unknown }

const textOf = (title: string, notes: string | null) =>
  notes && notes.trim() ? `${title}\n${notes.trim().slice(0, 1000)}` : title

async function opSuggest(reminders: Incoming[]) {
  const wanted = reminders
    .filter((r) => typeof r.id === 'string' && typeof r.title === 'string' && r.title.trim())
    .map((r) => ({ id: r.id as string, title: (r.title as string).trim(), notes: typeof r.notes === 'string' ? r.notes : null }))
  if (!wanted.length) return { suggested: 0, pending: 0 }

  // Only rows that exist, are open, are not triaged, and have no suggestion.
  const { data: rows, error } = await admin
    .from('today_reminders')
    .select('source_id')
    .eq('user_id', OWNER_ID)
    .eq('source', 'ios_reminders')
    .eq('completed', false)
    .is('suggested_at', null)
    .is('triage_state', null)
    .in('source_id', wanted.map((w) => w.id))
  if (error) throw new Error(`today_reminders lookup: ${error.message}`)
  const open = new Set((rows ?? []).map((r) => r.source_id as string))
  const todo = wanted.filter((w) => open.has(w.id))
  const batch = todo.slice(0, MAX_PER_CALL)

  let suggested = 0
  await Promise.all(batch.map(async (r) => {
    try {
      const { items } = await suggest(admin, OWNER_ID, textOf(r.title, r.notes))
      const { error: upErr } = await admin
        .from('today_reminders')
        .update({ suggestion: { items }, suggested_at: new Date().toISOString() })
        .eq('user_id', OWNER_ID)
        .eq('source_id', r.id)
      if (upErr) throw new Error(upErr.message)
      suggested++
    } catch (err) {
      // Left without suggested_at, so a later run retries it.
      console.error('suggest failed for', r.id, err instanceof Error ? err.message : err)
    }
  }))
  return { suggested, pending: todo.length - suggested }
}

function cleanItem(raw: Record<string, unknown>): RoutedItem | null {
  const kind = String(raw.kind || '')
  if (!APPLY_KINDS.has(kind)) return null
  const text = String(raw.text || '').trim()
  if (!text) return null
  const str = (v: unknown) => (v == null || v === '' ? null : String(v))
  const media = str(raw.media)
  return {
    kind: kind as RoutedItem['kind'],
    text,
    title: str(raw.title),
    back: str(raw.back),
    project: str(raw.project),
    due: str(raw.due),
    media: (kind === 'cue_add' ? media ?? 'movie' : null) as RoutedItem['media'],
    confidence: 1, // Nate confirmed it
  }
}

async function opApply(sourceId: unknown, rawItems: unknown) {
  if (typeof sourceId !== 'string' || !sourceId) return json({ error: 'source_id required' }, 400)
  if (!Array.isArray(rawItems) || !rawItems.length) return json({ error: 'items required' }, 400)
  const items = rawItems.map((i) => cleanItem((i ?? {}) as Record<string, unknown>))
  if (items.some((i) => i === null)) return json({ error: 'every item needs a known kind and text' }, 400)

  const { data: row, error } = await admin
    .from('today_reminders')
    .select('title, notes, triage_state')
    .eq('user_id', OWNER_ID)
    .eq('source', 'ios_reminders')
    .eq('source_id', sourceId)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!row) return json({ error: 'reminder not found (already completed on the phone?)' }, 404)
  // A double tap must not file the same thing twice.
  if (row.triage_state === 'moved') return json({ line: 'already moved', already: true })

  // Claim the row first; a concurrent second apply then sees 'moved'.
  const { data: claimed } = await admin
    .from('today_reminders')
    .update({ triage_state: 'moved', completed: true })
    .eq('user_id', OWNER_ID)
    .eq('source_id', sourceId)
    .is('triage_state', null)
    .select('id')
  if (!claimed?.length) return json({ line: 'already moved', already: true })

  const raw = textOf(row.title, row.notes)
  const lines: string[] = []
  try {
    for (const item of items as RoutedItem[]) lines.push(await applyItem(admin, OWNER_ID, item, raw, 'reminders'))
  } catch (err) {
    // Nothing (or only part) was filed: hand the row back to the inbox.
    await admin
      .from('today_reminders')
      .update({ triage_state: null, completed: false })
      .eq('user_id', OWNER_ID)
      .eq('source_id', sourceId)
    const msg = err instanceof Error ? err.message : 'unknown error'
    return json({ error: `not filed: ${msg}`, filed: lines }, 500)
  }

  const line = lines.join('; ')
  const { error: qErr } = await admin.from('today_reminder_actions').insert({
    user_id: OWNER_ID,
    action: 'complete',
    source_id: sourceId,
    payload: { note: `Moved: ${line}` },
  })
  if (qErr) console.error('queue complete failed:', qErr.message) // filed anyway; Today hides it
  return json({ line })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !OWNER_ID) return json({ error: 'server misconfigured' }, 500)
  if (!(await authorized(req))) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  try {
    if (body.op === 'suggest') return json(await opSuggest(Array.isArray(body.reminders) ? body.reminders : []))
    if (body.op === 'apply') return await opApply(body.source_id, body.items)
    return json({ error: "op must be 'suggest' or 'apply'" }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'unknown error' }, 500)
  }
})
