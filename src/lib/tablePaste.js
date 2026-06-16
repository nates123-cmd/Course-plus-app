// Turn a copied table (from Excel / Google Sheets / Word / a web page) into
// structured text — a GFM markdown table for rich editors, or CSV for raw "file"
// artifacts — instead of dumping tab-separated junk that doesn't read as a table
// and that the AI can't reliably parse.
//
// Clipboards expose two useful flavors when you copy a table:
//   - text/html  → an actual <table> element (Sheets, Word, web pages)
//   - text/plain → tab-separated rows (Excel, Sheets fallback)
// We prefer HTML (keeps cell structure even with line-wrapped cells), fall back
// to TSV.

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
  const cols = Math.max(...rows.map((r) => r.length))
  if (cols < 2) return null // single column isn't worth a table
  return rows.map((r) => {
    const c = r.slice()
    while (c.length < cols) c.push('')
    return c
  })
}

function parseHtmlTable(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (!table) return null
    const rows = Array.from(table.querySelectorAll('tr'))
      .map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((c) =>
          (c.textContent || '').replace(/\s+/g, ' ').trim()
        )
      )
      .filter((r) => r.length)
    return rows.length ? rows : null
  } catch {
    return null
  }
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

// Rich-editor paste: clipboard table → GFM markdown table. Returns true if it ran.
export function handleTablePaste(e, value, onChange) {
  const md = clipboardToMarkdownTable(e)
  if (md == null) return false
  insertAtCursor(e, value, onChange, md, true)
  return true
}

// Raw "file"/CSV artifact paste: clipboard table → clean CSV so the AI reads it
// like a spreadsheet and the viewer can render it as a real table. Returns true
// if it ran (otherwise let the default paste through).
export function handleCsvPaste(e, value, onChange) {
  const rows = clipboardRows(e)
  if (!rows) return false
  insertAtCursor(e, value, onChange, rowsToCsv(rows), false)
  return true
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
