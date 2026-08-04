// supabase/functions/capture-refile/index.ts
//
// The correction half of the capture router.
//
// When a capture cannot be confidently routed it lands in cp_inbox and Nate
// gets a Telegram message. This is what his reply reaches: OpenClaw reads
// "that's a flashcard", calls `refile`, and the capture becomes the record it
// should have been — without him opening an app.
//
// It reuses `_shared/router/writers.ts` rather than reimplementing the inserts,
// because those writers are where the suite's storage landmines are encoded
// (zero-indexed months, jsonb blob shapes, nullable owner columns). A second
// copy of that knowledge would rot out of sync with the first.
//
// Auth: bearer `OPENCLAW_REFILE_SECRET`, matching the other OpenClaw bridges.
// Deployed --no-verify-jwt because the bot carries no Supabase JWT; the
// service key never leaves the server and the bot holds only this one narrow
// secret.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { RoutedItem } from '../_shared/router/classify.ts'
import {
  writeBreakFlashcard,
  writeBreakLookup,
  writeCourseNote,
  writeCourseTask,
  writeInkThought,
  writeStockIdea,
  writeStockOut,
  writeStockStaple,
  type WriteResult,
} from '../_shared/router/writers.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const OWNER_ID = Deno.env.get('OWNER_ID') || ''
const REFILE_SECRET = Deno.env.get('OPENCLAW_REFILE_SECRET') || ''

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const KINDS = [
  'course_task',
  'course_note',
  'stock_out',
  'stock_staple',
  'stock_idea',
  'ink_thought',
  'break_lookup',
  'break_flashcard',
] as const
type Kind = typeof KINDS[number]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** Constant-time compare, same shape as the capture endpoint's. */
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

interface CaptureLogRow {
  id: string
  raw_text: string
  src: string
  items: Array<{
    kind: string
    table: string
    record_id: string
    line: string
    demoted_reason?: string
  }>
  created_at: string
  undone_at: string | null
}

/**
 * Find the capture a reply is correcting.
 *
 * `ref` is the short prefix shown in the Telegram alert, not a full uuid, so
 * this matches on prefix and REFUSES an ambiguous match rather than picking
 * one. Re-filing the wrong capture would move a record Nate never mentioned,
 * and he would have no reason to go looking for it.
 *
 * LANDMINE — the prefix match CANNOT be pushed into the query. `capture_log.id`
 * is a `uuid`, and Postgres has no `uuid ~~* text` operator: a PostgREST
 * `ilike` filter on it fails outright with
 * `operator does not exist: uuid ~~* unknown`, so every re-file would 400.
 * PostgREST cannot cast inside a filter either, so the window is fetched and
 * matched here. Capture volume is a handful a day; 200 rows covers weeks.
 */
const REF_SCAN_LIMIT = 200

async function findCapture(ref: string): Promise<CaptureLogRow | { error: string }> {
  const clean = ref.trim().toLowerCase().replace(/^ref\s+/, '')
  if (clean.length < 6) return { error: 'ref too short — need at least 6 characters' }

  const { data, error } = await admin
    .from('capture_log')
    .select('id, raw_text, src, items, created_at, undone_at')
    .eq('user_id', OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(REF_SCAN_LIMIT)

  if (error) return { error: `capture_log lookup: ${error.message}` }

  const hits = (data || []).filter((r) => String(r.id).toLowerCase().startsWith(clean))
  if (hits.length === 0) return { error: `no capture matching ref ${clean}` }
  if (hits.length > 1) return { error: `ref ${clean} is ambiguous — ${hits.length} matches` }
  return hits[0] as CaptureLogRow
}

/** Resolve a spoken project name, ranking active over dormant duplicates. */
async function resolveProject(
  name: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!name) return null
  const { data } = await admin
    .from('cp_projects')
    .select('id, name, status')
    .eq('user_id', OWNER_ID)
    .in('status', ['active', 'on-hold', 'idea'])

  if (!data) return null
  const want = name.toLowerCase().trim()
  const rank: Record<string, number> = { active: 0, 'on-hold': 1, idea: 2 }
  const hits = data
    .filter((p) => {
      const n = p.name.toLowerCase().trim()
      return n === want || n.includes(want) || want.includes(n)
    })
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
  return hits[0] ? { id: hits[0].id, name: hits[0].name } : null
}

async function writeFor(kind: Kind, item: RoutedItem): Promise<WriteResult> {
  const project = await resolveProject(item.project)
  switch (kind) {
    case 'course_task':
      return writeCourseTask(admin, OWNER_ID, item, project?.id ?? null, project?.name ?? null)
    case 'course_note':
      return writeCourseNote(admin, OWNER_ID, item, project?.id ?? null, project?.name ?? null)
    case 'stock_out':
      return writeStockOut(admin, OWNER_ID, item)
    case 'stock_staple':
      return writeStockStaple(admin, OWNER_ID, item)
    case 'stock_idea':
      return writeStockIdea(admin, OWNER_ID, item)
    case 'ink_thought':
      return writeInkThought(admin, OWNER_ID, item)
    case 'break_lookup':
      return writeBreakLookup(admin, OWNER_ID, item)
    case 'break_flashcard':
      return writeBreakFlashcard(admin, OWNER_ID, item)
  }
}

/**
 * Remove the inbox rows this capture produced.
 *
 * Deliberately only touches `cp_inbox`. A capture reaching this endpoint was
 * demoted, so the inbox row IS the misfile and clearing it is the point — but
 * deleting real records (a task, a thought) on a re-file would be destructive
 * on a wrong ref. Those are left for undo from the review strip, where the
 * consequence is visible.
 */
async function clearInboxRows(capture: CaptureLogRow): Promise<number> {
  const ids = capture.items.filter((i) => i.table === 'cp_inbox').map((i) => i.record_id)
  if (ids.length === 0) return 0

  const { error } = await admin
    .from('cp_inbox')
    .delete()
    .eq('user_id', OWNER_ID)
    .in('id', ids)

  if (error) {
    // Non-fatal: the new record already exists, and reporting failure here
    // would suggest the re-file did not happen when it did. A stale inbox row
    // is a visible, harmless leftover.
    console.error('cp_inbox cleanup failed:', error.message)
    return 0
  }
  return ids.length
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  if (!SUPABASE_URL || !SERVICE_KEY || !OWNER_ID || !REFILE_SECRET) {
    return json({ error: 'Server misconfigured' }, 500)
  }

  const presented = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!(await secretMatches(presented, REFILE_SECRET))) {
    return json({ error: 'Auth failed' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const action = String(body.action || '')

  /* ---------------- list: what is still sitting unfiled ---------------- */
  if (action === 'list') {
    const limit = Math.min(Number(body.limit) || 10, 25)
    const { data, error } = await admin
      .from('capture_log')
      .select('id, raw_text, src, items, created_at')
      .eq('user_id', OWNER_ID)
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return json({ error: error.message }, 500)

    // "Unfiled" means at least one item was demoted to the inbox. A capture
    // that routed cleanly is not this skill's business.
    const unfiled = (data || [])
      .filter((r) => (r.items as CaptureLogRow['items']).some((i) => i.demoted_reason))
      .slice(0, limit)
      .map((r) => ({
        ref: r.id.slice(0, 8),
        text: r.raw_text,
        src: r.src,
        at: r.created_at,
        reason: (r.items as CaptureLogRow['items']).find((i) => i.demoted_reason)
          ?.demoted_reason,
      }))

    return json({ count: unfiled.length, captures: unfiled })
  }

  /* ---------------- refile: turn it into the right record ---------------- */
  if (action === 'refile') {
    const ref = String(body.ref || '')
    const kind = String(body.kind || '') as Kind

    if (!ref) return json({ error: 'ref is required' }, 400)
    if (!KINDS.includes(kind)) {
      return json({ error: `kind must be one of: ${KINDS.join(', ')}` }, 400)
    }

    const found = await findCapture(ref)
    if ('error' in found) return json({ error: found.error }, 404)
    if (found.undone_at) return json({ error: 'that capture was already undone' }, 409)

    // The text defaults to what he actually said. An override exists because
    // dictation mangles words often enough that a correction like "it's
    // tendentious, not tendencies" has to be able to fix the content too.
    const item: RoutedItem = {
      kind,
      text: String(body.text || found.raw_text),
      title: body.title == null ? null : String(body.title),
      back: body.back == null ? null : String(body.back),
      project: body.project == null ? null : String(body.project),
      due: body.due == null ? null : String(body.due),
      confidence: 1, // he said so himself; this is not a guess
    }

    let result: WriteResult
    try {
      result = await writeFor(kind, item)
    } catch (err) {
      return json(
        { error: `could not file as ${kind}: ${err instanceof Error ? err.message : err}` },
        422,
      )
    }

    const cleared = await clearInboxRows(found)

    // Append rather than replace: the original demotion stays visible, so a
    // pattern of the same misroute is still findable after it was corrected.
    const items = [
      ...found.items,
      {
        kind,
        table: result.table,
        record_id: result.record_id,
        line: result.line,
        refiled_at: new Date().toISOString(),
      },
    ]
    const { error: logErr } = await admin
      .from('capture_log')
      .update({ items })
      .eq('user_id', OWNER_ID)
      .eq('id', found.id)
    if (logErr) console.error('capture_log update failed:', logErr.message)

    return json({
      ok: true,
      ref: found.id.slice(0, 8),
      line: result.line,
      table: result.table,
      record_id: result.record_id,
      inbox_rows_cleared: cleared,
    })
  }

  return json({ error: `unknown action: ${action || '(none)'}` }, 400)
})
