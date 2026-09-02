// Recurrence math for the remote MCP edge function.
//
// ⚠ This is a PORT of src/lib/recurrence.js, kept byte-for-byte equivalent in
// behaviour. It exists because a Supabase edge function is bundled from its own
// directory and cannot reliably reach up into src/. The Node MCP server
// (mcp/lib/data.js) imports the original directly — only this file is a copy.
//
// tools/recurrence.test.mjs runs the SAME assertions against both, so any drift
// between the two fails the test rather than quietly giving Claude a different
// answer than the app. Change one, change the other, run that test.
//
// See src/lib/recurrence.js for the rule shape and the reasoning.

export type Ymd = { y: number; m: number; d: number }
export type Rule = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  weekdays?: number[]
  monthDay?: number | 'last'
  from: 'due' | 'completion'
  until?: Ymd | null
  count?: number | null
}

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly']
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const toDate = (d: Ymd) => new Date(d.y, d.m, d.d)
const fromDate = (dt: Date): Ymd => ({ y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() })
export const ymdNum = (d: Ymd | null | undefined) => (d && d.y != null ? d.y * 10000 + d.m * 100 + d.d : null)
const addDays = (d: Ymd, n: number) => fromDate(new Date(d.y, d.m, d.d + n))
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
export const todayYmd = () => fromDate(new Date())

export function normalizeRule(raw: any): Rule | null {
  if (!raw || typeof raw !== 'object') return null
  const freq = FREQS.includes(raw.freq) ? raw.freq : null
  if (!freq) return null
  const interval = Math.max(1, Math.min(365, Math.round(Number(raw.interval) || 1)))
  const rule: any = { freq, interval, from: raw.from === 'completion' ? 'completion' : 'due' }
  if (freq === 'weekly') {
    const wd = [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : [])
      .map((n: any) => Math.round(Number(n))).filter((n: number) => n >= 0 && n <= 6))].sort((a: any, b: any) => a - b)
    if (wd.length) rule.weekdays = wd
  }
  if (freq === 'monthly') {
    if (raw.monthDay === 'last') rule.monthDay = 'last'
    else if (raw.monthDay != null) {
      const md = Math.round(Number(raw.monthDay))
      if (md >= 1 && md <= 31) rule.monthDay = md
    }
  }
  const until = raw.until && raw.until.y != null ? { y: +raw.until.y, m: +raw.until.m, d: +raw.until.d } : null
  if (until) rule.until = until
  const count = raw.count != null && Number(raw.count) > 0 ? Math.round(Number(raw.count)) : null
  if (count) rule.count = count
  return rule as Rule
}

export function nextDate(rule: any, anchor: Ymd | null | undefined): Ymd | null {
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

function nextWeekly(r: Rule, anchor: Ymd): Ymd {
  const days = r.weekdays && r.weekdays.length ? r.weekdays : [toDate(anchor).getDay()]
  const dow = toDate(anchor).getDay()
  const later = days.find((d) => d > dow)
  if (later != null) return addDays(anchor, later - dow)
  const weekStart = addDays(anchor, -dow)
  return addDays(weekStart, r.interval * 7 + days[0])
}

function nextMonthly(r: Rule, anchor: Ymd): Ymd {
  const want = r.monthDay != null ? r.monthDay : anchor.d
  let y = anchor.y, m = anchor.m + r.interval
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12
  const d = want === 'last' ? daysInMonth(y, m) : Math.min(want as number, daysInMonth(y, m))
  return { y, m, d }
}

function nextYearly(r: Rule, anchor: Ymd): Ymd {
  const y = anchor.y + r.interval
  return { y, m: anchor.m, d: Math.min(anchor.d, daysInMonth(y, anchor.m)) }
}

export function withinSeries(rule: any, date: Ymd | null, nextIndex: number): boolean {
  const r = normalizeRule(rule)
  if (!r || !date) return false
  if (r.count != null && nextIndex >= r.count) return false
  if (r.until && (ymdNum(date) as number) > (ymdNum(r.until) as number)) return false
  return true
}

export function nextOccurrence(task: any, completedOn?: Ymd | null): { dueDate: Ymd; index: number } | null {
  const r = normalizeRule(task && task.recurrence)
  if (!r) return null
  if (task.recurSpawned) return null
  const done = completedOn || todayYmd()
  const anchor = r.from === 'completion' ? done : (task.dueDate || done)
  const date = nextDate(r, anchor)
  if (!date) return null
  let d = date, guard = 0
  const todayN = ymdNum(done) as number
  while (r.from === 'due' && (ymdNum(d) as number) <= todayN && guard++ < 500) {
    const step = nextDate(r, d)
    if (!step || (ymdNum(step) as number) <= (ymdNum(d) as number)) break
    d = step
  }
  const index = (task.recurIndex || 0) + 1
  if (!withinSeries(r, d, index)) return null
  return { dueDate: d, index }
}

const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
const listWords = (xs: string[]) => (xs.length < 3 ? xs.join(' & ') : xs.slice(0, -1).join(', ') + ' & ' + xs[xs.length - 1])

export function recurrenceLabel(rule: any): string | null {
  const r = normalizeRule(rule)
  if (!r) return null
  const n = r.interval
  let s: string
  if (r.freq === 'daily') s = n === 1 ? 'Daily' : `Every ${n} days`
  else if (r.freq === 'weekly') {
    const wd = r.weekdays || []
    const weekdaysOnly = wd.length === 5 && wd.every((d) => d >= 1 && d <= 5)
    if (weekdaysOnly && n === 1) s = 'Every weekday'
    else if (!wd.length) s = n === 1 ? 'Weekly' : `Every ${n} weeks`
    else s = (n === 1 ? 'Weekly on ' : `Every ${n} weeks on `) + listWords(wd.map((d) => WD_SHORT[d]))
  } else if (r.freq === 'monthly') {
    const day = r.monthDay === 'last' ? 'the last day' : r.monthDay != null ? `the ${ord(r.monthDay as number)}` : null
    s = (n === 1 ? 'Monthly' : `Every ${n} months`) + (day ? ` on ${day}` : '')
  } else s = n === 1 ? 'Yearly' : `Every ${n} years`
  if (r.from === 'completion') s += ', after completion'
  if (r.count) s += ` · ${r.count}×`
  else if (r.until) s += ` · until ${r.until.m + 1}/${r.until.d}`
  return s
}
