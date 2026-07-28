// Study data access — cp_dives (the shelf) + cp_dive_runs (the graded history).
//
// Deliberately NOT loaded in loadAll(): the study shelf is a screen you visit,
// not part of the work spine every boot renders, and a missing migration here
// must never take the whole app down. Every read is fetched on demand and
// degrades to an empty list.
//
// This module talks only to cp_* tables. Break's `deep_dives` / `flashcards`
// are never touched — that separation is the whole point of building it here.
import { supabase } from './supabase'

const uuid = () => (crypto?.randomUUID?.() || 'id-' + Date.now() + '-' + Math.round(Math.random() * 1e6))

// Course+ migrations are applied by hand, so a build can reach a browser before
// its tables exist. Postgres 42P01 ("relation does not exist") is that exact
// case — translate it once, here, so the UI says what to do instead of leaking
// a PostgREST error string.
const NOT_MIGRATED =
  'The Study tables are not in this database yet. Apply supabase/migrations/20260728120000_cp_dives.sql, then reload.'
function translate(error) {
  return error?.code === '42P01' ? new Error(NOT_MIGRATED) : error
}

function mapDive(r) {
  return {
    id: r.id, title: r.title, prompt: r.prompt, summary: r.summary || '',
    keyPoints: Array.isArray(r.key_points) ? r.key_points : [],
    source: r.source || 'manual', sourceRef: r.source_ref || null, sourceLabel: r.source_label || '',
    project: r.project_id || null, area: r.area_id || null,
    lastReviewedAt: r.last_reviewed_at || null, lastBucket: r.last_bucket || null,
    reviewCount: r.review_count || 0, archived: !!r.archived, createdAt: r.created_at,
  }
}
function mapRun(r) {
  return {
    id: r.id, dive: r.dive_id, mode: r.mode, bucket: r.bucket || null,
    hits: r.hit_count ?? null, total: r.total_count ?? null,
    answer: r.answer || '', feedback: r.feedback || '',
    verdicts: Array.isArray(r.verdicts) ? r.verdicts : [], at: r.created_at,
  }
}

// The whole shelf, newest first. A missing table is the one error worth
// surfacing — it is a setup step, not a failure, and silently showing an empty
// shelf would read as "you have no drills". Anything else degrades to [].
export async function listDives({ includeArchived = false } = {}) {
  let q = supabase.from('cp_dives').select('*').order('created_at', { ascending: false })
  if (!includeArchived) q = q.eq('archived', false)
  const { data, error } = await q
  if (error?.code === '42P01') throw translate(error)
  if (error) return []
  return (data || []).map(mapDive)
}

export async function createDive(dive = {}) {
  const id = dive.id || uuid()
  const row = {
    id,
    title: dive.title || 'Untitled dive',
    prompt: dive.prompt || '',
    summary: dive.summary ?? null,
    key_points: dive.keyPoints || [],
    source: dive.source || 'manual',
    source_ref: dive.sourceRef ?? null,
    source_label: dive.sourceLabel ?? null,
    project_id: dive.project ?? null,
    area_id: dive.area ?? null,
  }
  const { error } = await supabase.from('cp_dives').insert(row)
  if (error) throw translate(error)
  return id
}

const DIVE_COLS = {
  title: 'title', prompt: 'prompt', summary: 'summary', keyPoints: 'key_points',
  project: 'project_id', area: 'area_id', archived: 'archived',
  lastReviewedAt: 'last_reviewed_at', lastBucket: 'last_bucket', reviewCount: 'review_count',
}
export async function updateDive(id, patch = {}) {
  const row = {}
  for (const k in patch) if (DIVE_COLS[k]) row[DIVE_COLS[k]] = patch[k]
  if (!Object.keys(row).length) return
  const { error } = await supabase.from('cp_dives').update(row).eq('id', id)
  if (error) throw translate(error)
}

export async function deleteDive(id) {
  await supabase.from('cp_dive_runs').delete().eq('dive_id', id)
  const { error } = await supabase.from('cp_dives').delete().eq('id', id)
  if (error) throw translate(error)
}

// Record a graded attempt AND roll the summary fields on the dive itself, so the
// shelf can show "last: missed" without loading every run.
export async function logRun(dive, run = {}) {
  const id = uuid()
  const row = {
    id, dive_id: dive.id, mode: run.mode || 'type', bucket: run.bucket ?? null,
    hit_count: run.hits ?? null, total_count: run.total ?? null,
    answer: run.answer ?? null, feedback: run.feedback ?? null, verdicts: run.verdicts || [],
  }
  // The run is the record; a failure to write it should surface. The dive-side
  // rollup is a convenience — never let it swallow the session.
  const { error } = await supabase.from('cp_dive_runs').insert(row)
  if (error) throw translate(error)
  try {
    await updateDive(dive.id, {
      lastReviewedAt: new Date().toISOString(),
      lastBucket: run.bucket ?? null,
      reviewCount: (dive.reviewCount || 0) + 1,
    })
  } catch {}
  return id
}

export async function listRuns(diveId, limit = 12) {
  const { data, error } = await supabase.from('cp_dive_runs').select('*')
    .eq('dive_id', diveId).order('created_at', { ascending: false }).limit(limit)
  if (error) return []
  return (data || []).map(mapRun)
}
