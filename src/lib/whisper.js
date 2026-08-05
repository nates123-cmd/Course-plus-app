// In-browser Whisper transcription via transformers.js (WebGPU/WASM, no server,
// private, free). Used as an alternative engine to the AssemblyAI edge function
// in transcribe.js. The model (~40MB for tiny.en) is fetched lazily on first use
// and cached by the browser, so app load is never blocked. No speaker labels.
//
// Audio: the recorder hands us a webm/mp4 Blob; Whisper wants a mono Float32Array
// at 16kHz, so we decode + resample through the WebAudio API first.

// Two configs, tried in order. WebGPU is worth attempting because the WASM path
// is single-threaded (see below) and therefore slow enough that an hour-long
// meeting is impractical — and because on WebGPU we can afford base.en, which is
// meaningfully more accurate on jargon-heavy speech than tiny.en. If WebGPU
// doesn't build a session we fall straight back to the config that has always
// worked, so this can never be worse than WASM-only.
const MODEL_GPU = 'Xenova/whisper-base.en'
const MODEL_WASM = 'Xenova/whisper-tiny.en' // fp32 tiny is what the WASM runtime can actually run
const SAMPLE_RATE = 16000

let _pipePromise = null // memoize the pipeline across calls
let _backend = null     // 'webgpu' | 'wasm' — which config actually built

// Which backend the loaded pipeline is using, once one has built. Null until then.
export function activeBackend() { return _backend }

// Lazy-load transformers.js + build (or reuse) the ASR pipeline. onProgress gets
// transformers' file-download progress events while the model is fetched.
async function getPipeline(onProgress) {
  if (_pipePromise) return _pipePromise
  _pipePromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    // Pull weights from the HF hub (not bundled locally), keep the browser cache on.
    env.allowLocalModels = false
    env.useBrowserCache = true
    // Run on single-threaded WASM. Two failure modes both surface as
    // onnxruntime's "no available backend found":
    //  1. WebGPU EP in the bundled onnxruntime-web throws "webgpuInit is not a
    //     function" — and v4 picks WebGPU by default when navigator.gpu exists,
    //     so an undefined device fails the same way (no real WASM fallback).
    //  2. Multi-threaded WASM needs SharedArrayBuffer, which needs COOP/COEP
    //     headers GitHub Pages can't send → the threaded backend won't register.
    // Single-threaded WASM is the one config that reliably loads on a static host.
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1

    // Attempt 1 — WebGPU + base.en. Historically the WebGPU EP in the bundled
    // onnxruntime-web threw "webgpuInit is not a function", which is why this
    // used to be pinned to WASM outright. It's attempted (never assumed) now:
    // any failure falls through to the WASM config below, so the worst case is
    // a wasted probe. q4 is fine here — the MatMulNBits problem is specific to
    // the WASM runtime, and WebGPU builds that op without complaint.
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const p = await pipeline('automatic-speech-recognition', MODEL_GPU, {
          device: 'webgpu',
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
          progress_callback: onProgress,
        })
        _backend = 'webgpu'
        return p
      } catch (e) {
        console.warn('[whisper] WebGPU unavailable, falling back to WASM:', e?.message || e)
      }
    }

    // Attempt 2 — the known-good config. Pin fp32 weights per-module: the v4
    // wasm path otherwise resolves the q4 weights, whose MatMulNBits op the WASM
    // runtime can't build a session for ("Missing required scale …
    // TransposeDQWeightsForMatMulNBits") — and passing device:'wasm' lets it
    // override an explicit dtype:'q8' back to q4. fp32 files contain no dequant
    // nodes at all, so that op can't appear regardless. Larger download (~150MB
    // once, then browser-cached) but it's the one config that reliably builds a
    // session on a static host.
    const p = await pipeline('automatic-speech-recognition', MODEL_WASM, {
      device: 'wasm',
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
      progress_callback: onProgress,
    })
    _backend = 'wasm'
    return p
  })()
  // Don't cache a failed load — let the next attempt retry.
  _pipePromise.catch(() => { _pipePromise = null; _backend = null })
  return _pipePromise
}

export const SR_16K = SAMPLE_RATE

// Blob -> mono Float32Array @ 16kHz that Whisper expects. Exported so the
// diarizer can decode an enrollment clip through the exact same pipeline.
export async function decodeMono16k(blob) { return blobToMono16k(blob) }

async function blobToMono16k(blob) {
  const buf = await blob.arrayBuffer()
  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  let decoded
  try { decoded = await ctx.decodeAudioData(buf.slice(0)) }
  finally { ctx.close?.() }

  // Average channels to mono.
  const ch = decoded.numberOfChannels
  const len = decoded.length
  const mono = new Float32Array(len)
  for (let c = 0; c < ch; c++) {
    const data = decoded.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += data[i] / ch
  }
  if (decoded.sampleRate === SAMPLE_RATE) return mono

  // Resample to 16kHz via OfflineAudioContext.
  const offline = new OfflineAudioContext(1, Math.ceil(len * SAMPLE_RATE / decoded.sampleRate), SAMPLE_RATE)
  const monoBuf = offline.createBuffer(1, len, decoded.sampleRate)
  monoBuf.copyToChannel(mono, 0)
  const src = offline.createBufferSource()
  src.buffer = monoBuf; src.connect(offline.destination); src.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

// True only where the in-browser path can run at all.
export const browserWhisperSupported =
  typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)

// blob -> transcript text. Mirrors transcribeAudio's onStatus contract so the
// recorder can reuse the same UI states. onStatus('loading-model'|'transcribing'),
// onModelProgress({ file, progress }) for the download bar. No speaker labels.
export async function transcribeInBrowser(blob, opts = {}) {
  const { text } = await transcribeInBrowserDetailed(blob, opts)
  return text
}

// Like transcribeInBrowser but also returns the decoded mono-16k audio and the
// chunk-level timestamps (return_timestamps) so the diarizer can slice each
// segment out of the audio and label it by speaker. Shape:
//   { text, audio: Float32Array@16k, chunks: [{ timestamp:[start,end], text }] }
export async function transcribeInBrowserDetailed(blob, { onStatus, onModelProgress } = {}) {
  if (!blob || !blob.size) throw new Error('empty recording')
  onStatus?.('loading-model')
  const transcriber = await getPipeline((p) => {
    if (p?.status === 'progress') onModelProgress?.({ file: p.file, progress: p.progress || 0 })
  })
  onStatus?.('transcribing')
  const audio = await blobToMono16k(blob)
  const out = await transcriber(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })
  const chunks = (out?.chunks || []).map((c) => ({ timestamp: c.timestamp, text: (c.text || '').trim() })).filter((c) => c.text)
  // With return_timestamps the chunked path reliably fills `chunks`, but the
  // aggregate `out.text` can come back empty (WebGPU/some transformers builds) —
  // which silently dropped the whole transcript on the no-speaker-label path.
  // Rebuild from the chunks so text is never lost when chunks exist.
  const text = (out?.text || '').trim() || chunks.map((c) => c.text).join(' ').trim()
  return { text, audio, chunks }
}
