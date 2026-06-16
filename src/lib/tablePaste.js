// Turn a copied table (from Excel / Google Sheets / Word / a web page) into a
// GFM markdown table so it renders as a real table via RichText (remark-gfm),
// instead of dumping tab-separated junk into the editor.
//
// Clipboards expose two useful flavors when you copy a table:
//   - text/html  → an actual <table> element (Sheets, Word, web pages)
//   - text/plain → tab-separated rows (Excel, Sheets fallback)
// We prefer HTML (keeps cell structure even with line-wrapped cells), fall back
// to TSV. Returns a markdown string, or null when the clipboard isn't tabular.

export function clipboardToMarkdownTable(e) {
  const cd = e.clipboardData || e.nativeEvent?.clipboardData
  if (!cd) return null
  let rows = null
  const html = cd.getData('text/html')
  if (html && /<table[\s>]/i.test(html)) rows = parseHtmlTable(html)
  if (!rows) rows = parseTsv(cd.getData('text/plain'))
  if (!rows || !rows.length) return null
  const cols = Math.max(...rows.map((r) => r.length))
  if (cols < 2) return null // single column isn't worth a table
  return rowsToMarkdown(rows, cols)
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

function rowsToMarkdown(rows, cols) {
  const esc = (s) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
  const pad = (r) => {
    const c = r.map(esc)
    while (c.length < cols) c.push('')
    return c
  }
  const line = (c) => `| ${c.join(' | ')} |`
  const header = pad(rows[0])
  const sep = Array(cols).fill('---')
  const body = rows.slice(1).map(pad)
  return [line(header), line(sep), ...body.map(line)].join('\n')
}

// Paste handler for a controlled textarea. value/onChange are the current state.
// Returns true if it converted+inserted a table (so caller knows it ran).
// Pads with blank lines so GFM parses the table as its own block.
export function handleTablePaste(e, value, onChange) {
  const md = clipboardToMarkdownTable(e)
  if (md == null) return false
  e.preventDefault()
  const el = e.target
  const start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? value.length
  const before = value.slice(0, start)
  const after = value.slice(end)
  const pre = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const post = after === '' ? '' : after.startsWith('\n') ? '' : '\n\n'
  onChange(before + pre + md + post + after)
  return true
}
