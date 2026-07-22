// Verbatim document edits — the machinery behind "update this document".
//
// The old revise flow asked the model for the COMPLETE rewritten document and
// wrote whatever came back. Even with "preserve everything untouched" in the
// system prompt, a model re-authoring 3,000 words will quietly reword a
// sentence here, drop a row there. The document you got back was a very good
// impression of your document rather than your document.
//
// So the model never writes the document any more. It returns targeted
// SEARCH/REPLACE blocks, and we splice them into the original string here.
// Every character the model did not explicitly ask to change is the original
// character — not "preserved", literally untouched.
//
// SEARCH/REPLACE blocks rather than JSON on purpose: the search text has to
// match the document byte for byte, and JSON string escaping of multi-line
// markdown (backslashes, quotes, newlines inside tables) is exactly where that
// goes wrong.

const OPEN = '<<<<<<< SEARCH'
const MID = '======='
const CLOSE = '>>>>>>> REPLACE'

// Pull the SEARCH/REPLACE blocks out of a model response. Anything outside the
// blocks (preamble, the summary section, stray commentary) is ignored.
export function parseEditBlocks(raw = '') {
  const text = String(raw).replace(/\r\n/g, '\n')
  const out = []
  let i = 0
  while (true) {
    const open = text.indexOf(OPEN, i)
    if (open === -1) break
    const mid = text.indexOf('\n' + MID + '\n', open)
    if (mid === -1) break
    const close = text.indexOf('\n' + CLOSE, mid)
    if (close === -1) break
    // Skip the marker line itself, including a trailing newline if present.
    const searchStart = open + OPEN.length + (text[open + OPEN.length] === '\n' ? 1 : 0)
    out.push({
      find: text.slice(searchStart, mid),
      replace: text.slice(mid + MID.length + 2, close),
    })
    i = close + CLOSE.length
  }
  return out
}

// The summary the model writes above its blocks, if it wrote one.
export function parseSummary(raw = '') {
  const text = String(raw).replace(/\r\n/g, '\n')
  const first = text.indexOf(OPEN)
  const head = (first === -1 ? text : text.slice(0, first))
  return head.replace(/^\s*SUMMARY\s*:?\s*\n?/i, '').replace(/\n?\s*EDITS\s*:?\s*$/i, '').trim()
}

// Index the document once so a whitespace-tolerant match can be mapped back to
// real offsets in the original text. Runs of whitespace collapse to one space;
// each kept character remembers where it came from.
function normalize(doc) {
  let norm = ''
  const map = [] // map[k] = index in doc of norm[k]
  let inWs = false
  for (let i = 0; i < doc.length; i++) {
    const c = doc[i]
    if (/\s/.test(c)) {
      if (!inWs) { norm += ' '; map.push(i); inWs = true }
    } else {
      norm += c; map.push(i); inWs = false
    }
  }
  return { norm, map }
}

function normalizeNeedle(s) {
  return s.replace(/\s+/g, ' ')
}

function allIndexes(hay, needle, limit = 3) {
  const hits = []
  if (!needle) return hits
  let from = 0
  while (hits.length < limit) {
    const at = hay.indexOf(needle, from)
    if (at === -1) break
    hits.push(at)
    from = at + 1
  }
  return hits
}

// Resolve one edit against the ORIGINAL document. Returns a span to splice, or
// a reason it could not be placed. Never guesses between two candidates — an
// ambiguous edit is reported, not applied to whichever came first.
function locate(doc, find) {
  const exact = allIndexes(doc, find)
  if (exact.length === 1) return { start: exact[0], end: exact[0] + find.length, how: 'exact' }
  if (exact.length > 1) return { fail: `matched ${exact.length}+ places in the document` }

  // Trim-only retry: models routinely add or lose a leading/trailing newline.
  const trimmed = find.trim()
  if (trimmed && trimmed !== find) {
    const t = allIndexes(doc, trimmed)
    if (t.length === 1) return { start: t[0], end: t[0] + trimmed.length, how: 'trimmed' }
    if (t.length > 1) return { fail: `matched ${t.length}+ places in the document` }
  }

  // Whitespace-tolerant retry: re-wrapped lines, tabs vs spaces, doubled blanks.
  const { norm, map } = normalize(doc)
  const needle = normalizeNeedle(trimmed || find)
  const n = allIndexes(norm, needle)
  if (n.length === 1) {
    const start = map[n[0]]
    const lastK = n[0] + needle.length - 1
    // +1 because map holds the START of each collapsed run; the run's last
    // character is wherever the next kept character begins.
    const end = lastK + 1 < map.length ? map[lastK + 1] : doc.length
    return { start, end, how: 'whitespace' }
  }
  if (n.length > 1) return { fail: `matched ${n.length}+ places in the document` }
  return { fail: 'that text is not in the document' }
}

// Apply edits to `doc`. Returns { body, applied, failed }.
//
// An edit with an empty SEARCH appends to the end of the document. Overlapping
// edits are refused rather than silently stacked, and every splice is computed
// against the original offsets, so the order of the blocks never matters.
export function applyEdits(doc = '', edits = []) {
  const spans = []
  const failed = []
  const appends = []

  for (const e of edits) {
    const find = e.find || ''
    if (!find.trim()) {
      if ((e.replace || '').trim()) appends.push(e.replace.replace(/^\n+/, ''))
      continue
    }
    const at = locate(doc, find)
    if (at.fail) { failed.push({ ...e, reason: at.fail }); continue }
    const clash = spans.find((s) => at.start < s.end && s.start < at.end)
    if (clash) { failed.push({ ...e, reason: 'overlaps another edit in the same pass' }); continue }
    spans.push({ ...at, edit: e })
  }

  spans.sort((a, b) => b.start - a.start)
  let body = doc
  for (const s of spans) body = body.slice(0, s.start) + s.edit.replace + body.slice(s.end)

  if (appends.length) {
    const head = body.replace(/\s*$/, '')
    body = (head ? head + '\n\n' : '') + appends.join('\n\n')
  }

  return {
    body,
    applied: spans.length + appends.length,
    failed,
  }
}
