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
} from '../kit'
import { createNote, deleteInbox } from '../lib/db'

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
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
