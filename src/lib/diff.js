// Line diff for reviewing a document revision before it overwrites the original.
// Plain LCS over lines — documents here are prose, not source files, so the
// cost is fine and the output is what a human wants to read (whole changed
// lines, not character runs).

// Longest-common-subsequence table, walked back into an edit script.
function lcsOps(a, b) {
  const n = a.length, m = b.length
  // Trim the common head and tail first — for a targeted revision that leaves
  // most of the document alone, this is what keeps the table small.
  let head = 0
  while (head < n && head < m && a[head] === b[head]) head++
  let tail = 0
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++
  const A = a.slice(head, n - tail), B = b.slice(head, m - tail)

  const rows = A.length + 1, cols = B.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      table[i * cols + j] = A[i] === B[j]
        ? table[(i + 1) * cols + (j + 1)] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)])
    }
  }

  const ops = []
  for (let k = 0; k < head; k++) ops.push({ type: 'same', text: a[k] })
  let i = 0, j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { ops.push({ type: 'same', text: A[i] }); i++; j++ }
    else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) { ops.push({ type: 'del', text: A[i] }); i++ }
    else { ops.push({ type: 'add', text: B[j] }); j++ }
  }
  while (i < A.length) { ops.push({ type: 'del', text: A[i] }); i++ }
  while (j < B.length) { ops.push({ type: 'add', text: B[j] }); j++ }
  for (let k = m - tail; k < m; k++) ops.push({ type: 'same', text: b[k] })
  return ops
}

// Diff two documents into ops: [{ type:'same'|'add'|'del', text }].
export function diffLines(before = '', after = '') {
  return lcsOps(String(before).split('\n'), String(after).split('\n'))
}

// Collapse runs of unchanged lines down to `context` lines either side of a
// change, replacing the rest with a { type:'skip', count } marker — so a
// two-line edit in a long document reads as a two-line edit.
export function collapseUnchanged(ops, context = 2) {
  const keep = new Array(ops.length).fill(false)
  ops.forEach((op, i) => {
    if (op.type === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true
  })
  const out = []
  let skipped = 0
  ops.forEach((op, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ type: 'skip', count: skipped }); skipped = 0 }
      out.push(op)
    } else skipped++
  })
  if (skipped) out.push({ type: 'skip', count: skipped })
  return out
}

// Headline counts for "12 lines added, 3 removed".
export function diffStat(ops) {
  let added = 0, removed = 0
  for (const op of ops) { if (op.type === 'add') added++; else if (op.type === 'del') removed++ }
  return { added, removed, changed: added + removed > 0 }
}
