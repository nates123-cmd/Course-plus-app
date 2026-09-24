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

// Initials tokens in a title: "JS/NS 1:1" -> ["js", "ns"]. Only short all-caps
// runs count, so ordinary words don't read as initials.
const initialsIn = (title) => (String(title || '').match(/\b[A-Z]{2,3}\b/g) || []).map((x) => x.toLowerCase())

// How strongly a meeting belongs to a person. 3 = named in the title or the
// series' people, 1 = only an initials token that starts with their initial.
export function personScore(name, meeting) {
  const n = (name || '').trim().toLowerCase()
  if (n.length < 2) return 0
  if (words(meeting.title).includes(n)) return 3
  if ((meeting.people || []).some((p) => words(p).includes(n))) return 3
  if (initialsIn(meeting.title).some((ini) => ini[0] === n[0])) return 1
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

// Words that are never the person in "ask Jon at the next meeting".
const STOP = new Set(('ask tell check raise bring discuss mention follow up with about at in on for the a an to of and ' +
  'next our my me i we meeting meetings sync call 1:1 1on1 one weekly week monthly recurring time ' +
  'monday tuesday wednesday thursday friday saturday sunday today tomorrow this that re').split(' '))

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

// Resolve free text against the known meetings. `meetings` are
// { title, when (ms|null), recurring, people } — upcoming calendar blocks,
// recurring calendar titles and series. Returns the best person with the
// meetings they're in (soonest first), or null.
export function resolveFreeText(text, meetings) {
  for (const name of nameCandidates(text)) {
    const hits = meetings.map((m) => ({ ...m, score: personScore(name, m) })).filter((m) => m.score > 0)
    if (!hits.length) continue
    // Prefer title/people hits; initials are a fallback only when nothing better exists.
    const best = Math.max(...hits.map((h) => h.score))
    const pick = hits.filter((h) => h.score === best)
      .sort((a, b) => (a.when ?? 9e15) - (b.when ?? 9e15))
    return { name, meetings: pick, weak: best < 3 }
  }
  return null
}
