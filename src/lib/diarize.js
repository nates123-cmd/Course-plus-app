// On-device speaker labeling — "Me" vs "Computer" — with zero credits.
//
// Whisper gives us WORDS + timestamps but not WHO spoke. This adds the "who":
// a WavLM speaker-verification model (Xenova/wavlm-base-plus-sv, ~102MB q8,
// cached after first use) turns a clip into an embedding vector. You enroll
// your own voice once; then every transcript segment is embedded and compared
// to your voiceprint by cosine similarity.
//
// The common case here is a Teams call recorded off a laptop speaker: your
// voice hits the mic direct + full-band, while the other person is band-limited
// and reverberant — a big acoustic gap that makes the binary me/them split far
// easier than general diarization. We exploit that with a per-recording
// adaptive split (biggest-gap) rather than a brittle fixed threshold, falling
// back to a fixed cut only when a recording looks single-speaker.
import { decodeMono16k, SR_16K, browserWhisperSupported } from './whisper'

const EMB_MODEL = 'Xenova/wavlm-base-plus-sv'
export const VOICEPRINT_KEY = 'course.voiceprint'

// Tuning knobs (cosine space). The split is adaptive, but these bound it.
const MIN_CLIP_S = 0.5      // segments shorter than this give noisy embeddings → inherit a neighbour's label
const SPREAD_MIN = 0.12     // if all segment sims are within this band, treat the recording as one speaker
const SOLO_THRESH = 0.78    // …and label each segment me/them by this fixed cut instead
export const diarizeSupported = browserWhisperSupported

let _modelPromise = null
async function getEmbedder(onProgress) {
  if (_modelPromise) return _modelPromise
  _modelPromise = (async () => {
    const { AutoProcessor, AutoModel, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    env.useBrowserCache = true
    // Single-threaded WASM — same backend constraint as the Whisper pipeline
    // (WebGPU EP is broken in the bundled ORT; threaded WASM needs COOP/COEP
    // headers GitHub Pages can't send). See lib/whisper.js getPipeline.
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1
    const opts = { dtype: 'q8', progress_callback: onProgress }
    const processor = await AutoProcessor.from_pretrained(EMB_MODEL, { progress_callback: onProgress })
    const model = await AutoModel.from_pretrained(EMB_MODEL, { ...opts, device: 'wasm' })
    return { processor, model }
  })()
  _modelPromise.catch(() => { _modelPromise = null })
  return _modelPromise
}

// L2-normalize in place → cosine similarity becomes a plain dot product.
function normalize(v) {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n
  return out
}
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

// mono-16k Float32Array → normalized embedding (Float32Array).
async function embed({ processor, model }, audio) {
  const inputs = await processor(audio, { sampling_rate: SR_16K })
  const out = await model(inputs)
  const tensor = out.embeddings || out.logits || Object.values(out)[0]
  const data = tensor?.data || tensor
  return normalize(Float32Array.from(data))
}

export function hasVoiceprint() { try { return !!localStorage.getItem(VOICEPRINT_KEY) } catch { return false } }
export function getVoiceprint() {
  try { const a = JSON.parse(localStorage.getItem(VOICEPRINT_KEY)); return Array.isArray(a) && a.length ? Float32Array.from(a) : null }
  catch { return null }
}
export function clearVoiceprint() { try { localStorage.removeItem(VOICEPRINT_KEY) } catch {} }

// Record-your-voice → store a voiceprint. ~10s of clean speech is plenty.
export async function enrollVoiceprint(blob, { onStatus, onModelProgress } = {}) {
  if (!blob || !blob.size) throw new Error('empty enrollment clip')
  onStatus?.('loading-model')
  const eng = await getEmbedder((p) => { if (p?.status === 'progress') onModelProgress?.({ progress: p.progress || 0 }) })
  onStatus?.('embedding')
  const audio = await decodeMono16k(blob)
  if (audio.length < MIN_CLIP_S * SR_16K) throw new Error('enrollment clip too short — speak for ~10 seconds')
  const v = await embed(eng, audio)
  try { localStorage.setItem(VOICEPRINT_KEY, JSON.stringify(Array.from(v))) } catch {}
  onStatus?.('')
  return v
}

// Label Whisper chunks as me/them. Returns turns [{ sp, text }] (consecutive
// same-speaker segments merged), or null if it can't run (no voiceprint / no
// chunks). `audio` is the SAME mono-16k array Whisper transcribed.
export async function labelChunks(audio, chunks, { meLabel = 'Me', themLabel = 'Computer', onStatus, onProgress } = {}) {
  const me = getVoiceprint()
  if (!me || !audio || !chunks?.length) return null
  onStatus?.('loading-model')
  const eng = await getEmbedder()
  onStatus?.('labeling')

  // Embed each segment; segments too short to embed reliably get sim=null.
  const sims = new Array(chunks.length).fill(null)
  for (let i = 0; i < chunks.length; i++) {
    const [s, e] = chunks[i].timestamp || []
    const a = Math.max(0, Math.floor((s || 0) * SR_16K))
    const b = Math.min(audio.length, Math.floor((e ?? s ?? 0) * SR_16K))
    if (b - a >= MIN_CLIP_S * SR_16K) {
      try { sims[i] = dot(me, await embed(eng, audio.subarray(a, b))) } catch { sims[i] = null }
    }
    onProgress?.((i + 1) / chunks.length)
  }

  const valid = sims.filter((x) => x != null)
  if (!valid.length) return chunks.map((c) => ({ sp: meLabel, text: c.text }))

  // Decide the me/them cut for THIS recording.
  const max = Math.max(...valid), min = Math.min(...valid)
  let isMe
  if (max - min < SPREAD_MIN) {
    isMe = (sim) => sim >= SOLO_THRESH
  } else {
    // Split at the largest gap between sorted sims; the higher cluster is "me"
    // (your direct-mic voice scores closest to your enrolled voiceprint).
    const sorted = [...valid].sort((x, y) => x - y)
    let gap = -1, cut = (max + min) / 2
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i] - sorted[i - 1]
      if (g > gap) { gap = g; cut = (sorted[i] + sorted[i - 1]) / 2 }
    }
    isMe = (sim) => sim >= cut
  }

  // Assign labels; short/empty-embedding segments inherit the previous label.
  let prev = meLabel
  const labeled = chunks.map((c, i) => {
    const sp = sims[i] == null ? prev : (isMe(sims[i]) ? meLabel : themLabel)
    prev = sp
    return { sp, text: c.text }
  })

  // Merge consecutive same-speaker turns.
  const turns = []
  for (const l of labeled) {
    const last = turns[turns.length - 1]
    if (last && last.sp === l.sp) last.text += ' ' + l.text
    else turns.push({ sp: l.sp, text: l.text })
  }
  return turns
}
