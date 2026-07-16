// Turn copied content (from Excel / Google Sheets / Word / a web page) into
// structured text — GFM markdown for rich editors, or CSV for raw "file"
// artifacts — instead of dumping tab-separated junk that doesn't read as a table
// and that the AI can't reliably parse.
//
// Clipboards expose two useful flavors when you copy a table:
//   - text/html  → an actual <table> element (Sheets, Word, web pages)
//   - text/plain → tab-separated rows (Excel, Sheets fallback)
// We prefer HTML (keeps cell structure even with line-wrapped cells), fall back
// to TSV.
//
// IMPORTANT: a pasted *document* is usually prose AND tables, not one bare
// table. Serializing only the first <table> silently threw away every heading,
// paragraph and later table in the doc — the AI then reasoned over a fragment.
// So the HTML path walks the whole document in order (see htmlToText) and only
// the tables inside it become markdown. Getting everything across matters more
// than formatting it prettily.

// --- clipboard → normalized rows -------------------------------------------

// Returns a rectangular array of rows (each padded to the widest), or null when
// the clipboard isn't tabular.
export function clipboardRows(e) {
  const cd = e.clipboardData || e.nativeEvent?.clipboardData
  if (!cd) return null
  let rows = null
  const html = cd.getData('text/html')
  if (html && /<table[\s>]/i.test(html)) rows = parseHtmlTable(html)
  if (!rows) rows = parseTsv(cd.getData('text/plain'))
  if (!rows || !rows.length) return null
  if (Math.max(...rows.map((r) => r.length)) < 2) return null // single column isn't worth a table
  return rectangular(rows)
}

function parseHtmlTable(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    return table ? tableRows(table) : null
  } catch {
    return null
  }
}

// Rows of THIS table only — a nested table's <tr>s belong to the inner table and
// would otherwise be hoisted into the outer one by querySelectorAll.
function tableRows(table) {
  const rows = Array.from(table.querySelectorAll('tr'))
    .filter((tr) => tr.closest('table') === table)
    .map((tr) =>
      Array.from(tr.querySelectorAll('th,td'))
        .filter((c) => c.closest('table') === table)
        .map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())
    )
    .filter((r) => r.length)
  return rows.length ? rows : null
}

// --- clipboard HTML → whole-document text -----------------------------------

const BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|BLOCKQUOTE|UL|OL|DL|DT|DD|FIGURE|FIGCAPTION|ADDRESS|FORM|CAPTION)$/

// Serialize a clipboard HTML fragment to plain text in document order, turning
// each table into a GFM markdown table and leaving everything else as lines.
// Deliberately lossy on styling — the point is that no content goes missing.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,noscript,meta,link,title').forEach((n) => n.remove())
  const out = []
  serialize(doc.body, out)
  return tidy(out.join(''))
}

function serialize(node, out) {
  if (node.nodeType === 3) { out.push((node.nodeValue || '').replace(/\s+/g, ' ')); return }
  if (node.nodeType !== 1) return
  const tag = node.tagName

  if (tag === 'TABLE') {
    const rows = tableRows(node)
    const md = rows ? rowsToMarkdown(rectangular(rows)) : (node.textContent || '').trim()
    if (md) out.push('\n\n' + md + '\n\n')
    return
  }
  if (tag === 'BR') { out.push('\n'); return }
  if (tag === 'HR') { out.push('\n\n---\n\n'); return }
  if (tag === 'PRE') {
    const code = (node.textContent || '').replace(/\s+$/, '')
    if (code) out.push('\n\n```\n' + code + '\n```\n\n')
    return
  }
  if (/^H[1-6]$/.test(tag)) {
    out.push('\n\n' + '#'.repeat(Number(tag[1])) + ' ')
    node.childNodes.forEach((c) => serialize(c, out))
    out.push('\n\n')
    return
  }
  if (tag === 'LI') {
    const ol = node.parentElement?.tagName === 'OL'
    const n = ol ? Array.from(node.parentElement.children).indexOf(node) + 1 : 0
    out.push('\n' + (ol ? n + '. ' : '- '))
    node.childNodes.forEach((c) => serialize(c, out))
    return
  }

  const block = BLOCK.test(tag)
  if (block) out.push('\n')
  node.childNodes.forEach((c) => serialize(c, out))
  if (block) out.push('\n')
}

function tidy(s) {
  return s
    .replace(/ /g, ' ')       // Word/Outlook pad text with nbsp
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')      // strip the spaces our block markers stranded
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Pad every row to the widest so the markdown table's columns line up.
function rectangular(rows) {
  const cols = Math.max(...rows.map((r) => r.length))
  return rows.map((r) => {
    const c = r.slice()
    while (c.length < cols) c.push('')
    return c
  })
}

function parseTsv(text) {
  if (!text || !text.includes('\t')) return null
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (lines.length < 2) return null // need a header + at least one row
  return lines.map((l) => l.split('\t'))
}

// --- rows → markdown / csv --------------------------------------------------

function rowsToMarkdown(rows) {
  const cols = rows[0].length
  const esc = (s) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
  const line = (c) => `| ${c.map(esc).join(' | ')} |`
  const sep = Array(cols).fill('---')
  return [line(rows[0]), line(sep), ...rows.slice(1).map(line)].join('\n')
}

function csvField(s) {
  s = s == null ? '' : String(s)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function rowsToCsv(rows) {
  return rows.map((r) => r.map(csvField).join(',')).join('\n')
}

export function clipboardToMarkdownTable(e) {
  const rows = clipboardRows(e)
  return rows ? rowsToMarkdown(rows) : null
}

// What the clipboard should become in a rich editor:
//   { kind: 'doc',   text }  — an HTML document containing at least one table:
//                              everything, in order, tables as markdown.
//   { kind: 'table', text }  — a bare table (Excel/Sheets copy, or HTML that is
//                              only a table): markdown table, nothing else.
//   null                     — not tabular; let the browser paste it normally.
export function clipboardDocument(e) {
  const cd = e.clipboardData || e.nativeEvent?.clipboardData
  if (!cd) return null
  const html = cd.getData('text/html')
  if (html && /<table[\s>]/i.test(html)) {
    let text = null
    try { text = htmlToText(html) } catch { text = null }
    // Never let a serializer failure eat the paste — fall back to the old
    // table-only path, and past that to the browser's own plain-text paste.
    if (!text) {
      const md = clipboardToMarkdownTable(e)
      return md ? { kind: 'table', text: md } : null
    }
    return { kind: hasProseOutsideTables(text) ? 'doc' : 'table', text }
  }
  const rows = parseTsv(cd.getData('text/plain'))
  if (!rows || Math.max(...rows.map((r) => r.length)) < 2) return null
  return { kind: 'table', text: rowsToMarkdown(rectangular(rows)) }
}

// Is there real content outside the markdown tables? Drives whether a capture is
// a "table" or a document that happens to contain one.
export function hasProseOutsideTables(text) {
  const rest = text
    .split('\n')
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l))
    .join(' ')
    .trim()
  return rest.length > 40
}

// --- paste handlers (for controlled textareas) ------------------------------

function insertAtCursor(e, value, onChange, text, blankLines) {
  e.preventDefault()
  const el = e.target
  const start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? value.length
  const before = value.slice(0, start)
  const after = value.slice(end)
  const nl = blankLines ? '\n\n' : '\n'
  const pre = before === '' ? '' : before.endsWith(nl) ? '' : before.endsWith('\n') ? (blankLines ? '\n' : '') : nl
  const post = after === '' ? '' : after.startsWith('\n') ? '' : nl
  onChange(before + pre + text + post + after)
}

// Rich-editor paste: clipboard → markdown. A bare table becomes a GFM table; a
// whole document keeps its prose and gets its tables converted in place.
// Returns the kind it inserted ('doc' | 'table'), or false to let the paste
// through untouched — truthy either way for callers that only care that it ran.
export function handleTablePaste(e, value, onChange) {
  const res = clipboardDocument(e)
  if (!res) return false
  insertAtCursor(e, value, onChange, res.text, true)
  return res.kind
}

// Raw "file"/CSV artifact paste: a bare clipboard table → clean CSV so the AI
// reads it like a spreadsheet and the viewer can render it as a real table.
// A pasted *document* is not a spreadsheet — CSV-ing it would keep only its
// table and drop the prose, so it lands whole as text instead. Returns the kind
// it inserted, or false to let the default paste through.
export function handleCsvPaste(e, value, onChange) {
  const res = clipboardDocument(e)
  if (!res) return false
  if (res.kind === 'table') {
    const rows = clipboardRows(e)
    if (rows) { insertAtCursor(e, value, onChange, rowsToCsv(rows), false); return 'table' }
  }
  insertAtCursor(e, value, onChange, res.text, true)
  return res.kind
}

// --- delimited text → rows (for rendering a saved file artifact as a table) --

// Parse CSV or TSV text into rows, honoring quoted fields. Returns null when the
// text doesn't look like a consistent table (so callers fall back to raw view).
export function parseDelimited(text) {
  if (!text) return null
  const head = text.replace(/\r\n/g, '\n').split('\n').slice(0, 5)
  const commas = head.map((l) => countOutsideQuotes(l, ','))
  const tabs = head.map((l) => l.split('\t').length - 1)
  const hasTab = tabs.some((n) => n > 0)
  const hasComma = commas.some((n) => n > 0)
  // prefer the delimiter that actually segments the header row
  const delim = hasTab && (!hasComma || tabs[0] >= commas[0]) ? '\t' : hasComma ? ',' : null
  if (!delim) return null
  const rows = parseCsvLike(text, delim)
  if (!rows || rows.length < 2) return null
  const cols = rows[0].length
  if (cols < 2) return null
  // most rows should match the header's column count
  const consistent = rows.filter((r) => r.length === cols).length >= Math.ceil(rows.length * 0.6)
  return consistent ? rows : null
}

function countOutsideQuotes(line, ch) {
  let n = 0, inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQ = !inQ
    else if (c === ch && !inQ) n++
  }
  return n
}

function parseCsvLike(text, delim) {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows = []
  let row = [], field = '', inQ = false, i = 0
  while (i < s.length) {
    const ch = s[i]
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        inQ = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQ = true; i++; continue }
    if (ch === delim) { row.push(field); field = ''; i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop()
  return rows
}
