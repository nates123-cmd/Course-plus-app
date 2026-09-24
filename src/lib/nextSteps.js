// A meeting's "Suggested next steps" (cp_notes.next_steps) is Claude-written
// markdown: optional "## Immediate" style headings over bullet lists, bullets
// often led by a bold name ("**Kirby** → confirm …"). These helpers turn it into
// candidate tasks for a project's "For your consideration" queue, and find the
// stretch of transcript a suggestion came from.
//
// Pure — no React, no Supabase.

const MAX_LABEL = 110

const clean = (s) => String(s || '')
  .replace(/\*\*|__/g, '')
  .replace(/`/g, '')
  .replace(/\s*(→|->|=>)\s*/g, ': ')
  .replace(/\s+/g, ' ')
  .trim()

// A bullet reads as a task title up to its first clause break; the rest is detail.
function splitLabel(text) {
  if (text.length <= MAX_LABEL) return { label: text, detail: null }
  const breaks = [' - ', ' – ', ' — ', '; ', ': ', '. ', ', ']
  for (const b of breaks) {
    // "3 - 4%" and "v2. 1" aren't clause breaks.
    let i = text.indexOf(b)
    while (i >= 0 && /\d/.test(text[i - 1] || '') && /\d/.test(text[i + b.length] || '')) i = text.indexOf(b, i + 1)
    if (i >= 25 && i <= MAX_LABEL) return { label: text.slice(0, i).replace(/[:,;.]$/, ''), detail: text }
  }
  const cut = text.slice(0, MAX_LABEL).replace(/\s+\S*$/, '')
  return { label: cut + '…', detail: text }
}

// -> [{ label, detail, section }]
export function parseNextSteps(md) {
  const out = []
  let section = null
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const h = line.match(/^#{1,6}\s+(.*)$/)
    if (h) { section = clean(h[1]) || null; continue }
    const b = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (!b) continue
    const text = clean(b[1]).replace(/\.$/, '')
    if (text.split(' ').length < 3) continue
    out.push({ ...splitLabel(text), section })
  }
  return out
}

// Is a next step already on the project? Against any task: near-identical
// wording (token Jaccard >= 0.5). Against a task born in the SAME meeting —
// almost always the owned action item that restates it ("Kirby: confirm if
// Deal Reg is in the NA portal" vs "Check with Kirby whether Deal Reg is
// visible in the NA partner portal") — a looser test: four or more shared words
// covering at least 45% of the shorter one.
export function isDuplicateStep(label, task) {
  const A = new Set(toks(label)), B = new Set(toks(task.label))
  if (!A.size || !B.size) return false
  let inter = 0; A.forEach((w) => { if (B.has(w)) inter++ })
  if (inter / (A.size + B.size - inter) >= 0.5) return true
  return !!task.sameMeeting && inter >= 4 && inter / Math.min(A.size, B.size) >= 0.45
}

const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'and', 'on', 'in', 'with', 'by', 'from', 'our', 'my', 'me', 'i', 'we',
  'at', 'is', 'be', 'this', 'that', 'it', 'so', 'you', 'your', 'can', 'will', 'should', 'get', 'any', 'if', 'as', 'or', 'are', 'up'])
const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))

// The transcript lines most likely to be where a suggestion came from: score
// each line by how many of the suggestion's words it shares, take the best one
// and a line either side for context. Returns [] when nothing overlaps enough.
export function transcriptExcerpt(transcript, text, { maxChars = 700 } = {}) {
  const lines = String(transcript || '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const want = new Set(toks(text))
  if (!want.size) return []
  let best = -1, bestScore = 0
  lines.forEach((l, i) => {
    const have = new Set(toks(l))
    let hit = 0; want.forEach((w) => { if (have.has(w)) hit++ })
    // favour lines that are about the thing, not long lines that mention everything
    const score = hit / Math.sqrt(Math.max(have.size, 4))
    if (score > bestScore) { bestScore = score; best = i }
  })
  if (best < 0 || bestScore < 0.45) return []
  const pick = [best - 1, best, best + 1].filter((i) => i >= 0 && i < lines.length).map((i) => ({ text: lines[i], hit: i === best }))
  let total = 0
  return pick.map((p) => {
    const room = Math.max(0, maxChars - total)
    const t = p.text.length > room ? p.text.slice(0, room).replace(/\s+\S*$/, '') + '…' : p.text
    total += t.length
    return { ...p, text: t }
  }).filter((p) => p.text && p.text !== '…')
}
