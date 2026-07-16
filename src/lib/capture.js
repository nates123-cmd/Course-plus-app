// Pure helpers for the project Capture card: guess what a pasted/typed capture
// is, and turn its text into note blocks. Kept out of Project.jsx so they can be
// exercised without booting React or Supabase.
import { hasProseOutsideTables } from './tablePaste'

// Guess what a capture is — biased AWAY from meeting. The user almost never
// pastes a real transcript here, so 'transcript' needs a strong multi-speaker
// signal, and even then the confirm bar lets them override before it files.
// `pasteKind` is what the paste handler saw: 'table' (a bare table), 'doc' (a
// document that may contain tables), or null (typed / plain paste).
export function classifyCapture(text, pasteKind) {
  const s = (text || '').trim(); const lower = s.toLowerCase()
  // Only a *bare* table is a table. A document that merely contains one is still
  // an email/update/working doc — classify it on its prose.
  if (pasteKind === 'table') return 'table'
  if (!pasteKind && /(^|\n)\s*\|.*\|.*\|/.test(s) && !hasProseOutsideTables(s)) return 'table'
  if (/(^|\n)\s*(from|to|cc|subject|sent):\s/i.test(s) || /\bon .+ wrote:\s*$/im.test(s)) return 'email'
  const chatLines = (s.match(/(^|\n)[A-Z][\w .'-]{1,28}\s+\d{1,2}:\d{2}\b/g) || []).length
  if (chatLines >= 2) return 'teams'
  const speakerTurns = (s.match(/(^|\n)\s*[A-Z][\w .'-]{1,28}:\s/g) || []).length
  if (speakerTurns >= 4) return 'transcript'
  if (/\b(update|status|fyi|heads[- ]up|shipped|blocked|in progress|next steps?|eta)\b/i.test(lower) && s.split(/\s+/).length <= 90) return 'update'
  return pasteKind === 'doc' ? 'doc' : 'note'
}

// Turn capture text into note blocks, converting any GFM table region (a paste
// is normalized to markdown by handleTablePaste) into a { table: rows } block so
// it renders as a real table when the note is opened. Prose splits on blank
// lines and bullet/number runs become ul/ol — a pasted document keeps its shape
// rather than collapsing into one slab. Anything unrecognized stays as text: no
// line is ever dropped.
export function textToBlocks(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let para = [], tbl = [], list = null, listKind = null

  const flushPara = () => {
    // blank lines separate paragraphs
    let buf = []
    const emit = () => { const p = buf.join('\n').trim(); if (p) blocks.push({ p }); buf = [] }
    for (const l of para) { if (l.trim() === '') emit(); else buf.push(l) }
    emit(); para = []
  }
  const flushList = () => {
    if (list && list.length) blocks.push(listKind === 'ol' ? { ol: list } : { ul: list })
    list = null; listKind = null
  }
  const flushTbl = () => {
    if (tbl.length >= 2) {
      const rows = tbl
        .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/\\\|/g, '|').trim()))
        .filter((r, i) => !(i === 1 && r.every((c) => /^:?-{2,}:?$/.test(c)))) // drop |---| separator
      blocks.push({ table: rows })
    } else para.push(...tbl) // a lone |row| isn't a table — keep it as text
    tbl = []
  }
  const isTblRow = (l) => /^\s*\|.*\|\s*$/.test(l)
  const bullet = (l) => l.match(/^\s*[-*•]\s+(.*)$/)
  const number = (l) => l.match(/^\s*\d{1,3}[.)]\s+(.*)$/)

  for (const l of lines) {
    if (isTblRow(l)) { if (!tbl.length) { flushList(); flushPara() } tbl.push(l); continue }
    if (tbl.length) flushTbl()
    const b = bullet(l), n = b ? null : number(l)
    if (b || n) {
      const kind = b ? 'ul' : 'ol'
      if (listKind && listKind !== kind) flushList()
      if (!list) { flushPara(); list = []; listKind = kind }
      list.push((b || n)[1].trim())
      continue
    }
    if (list) { flushList(); if (l.trim() === '') continue } // a non-list line ends the run
    para.push(l)
  }
  flushTbl(); flushList(); flushPara()
  return blocks.length ? blocks : [{ p: String(text || '').trim() }]
}

// First meaningful line of a capture, as a note title. Strips markdown heading
// marks / bullets / table pipes so a pasted doc doesn't get titled "# Q3 plan".
export function captureTitle(text) {
  const line = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^[-|#*\s]*$/.test(l)) || ''
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^\|/, '')
    .replace(/\|.*$/, '')
    .replace(/\*\*/g, '')
    .trim()
    .slice(0, 60)
}
