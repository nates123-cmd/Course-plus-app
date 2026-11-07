// The meetings a Scheduled task can be routed to: the Agenda's calendar blocks
// (`placed_blocks` where type='meeting', shared with Today) plus the meeting
// series. Shared by the Scheduled picker (TaskSheet) and the background router
// (lib/meetingRouter), so both see the same list and Claude gets the same hints.
//
// Reads four weeks back and five weeks ahead: a weekly or fortnightly meeting
// shows up as recurring (its title appears more than once), "next meeting with
// X" can find a 1:1 that isn't this week, and a meeting that just fell off the
// feed's horizon is still offered as "last held".
import { supabase } from './supabase'
import { normalizeTitle } from './seriesAgenda'

const pad = (n) => String(n).padStart(2, '0')
const isoOffset = (n) => { const t = new Date(); const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const startOf = (b) => { const [y, m, d] = b.date.split('-').map(Number); const hr = Math.floor(b.hour); return new Date(y, m - 1, d, hr, Math.round((b.hour - hr) * 60)) }

// `series` = active (non-archived) cp_series rows from DataContext.
export async function loadMeetingCatalog(series = []) {
  const { data, error } = await supabase.from('placed_blocks').select('id,title,date,hour').eq('type', 'meeting')
    .gte('date', isoOffset(-28)).lte('date', isoOffset(35)).order('date').order('hour')
  if (error) throw error
  const now = Date.now()
  const seen = new Set()
  const rows = (data || []).map((r) => ({ id: r.id, title: r.title || 'Meeting', date: r.date, hour: Number(r.hour) }))
    .filter((b) => !/^\s*(\[external\]\s*)?(canceled|cancelled)\b/i.test(b.title))
    .filter((b) => { const k = [b.date, b.hour, normalizeTitle(b.title)].join('|'); if (seen.has(k)) return false; seen.add(k); return true })
    .map((b) => ({ ...b, when: startOf(b).getTime() }))
  const blocks = rows.filter((b) => b.when > now) // upcoming — drop ones that already happened today
  // One entry per title: its next occurrence, and whether it repeats.
  const byTitle = new Map()
  for (const b of blocks) {
    const k = normalizeTitle(b.title)
    const cur = byTitle.get(k)
    if (!cur) byTitle.set(k, { ...b, count: 1 })
    else cur.count += 1
  }
  // Held recently: counts toward "repeats"; a title with no upcoming
  // occurrence is still offered, as "last <day>", for typed routing.
  const pastOnly = new Map()
  for (const b of rows) {
    if (b.when > now) continue
    const k = normalizeTitle(b.title)
    if (byTitle.has(k)) byTitle.get(k).count += 1
    else { const cur = pastOnly.get(k); if (!cur) pastOnly.set(k, { ...b, count: 1 }); else { cur.count += 1; if (b.when > cur.when) Object.assign(cur, { date: b.date, hour: b.hour, when: b.when }) } }
  }
  const seriesFor = (title) => series.find((s) => [s.name, ...(s.calendarTitles || [])].some((x) => normalizeTitle(x) === normalizeTitle(title)))
  const weekEnd = startOf({ date: isoOffset(6), hour: 23.99 }).getTime()
  const all = [...byTitle.values()].map((b) => { const s = seriesFor(b.title)
    return { id: b.id, title: b.title, date: b.date, hour: b.hour, when: b.when, recurring: b.count > 1 || !!s, people: s ? s.people : [] } })
  // Series with no occurrence in the window are still offered — "raise it at
  // the next Jon 1:1" shouldn't depend on the calendar feed's horizon.
  for (const s of series) if (s.name && !byTitle.has(normalizeTitle(s.name)) && !(s.calendarTitles || []).some((x) => byTitle.has(normalizeTitle(x))))
    all.push({ id: 's-' + s.id, title: s.name, when: null, recurring: true, people: s.people || [] })
  for (const [k, b] of pastOnly) if (!all.some((m) => normalizeTitle(m.title) === k)) { const s = seriesFor(b.title)
    all.push({ id: 'p-' + b.id, title: b.title, when: null, last: b.date, recurring: b.count > 1 || !!s, people: s ? s.people : [] }) }
  return {
    loaded: true, all,
    recurring: all.filter((m) => m.recurring && !m.last).sort((a, b) => (a.when ?? 9e15) - (b.when ?? 9e15)),
    week: blocks.filter((b) => b.when <= weekEnd && !all.find((m) => m.recurring && normalizeTitle(m.title) === normalizeTitle(b.title))),
  }
}

// ── Hints: how a meeting reads in the picker and in Claude's numbered list ──
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function blockHint(b) {
  const [y, m, d] = b.date.split('-').map(Number); const hr = Math.floor(b.hour), mm = pad(Math.round((b.hour - hr) * 60))
  const h12 = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr
  return `${WD[new Date(y, m - 1, d).getDay()]} · ${h12}:${mm}${hr < 12 ? 'a' : 'p'}`
}
const lastHint = (ymd) => { const [y, mo, d] = ymd.split('-').map(Number); return `last held ${WD[new Date(y, mo - 1, d).getDay()]} ${mo}/${d}` }
export function hintFor(m) { return m.last ? lastHint(m.last) : m.date ? (m.recurring ? 'recurring · next ' : '') + blockHint(m) : 'recurring' }
// What Claude sees per meeting: the hint plus the ISO date, so timing words land.
export const aiMeetingList = (all) => all.map((m) => ({ title: m.title, hint: hintFor(m) + (m.date && !m.last ? ` ${m.date}` : '') }))
