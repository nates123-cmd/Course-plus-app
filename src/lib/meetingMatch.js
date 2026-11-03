// Scheduling a task for "the next meeting with Jon" — free text to meetings.
//
// A scheduled task's meeting_id normally holds one calendar title ("JS/NS 1:1").
// A PERSON link holds a name plus every meeting title it resolved to when it was
// set, e.g. "@Jon: JS/NS 1:1 | Arrow Staff Weekly". The task then shows up in
// the To-discuss list of whichever of those meetings comes first (the 1:1, the
// recurring one, or both), and a meeting whose title names the person matches
// too. The titles ride in the field itself so the link resolves the same on
// every device and reads plainly over MCP.
//
// Pure — no React, no Supabase.
import { normalizeTitle } from './seriesAgenda.js'

const PERSON = '@'

export function isPersonLink(meetingId) { return typeof meetingId === 'string' && meetingId.startsWith(PERSON) }

export function encodePersonLink(name, titles = []) {
  const uniq = [...new Set(titles.map((x) => (x || '').trim()).filter(Boolean))]
  return PERSON + name.trim() + (uniq.length ? ': ' + uniq.join(' | ') : '')
}

export function parsePersonLink(meetingId) {
  if (!isPersonLink(meetingId)) return null
  const body = meetingId.slice(1)
  const i = body.indexOf(':')
  // A title can itself contain ':' ("JS/NS 1:1"), so only the FIRST colon splits.
  const name = (i < 0 ? body : body.slice(0, i)).trim()
  const titles = i < 0 ? [] : body.slice(i + 1).split('|').map((x) => x.trim()).filter(Boolean)
  return { name, titles }
}

// What a scheduled task's chip reads.
export function meetingLabel(meetingId) {
  const p = parsePersonLink(meetingId)
  return p ? 'Next with ' + p.name : (meetingId || '')
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

// ── Who a meeting is with ────────────────────────────────────────────────────
// Only words in a person POSITION count, so "SGS CRM Daily Standup" or "Citrix
// Pricing" never read as people:
//   "Kim <> Nate Sync", "Connor/Nate", "Ed x Nate"   either side of a pair mark
//   "Therapy w Dr Kent", "Lunch with Sophie"          after w / with / Dr
//   "Jon 1 on 1", "Gabe Hangs", "Ed 1:1"              before a 1:1 word
// 2-3 letter all-caps tokens in those spots are initials ("JS/NS 1:1").
const PAIR = new Set(['<>', '<->', '/', 'x', '+', 'vs', '//'])
const AFTER = new Set(['w', 'w/', 'with', 'dr', 'dr.'])
const BEFORE = new Set(['1:1', '1on1', '1-on-1', 'hangs', 'hang', 'catchup', 'catch-up', 'coffee', 'lunch'])
const isName = (w) => /^[A-Z][a-z][A-Za-z'-]*$/.test(w)
const isInit = (w) => /^[A-Z]{2,3}$/.test(w)

export function peopleIn(title) {
  const raw = String(title || '').replace(/1 on 1/gi, '1on1')
  const tok = raw.match(/<->|<>|\/\/|\/|[A-Za-z][A-Za-z'.-]*\/?|\d:\d|\d+on\d+|\S/g) || []
  const names = new Set(), inits = new Set()
  const add = (w) => { if (!w) return; const c = w.replace(/[/.]$/, ''); if (isName(c)) names.add(c.toLowerCase()); else if (isInit(c)) inits.add(c.toLowerCase()) }
  for (let i = 0; i < tok.length; i++) {
    const w = tok[i], lw = w.toLowerCase()
    if (PAIR.has(lw)) { add(tok[i - 1]); add(tok[i + 1]) }
    else if (w.endsWith('/') && w.length > 1) { add(w); add(tok[i + 1]) } // "Connor/Nate" tokenises as "Connor/" "Nate"
    if (AFTER.has(lw)) { let j = i + 1; if (/^dr\.?$/i.test(tok[j] || '')) j++; add(tok[j]) }
    if (BEFORE.has(lw)) add(tok[i - 1])
  }
  return { names, inits }
}

// The app's owner shows up in most 1:1 titles ("Kim <> Nate", "Ed <> Nate",
// "JS/NS"). Whoever is a person in the most distinct titles (2+) is "me" — never
// a routing target, and my initial never counts as an initials match.
export function selfName(meetings = []) {
  const n = new Map()
  for (const m of meetings) for (const w of peopleIn(m.title).names) n.set(w, (n.get(w) || 0) + 1)
  let best = null, c = 1
  for (const [w, k] of n) if (k > c) { best = w; c = k }
  return best
}

// How strongly a meeting belongs to a person. 3 = named as a person in the
// title or the series' people, 2 = a person word starting with what was typed
// ("Har" -> Haritha), 1 = only an initials token with their initial (not mine).
export function personScore(name, meeting, self = null) {
  const n = (name || '').trim().toLowerCase()
  if (n.length < 2 || n === self) return 0
  const { names, inits } = peopleIn(meeting.title)
  const ppl = (meeting.people || []).flatMap(words)
  if (names.has(n) || ppl.includes(n)) return 3
  if (n.length >= 3 && [...names, ...ppl].some((w) => w.startsWith(n) && w !== self)) return 2
  if ([...inits].some((ini) => ini[0] === n[0] && !(self && ini[0] === self[0]))) return 1
  return 0
}

// Does a scheduled task's meeting_id belong in the meeting with this title?
export function linkMatchesTitle(meetingId, title) {
  const want = normalizeTitle(title)
  if (!want || !meetingId) return false
  const p = parsePersonLink(meetingId)
  if (!p) return normalizeTitle(meetingId) === want
  if (p.titles.some((x) => normalizeTitle(x) === want)) return true
  return words(title).includes(p.name.toLowerCase())
}

// Words that are never the person or the meeting in "ask Jon at the next meeting".
const STOP = new Set(('ask tell check raise bring discuss mention follow up with about at in on for the a an to of and ' +
  'next our my me i we meeting meetings sync call 1:1 1on1 one weekly week monthly recurring time w dr ' +
  'monday tuesday wednesday thursday friday saturday sunday today tomorrow this that re is it his her their them him').split(' '))

// Candidate person names in free text, most name-like first (capitalised words
// before lowercase ones — dictation doesn't always capitalise).
export function nameCandidates(text) {
  const raw = String(text || '').split(/[^A-Za-z'-]+/).filter(Boolean)
  const seen = new Set(), caps = [], rest = []
  for (const w of raw) {
    const k = w.toLowerCase().replace(/'s$/, '')
    if (k.length < 2 || STOP.has(k) || seen.has(k)) continue
    seen.add(k)
    ;(/^[A-Z]/.test(w) ? caps : rest).push(k.charAt(0).toUpperCase() + k.slice(1))
  }
  return [...caps, ...rest]
}

// ── Which meeting by its title ───────────────────────────────────────────────
// A typed word hits a title word by prefix ("retro" -> Retrospective) or, for
// 3+ letters, as an abbreviation sharing the first letter ("ops" -> operations).
// Abbreviations only kick in for a word with no prefix hit in ANY title, so
// "rev" stays on Revenue and doesn't also catch "retrospective".
const abbrevOf = (q, w) => {
  if (q.length < 3 || q[0] !== w[0] || w.length > q.length * 5) return false
  let i = 0
  for (const ch of w) if (ch === q[i]) i++
  return i === q.length
}
const ONE_ON_ONE = /\b1\s*(?::|on|-on-)\s*1\b/i

export function titleMatches(text, meetings, skip = []) {
  const drop = new Set(skip.map((s) => s.toLowerCase()))
  const qs = words(text).filter((q) => !STOP.has(q) && !drop.has(q) && !/^\d+$/.test(q))
  const want11 = ONE_ON_ONE.test(text) || /\b1on1\b/i.test(text)
  if (!qs.length && !want11) return []
  const need = qs.length + (want11 ? 1 : 0)
  const titleWords = meetings.map((m) => words(m.title))
  const prefixAnywhere = new Set(qs.filter((q) => titleWords.some((tw) => tw.some((w) => w.startsWith(q)))))
  const hits = (q, w) => w.startsWith(q) || (!prefixAnywhere.has(q) && abbrevOf(q, w))
  let out = []
  meetings.forEach((m, k) => {
    let hit = qs.filter((q) => titleWords[k].some((w) => hits(q, w))).length
    if (want11 && ONE_ON_ONE.test(m.title)) hit++
    if (hit && hit / need >= 0.5) out.push({ ...m, hit })
  })
  // A title that fits every word beats ones that fit some of them.
  if (need > 1 && out.some((m) => m.hit === need)) out = out.filter((m) => m.hit === need)
  return out.sort((a, b) => b.hit - a.hit || (b.recurring - a.recurring) || (a.when ?? 9e15) - (b.when ?? 9e15))
}

// Resolve free text against the known meetings. `meetings` are
// { title, when (ms|null), recurring, people } — upcoming calendar blocks,
// recurring calendar titles, recently held ones and series. Returns
//   { person: { name, meetings, weak } | null, matches: [meeting...] }
// `person` = the best person in the text with every meeting they're in
// (soonest first); `matches` = meetings whose TITLE fits the rest of the text.
export function resolveFreeText(text, meetings) {
  const self = selfName(meetings)
  let person = null, typed = null
  for (const name of nameCandidates(text)) {
    if (name.toLowerCase() === self) continue
    const hits = meetings.map((m) => ({ ...m, score: personScore(name, m, self) })).filter((m) => m.score > 0)
    if (!hits.length) continue
    // Named meetings win, but a calendar-less series ("Jon 1 on 1" made in-app)
    // must not hide the real calendar 1:1 that only carries initials ("JS/NS").
    const strong = hits.filter((h) => h.score >= 2)
    const strongOnCal = strong.some((h) => h.when != null)
    const pick = (strongOnCal ? strong : hits).sort((a, b) => (b.score >= 2) - (a.score >= 2) || (a.when ?? 9e15) - (b.when ?? 9e15))
    const resolvedName = strong.length && strong.every((h) => h.score === 2) ? fullName(name, strong[0], self) : name
    person = { name: resolvedName, meetings: pick, weak: pick.some((h) => h.score < 2) }
    typed = name
    break
  }
  const matches = titleMatches(text, meetings, person ? [person.name, typed] : [])
    .filter((m) => !person || !person.meetings.some((p) => p.id === m.id))
  return { person, matches }
}

// "Har" typed, "Haritha" in the title: label the link with the whole name.
function fullName(prefix, meeting, self) {
  const p = prefix.toLowerCase()
  const w = [...peopleIn(meeting.title).names, ...(meeting.people || []).flatMap(words)].find((x) => x.startsWith(p) && x !== self)
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : prefix
}
