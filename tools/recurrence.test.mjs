// Recurrence engine tests.
//
// Runs the SAME assertions against both implementations:
//   src/lib/recurrence.js                     — the app + the local MCP server
//   supabase/functions/_shared/recurrence.ts  — the remote MCP edge function
// The second is a hand-kept port (an edge function is bundled from its own
// directory and cannot import out of src/), so any drift between them would give
// Claude a different answer than the app. That is exactly what this catches.
//
//   node tools/recurrence.test.mjs
//
// Needs a Node with native TypeScript type-stripping (22.6+ with
// --experimental-strip-types, on by default from 23) to import the .ts port.
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const js = await import(resolve(ROOT, 'src/lib/recurrence.js'))
const ts = await import(resolve(ROOT, 'supabase/functions/_shared/recurrence.ts'))

let pass = 0, fail = 0
const D = (str) => { const [y, m, d] = str.split('-').map(Number); return { y, m: m - 1, d } }
const s = (d) => (d ? `${d.y}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : String(d))

// Every assertion runs against BOTH implementations.
const eq = (name, fn, want) => {
  for (const [tag, mod] of [['js', js], ['ts', ts]]) {
    let got
    try { got = fn(mod) } catch (e) { got = 'threw: ' + e.message }
    if (got === want) pass++
    else { fail++; console.log(`FAIL [${tag}] ${name}\n  got  ${got}\n  want ${want}`) }
  }
}
const nd = (rule, anchor) => (m) => s(m.nextDate(rule, anchor))
// 'null' means the series ends here — distinct from a date, so don't let an
// optional-chain turn "no next occurrence" into the string 'undefined'.
const no = (task, on) => (m) => { const r = m.nextOccurrence(task, on); return r ? s(r.dueDate) : 'null' }
const lbl = (rule) => (m) => String(m.recurrenceLabel(rule))

// ── daily ──
eq('daily +1', nd({ freq: 'daily', interval: 1 }, D('2026-09-02')), '2026-09-03')
eq('daily +3 over month end', nd({ freq: 'daily', interval: 3 }, D('2026-09-30')), '2026-10-03')
eq('daily over year end', nd({ freq: 'daily', interval: 1 }, D('2026-12-31')), '2027-01-01')

// ── weekly (2026-09-02 is a Wednesday) ──
eq('weekly same weekday', nd({ freq: 'weekly', interval: 1, weekdays: [3] }, D('2026-09-02')), '2026-09-09')
eq('weekly no weekdays = anchor dow', nd({ freq: 'weekly', interval: 1 }, D('2026-09-02')), '2026-09-09')
eq('weekdays Wed->Thu', nd({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, D('2026-09-02')), '2026-09-03')
eq('weekdays Fri->Mon', nd({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, D('2026-09-04')), '2026-09-07')
eq('weekdays Sat->Mon', nd({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, D('2026-09-05')), '2026-09-07')
eq('weekdays Sun->Mon', nd({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, D('2026-09-06')), '2026-09-07')
eq('biweekly Wed', nd({ freq: 'weekly', interval: 2, weekdays: [3] }, D('2026-09-02')), '2026-09-16')
eq('Mon&Thu from Mon', nd({ freq: 'weekly', interval: 1, weekdays: [1, 4] }, D('2026-09-07')), '2026-09-10')
eq('Mon&Thu from Thu', nd({ freq: 'weekly', interval: 1, weekdays: [1, 4] }, D('2026-09-10')), '2026-09-14')
eq('2wk Mon&Thu from Thu', nd({ freq: 'weekly', interval: 2, weekdays: [1, 4] }, D('2026-09-10')), '2026-09-21')

// ── monthly ──
eq('monthly 15th', nd({ freq: 'monthly', interval: 1, monthDay: 15 }, D('2026-09-15')), '2026-10-15')
eq('monthly 31 clamps Feb', nd({ freq: 'monthly', interval: 1, monthDay: 31 }, D('2026-01-31')), '2026-02-28')
eq('monthly 31 recovers Mar', nd({ freq: 'monthly', interval: 1, monthDay: 31 }, D('2026-02-28')), '2026-03-31')
eq('monthly last day', nd({ freq: 'monthly', interval: 1, monthDay: 'last' }, D('2026-01-31')), '2026-02-28')
eq('monthly quarterly', nd({ freq: 'monthly', interval: 3, monthDay: 5 }, D('2026-11-05')), '2027-02-05')
eq('monthly no monthDay = anchor day', nd({ freq: 'monthly', interval: 1 }, D('2026-09-09')), '2026-10-09')

// ── yearly ──
eq('yearly', nd({ freq: 'yearly', interval: 1 }, D('2026-09-02')), '2027-09-02')
eq('yearly leap clamp', nd({ freq: 'yearly', interval: 1 }, D('2028-02-29')), '2029-02-28')

// ── anchors ──
const today = D('2026-09-02')
eq('from due uses dueDate',
  no({ recurrence: { freq: 'weekly', interval: 1, weekdays: [5], from: 'due' }, dueDate: D('2026-08-28') }, today), '2026-09-04')
eq('from completion uses today',
  no({ recurrence: { freq: 'daily', interval: 10, from: 'completion' }, dueDate: D('2026-08-01') }, today), '2026-09-12')
eq('from due with no dueDate falls back to completion',
  no({ recurrence: { freq: 'daily', interval: 7, from: 'due' } }, today), '2026-09-09')
eq('stale series rolls forward past today',
  no({ recurrence: { freq: 'weekly', interval: 1, weekdays: [3], from: 'due' }, dueDate: D('2026-01-07') }, today), '2026-09-09')
eq('next never lands on the completion day',
  no({ recurrence: { freq: 'daily', interval: 1, from: 'due' }, dueDate: D('2026-08-01') }, today), '2026-09-03')

// ── termination ──
eq('until stops it',
  no({ recurrence: { freq: 'daily', interval: 1, until: D('2026-09-02') }, dueDate: today }, today), 'null')
eq('until allows in-range',
  no({ recurrence: { freq: 'daily', interval: 1, until: D('2026-09-30') }, dueDate: today }, today), '2026-09-03')
eq('count stops at limit',
  no({ recurrence: { freq: 'daily', interval: 1, count: 3 }, dueDate: today, recurIndex: 2 }, today), 'null')
eq('count allows under limit',
  no({ recurrence: { freq: 'daily', interval: 1, count: 3 }, dueDate: today, recurIndex: 1 }, today), '2026-09-03')
eq('index increments',
  (m) => String(m.nextOccurrence({ recurrence: { freq: 'daily', interval: 1 }, dueDate: today, recurIndex: 4 }, today)?.index), '5')
eq('recurSpawned blocks a second fork',
  no({ recurrence: { freq: 'daily', interval: 1 }, dueDate: today, recurSpawned: true }, today), 'null')
eq('no rule = no occurrence', no({ dueDate: today }, today), 'null')
eq('garbage rule = no occurrence', no({ recurrence: { freq: 'fortnightly' }, dueDate: today }, today), 'null')

// ── normalisation ──
eq('normalize clamps interval', (m) => String(m.normalizeRule({ freq: 'daily', interval: 0 }).interval), '1')
eq('normalize caps interval', (m) => String(m.normalizeRule({ freq: 'daily', interval: 99999 }).interval), '365')
eq('normalize drops bad weekdays', (m) => JSON.stringify(m.normalizeRule({ freq: 'weekly', weekdays: [1, 9, 'x', 3, 1] }).weekdays), '[1,3]')
eq('normalize rejects bad freq', (m) => String(m.normalizeRule({ freq: 'hourly' })), 'null')
eq('normalize rejects null', (m) => String(m.normalizeRule(null)), 'null')
eq('normalize defaults from', (m) => m.normalizeRule({ freq: 'daily' }).from, 'due')
eq('normalize drops out-of-range monthDay', (m) => String(m.normalizeRule({ freq: 'monthly', monthDay: 40 }).monthDay), 'undefined')
// Field ORDER matters: matchPreset compares serialised rules, so the two
// implementations must build the object identically, not just equivalently.
eq('normalize key order', (m) => JSON.stringify(m.normalizeRule({ freq: 'weekly', interval: 2, weekdays: [1], count: 3, from: 'completion' })),
  '{"freq":"weekly","interval":2,"from":"completion","weekdays":[1],"count":3}')

// ── labels ──
eq('label daily', lbl({ freq: 'daily', interval: 1 }), 'Daily')
eq('label every 3 days', lbl({ freq: 'daily', interval: 3 }), 'Every 3 days')
eq('label weekdays', lbl({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }), 'Every weekday')
eq('label weekly on Wed', lbl({ freq: 'weekly', interval: 1, weekdays: [3] }), 'Weekly on Wed')
eq('label 2wk Mon&Thu', lbl({ freq: 'weekly', interval: 2, weekdays: [1, 4] }), 'Every 2 weeks on Mon & Thu')
eq('label 3 days list', lbl({ freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }), 'Weekly on Mon, Wed & Fri')
eq('label monthly 15', lbl({ freq: 'monthly', interval: 1, monthDay: 15 }), 'Monthly on the 15th')
eq('label monthly 1st', lbl({ freq: 'monthly', interval: 1, monthDay: 1 }), 'Monthly on the 1st')
eq('label monthly 22nd', lbl({ freq: 'monthly', interval: 1, monthDay: 22 }), 'Monthly on the 22nd')
eq('label monthly 3rd', lbl({ freq: 'monthly', interval: 1, monthDay: 3 }), 'Monthly on the 3rd')
eq('label monthly 11th', lbl({ freq: 'monthly', interval: 1, monthDay: 11 }), 'Monthly on the 11th')
eq('label monthly last', lbl({ freq: 'monthly', interval: 1, monthDay: 'last' }), 'Monthly on the last day')
eq('label quarterly', lbl({ freq: 'monthly', interval: 3, monthDay: 1 }), 'Every 3 months on the 1st')
eq('label yearly', lbl({ freq: 'yearly', interval: 1 }), 'Yearly')
eq('label completion anchor', lbl({ freq: 'daily', interval: 10, from: 'completion' }), 'Every 10 days, after completion')
eq('label count', lbl({ freq: 'daily', interval: 1, count: 5 }), 'Daily · 5×')
eq('label until', lbl({ freq: 'daily', interval: 1, until: D('2026-12-25') }), 'Daily · until 12/25')
eq('label null rule', lbl(null), 'null')

// ── presets (app-only: the edge function does not build presets) ──
const anchor = D('2026-09-02') // Wednesday
for (const p of js.PRESETS) {
  const got = js.matchPreset(p.build(anchor), anchor)
  if (got === p.id) pass++
  else { fail++; console.log(`FAIL [js] preset ${p.id} round-trips\n  got  ${got}\n  want ${p.id}`) }
}
const check = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL [js] ${name}\n  got  ${got}\n  want ${want}`) } }
check('preset weekly builds Wed', JSON.stringify(js.normalizeRule(js.PRESETS.find((p) => p.id === 'weekly').build(anchor)).weekdays), '[3]')
check('preset monthly takes anchor day', String(js.normalizeRule(js.PRESETS.find((p) => p.id === 'monthly').build(anchor)).monthDay), '2')
check('custom rule matches no preset', String(js.matchPreset({ freq: 'daily', interval: 9 }, anchor)), 'null')
check('rule with until is custom', String(js.matchPreset({ freq: 'daily', interval: 1, until: D('2026-12-01') }, anchor)), 'null')
check('rule with count is custom', String(js.matchPreset({ freq: 'daily', interval: 1, count: 4 }, anchor)), 'null')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
