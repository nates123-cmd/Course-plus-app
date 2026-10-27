// calendarGhosts.js — hide calendar rows for meetings that moved or were
// canceled. placed_blocks rows with source='ical' come from Today's
// ical-ingest, which rewrites every live meeting on each feed run, so a row an
// earlier run left behind is a meeting that changed. ical-ingest sweeps those
// itself; this hides them until it does.
//   - Outlook cancels by renaming: "Canceled: X", "[External] Canceled: X".
//     Hide the canceled row and X on that day.
//   - Same title, same day, written more than a run apart: the meeting moved
//     within the day. Keep the newest. Two same-title meetings from one run
//     are both kept.
// Only ical rows; blocks placed by hand in Today are never hidden.
// Rows need { source, date, title, at } where `at` is updated_at in ms.

const RUN_GAP_MS = 10 * 60 * 1000
const stripTags = (s) => (s || '').replace(/^(?:\s*\[[^\]]*\])+\s*/, '').trim()
const canceledBase = (s) => { const m = stripTags(s).match(/^cancell?ed\s*:\s*(.*)$/i); return m ? m[1].trim().toLowerCase() : null }

export const rowWrittenAt = (r) => Date.parse(r.updated_at || r.created_at) || 0

export function dropGhosts(blocks) {
  const key = (b, title) => b.date + '|' + title
  const canceled = new Set()
  const newest = new Map()
  for (const b of blocks) {
    if (b.source !== 'ical') continue
    const base = canceledBase(b.title)
    if (base != null) { canceled.add(key(b, base)); continue }
    const k = key(b, stripTags(b.title).toLowerCase())
    newest.set(k, Math.max(newest.get(k) || 0, b.at))
  }
  return blocks.filter((b) => {
    if (b.source !== 'ical') return true
    if (canceledBase(b.title) != null) return false
    const k = key(b, stripTags(b.title).toLowerCase())
    return !canceled.has(k) && b.at >= newest.get(k) - RUN_GAP_MS
  })
}
