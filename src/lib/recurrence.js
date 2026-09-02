// Recurring tasks — the rule shape, the date math, and the human label.
//
// A recurring task is not a special kind of row. It is an ordinary task that
// carries a `recurrence` rule; when it is completed, the next occurrence is
// created as a NEW task and the completed one stays in history. That keeps the
// Goals wins ledger honest (one completion = one win) and means any single
// occurrence can be moved, re-labelled, or stopped without touching the rest.
//
// Rule shape (cp_tasks.recurrence, jsonb):
//   { freq:     'daily' | 'weekly' | 'monthly' | 'yearly'
//     interval: 1,              // every N days/weeks/months/years
//     weekdays: [1,2,3,4,5],    // weekly only. 0 = Sunday. Empty = anchor's own weekday.
//     monthDay: 15 | 'last',    // monthly only. Absent = anchor's own day of month.
//     from:     'due' | 'completion',
//     until:    {y,m,d} | null, // stop after this date
//     count:    n | null }      // stop after n occurrences total
//
// Dates are the app's {y, m, d} shape throughout — m is 0-based, as in Date.

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly']
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── ymd helpers ────────────────────────────────────────────────────
export const toDate = (d) => (d && d.y != null ? new Date(d.y, d.m, d.d) : null)
export const fromDate = (dt) => ({ y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() })
export const ymdNum = (d) => (d && d.y != null ? d.y * 10000 + d.m * 100 + d.d : null)
export const sameYmd = (a, b) => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d
const addDays = (d, n) => fromDate(new Date(d.y, d.m, d.d + n))
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
export const todayYmd = () => fromDate(new Date())

// ── rule normalisation ─────────────────────────────────────────────
// Accepts a partial/legacy rule and returns a complete, valid one — or null if
// there is nothing usable in it. Every read path goes through this so a rule
// hand-written by Claude over MCP is as safe as one built by the sheet.
export function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null
  const freq = FREQS.includes(raw.freq) ? raw.freq : null
  if (!freq) return null
  const interval = Math.max(1, Math.min(365, Math.round(Number(raw.interval) || 1)))
  const rule = { freq, interval, from: raw.from === 'completion' ? 'completion' : 'due' }
  if (freq === 'weekly') {
    const wd = [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : [])
      .map((n) => Math.round(Number(n))).filter((n) => n >= 0 && n <= 6))].sort((a, b) => a - b)
    if (wd.length) rule.weekdays = wd
  }
  if (freq === 'monthly') {
    if (raw.monthDay === 'last') rule.monthDay = 'last'
    else if (raw.monthDay != null) {
      const md = Math.round(Number(raw.monthDay))
      if (md >= 1 && md <= 31) rule.monthDay = md
    }
  }
  const until = raw.until && raw.until.y != null
    ? { y: +raw.until.y, m: +raw.until.m, d: +raw.until.d } : null
  if (until) rule.until = until
  const count = raw.count != null && Number(raw.count) > 0 ? Math.round(Number(raw.count)) : null
  if (count) rule.count = count
  return rule
}

// ── the date math ──────────────────────────────────────────────────
// Next date strictly AFTER `anchor` that satisfies the rule. Returns {y,m,d}.
// `anchor` is the previous due date (from: 'due') or the completion date
// (from: 'completion') — the caller picks which, since only it knows both.
export function nextDate(rule, anchor) {
  const r = normalizeRule(rule)
  if (!r || !anchor || anchor.y == null) return null
  switch (r.freq) {
    case 'daily': return addDays(anchor, r.interval)
    case 'weekly': return nextWeekly(r, anchor)
    case 'monthly': return nextMonthly(r, anchor)
    case 'yearly': return nextYearly(r, anchor)
    default: return null
  }
}

// Weekly, honouring a weekday set. Within the anchor's own week, take the next
// listed weekday; if the week is exhausted, jump `interval` weeks to the start of
// that week and take the first listed day. (RRULE BYDAY + INTERVAL semantics.)
function nextWeekly(r, anchor) {
  const days = r.weekdays && r.weekdays.length ? r.weekdays : [toDate(anchor).getDay()]
  const dow = toDate(anchor).getDay()
  const later = days.find((d) => d > dow)
  if (later != null) return addDays(anchor, later - dow)
  const weekStart = addDays(anchor, -dow)                 // Sunday of the anchor's week
  return addDays(weekStart, r.interval * 7 + days[0])
}

// Monthly, clamped to the end of short months. The intended day of month lives
// in the RULE (not read back off the last occurrence), so a 31st that lands on
// Feb 28 does not permanently degrade the series to the 28th.
function nextMonthly(r, anchor) {
  const want = r.monthDay != null ? r.monthDay : anchor.d
  let y = anchor.y, m = anchor.m + r.interval
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12
  const d = want === 'last' ? daysInMonth(y, m) : Math.min(want, daysInMonth(y, m))
  return { y, m, d }
}

// Yearly. Feb 29 in a non-leap year clamps to Feb 28 for that year only — the
// anchor month/day is preserved in the series because we advance off the rule's
// original day, not the clamped one.
function nextYearly(r, anchor) {
  const y = anchor.y + r.interval
  return { y, m: anchor.m, d: Math.min(anchor.d, daysInMonth(y, anchor.m)) }
}

// ── series termination ─────────────────────────────────────────────
// Would the occurrence AFTER `index` (0-based) at `date` still be inside the
// series? False = the chain ends here and nothing more should be spawned.
export function withinSeries(rule, date, nextIndex) {
  const r = normalizeRule(rule)
  if (!r || !date) return false
  if (r.count != null && nextIndex >= r.count) return false
  if (r.until && ymdNum(date) > ymdNum(r.until)) return false
  return true
}

// The whole decision in one call: given a task that was just completed, what (if
// anything) is the next occurrence? Returns { dueDate, index } or null.
// `completedOn` defaults to today and only matters for from:'completion' rules.
export function nextOccurrence(task, completedOn) {
  const r = normalizeRule(task && task.recurrence)
  if (!r) return null
  if (task.recurSpawned) return null                 // already forked once — never twice
  const done = completedOn || todayYmd()
  // from:'due' repeats on a fixed calendar (the Friday report is due Fridays even
  // if you file it on Sunday). from:'completion' repeats off when you actually did
  // it (water the plants 10 days after the last watering, not 10 days after a date
  // you missed). A due-anchored task with no due date has no calendar to hold to,
  // so it falls back to the completion date.
  const anchor = r.from === 'completion' ? done : (task.dueDate || done)
  const date = nextDate(r, anchor)
  if (!date) return null
  // A due-anchored series left alone for months would otherwise spawn its next
  // occurrence in the past. Roll forward to the first date after the completion
  // day instead of burning through every missed one — you owe the chore once, not
  // twenty times. Strictly after: landing it on the day you just did it would
  // make the new task due the moment it appears.
  let d = date, guard = 0
  const todayN = ymdNum(done)
  while (r.from === 'due' && ymdNum(d) <= todayN && guard++ < 500) {
    const step = nextDate(r, d)
    if (!step || ymdNum(step) <= ymdNum(d)) break
    d = step
  }
  const index = (task.recurIndex || 0) + 1
  if (!withinSeries(r, d, index)) return null
  return { dueDate: d, index }
}

// ── human labels ───────────────────────────────────────────────────
const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
const listWords = (xs) => (xs.length < 3 ? xs.join(' & ') : xs.slice(0, -1).join(', ') + ' & ' + xs[xs.length - 1])

export function recurrenceLabel(rule) {
  const r = normalizeRule(rule)
  if (!r) return null
  const n = r.interval
  let s
  if (r.freq === 'daily') s = n === 1 ? 'Daily' : `Every ${n} days`
  else if (r.freq === 'weekly') {
    const wd = r.weekdays || []
    const weekdaysOnly = wd.length === 5 && wd.every((d) => d >= 1 && d <= 5)
    if (weekdaysOnly && n === 1) s = 'Every weekday'
    else if (!wd.length) s = n === 1 ? 'Weekly' : `Every ${n} weeks`
    else s = (n === 1 ? 'Weekly on ' : `Every ${n} weeks on `) + listWords(wd.map((d) => WD_SHORT[d]))
  } else if (r.freq === 'monthly') {
    const day = r.monthDay === 'last' ? 'the last day' : r.monthDay != null ? `the ${ord(r.monthDay)}` : null
    s = (n === 1 ? 'Monthly' : `Every ${n} months`) + (day ? ` on ${day}` : '')
  } else s = n === 1 ? 'Yearly' : `Every ${n} years`
  if (r.from === 'completion') s += ', after completion'
  if (r.count) s += ` · ${r.count}×`
  else if (r.until) s += ` · until ${r.until.m + 1}/${r.until.d}`
  return s
}

// ── presets for the task sheet ─────────────────────────────────────
// `weekdaysFrom` builds the rule against the task's current due date, so
// "Weekly" means "weekly on the day it is already due".
export const PRESETS = [
  { id: 'daily', label: 'Daily', build: () => ({ freq: 'daily', interval: 1, from: 'due' }) },
  { id: 'weekdays', label: 'Weekdays', build: () => ({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5], from: 'due' }) },
  { id: 'weekly', label: 'Weekly', build: (anchor) => ({ freq: 'weekly', interval: 1, weekdays: anchor ? [toDate(anchor).getDay()] : [], from: 'due' }) },
  { id: 'biweekly', label: 'Every 2 weeks', build: (anchor) => ({ freq: 'weekly', interval: 2, weekdays: anchor ? [toDate(anchor).getDay()] : [], from: 'due' }) },
  { id: 'monthly', label: 'Monthly', build: (anchor) => ({ freq: 'monthly', interval: 1, monthDay: anchor ? anchor.d : undefined, from: 'due' }) },
  { id: 'yearly', label: 'Yearly', build: () => ({ freq: 'yearly', interval: 1, from: 'due' }) },
]

// Which preset (if any) a stored rule corresponds to — so the sheet can light up
// the right chip instead of always falling through to "Custom".
export function matchPreset(rule, anchor) {
  const r = normalizeRule(rule)
  if (!r || r.until || r.count) return null // an end condition is always "Custom"
  const key = JSON.stringify(r)
  const hit = PRESETS.find((p) => JSON.stringify(normalizeRule(p.build(anchor))) === key)
  return hit ? hit.id : null
}
