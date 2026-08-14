// Hindrance detection — the derived "this is stuck" signals.
//
// Lifted verbatim out of screens/Inbox.jsx so the Goals screen can report the
// same thing the Inbox nags about. Two readers, one definition of stuck: if the
// Inbox says a project has drifted, the goal it feeds says so too, with the same
// thresholds and the same wording.
//
// Four kinds:
//   checkin — an on-hold project whose resurface date has arrived (a hold is a
//             promise to look again on a date, and this is that promise coming due)
//   drift   — an open task pushed forward 3+ times. Beats staleness: a project
//             you keep touching but whose one task you keep pushing is stuck in a
//             way "last activity" can never see.
//   decay   — a hold parked ~2 months. It has stopped being a plan and has to be
//             re-decided rather than inherited.
//   stall   — an active project with no activity in 14+ days.
//
// Staleness is measured off `lastTouchAt` (DataContext) — the newest of ANY
// activity signal on the project: an update logged, a task added, a note
// written, an artifact produced. A project with no signal at all can't be aged,
// so it's left out (no false "archive this").
import { holdDue, holdView } from '../kit'

export const STALL_DAYS = 14
export const DECAY_DAYS = 60   // a hold this old has stopped being a plan
export const DRIFT_PUSHES = 3  // pushed forward 3+ times = you are avoiding it
export const MS_DAY = 86400000

// Decisions you promised to make first (check-ins), then avoidance, then rot.
const RANK = { checkin: 0, drift: 1, decay: 2, stall: 3 }

// One project in, at most one nudge out (or null). Exported on its own so the
// Goals screen can ask about a single project without filtering a whole list.
export function nudgeFor(p) {
  if (!p) return null
  if (p.status === 'on-hold') {
    const hv = holdView(p.hold)
    if (holdDue(p.hold)) {
      const when = hv?.resurfaceText ? `Hold ended ${hv.resurfaceText}` : 'Hold ended'
      return { kind: 'checkin', proj: p, days: 0, text: hv?.reason ? `${when} — ${hv.reason}` : `${when}.` }
    }
    const setAt = hv?.setAt ? Date.parse(hv.setAt) : 0
    if (setAt) {
      const held = Math.floor((Date.now() - setAt) / MS_DAY)
      if (held >= DECAY_DAYS) {
        const months = Math.round(held / 30)
        return { kind: 'decay', proj: p, days: held, text: `On hold ${months} month${months > 1 ? 's' : ''} — still real, or drop it?` }
      }
    }
    // Parked but not yet due and not yet decayed — still a live plan, say so.
    return hv?.reason
      ? { kind: 'waiting', proj: p, days: 0, text: `On hold — ${hv.reason}` }
      : { kind: 'waiting', proj: p, days: 0, text: 'On hold.' }
  }
  if (p.status !== 'active') return null
  const drift = (p.tasks || []).filter((tk) => !tk.done && (tk.rescheduleCount || 0) >= DRIFT_PUSHES)
    .sort((a, b) => (b.rescheduleCount || 0) - (a.rescheduleCount || 0))[0]
  if (drift) {
    return { kind: 'drift', proj: p, days: 0, drift, text: `Pushed “${drift.label}” ${drift.rescheduleCount} times.` }
  }
  return null
}

// The Inbox's list form. `isQuiet(id)` waves off a snoozed project; `lastTouchAt`
// comes from DataContext. Only the four nagging kinds — 'waiting' is a Goals-only
// status line, not a pending decision, so it never reaches the Inbox.
export function buildNudges(projects, lastTouchAt, isQuiet) {
  const out = []
  for (const p of projects) {
    if (isQuiet(p.id)) continue // consciously waved off — stay waved off
    const n = nudgeFor(p)
    if (n && n.kind !== 'waiting') { out.push(n); continue }
    if (n) continue // on-hold but healthy — nothing pending
    if (p.status !== 'active') continue
    const touched = lastTouchAt(p)
    if (!touched) continue
    const days = Math.floor((Date.now() - touched) / MS_DAY)
    if (days >= STALL_DAYS) out.push({ kind: 'stall', proj: p, days, text: `No activity in ${days} days.` })
  }
  return out.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || ((b.days || 0) - (a.days || 0)))
}

// Every hindrance on one project, for the Goals screen: the project-level nudge
// (or staleness) plus each task that is explicitly blocked on someone.
export function hindrancesFor(p, lastTouchAt) {
  const out = []
  const n = nudgeFor(p)
  if (n) out.push({ ...n, project: p.id, projectName: p.name })
  else if (p.status === 'active') {
    const touched = lastTouchAt ? lastTouchAt(p) : 0
    if (touched) {
      const days = Math.floor((Date.now() - touched) / MS_DAY)
      if (days >= STALL_DAYS) out.push({ kind: 'stall', proj: p, days, project: p.id, projectName: p.name, text: `No activity in ${days} days.` })
    }
  }
  for (const tk of p.tasks || []) {
    if (tk.done) continue
    const who = tk.waiting || (tk.taskStatus === 'waiting' ? '' : null)
    if (who == null) continue
    out.push({
      kind: 'blocked', proj: p, days: 0, project: p.id, projectName: p.name, task: tk.id,
      text: who ? `“${tk.label}” — waiting on ${who}` : `“${tk.label}” — waiting.`,
    })
  }
  return out
}
