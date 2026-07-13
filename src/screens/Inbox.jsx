// Inbox triage (Direction B) — each captured item carries an AI-suggested home.
// Accept files it into the suggested project as a real note (createNote), then
// drops it from the inbox (deleteInbox) and reloads. Assign opens a project
// picker to choose a different home. Leave keeps it untriaged. Multi-home
// suggestions file under the area home and record the route breakdown.
// No window.* — useApp() for theme/route/nav, useData() for the spine, db.js for writes.
import { useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import {
  Icon, Btn, Card, AreaDot, Tag, Popover, PopRow, MONTHS, TODAY,
  StatusPill, STATUS, statusSkin, holdDue, holdView, fmtDate,
} from '../kit'
import { createNote, deleteInbox, updateProject, createUpdate } from '../lib/db'
import { HoldSheet } from './HoldSheet'
import { ThinkItThrough } from '../components/ThinkItThrough'

// Today as the prototype's "Mon D, YYYY" string (e.g. "Jun 9, 2026").
const todayStr = () => `${MONTHS[TODAY.m]} ${TODAY.d}, ${TODAY.y}`

// Build the note payload an Accept/Assign produces. `pid` is the chosen project.
function noteFor(item, pid, areaId, snippet) {
  return {
    kind: 'note', title: item.title, project: pid, area: areaId || null,
    date: todayStr(), updated: 'now', status: 2, tags: item.tags || [],
    summary: snippet, body: [{ p: snippet }],
  }
}

// Project picker popover — flat list of every project, grouped visually by area dot.
function AssignPopover({ projects, onPick, onClose }) {
  return (
    <Popover onClose={onClose} width={240} maxHeight={300}>
      {projects.map((p) => (
        <PopRow key={p.id} dot={undefined} label={p.name} hint={p.areaName}
          onClick={() => onPick(p)} icon={undefined} />
      ))}
    </Popover>
  )
}

// ── Project nudges — derived "pending decisions" alerts. Two kinds, pooled into
// one card above the captures:
//   checkin — an on-hold project whose resurface date has arrived (the point of
//             the card: a hold is a promise to look again on a date, and this is
//             where that promise comes due)
//   stall   — an active project with no activity in 14+ days
// The ONE action on a row is a status change (StatusPill + picker, same control
// and semantics as the project page). The old fixed button trio per row
// (Archive / On hold / Keep active, Reactivate / +1 wk / Keep on hold) is gone —
// it hard-coded a few paths through a decision that is really just "what is this
// project's status now?", and couldn't reach Idea/Sent at all.
// Staleness is measured off `lastTouchAt` (DataContext) — the newest of ANY
// activity signal on the project: an update logged, a task added, a note
// written, an artifact produced. It used to read the update log (cp_updates)
// ALONE, which only gets a row from an explicit "log an update" / archive /
// hold action — never from doing the actual work. Result: projects Nate was
// working daily via tasks + meeting notes were nagging "No work logged in 33
// days". A project with no signal at all can't be aged, so it's left out (no
// false "archive this").
const STALL_DAYS = 14
const DECAY_DAYS = 60   // a hold this old has stopped being a plan
const DRIFT_PUSHES = 3  // pushed forward 3+ times = you are avoiding it
const MS_DAY = 86400000

function buildNudges(projects, lastTouchAt, isQuiet) {
  const out = []
  for (const p of projects) {
    if (isQuiet(p.id)) continue // consciously waved off — stay waved off
    if (p.status === 'on-hold') {
      const hv = holdView(p.hold)
      if (holdDue(p.hold)) {
        const when = hv?.resurfaceText ? `Hold ended ${hv.resurfaceText}` : 'Hold ended'
        out.push({ kind: 'checkin', proj: p, days: 0, text: hv?.reason ? `${when} — ${hv.reason}` : `${when}.` })
        continue
      }
      // Long-hold decay: a hold that keeps getting pushed quietly becomes a
      // graveyard. Designed in the old Course prototype, never built. Surface it
      // once it's been parked ~2 months so it has to be re-decided, not inherited.
      const setAt = hv?.setAt ? Date.parse(hv.setAt) : 0
      if (setAt) {
        const held = Math.floor((Date.now() - setAt) / MS_DAY)
        if (held >= DECAY_DAYS) {
          const months = Math.round(held / 30)
          out.push({ kind: 'decay', proj: p, days: held, text: `On hold ${months} month${months > 1 ? 's' : ''} — still real, or drop it?` })
        }
      }
    } else if (p.status === 'active') {
      // Drift beats staleness: a project you keep touching but whose one task you
      // keep pushing is stuck in a way "last activity" can never see.
      const drift = (p.tasks || []).filter((tk) => !tk.done && (tk.rescheduleCount || 0) >= DRIFT_PUSHES)
        .sort((a, b) => (b.rescheduleCount || 0) - (a.rescheduleCount || 0))[0]
      if (drift) {
        out.push({ kind: 'drift', proj: p, days: 0, drift,
          text: `Pushed "${drift.label}" ${drift.rescheduleCount} times.` })
        continue
      }
      const touched = lastTouchAt(p)
      if (!touched) continue
      const days = Math.floor((Date.now() - touched) / MS_DAY)
      if (days >= STALL_DAYS) out.push({ kind: 'stall', proj: p, days, text: `No activity in ${days} days.` })
    }
  }
  // Decisions you promised to make first (check-ins), then avoidance, then rot.
  const rank = { checkin: 0, drift: 1, decay: 2, stall: 3 }
  return out.sort((a, b) => (rank[a.kind] - rank[b.kind]) || ((b.days || 0) - (a.days || 0)))
}

function ProjectNudges() {
  const { t, f, go } = useApp()
  const { allProjects, reload, lastTouchAt, nudgeStates, snoozeNudge } = useData()
  const [busy, setBusy] = useState(null)
  const [dismissed, setDismissed] = useState(() => new Set()) // this-session only; the durable half is cp_nudge_states
  const [holdFor, setHoldFor] = useState(null) // project pending the on-hold popup
  const [pickFor, setPickFor] = useState(null) // project id whose status picker is open
  const [stuckFor, setStuckFor] = useState(null) // project id with Think-it-through open

  // A project is quiet if it was consciously waved off and the snooze hasn't
  // lapsed. This is the durable memory the old in-memory Set never had — a
  // dismiss used to die on reload, so the same nudge nagged forever.
  const isQuiet = (id) => {
    if (dismissed.has(id)) return true
    const st = nudgeStates.find((n) => n.project === id)
    return !!(st?.snoozedUntil && Date.parse(st.snoozedUntil) > Date.now())
  }

  const nudges = buildNudges(allProjects(), lastTouchAt, isQuiet)
  if (!nudges.length) return null

  // Run an action, hide the row immediately, then reload from the spine.
  const act = async (proj, fn) => {
    setBusy(proj.id)
    try {
      await fn()
      setDismissed((s) => new Set(s).add(proj.id))
      await reload()
    } finally { setBusy(null) }
  }

  // Putting on hold is a gated flow (same HoldSheet as the project page): collect
  // a reason + resurface date in the popup, THEN write status + hold together.
  // This doubles as "keep on hold" for a hold that just came due — same sheet,
  // prefilled with the old reason, asking for a fresh date.
  const commitHold = (p) => ({ reason, resurfaceOn, setAt }) => act(p, async () => {
    await updateProject(p.id, { status: 'on-hold', hold: { reason, resurfaceOn, setAt } })
    const held = p.status === 'on-hold'
    await createUpdate(p.id, `${held ? 'Still on hold' : 'On hold'} — ${reason}${resurfaceOn ? ` · resurface ${fmtDate(resurfaceOn)}` : ''}`)
  })

  // The other half of a due hold. Clears the hold payload so a stale reason/date
  // can't linger, and logs it — which counts as activity, so a just-reactivated
  // project doesn't immediately turn around and nag about being stale.
  const reactivate = (p) => act(p, async () => {
    await updateProject(p.id, { status: 'active', hold: null })
    await createUpdate(p.id, 'Reactivated from hold')
  })

  // The one action on a nudge row. Same semantics as the project page's picker:
  // on-hold is a gated flow (reason + resurface date via HoldSheet, never a bare
  // label flip), and leaving hold clears the hold payload so a stale reason/date
  // can't linger. Every flip is logged to the update feed so the decision is
  // auditable — and, now that lastTouchAt reads that feed, deciding counts as
  // activity and the project stops re-nagging.
  const setStatus = (p) => async (k) => {
    setPickFor(null)
    // On-hold ALWAYS goes through the sheet — including re-picking it on a project
    // that's already held. That's the "keep on hold" case, and it needs a new
    // resurface date; snoozing the row instead would leave the hold expired and
    // the project quietly rotting with no date to come back on.
    if (k === 'on-hold') { setHoldFor(p); return }
    // Re-affirming any other current status IS a decision ("leave it alone") —
    // snooze it for real rather than just hiding the row until the next reload.
    if (k === p.status) { setDismissed((s) => new Set(s).add(p.id)); snoozeNudge(p.id, 14); return }
    await act(p, async () => {
      await updateProject(p.id, p.hold ? { status: k, hold: null } : { status: k })
      await createUpdate(p.id, `Status → ${STATUS[k]?.label || k}`)
    })
  }

  return (
    <Card style={{ padding: '15px 18px', marginBottom: 20, border: '1px solid ' + t.riskLine, background: t.riskBg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon n="bell" s={15} c={t.risk} />
        <span style={{ fontFamily: f.label, fontSize: 11, fontWeight: 700, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.risk }}>
          Pending decisions · {nudges.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {nudges.map((n) => {
          const p = n.proj
          const open = pickFor === p.id
          const stuck = stuckFor === p.id
          return (
            <div key={p.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <span onClick={() => go({ screen: 'project', id: p.id })}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: f.body, fontSize: 14, fontWeight: 600, color: t.t1, cursor: 'pointer' }}>
                    <AreaDot areaId={p.area} s={7} />{p.name}
                  </span>
                  <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.text}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none', opacity: busy === p.id ? 0.5 : 1, pointerEvents: busy === p.id ? 'none' : 'auto' }}>
                  {/* A held project that came due gets the two answers its own question
                      admits: it's back, or it isn't yet. "Keep on hold" reopens the
                      HoldSheet for a fresh date rather than silently re-arming the old
                      one — a hold with no new date is just a project you've forgotten. */}
                  {p.status === 'on-hold' ? (
                    <>
                      <Btn kind="primary" size="sm" icon="player-play" onClick={() => reactivate(p)}>Reactivate</Btn>
                      <Btn kind="ghost" size="sm" icon="player-pause" onClick={() => setHoldFor(p)}>Keep on hold</Btn>
                    </>
                  ) : (
                    /* The other half of the decision: the pill answers "what is this?",
                       Stuck? answers "why isn't it moving?" and ends in a real write. */
                    <Btn kind="ghost" size="sm" icon="sparkles" onClick={() => setStuckFor(stuck ? null : p.id)}>Stuck?</Btn>
                  )}
                  <span style={{ position: 'relative' }}>
                    <StatusPill id={p.status} open={open} onClick={() => setPickFor(open ? null : p.id)} />
                    {open && (
                      <Popover onClose={() => setPickFor(null)} width={210}>
                        {Object.keys(STATUS).map((k) => (
                          <PopRow key={k} dot={statusSkin(t, k).dot} label={STATUS[k].label} hint={STATUS[k].hint}
                            on={p.status === k} onClick={() => setStatus(p)(k)} />
                        ))}
                      </Popover>
                    )}
                  </span>
                </div>
              </div>
              {stuck && (
                <ThinkItThrough project={p} idleDays={n.days || null}
                  onClose={() => setStuckFor(null)} onHold={(proj) => setHoldFor(proj)} />
              )}
            </div>
          )
        })}
      </div>
      {holdFor && <HoldSheet project={holdFor} onConfirm={commitHold(holdFor)} onClose={() => setHoldFor(null)} />}
    </Card>
  )
}

export function InboxScreen() {
  const { t, f } = useApp()
  const { inbox, allProjects, projectById, projectName, areaOfProject, reload } = useData()
  const projects = allProjects()
  const [busy, setBusy] = useState(null)      // id currently filing
  const [assignFor, setAssignFor] = useState(null) // id with picker open
  const [err, setErr] = useState(null)

  const live = inbox

  // File `item` into project `pid` as a note, then drop the inbox row + reload.
  // A null `pid` with `areaOverride` files at an area home (multi-home Accept).
  const file = async (item, pid, areaOverride) => {
    setBusy(item.id); setErr(null)
    try {
      const areaId = pid ? (areaOfProject(pid)?.id || null) : (areaOverride || null)
      await createNote(noteFor(item, pid, areaId, item.snippet || ''))
      await deleteInbox(item.id)
      await reload()
    } catch (e) {
      setErr(e); setBusy(null)
    }
    // On success the card disappears with the reload — stay on Inbox.
  }

  // Dismiss: drop the item from the inbox without filing it anywhere.
  const dismiss = async (item) => {
    setBusy(item.id); setErr(null)
    try {
      await deleteInbox(item.id)
      await reload()
    } catch (e) {
      setErr(e); setBusy(null)
    }
  }

  // Triage all: accept every item that has a confident single suggestion.
  const triageAll = async () => {
    const ready = live.filter((it) => it.suggest?.project)
    if (!ready.length) return
    setBusy('all'); setErr(null)
    try {
      for (const it of ready) {
        const pid = it.suggest.project
        const areaId = areaOfProject(pid)?.id || null
        await createNote(noteFor(it, pid, areaId, it.snippet || ''))
        await deleteInbox(it.id)
      }
      await reload()
    } catch (e) {
      setErr(e)
    }
    setBusy(null)
  }

  const hasConfident = live.some((it) => it.suggest?.project)

  return (
    <div data-screen-label="Inbox" style={{ maxWidth: 820, margin: '0 auto', padding: '40px 36px 90px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Inbox</div>
          <div style={{ fontFamily: f.ui, fontSize: 13.5, color: t.t2, marginTop: 5 }}>
            {live.length} untriaged · each has a suggested home.
          </div>
        </div>
        {hasConfident && (
          <Btn kind="outline" size="sm" icon="wand" onClick={triageAll}>
            {busy === 'all' ? 'Filing…' : 'Triage all'}
          </Btn>
        )}
      </div>

      {err && (
        <div style={{ fontFamily: f.ui, fontSize: 13, color: t.risk, marginTop: 16 }}>
          Couldn’t file it — {String(err?.message || err)}.
        </div>
      )}

      <div style={{ marginTop: 24 }}><ProjectNudges /></div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {live.map((it) => {
          const sp = it.suggest ? projectById(it.suggest.project) : null
          const m = it.suggestMulti
          const conf = it.suggest ? it.suggest.confidence : (m ? m.confidence : null)
          const loading = busy === it.id
          const assignOpen = assignFor === it.id

          return (
            <Card key={it.id} style={{ padding: '15px 17px' }}>
              {/* source row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon n={it.srcIcon} s={14} c={t.t3} />
                <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>{it.src}</span>
                <div style={{ flex: 1 }} />
                {conf != null && (
                  <span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 600, color: conf > 0.85 ? t.good : t.t2 }}>
                    {Math.round(conf * 100)}% match
                  </span>
                )}
              </div>

              <div style={{ fontFamily: f.title, fontSize: 16, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>{it.title}</div>
              <div style={{ fontFamily: f.body, fontSize: 13.5, color: t.t2, marginTop: 6, lineHeight: 1.55, textWrap: 'pretty' }}>{it.snippet}</div>

              {it.tags && it.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {it.tags.map((tg) => <Tag key={tg}>{tg}</Tag>)}
                </div>
              )}

              {/* suggestion + actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 13, paddingTop: 12, borderTop: '1px solid ' + t.line, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon n="sparkles" s={11} />Suggested
                </span>

                {sp && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 7, padding: '4px 10px' }}>
                    <AreaDot areaId={sp.area} s={6} />{sp.name}
                  </span>
                )}

                {m && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 7, padding: '4px 10px' }}>
                    <AreaDot areaId={m.home} s={6} />{m.homeLabel}
                    <span style={{ color: t.t3, fontWeight: 500 }}>
                      · splits to {m.routes.map((r) => `${projectName(r.project)} (${r.count})`).join(', ')}
                    </span>
                  </span>
                )}

                {!sp && !m && (
                  <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, fontStyle: 'italic' }}>
                    No confident project — assign one.
                  </span>
                )}

                <div style={{ flex: 1 }} />

                <div style={{ display: 'flex', gap: 7, position: 'relative' }}>
                  <Btn kind="ghost" size="sm" onClick={() => { /* Leave — keep untriaged */ }}>Leave</Btn>

                  {/* Dismiss — drop from the inbox without filing */}
                  <Btn kind="ghost" size="sm" icon={loading ? 'loader-2' : 'trash'} onClick={() => dismiss(it)}>
                    {loading ? 'Dismissing…' : 'Dismiss'}
                  </Btn>

                  {/* Assign — pick a different home */}
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <Btn kind="outline" size="sm" icon="folder" onClick={() => setAssignFor(assignOpen ? null : it.id)}>Assign</Btn>
                    {assignOpen && (
                      <AssignPopover
                        projects={projects}
                        onClose={() => setAssignFor(null)}
                        onPick={(p) => { setAssignFor(null); file(it, p.id) }}
                      />
                    )}
                  </span>

                  {/* Accept — file into the suggested home (multi → area home) */}
                  {(sp || m) && (
                    <Btn kind="primary" size="sm" icon={loading ? 'loader-2' : 'check'}
                      onClick={() => file(it, sp ? sp.id : null, m ? m.home : null)}>
                      {loading ? 'Filing…' : 'Accept'}
                    </Btn>
                  )}
                </div>
              </div>
            </Card>
          )
        })}

        {live.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: f.body, fontSize: 15, color: t.t3, fontStyle: 'italic' }}>
            Inbox zero. Nothing waiting to be triaged.
          </div>
        )}
      </div>
    </div>
  )
}
