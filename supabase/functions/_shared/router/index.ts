// supabase/functions/_shared/router/index.ts
//
// The capture router: dictated text in, real records out.
//
// Shared on purpose. Today only the `capture` function calls it, but the
// long-form path (`capture-audio`, which already produces a transcript) is the
// same problem with a longer input, so the seam is here rather than inside one
// endpoint.
//
// The contract that matters: `route()` NEVER throws and NEVER loses a capture.
// Every failure path — the classifier being down, a writer rejecting a row, a
// confidence too low to trust — ends with the text in cp_inbox, which is
// exactly where it landed before the router existed. Misfiling is recoverable;
// a dropped thought Nate believes he saved is not.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classify, CONFIDENCE_FLOOR, type RoutedItem } from './classify.ts'
import {
  writeBreakLookup,
  writeCourseNote,
  writeCourseTask,
  writeInbox,
  writeInkThought,
  writeStockOut,
  type WriteResult,
} from './writers.ts'

/** One entry per record the capture produced. Written to capture_log. */
interface LoggedItem extends WriteResult {
  kind: string
  confidence: number | null
  /** Why this landed in the inbox instead of its real destination. */
  demoted_reason?: string
}

async function activeProjects(
  admin: SupabaseClient,
  ownerId: string,
): Promise<{ names: string[]; byName: Map<string, { id: string; name: string }> }> {
  const { data, error } = await admin
    .from('cp_projects')
    .select('id, name')
    .eq('user_id', ownerId)
    .eq('status', 'active')

  // A failed project lookup is not fatal: without the list the classifier
  // simply cannot attach a project, and an unfiled task still beats no task.
  if (error || !data) {
    console.error('cp_projects lookup failed:', error?.message)
    return { names: [], byName: new Map() }
  }

  const byName = new Map<string, { id: string; name: string }>()
  for (const p of data) byName.set(p.name.toLowerCase().trim(), p)
  return { names: data.map((p) => p.name), byName }
}

async function dispatch(
  admin: SupabaseClient,
  ownerId: string,
  item: RoutedItem,
  byName: Map<string, { id: string; name: string }>,
): Promise<WriteResult> {
  // The classifier returns a project NAME copied from the list we gave it;
  // resolving it to an id here means a hallucinated name degrades to "no
  // project" rather than a foreign key that points at nothing.
  const project = item.project ? byName.get(item.project.toLowerCase().trim()) : undefined
  const projectId = project?.id ?? null
  const projectName = project?.name ?? null

  switch (item.kind) {
    case 'course_task':
      return writeCourseTask(admin, ownerId, item, projectId, projectName)
    case 'course_note':
      return writeCourseNote(admin, ownerId, item, projectId, projectName)
    case 'stock_out':
      return writeStockOut(admin, ownerId, item)
    case 'ink_thought':
      return writeInkThought(admin, ownerId, item)
    case 'break_lookup':
      return writeBreakLookup(admin, ownerId, item)
    default:
      throw new Error(`unroutable kind: ${item.kind}`)
  }
}

/**
 * Route one capture. Returns the line to show Nate — always non-empty, and
 * always naming what actually happened rather than just acknowledging receipt.
 */
export async function route(
  admin: SupabaseClient,
  ownerId: string,
  text: string,
  src: string,
): Promise<string> {
  const logged: LoggedItem[] = []

  let items: RoutedItem[] = []
  let classifierFailed = false
  try {
    const { names, byName } = await activeProjects(admin, ownerId)

    items = await classify(text, names)

    for (const item of items) {
      const lowConfidence = item.confidence < CONFIDENCE_FLOOR
      const unroutable = item.kind === 'unknown'

      if (lowConfidence || unroutable) {
        // Demoted, not dropped. The inbox row carries the item's own text so a
        // multi-item capture does not lose the part that routed cleanly.
        const result = await writeInbox(admin, ownerId, item.text || text, src)
        logged.push({
          ...result,
          kind: item.kind,
          confidence: item.confidence,
          demoted_reason: unroutable ? 'unknown kind' : 'low confidence',
        })
        continue
      }

      try {
        const result = await dispatch(admin, ownerId, item, byName)
        logged.push({ ...result, kind: item.kind, confidence: item.confidence })
      } catch (err) {
        // One writer failing must not take the other items down with it.
        console.error('writer failed:', err instanceof Error ? err.message : err)
        const result = await writeInbox(admin, ownerId, item.text || text, src)
        logged.push({
          ...result,
          kind: item.kind,
          confidence: item.confidence,
          demoted_reason: `writer error: ${err instanceof Error ? err.message : 'unknown'}`,
        })
      }
    }
  } catch (err) {
    console.error('classification failed:', err instanceof Error ? err.message : err)
    classifierFailed = true
  }

  // Nothing was written: the classifier died, or it returned no items at all.
  // Either way the raw text still has to land somewhere.
  if (logged.length === 0) {
    const result = await writeInbox(admin, ownerId, text, src)
    logged.push({
      ...result,
      kind: 'unknown',
      confidence: null,
      demoted_reason: classifierFailed ? 'classifier unavailable' : 'no items returned',
    })
  }

  await recordLog(admin, ownerId, text, src, logged)

  return logged.map((l) => l.line).join('; ')
}

/**
 * The capture log is what makes writing directly to real tables safe to rely
 * on. Without it a misroute is silent — the capture is gone into an app Nate
 * has no reason to open. With it, "recent captures" is a reviewable strip and
 * every row carries what it decided and which record it made, so a bad route
 * can be re-filed or undone.
 *
 * A logging failure must never fail the capture: the record is already
 * written, and reporting an error at this point would tell him a capture was
 * lost when it was not.
 */
async function recordLog(
  admin: SupabaseClient,
  ownerId: string,
  text: string,
  src: string,
  items: LoggedItem[],
): Promise<void> {
  const { error } = await admin.from('capture_log').insert({
    user_id: ownerId,
    raw_text: text,
    src,
    items,
  })
  if (error) console.error('capture_log insert failed:', error.message)
}
