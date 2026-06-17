// Asset hosting + "interpret once, markdown forever". Upload a screenshot / PDF /
// file to the private `cp-assets` bucket, record it in cp_assets, and interpret
// it ONCE with a Claude vision model into extracted_md. After that every AI
// surface (Claude + Gemini) reads the markdown as plain text — see DataContext
// digest builders. The original bytes are only fetched for viewing / re-extract.
import { supabase } from './supabase'
import { claudeVision } from './claude'

const BUCKET = 'cp-assets'
const uuid = () => (crypto?.randomUUID?.() || 'id-' + Date.now() + '-' + Math.round(Math.random() * 1e6))

// Anthropic accepts these image media types; everything else is sent as a JPEG
// (we re-encode) or treated as a non-interpretable "other".
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const MAX_BYTES = 10 * 1024 * 1024 // 10MB cap (Anthropic img ~5MB, PDF ~32MB)

export function kindFor(mime = '') {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  return 'other'
}

const extFor = (name = '', mime = '') => {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  if (m) return m[1].toLowerCase()
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return mime.slice(6).replace('jpeg', 'jpg')
  return 'bin'
}

// ── row -> app shape ───────────────────────────────────────────────
export function mapAsset(r) {
  return {
    id: r.id, projectId: r.project_id || null, noteId: r.note_id || null,
    filename: r.filename, mime: r.mime, sizeBytes: r.size_bytes, storagePath: r.storage_path,
    kind: r.kind, extractedMd: r.extracted_md || '', extractStatus: r.extract_status || 'pending',
    at: r.created_at,
  }
}

// ── blob <-> base64 ────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('read failed'))
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '')
    fr.readAsDataURL(blob)
  })
}

// Downscale a large image to fit Anthropic's ~5MB / sensible-pixel budget. Keeps
// aspect ratio, re-encodes as JPEG. Returns { blob, mime } (original if small or
// not an image we can canvas-encode). Best-effort — failures fall back to source.
async function downscaleImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { blob: file, mime: file.type }
  if (file.size < 1.5 * 1024 * 1024) return { blob: file, mime: file.type }
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const MAX = 2000
    let { naturalWidth: w, naturalHeight: h } = img
    const scale = Math.min(1, MAX / Math.max(w, h))
    w = Math.round(w * scale); h = Math.round(h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (blob && blob.size < file.size) return { blob, mime: 'image/jpeg' }
  } catch { /* fall through to original */ }
  return { blob: file, mime: file.type }
}

// ── read ───────────────────────────────────────────────────────────
export async function listAssets({ projectId, noteId } = {}) {
  let q = supabase.from('cp_assets').select('*').order('created_at', { ascending: false })
  if (projectId) q = q.eq('project_id', projectId)
  if (noteId) q = q.eq('note_id', noteId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(mapAsset)
}

// Time-limited URL for viewing the private object (1 hour).
export async function signedUrl(storagePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn)
  if (error) throw error
  return data.signedUrl
}

// ── interpret once ─────────────────────────────────────────────────
const EXTRACT_PROMPT =
  'Transcribe and interpret this file into clean, faithful markdown so a text-only ' +
  'assistant can fully understand it. Preserve all text exactly. Render tables as ' +
  'markdown tables, lists as lists. For charts / diagrams / screenshots, describe ' +
  'the content and any data shown. Do not add commentary or a preamble - return only ' +
  'the markdown transcription.'

// Download bytes, build the right content block, ask Claude, persist extracted_md.
export async function extractToMarkdown(asset, { onUsage } = {}) {
  const a = asset.kind ? asset : mapAsset(asset)
  if (a.kind === 'other') {
    await supabase.from('cp_assets').update({ extract_status: 'skipped' }).eq('id', a.id)
    return { status: 'skipped' }
  }
  try {
    const { data: file, error } = await supabase.storage.from(BUCKET).download(a.storagePath)
    if (error) throw error
    const b64 = await blobToBase64(file)
    const block = a.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: IMG_TYPES.includes(a.mime) ? a.mime : 'image/jpeg', data: b64 } }
    const md = await claudeVision([block, { type: 'text', text: EXTRACT_PROMPT }], { onUsage })
    await supabase.from('cp_assets').update({ extracted_md: md, extract_status: 'done' }).eq('id', a.id)
    return { status: 'done', extractedMd: md }
  } catch (e) {
    await supabase.from('cp_assets').update({ extract_status: 'error' }).eq('id', a.id)
    return { status: 'error', error: String(e?.message || e) }
  }
}

export async function reExtract(id) {
  const { data, error } = await supabase.from('cp_assets').select('*').eq('id', id).single()
  if (error) throw error
  await supabase.from('cp_assets').update({ extract_status: 'pending' }).eq('id', id)
  return extractToMarkdown(mapAsset(data))
}

// ── upload ─────────────────────────────────────────────────────────
// Upload bytes -> insert a `pending` row -> kick off extraction in the
// background. `onProgress(stage)` fires 'uploading' | 'extracting' | 'done'.
// Returns the inserted asset immediately (status pending); extraction resolves
// later and the caller should re-list to pick up extracted_md / final status.
export async function uploadAsset(file, { projectId = null, noteId = null, onProgress, onExtracted } = {}) {
  if (!file || !file.size) throw new Error('empty file')
  if (file.size > MAX_BYTES && !file.type.startsWith('image/')) {
    throw new Error(`File too large (${(file.size / 1048576).toFixed(1)}MB) - cap is ${MAX_BYTES / 1048576}MB`)
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('not signed in')

  onProgress?.('uploading')
  // Images: downscale big ones so we stay under Anthropic's per-image limit.
  const { blob, mime } = await downscaleImage(file)
  if (blob.size > MAX_BYTES) throw new Error(`File too large after downscale - cap is ${MAX_BYTES / 1048576}MB`)

  const ext = extFor(file.name, mime)
  const path = `${user.id}/${uuid()}.${ext}`
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime || 'application/octet-stream', upsert: false })
  if (up.error) throw new Error('upload: ' + up.error.message)

  const id = uuid()
  const kind = kindFor(mime)
  const row = {
    id, project_id: projectId, note_id: noteId, filename: file.name || 'file',
    mime, size_bytes: blob.size, storage_path: path, kind, extract_status: kind === 'other' ? 'skipped' : 'pending',
  }
  const { error } = await supabase.from('cp_assets').insert(row)
  if (error) throw error
  const asset = mapAsset({ ...row, created_at: new Date().toISOString() })

  // Fire extraction without blocking the upload return.
  if (asset.kind !== 'other') {
    onProgress?.('extracting')
    extractToMarkdown(asset).then((r) => { onProgress?.('done'); onExtracted?.(r) }).catch(() => onProgress?.('done'))
  } else {
    onProgress?.('done')
  }
  return asset
}

// ── delete (row + bucket object) ───────────────────────────────────
export async function deleteAsset(id) {
  const { data, error } = await supabase.from('cp_assets').select('storage_path').eq('id', id).single()
  if (error) throw error
  if (data?.storage_path) await supabase.storage.from(BUCKET).remove([data.storage_path])
  const { error: delErr } = await supabase.from('cp_assets').delete().eq('id', id)
  if (delErr) throw delErr
}
