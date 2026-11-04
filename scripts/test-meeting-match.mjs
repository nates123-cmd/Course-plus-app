// Regression check for the Scheduled picker's typed routing (src/lib/meetingMatch.js).
// Titles are the shapes on the real calendar feed. Run: node scripts/test-meeting-match.mjs
import assert from 'node:assert/strict'
import { resolveFreeText, linkMatchesTitle, encodePersonLink, encodePending, isPendingLink, pendingText, meetingLabel } from '../src/lib/meetingMatch.js'

const titles = ['Citrix Discount Tiered Pricing - Working Session', 'Connor/Nate Housewarming', 'Ed <> Nate Weekly',
  'Flight 2 of 2 | DL0630 | SFO to JFK', 'Gabe Hangs', 'Global Citrix Team & Markets - Monthly Connect', 'Haritha <> Nate Bi-Weekly',
  'JS/NS 1:1', 'Monthly Revenue operations status call', 'SGS CRM Daily Standup Call', 'SGS CRM Global  - Sprint Retrospective',
  'SGS Projects - Global Tracking Weekly Call', 'SGS User Story Daily Sync', 'Status on CSP Named', 'Therapy w Dr Kent']
const all = titles.map((title, i) => ({ id: i, title, when: i, recurring: /Weekly|Daily|1:1|Monthly/.test(title), people: [] }))
all.push({ id: 's-1', title: 'Jon 1 on 1', when: null, recurring: true, people: [] })      // calendar-less series
all.push({ id: 'p-1', title: 'Kim <> Nate Quick Sync', when: null, last: '2026-10-29', people: [] }) // held recently

const r = (q) => resolveFreeText(q, all)
const titlesOf = (ms) => ms.map((m) => m.title)
let n = 0
const ok = (name, fn) => { fn(); n++; }

ok('Jon keeps the real calendar 1:1 next to the in-app series', () => {
  const { person } = r('ask Jon next meeting')
  assert.equal(person.name, 'Jon')
  assert.deepEqual(titlesOf(person.meetings).sort(), ['JS/NS 1:1', 'Jon 1 on 1'])
})
ok('pair names', () => { assert.deepEqual(titlesOf(r('bring up with ed').person.meetings), ['Ed <> Nate Weekly']) })
ok('recently held meeting is routable', () => { assert.deepEqual(titlesOf(r('Kim').person.meetings), ['Kim <> Nate Quick Sync']) })
ok('name prefix resolves to the full name', () => { assert.equal(r('Har').person.name, 'Haritha'); assert.equal(r('Har').matches.length, 0) })
ok('after w / Dr', () => { assert.equal(r('Kent').person.name, 'Kent') })
ok('title words are meetings, not people', () => {
  for (const q of ['SGS standup', 'Citrix pricing', 'therapy', 'standup']) assert.equal(r(q).person, null, q)
  assert.deepEqual(titlesOf(r('SGS standup').matches), ['SGS CRM Daily Standup Call'])
  assert.deepEqual(titlesOf(r('Citrix pricing').matches), ['Citrix Discount Tiered Pricing - Working Session'])
})
ok('abbreviations', () => {
  assert.deepEqual(titlesOf(r('rev ops').matches), ['Monthly Revenue operations status call'])
  assert.deepEqual(titlesOf(r('sprint retro').matches), ['SGS CRM Global  - Sprint Retrospective'])
})
ok('person and meeting in one sentence', () => {
  const x = r('Discuss telemetry with Jon at rev ops')
  assert.equal(x.person.name, 'Jon')
  assert.deepEqual(titlesOf(x.matches), ['Monthly Revenue operations status call'])
})
ok('the owner is never a person target, and their initials never match', () => {
  assert.equal(r('Nate').person, null)
  assert.equal(r('Nick').person, null) // NS in "JS/NS" is Nate
})
ok('airport codes are not initials', () => { assert.ok(!titlesOf(r('Jo').person?.meetings || []).some((t) => t.includes('JFK'))) })
ok('person links still match', () => {
  assert.ok(linkMatchesTitle(encodePersonLink('Jon', ['Jon 1 on 1', 'JS/NS 1:1']), 'JS/NS 1:1'))
  assert.ok(linkMatchesTitle('@Jon', 'Lunch with Jon'))
  assert.ok(!linkMatchesTitle('@Jon', 'Jonathan <> Nate'))
})
ok('Agathe-Nate 1:1 resolves for "next Agathe 1 on 1"', () => {
  const x = resolveFreeText('next Agathe 1 on 1', [...all, { id: 'a', title: 'Agathe-Nate 1:1', when: 99, recurring: true, people: [] }])
  assert.equal(x.person?.name, 'Agathe')
  assert.deepEqual(titlesOf(x.person.meetings), ['Agathe-Nate 1:1'])
  assert.equal(x.person.weak, false)
})
ok('pending links round-trip, label, and wait for a fitting title', () => {
  const p = encodePending('  next Agathe   1 on 1 ')
  assert.ok(isPendingLink(p))
  assert.equal(pendingText(p), 'next Agathe 1 on 1')
  assert.equal(meetingLabel(p), 'Finding: next Agathe 1 on 1')
  assert.ok(linkMatchesTitle(p, 'Agathe-Nate 1:1'))
  assert.ok(linkMatchesTitle(p, 'Nate/Agathe 1:1'))
  assert.ok(!linkMatchesTitle(p, 'JS/NS 1:1'))
  assert.ok(!linkMatchesTitle(encodePending('next 1 on 1'), 'JS/NS 1:1')) // nothing meaningful typed: never matches
  assert.ok(linkMatchesTitle(encodePending('the pricing working session'), 'Citrix Discount Tiered Pricing - Working Session'))
})
console.log(`meetingMatch: ${n} checks passed`)
