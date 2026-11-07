// Background routing for Scheduled tasks: turns what was typed ("next Agathe
// 1 on 1") into a meeting link without the picker having to stay open.
//
// The flow: the picker saves a PENDING link ("?next Agathe 1 on 1", see
// lib/meetingMatch) the moment you press Enter or close it, then DataContext
// calls resolveMeetingText() here. If Claude (or a strong local match) finds
// the meeting, the task's link becomes a person link or a title. If nothing on
// the calendar fits yet, the pending link stays, and DataContext retries it on
// later app loads, so a 1:1 that isn't on the agenda yet gets linked once it is.
import { routeToMeeting } from './ai'
import { aiMeetingList } from './meetingCatalog'
import { resolveFreeText, encodePersonLink } from './meetingMatch'
import { normalizeTitle } from './seriesAgenda'

// Claude names the person; which meetings they're in is checked locally, so a
// padded list gets trimmed and an initials-only calendar 1:1 is never missed.
// Returns { person, meetings } (meetings = catalog entries, best first).
export function aiPick(result, all) {
  const byTitle = (title) => all.find((m) => normalizeTitle(m.title) === normalizeTitle(title))
  const raw = (result?.titles || []).map(byTitle).filter(Boolean)
  const person = result?.person && raw.length ? result.person : null
  if (!person) return { person: null, meetings: raw }
  const theirs = resolveFreeText(person, all).person?.meetings || []
  if (!theirs.length) return { person, meetings: raw.slice(0, 3) }
  const ids = new Set(theirs.map((m) => m.id))
  return { person, meetings: [...raw.filter((m) => ids.has(m.id)), ...theirs.filter((m) => !raw.some((a) => a.id === m.id))] }
}

// The meeting_id a pick turns into.
export const linkFor = ({ person, meetings }) =>
  person ? encodePersonLink(person, meetings.map((m) => m.title)) : meetings.length ? meetings[0].title : null

// text + task -> a meeting_id, or null when nothing on the calendar fits yet.
// Claude first; if it errors or finds nothing, a STRONG local person match
// (their name in a person position in a title) is still trusted.
export async function resolveMeetingText({ text, task = {}, projectName = '', catalog }) {
  const all = catalog?.all || []
  if (!all.length || !String(text || '').trim()) return null
  let picked = null
  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    const result = await routeToMeeting(text, aiMeetingList(all),
      { taskLabel: task.label || '', taskNotes: task.notes || '', waiting: task.waiting || '', projectName, today })
    if (result) { const p = aiPick(result, all); if (p.meetings.length) picked = p }
  } catch (e) {
    console.warn('[course+] background routeToMeeting', e)
  }
  if (!picked) {
    const { person } = resolveFreeText(text, all)
    if (person && !person.weak && person.meetings.length) picked = { person: person.name, meetings: person.meetings }
  }
  return picked ? linkFor(picked) : null
}
