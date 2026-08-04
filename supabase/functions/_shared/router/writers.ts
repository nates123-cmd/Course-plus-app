// supabase/functions/_shared/router/writers.ts
//
// One writer per destination. Each writer owns the storage shape of its app,
// including that app's landmines, so the classifier never has to know a column
// name and adding a new destination never touches the classifier.
//
// Every app in the suite lives in the same Supabase project, so these are
// plain inserts under the service key — no MCP, no per-app API, no cross
// service auth. The cost of that convenience is that each writer is writing
// into a schema it does not own, and several of those schemas will accept a
// wrong-shaped row without complaining. Hence the landmine notes below; they
// are load-bearing, not commentary.
//
// Writers return a short human-readable line. It is rendered verbatim in the
// watch notification and is the only proof a capture landed, so it must name
// the app and the outcome ("Stock: butter -> shopping list"), never just "OK".

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { RoutedItem } from './classify.ts'

const TZ = 'America/New_York'

/** cp_inbox.title is not-null and drives the Inbox headline. */
const TITLE_MAX = 80

export interface WriteResult {
  /** Table the record landed in. Recorded in capture_log so undo can find it. */
  table: string
  /** Primary key of the new row, for undo. */
  record_id: string
  /** One line, shown to Nate on the watch. */
  line: string
}

export function titleFor(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= TITLE_MAX) return flat
  const cut = flat.slice(0, TITLE_MAX)
  const sp = cut.lastIndexOf(' ')
  return (sp > 40 ? cut.slice(0, sp) : cut) + '...'
}

/** `Aug 3, 2026` — the format cp_notes.date is stored in (it is text, not a date). */
function courseDateString(iso?: string | null): string {
  const d = iso ? new Date(`${iso}T12:00:00Z`) : new Date()
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

// Stock mints ids as `extra_<base36>`; the id is also duplicated inside `data`.
const stockId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Strip LIKE wildcards so a dictated name can't turn into a pattern. */
const literal = (s: string) => s.replace(/[%_\\]/g, '\\$&')

/* ------------------------------------------------------------------ */
/* Course+                                                             */
/* ------------------------------------------------------------------ */

/**
 * LANDMINE — cp_tasks.due_date months are ZERO-INDEXED.
 * The column is jsonb `{d, m, y}` written by a JS client that stored
 * `Date.getMonth()` verbatim, so August is `m: 7`. Writing `m: 8` here files
 * the task in September and nothing errors. The sibling `due` text column is
 * legacy and null on every current row — do not write it.
 * Also: `id` is text with NO default, so it must be minted.
 */
export async function writeCourseTask(
  admin: SupabaseClient,
  ownerId: string,
  item: RoutedItem,
  projectId: string | null,
  projectName: string | null,
): Promise<WriteResult> {
  const id = crypto.randomUUID()

  let due_date: { d: number; m: number; y: number } | null = null
  if (item.due) {
    const [y, m, d] = item.due.split('-').map(Number)
    if (y && m && d) due_date = { d, m: m - 1, y } // m - 1: see landmine above
  }

  const { error } = await admin.from('cp_tasks').insert({
    id,
    user_id: ownerId,
    project_id: projectId,
    label: item.text,
    due_date,
  })
  if (error) throw new Error(`cp_tasks: ${error.message}`)

  const where = projectName ? ` on ${projectName}` : ''
  const when = item.due ? ` (due ${courseDateString(item.due)})` : ''
  return { table: 'cp_tasks', record_id: id, line: `Course+ task${where}${when}` }
}

/**
 * LANDMINE — cp_notes.body is jsonb shaped `[{ "md": "<markdown>" }]`, not a
 * string and not a block array. `project` holds a project ID, not a name,
 * despite `cp_tasks` calling the same thing `project_id`. `date` is TEXT in
 * `Aug 3, 2026` form, not a date column. `id` is text with no default.
 */
export async function writeCourseNote(
  admin: SupabaseClient,
  ownerId: string,
  item: RoutedItem,
  projectId: string | null,
  projectName: string | null,
): Promise<WriteResult> {
  const id = crypto.randomUUID()

  const { error } = await admin.from('cp_notes').insert({
    id,
    user_id: ownerId,
    kind: 'note',
    title: item.title ? titleFor(item.title) : titleFor(item.text),
    body: [{ md: item.text }],
    project: projectId,
    date: courseDateString(),
  })
  if (error) throw new Error(`cp_notes: ${error.message}`)

  const where = projectName ? ` on ${projectName}` : ''
  return { table: 'cp_notes', record_id: id, line: `Course+ note${where}` }
}

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

/**
 * "I'm out of butter" — mark the pantry item out if we can name it exactly,
 * otherwise put it on the shopping list.
 *
 * Exact match only, deliberately. Stock's pantry names are specific ("fine sea
 * salt"), so a fuzzy match on "salt" could flip the wrong jar to `out`. Adding
 * an unmatched name to the shopping list is the harmless failure; silently
 * changing the state of a pantry item he did not mean is not. Both outcomes
 * put the item in front of him when he shops, which is the point.
 *
 * LANDMINE — `originId` decides whether the row survives Stock's filters.
 * `isDeliberateExtra()` in the app routes anything with an unrecognised
 * originId to the Already-have bucket when the name is pinned always-have or
 * flagged a pantry staple, so a voice add tagged `capture` or `voice` would
 * VANISH from the list for exactly the staples he is most likely to run out
 * of. `manual` (MANUAL_ACTIVE) is the value that means "the user put this here
 * by hand", which outranks every automatic hide. Provenance goes in
 * `originLabel`, which is display-only and safe.
 *
 * LANDMINE — both stock tables are jsonb blobs keyed `{id, user_id, data}`,
 * and `data.id` must duplicate the row `id` or the app reads back an item it
 * cannot then update.
 */
export async function writeStockOut(
  admin: SupabaseClient,
  ownerId: string,
  item: RoutedItem,
): Promise<WriteResult> {
  const name = item.text.trim()

  const { data: matches, error: findErr } = await admin
    .from('pantry_items')
    .select('id, data')
    .eq('user_id', ownerId)
    .ilike('data->>canonicalName', literal(name))
  if (findErr) throw new Error(`pantry_items lookup: ${findErr.message}`)

  const hit = matches?.[0]
  if (hit) {
    const next = { ...hit.data, status: 'out', statusUpdatedAt: new Date().toISOString() }
    const { error } = await admin
      .from('pantry_items')
      .update({ data: next, updated_at: new Date().toISOString() })
      .eq('user_id', ownerId)
      .eq('id', hit.id)
    if (error) throw new Error(`pantry_items: ${error.message}`)

    // 'out' auto-promotes to the shopping list in Stock, so this is the whole
    // action — no extras row is needed and adding one would duplicate the item.
    return {
      table: 'pantry_items',
      record_id: hit.id,
      line: `Stock: ${next.canonicalName} marked out`,
    }
  }

  const id = stockId('extra')
  const { error } = await admin.from('extras').insert({
    id,
    user_id: ownerId,
    data: {
      id,
      canonicalName: name,
      unit: null,
      amount: null,
      addedAt: new Date().toISOString(),
      originId: 'manual', // see landmine above — must stay 'manual'
      originLabel: 'added by voice',
    },
  })
  if (error) throw new Error(`extras: ${error.message}`)

  return { table: 'extras', record_id: id, line: `Stock: ${name} -> shopping list` }
}

/* ------------------------------------------------------------------ */
/* Ink                                                                 */
/* ------------------------------------------------------------------ */

/**
 * LANDMINE — `entries` has CHECK constraints on both `primary_type` and
 * `source_surface`, and a capture-specific surface like `'capture'` or
 * `'watch'` violates the second one outright. `'mcp'` is the accepted value
 * for anything written programmatically. A thought is a DUAL write: the
 * `entries` row is the canonical record and the `thoughts` row is what Ink's
 * Mind stream reads, linked by `source_entry_id`. Writing only one of the two
 * produces a thought that exists but never appears.
 */
export async function writeInkThought(
  admin: SupabaseClient,
  ownerId: string,
  item: RoutedItem,
): Promise<WriteResult> {
  const { data: entry, error: entryErr } = await admin
    .from('entries')
    .insert({
      user_id: ownerId,
      raw_text: item.text,
      primary_type: 'thought',
      source_surface: 'mcp', // constrained value — see landmine above
    })
    .select('id')
    .single()
  if (entryErr) throw new Error(`entries: ${entryErr.message}`)

  const { error: thoughtErr } = await admin.from('thoughts').insert({
    user_id: ownerId,
    text: item.text,
    source_entry_id: entry.id,
  })
  if (thoughtErr) throw new Error(`thoughts: ${thoughtErr.message}`)

  return { table: 'thoughts', record_id: entry.id, line: 'Ink: thought saved' }
}

/* ------------------------------------------------------------------ */
/* Break                                                               */
/* ------------------------------------------------------------------ */

export async function writeBreakLookup(
  admin: SupabaseClient,
  ownerId: string,
  item: RoutedItem,
): Promise<WriteResult> {
  const { data, error } = await admin
    .from('look_up_later')
    .insert({ user_id: ownerId, question: item.text })
    .select('id')
    .single()
  if (error) throw new Error(`look_up_later: ${error.message}`)

  return { table: 'look_up_later', record_id: data.id, line: 'Break: look up later' }
}

/* ------------------------------------------------------------------ */
/* Fallback                                                            */
/* ------------------------------------------------------------------ */

/**
 * The catch-all, and the behaviour this whole endpoint had before the router.
 * Everything that is unroutable, low-confidence, or blew up on the way to its
 * real destination lands here rather than being dropped.
 *
 * LANDMINE — cp_inbox has no `body` and no `source` column. Provenance is
 * `src`; the full text goes in `snippet`; `title` is not-null and must be
 * given something. PK is composite `(user_id, id)` and `id` is text with no
 * default, so ids must be minted. `user_id` defaults to `auth.uid()`, which is
 * null under the service key, so it must be passed explicitly.
 */
export async function writeInbox(
  admin: SupabaseClient,
  ownerId: string,
  text: string,
  src: string,
): Promise<WriteResult> {
  const id = `${src}-${crypto.randomUUID()}`
  const { error } = await admin.from('cp_inbox').insert({
    id,
    user_id: ownerId,
    title: titleFor(text),
    snippet: text,
    src,
  })
  if (error) throw new Error(`cp_inbox: ${error.message}`)

  return { table: 'cp_inbox', record_id: id, line: 'Inbox' }
}
