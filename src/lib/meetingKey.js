// Which cp_notes row IS a given calendar meeting. A meeting is identified by
// its title and its calendar day — the same title next week is a different
// meeting, the same title later today is the same one. Pure, so the composer
// (RecorderContext) and the Agenda screen resolve identically.
import { normalizeTitle } from './seriesAgenda'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const dateLabel = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// "2026-09-17" -> "Sep 17, 2026" (the format cp_notes.date has always used)
export const labelFromIso = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return dateLabel(new Date())
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

// The note for this meeting, or null. An unfinished note wins over a finished
// one (that's the one you'd be resuming); otherwise the most recently touched.
export function findMeetingNote(notes = [], { title, dateIso } = {}) {
  const want = normalizeTitle(title || '')
  if (!want) return null
  const label = labelFromIso(dateIso || todayIso())
  const hits = notes.filter((n) => n && n.kind === 'meeting' && n.date === label && normalizeTitle(n.title) === want)
  if (!hits.length) return null
  const open = hits.filter((n) => n.incomplete)
  const pool = open.length ? open : hits
  return pool.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
}
