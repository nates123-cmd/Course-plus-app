// Outline keyboard model for the markdown editor — Tab / Shift+Tab / Enter
// behave like a real outliner (Google Docs / Workflowy) rather than like a raw
// textarea. Everything here is pure: functions take the document's lines and
// the caret, and return new lines plus where the caret should land. The DOM
// work (replacing text, restoring selection) lives in MdEditor.
//
// Why this file exists: @uiw/react-md-editor ships its own keydown handler with
// two defects. (a) It re-inserts list markers at column 0, so Enter on a nested
// bullet drops back to the top level. (b) It tests list-ness with /^\d+.\s/ —
// an unescaped dot — so a plain line like "200 licenses" parses as list item
// 200 and Enter yields "201. ". MdEditor intercepts Tab/Enter in the capture
// phase so that handler never sees them.

export const INDENT = '  ' // two spaces = one plain-text indent step

// indent · (bullet | number + delimiter) · gap · body
const LIST = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/
const CHECK = /^\[([ xX])\]\s+/ // "[ ] " / "[x] " task marker inside the body

export const indentWidth = (s) => s.match(/^[ \t]*/)[0].replace(/\t/g, INDENT).length

// Parse one line as a list item, or null if it isn't one. `offset` is the
// CommonMark content column — the indent a child item has to reach to nest.
// For "- foo" that's 2; for "200. foo" it's 5.
export function parseLine(line) {
  const m = LIST.exec(line)
  if (!m) return null
  const gap = m[5] || ' '
  const body = m[6] || ''
  const marker = m[2] || m[3] + m[4]
  const w = m[1].replace(/\t/g, INDENT).length
  return {
    w, indent: ' '.repeat(w), marker, gap, body,
    bullet: m[2] || '', ordered: !!m[3], delim: m[4] || '',
    num: m[3] ? parseInt(m[3], 10) : null,
    check: CHECK.test(body),
    offset: w + marker.length + gap.length,
  }
}

// Re-number ordered lists so each run of siblings counts up. The first item of
// a run keeps whatever number it has ("200." stays 200), which makes this
// idempotent and keeps a deliberately-numbered list intact.
export function renumber(lines) {
  const out = lines.slice()
  const stack = [] // { w, n, ordered }
  for (let i = 0; i < out.length; i++) {
    const p = parseLine(out[i])
    if (!p) {
      // Blank lines and indented continuation text sit inside a list; anything
      // else at the left margin ends it and resets the counters.
      if (!out[i].trim() || indentWidth(out[i]) >= 2) continue
      stack.length = 0
      continue
    }
    while (stack.length && stack[stack.length - 1].w > p.w) stack.pop()
    let top = stack[stack.length - 1]
    if (!top || top.w < p.w) { top = { w: p.w, n: null, ordered: false }; stack.push(top) }
    if (!p.ordered) { top.ordered = false; top.n = null; continue }
    if (!top.ordered || top.n == null) { top.ordered = true; top.n = p.num }
    else top.n += 1
    out[i] = p.indent + String(top.n) + p.delim + p.gap + p.body
  }
  return out
}

// ── caret <-> offset ─────────────────────────────────────────────
export function lineStartAt(lines, i) { let n = 0; for (let k = 0; k < i; k++) n += lines[k].length + 1; return n }
export function lineIndexAt(lines, off) {
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const end = n + lines[i].length
    if (off <= end) return i
    n = end + 1
  }
  return Math.max(0, lines.length - 1)
}
export const toOffset = (lines, { line, col }) => {
  const i = Math.max(0, Math.min(line, lines.length - 1))
  return lineStartAt(lines, i) + Math.max(0, Math.min(col, lines[i].length))
}

// ── structure lookups ────────────────────────────────────────────
// Nearest list item above `i` that would become the parent if this line moved
// in a level: a sibling at the same indent. A shallower line or a non-list line
// means there's nothing to nest under, so indenting would be a visual no-op.
function siblingAbove(lines, i, w) {
  for (let k = i - 1; k >= 0; k--) {
    if (!lines[k].trim()) return null
    const kw = indentWidth(lines[k])
    if (kw > w) continue // a deeper descendant of an earlier sibling
    const p = parseLine(lines[k])
    if (!p) return null
    return p.w === w ? p : null
  }
  return null
}

// Indent of the list item this line is currently nested under — the outdent target.
function parentIndent(lines, i, w) {
  for (let k = i - 1; k >= 0; k--) {
    if (!lines[k].trim()) break
    const p = parseLine(lines[k])
    if (p && p.w < w) return p.w
  }
  return 0
}

// Last line of the sub-tree hanging off line `j` (everything indented deeper).
function subtreeEnd(lines, j, w) {
  let last = j
  while (last + 1 < lines.length) {
    const nx = lines[last + 1]
    if (!nx.trim()) break
    if (indentWidth(nx) <= w) break
    last++
  }
  return last
}

// Does a list already exist at `target` indent inside the sub-tree the line at
// `i` is about to join? If so it joins that run; if not it starts a new one.
function runAt(lines, i, w, target) {
  for (let k = i - 1; k >= 0; k--) {
    if (!lines[k].trim()) return false
    if (indentWidth(lines[k]) <= w) return false
    const p = parseLine(lines[k])
    if (p && p.w === target) return true
  }
  return false
}

const reindent = (line, d) => ' '.repeat(Math.max(0, indentWidth(line) + d)) + line.replace(/^[ \t]*/, '')

// ── Tab / Shift+Tab ──────────────────────────────────────────────
// Returns { lines, sel:[{line,col},{line,col}] } or null for "nothing to do,
// but still swallow the key" (never let Tab move focus out of the editor).
export function indentAt(lines, selStart, selEnd, shift) {
  const i = lineIndexAt(lines, selStart)
  const j = lineIndexAt(lines, selEnd)
  const colA = selStart - lineStartAt(lines, i)
  const colB = selEnd - lineStartAt(lines, j)
  const p = parseLine(lines[i])

  // Plain text: a collapsed caret inserts/removes an indent step; a selection
  // shifts every touched line.
  if (!p) {
    const out = lines.slice()
    if (i === j && selStart === selEnd && !shift) {
      out[i] = lines[i].slice(0, colA) + INDENT + lines[i].slice(colA)
      const c = { line: i, col: colA + INDENT.length }
      return { lines: out, sel: [c, c] }
    }
    let dA = 0, dB = 0
    for (let k = i; k <= j; k++) {
      if (!lines[k].trim()) continue
      const before = indentWidth(out[k])
      out[k] = reindent(out[k], shift ? -INDENT.length : INDENT.length)
      const d = indentWidth(out[k]) - before
      if (k === i) dA = d
      if (k === j) dB = d
    }
    return { lines: out, sel: [{ line: i, col: Math.max(0, colA + dA) }, { line: j, col: Math.max(0, colB + dB) }] }
  }

  // List item: move it (and its sub-tree) a full level, using the CommonMark
  // content column of the sibling above so the nesting actually parses.
  let target
  if (shift) {
    if (p.w === 0) return null
    target = parentIndent(lines, i, p.w)
  } else {
    const sib = siblingAbove(lines, i, p.w)
    if (!sib) return null // first item of its list — nowhere to nest
    target = sib.offset
  }
  const d = target - p.w
  if (!d) return null

  const last = subtreeEnd(lines, j, p.w)
  const out = lines.slice()
  for (let k = i; k <= last; k++) {
    if (!lines[k].trim()) continue
    out[k] = reindent(out[k], d)
  }
  // An ordered item that nests into a level with no existing siblings starts a
  // fresh run, so it counts from 1 rather than carrying its old number down.
  if (!shift && p.ordered && !runAt(lines, i, p.w, target)) {
    out[i] = ' '.repeat(target) + '1' + p.delim + p.gap + p.body
  }
  return {
    lines: renumber(out),
    sel: [{ line: i, col: Math.max(0, colA + d) }, { line: j, col: Math.max(0, colB + d) }],
  }
}

// ── Enter ────────────────────────────────────────────────────────
// Returns { lines, sel } when the caret is on a list item, or 'plain' to let
// the browser insert a newline normally (we still swallow the event so the
// library's handler can't fire).
export function enterAt(lines, selStart, selEnd) {
  const i = lineIndexAt(lines, selStart)
  const p = parseLine(lines[i])
  if (!p) return 'plain'
  const ls = lineStartAt(lines, i)
  const contentCol = lines[i].length - p.body.length
  const bodyText = p.check ? p.body.replace(CHECK, '') : p.body

  // Enter on an empty item ends the list: outdent a level, or drop the marker
  // entirely once it's back at the left margin.
  if (!bodyText.trim() && selStart === selEnd) {
    const out = lines.slice()
    if (p.w > 0) {
      const target = parentIndent(lines, i, p.w)
      out[i] = ' '.repeat(target) + lines[i].replace(/^[ \t]*/, '')
      const c = { line: i, col: out[i].length }
      return { lines: renumber(out), sel: [c, c] }
    }
    out[i] = ''
    const c = { line: i, col: 0 }
    return { lines: out, sel: [c, c] }
  }

  // Split the item at the caret and open a sibling at the same indent.
  const a = Math.max(selStart, ls + contentCol)
  const b = Math.max(selEnd, a)
  const head = lines[i].slice(0, a - ls)
  const tail = lines[i].slice(b - ls)
  const marker = p.ordered ? String(p.num + 1) + p.delim : p.bullet
  const prefix = p.indent + marker + p.gap + (p.check ? '[ ] ' : '')
  const out = lines.slice()
  out.splice(i, 1, head, prefix + tail)
  const c = { line: i + 1, col: prefix.length }
  return { lines: renumber(out), sel: [c, c] }
}
