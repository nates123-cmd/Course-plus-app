// Note / Meeting viewer — Direction B. Reading column + Related rail, with an
// editable title/body, a Reference bookmark toggle (replaces the legacy
// "knowledge" kind), and a Claude action rail (overlay) whose actions call the
// live AI surfaces and write back through updateNote / createTask + reload.
import { Fragment, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import {
  Icon, Btn, IconBtn, Card, Label, Tag, Person, KindBadge, SynthPill, KIND, isReference,
} from '../kit'
import { updateNote, createTask } from '../lib/db'
import { blocksToText, textToBlocks } from '../lib/blocks'
import { summarizeNote, extractActions, suggestTags, rewriteNote } from '../lib/ai'

// Word count — for meetings, count the raw transcript (the body is just the
// scratch notes). Else legacy rawWords display string, else the body.
function wordCount(n) {
  if (n.transcript) {
    const w = n.transcript.split(/\s+/).filter(Boolean).length
    return w ? w.toLocaleString() : null
  }
  if (n.rawWords) return n.rawWords
  const text = blocksToText(n.body || [])
  const w = text.split(/\s+/).filter(Boolean).length
  return w ? w.toLocaleString() : null
}

// ── Body renderer ────────────────────────────────────────────────
function Body({ blocks }) {
  const { t, f, go } = useApp()
  const { noteByTitle } = useData()
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {(blocks || []).map((b, i) => {
      if (b.p) return <p key={i} style={{ margin: 0, fontFamily: f.body, fontSize: 16, lineHeight: 1.68, color: t.t1, textWrap: 'pretty' }}>{b.p}</p>
      if (b.ul) return <ul key={i} style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {b.ul.map((li, j) => <li key={j} style={{ display: 'flex', gap: 11, fontFamily: f.body, fontSize: 15.5, lineHeight: 1.55, color: t.t1 }}>
          <span style={{ width: 5, height: 5, borderRadius: 3, background: t.accent, flex: 'none', marginTop: 9 }} />
          <span style={{ flex: 1 }}>{li}</span></li>)}
      </ul>
      if (b.ol) return <ol key={i} style={{ margin: 0, paddingLeft: 0, listStyle: 'none', counterReset: 'ol', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {b.ol.map((li, j) => <li key={j} style={{ display: 'flex', gap: 11, fontFamily: f.body, fontSize: 15.5, lineHeight: 1.55, color: t.t1 }}>
          <span style={{ fontFamily: f.ui, fontWeight: 700, fontSize: 13, color: t.accent, flex: 'none', minWidth: 16, marginTop: 1 }}>{j + 1}.</span>
          <span style={{ flex: 1 }}>{li}</span></li>)}
      </ol>
      if (b.links) return <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {b.links.map((lk, j) => { const tgt = noteByTitle(lk)
          return <span key={j} onClick={() => tgt && go({ screen: 'note', id: tgt.id })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, color: t.accent,
              background: t.accentBg, border: '1px solid ' + t.accentLine, borderRadius: 8, padding: '5px 10px', cursor: tgt ? 'pointer' : 'default' }}>
            <Icon n="link" s={12} />{lk}</span> })}
      </div>
      return null
    })}
  </div>
}

// ── Reference bookmark toggle ────────────────────────────────────
function RefToggle({ note, onToggle, busy }) {
  const { t, f } = useApp()
  const on = isReference(note)
  return <span onClick={() => { if (!busy) onToggle(!on) }}
    title={on ? 'Reference — click to unmark' : 'Mark as reference'}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: busy ? 'default' : 'pointer', fontFamily: f.ui,
      fontSize: 11.5, fontWeight: 600, borderRadius: 7, padding: '3px 9px', color: on ? t.accent : t.t3,
      background: on ? t.accentBg : t.sel, border: '1px solid ' + (on ? t.accentLine : 'transparent'), opacity: busy ? 0.6 : 1 }}>
    <Icon n={busy ? 'loader-2' : 'bookmark'} s={13} />{on ? 'Reference' : 'Mark reference'}</span>
}

// ── Claude action rail (overlay panel) ───────────────────────────
function ClaudeRail({ note, onClose, onReload }) {
  const { t, f, go } = useApp()
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null) // { body } from Rewrite, awaiting apply

  const run = async (id, fn) => {
    if (busy) return
    setBusy(id); setMsg(null); setPreview(null)
    try {
      if (id === 'summarize') {
        const summary = await summarizeNote(note)
        await updateNote(note.id, { summary }); setMsg('Summary updated.')
      } else if (id === 'extract') {
        const fresh = await extractActions(note)
        const merged = [...(note.actions || []), ...fresh]
        await updateNote(note.id, { actions: merged }); setMsg(fresh.length + ' action item' + (fresh.length === 1 ? '' : 's') + ' added.')
      } else if (id === 'tags') {
        const suggested = await suggestTags(note)
        const merged = [...new Set([...(note.tags || []), ...suggested])]
        await updateNote(note.id, { tags: merged }); setMsg('Tags updated.')
      } else if (id === 'rewrite') {
        const md = await rewriteNote(note)
        setPreview({ md }); setBusy(null); return
      }
      await onReload()
    } catch (e) { setMsg('Failed — ' + String(e?.message || e)) }
    finally { setBusy(null) }
  }

  const applyRewrite = async () => {
    if (!preview) return
    setBusy('rewrite'); setMsg(null)
    try { await updateNote(note.id, { body: textToBlocks(preview.md) }); await onReload(); setPreview(null); setMsg('Body rewritten.') }
    catch (e) { setMsg('Failed — ' + String(e?.message || e)) }
    finally { setBusy(null) }
  }

  const acts = [
    ['summarize', 'list', 'Summarize', 'Tighten to a calm 2–3 sentences'],
    ['extract', 'checkbox', 'Extract action items', 'Pull concrete to-dos'],
    ['tags', 'tags', 'Suggest tags', 'Topic tags, merged in'],
    ['rewrite', 'pencil', 'Rewrite', 'Clearer, same meaning'],
  ]

  return <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 340, maxWidth: '92vw', zIndex: 320, background: t.panel,
    borderLeft: '1px solid ' + t.line, boxShadow: t.shadow, padding: 18, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <Icon n="sparkles" s={16} c={t.accent} />
      <span style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 600, color: t.t1 }}>Claude actions</span>
      <div style={{ flex: 1 }} /><IconBtn n="x" s={18} onClick={onClose} />
    </div>

    {msg && <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t2, background: t.accentBg, border: '1px solid ' + t.accentLine,
      borderRadius: 9, padding: '9px 11px', marginBottom: 12, lineHeight: 1.45 }}>{msg}</div>}

    {preview ? <div>
      <Label style={{ marginBottom: 8 }}>Rewrite preview</Label>
      <Card style={{ padding: '12px 14px', maxHeight: '46vh', overflowY: 'auto' }}>
        <div className="selectable" style={{ fontFamily: f.body, fontSize: 13.5, lineHeight: 1.6, color: t.t1, whiteSpace: 'pre-wrap' }}>{preview.md}</div>
      </Card>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Btn kind="primary" size="sm" icon={busy === 'rewrite' ? 'loader-2' : 'circle-check'} onClick={applyRewrite}>
          {busy === 'rewrite' ? 'Applying…' : 'Apply to body'}</Btn>
        <Btn kind="ghost" size="sm" onClick={() => setPreview(null)}>Discard</Btn>
      </div>
    </div> : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {acts.map(([id, icon, label, desc]) => { const on = busy === id
        return <div key={id} onClick={() => run(id, label)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 11,
            cursor: busy ? 'default' : 'pointer', background: t.card, border: '1px solid ' + t.line,
            opacity: busy && !on ? 0.55 : 1 }}
          onMouseEnter={(e) => { if (!busy) e.currentTarget.style.borderColor = t.accent }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.line }}>
          <Icon n={on ? 'loader-2' : icon} s={17} c={t.accent} />
          <div><div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>{label}</div>
            <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>{on ? 'Working…' : desc}</div></div></div> })}
      <div onClick={() => { onClose(); note.project ? go({ screen: 'project', id: note.project }) : go({ screen: 'library' }) }}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 11, cursor: 'pointer',
          background: t.card, border: '1px dashed ' + t.line2 }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = t.accent}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = t.line2}>
        <Icon n="file-export" s={17} c={t.t2} />
        <div><div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>Compose…</div>
          <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Open the project to compose a deliverable</div></div></div>
    </div>}
  </div>
}

// ════ NOTE / MEETING VIEWER ═════════════════════════════════════
export function NoteScreen() {
  const { t, f, go, route, isMobile } = useApp()
  const { noteById, noteByTitle, projectName, reload } = useData()
  const n = noteById(route.id)
  const [rawOpen, setRawOpen] = useState(false)
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [refBusy, setRefBusy] = useState(false)
  const [taskDone, setTaskDone] = useState({}) // action index -> true once filed
  const [taskBusy, setTaskBusy] = useState(null)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [eTitle, setETitle] = useState('')
  const [eBody, setEBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  if (!n) return <div style={{ padding: 40, fontFamily: f.body, color: t.t3 }}>Note not found.</div>

  const isMeeting = n.kind === 'meeting'
  const proj = n.project ? projectName(n.project) : null
  const words = wordCount(n)

  const toggleRef = async (next) => {
    setRefBusy(true)
    try { await updateNote(n.id, { reference: next }); await reload() }
    catch (e) { window.alert('Could not update: ' + (e?.message || e)) }
    finally { setRefBusy(false) }
  }

  const fileTask = async (a, i) => {
    if (!n.project || taskBusy != null || taskDone[i]) return
    setTaskBusy(i)
    try { await createTask(n.project, { label: a.text }); await reload(); setTaskDone((d) => ({ ...d, [i]: true })) }
    catch (e) { window.alert('Could not create task: ' + (e?.message || e)) }
    finally { setTaskBusy(null) }
  }

  const startEdit = () => { setETitle(n.title); setEBody(blocksToText(n.body || [])); setErr(null); setEditing(true) }
  const saveEdit = async () => {
    setSaving(true); setErr(null)
    try { await updateNote(n.id, { title: eTitle.trim() || 'Untitled', body: textToBlocks(eBody) }); await reload(); setEditing(false) }
    catch (e) { setErr(e) } finally { setSaving(false) }
  }

  const main = <div className="selectable">
    {/* breadcrumb */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: f.ui, fontSize: 12, color: t.t3, marginBottom: 14 }}>
      <span onClick={() => go(n.project ? { screen: 'project', id: n.project } : { screen: 'library' })}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
        <Icon n="chevron-left" s={15} />{proj || 'Library'}</span>
    </div>

    {/* kind / reference / synth / actions */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
      <KindBadge kind={n.kind} />
      <RefToggle note={n} onToggle={toggleRef} busy={refBusy} />
      {isMeeting && <SynthPill status={n.status} />}
      <div style={{ flex: 1 }} />
      {editing
        ? <span style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Btn>
            <Btn kind="primary" size="sm" icon={saving ? 'loader-2' : 'circle-check'} onClick={saveEdit}>{saving ? 'Saving…' : 'Save'}</Btn>
          </span>
        : <span style={{ display: 'flex', gap: 8 }}>
            <Btn kind="outline" size="sm" icon="pencil" onClick={startEdit}>Edit</Btn>
            <Btn kind="outline" size="sm" icon="sparkles" onClick={() => setRailOpen(true)}>Claude</Btn>
          </span>}
    </div>

    {/* title */}
    {editing
      ? <input value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="Untitled" className="selectable"
          style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontFamily: f.title, fontSize: 28,
            fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15, padding: 0 }} />
      : <h1 onClick={startEdit} title="Click to edit"
          style={{ margin: 0, fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing,
            color: t.t1, lineHeight: 1.15, textWrap: 'pretty', cursor: 'text' }}>{n.title}</h1>}

    {/* date / people / words */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>{n.date}</span>
      {(n.people || []).map((p) => <Person key={p} size="sm">{p}</Person>)}
      {words && <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3 }}>· {words} words</span>}
    </div>

    {/* meeting synthesis: summary + actions + terms */}
    {isMeeting && !editing && <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {n.summary && <Card style={{ padding: '16px 18px', background: t.accentBg, borderColor: t.accentLine }}>
        <Label style={{ color: t.accent, marginBottom: 10 }}>Summary</Label>
        {(() => {
          const ls = n.summary.split('\n').map((l) => l.trim()).filter(Boolean)
          const allB = ls.length > 0 && ls.every((l) => /^[-*]\s+/.test(l))
          return allB
            ? <ul className="selectable" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ls.map((l, i) => <li key={i} style={{ fontFamily: f.body, fontSize: 14.5, lineHeight: 1.5, color: t.t1 }}>{l.replace(/^[-*]\s+/, '')}</li>)}</ul>
            : <div className="selectable" style={{ fontFamily: f.body, fontSize: 15, lineHeight: 1.6, color: t.t1, textWrap: 'pretty' }}>{n.summary}</div>
        })()}
      </Card>}
      {(n.actions || []).length > 0 && <div>
        <Label style={{ marginBottom: 9 }}>Action items · {n.actions.length}</Label>
        <Card style={{ padding: '4px 0' }}>
          {n.actions.map((a, i) => <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 16px',
            borderTop: i ? '1px solid ' + t.line : 'none' }}>
            <span style={{ width: 16, height: 16, borderRadius: 5, border: '1.5px solid ' + t.t3, flex: 'none', marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1 }}>{a.text}</div>
              <div style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, marginTop: 3 }}>
                {a.owner}{a.src ? ' · from ' + a.src : ''}</div>
            </div>
            {n.project && (taskDone[i]
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11, fontWeight: 600,
                  color: t.good, whiteSpace: 'nowrap', marginTop: 1 }}><Icon n="check" s={13} />Filed</span>
              : <span onClick={() => fileTask(a, i)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11, fontWeight: 600,
                    color: t.t2, whiteSpace: 'nowrap', marginTop: 1, cursor: taskBusy != null ? 'default' : 'pointer', opacity: taskBusy != null && taskBusy !== i ? 0.5 : 1 }}>
                  <Icon n={taskBusy === i ? 'loader-2' : 'plus'} s={12} />To task</span>)}
          </div>)}
        </Card>
      </div>}
    </div>}

    {/* agenda / prep — collapsible */}
    {!editing && n.agenda && n.agenda.trim() && <div style={{ marginTop: 18 }}>
      <div onClick={() => setAgendaOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
        borderRadius: 10, cursor: 'pointer', background: t.panel, border: '1px solid ' + t.line, fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>
        <Icon n={agendaOpen ? 'chevron-down' : 'chevron-right'} s={14} />
        <Icon n="clipboard-list" s={14} c={t.t3} />Agenda · prep</div>
      {agendaOpen && <div className="selectable" style={{ padding: '14px 16px', fontFamily: f.body, fontSize: 14, lineHeight: 1.65, color: t.t2,
        background: t.panel, border: '1px solid ' + t.line, borderTop: 'none', borderRadius: '0 0 10px 10px', whiteSpace: 'pre-wrap' }}>{n.agenda}</div>}
    </div>}

    {/* body */}
    <div style={{ marginTop: 24 }}>
      {editing
        ? <>
            <Label style={{ marginBottom: 8 }}>Body</Label>
            <textarea value={eBody} onChange={(e) => setEBody(e.target.value)} className="selectable"
              placeholder="Write in markdown — paragraphs, - bullets, 1. numbered, [[note links]]. Blank line between blocks."
              style={{ width: '100%', minHeight: 300, border: '1px solid ' + t.line2, borderRadius: 11, padding: '14px 16px',
                outline: 0, background: t.card, resize: 'vertical', fontFamily: f.body, fontSize: 15, lineHeight: 1.7, color: t.t1 }} />
            {err && <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 10 }}>Couldn’t save — {String(err?.message || err)}.</div>}
          </>
        : <Body blocks={n.body} />}
    </div>

    {/* tags */}
    {!editing && (n.tags || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 26,
      paddingTop: 18, borderTop: '1px solid ' + t.line, alignItems: 'center' }}>
      <Label style={{ marginRight: 4 }}>Tags</Label>
      {n.tags.map((tg) => <span key={tg} onClick={() => go({ screen: 'library', tag: tg })} style={{ cursor: 'pointer' }}><Tag>{tg}</Tag></span>)}</div>}

    {/* raw transcript collapsible */}
    {!editing && n.transcript && <div style={{ marginTop: 22 }}>
      <div onClick={() => setRawOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
        borderRadius: 10, cursor: 'pointer', background: t.panel, border: '1px solid ' + t.line, fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>
        <Icon n={rawOpen ? 'chevron-down' : 'chevron-right'} s={14} />
        <Icon n="file-text" s={14} c={t.t3} />Raw transcript
        <span style={{ color: t.t3 }}>· {words ? words + ' words · ' : ''}source material</span></div>
      {rawOpen && <div className="selectable" style={{ padding: '14px 16px', fontFamily: f.meta, fontSize: 12.5, lineHeight: 1.7, color: t.t3,
        background: t.panel, border: '1px solid ' + t.line, borderTop: 'none', borderRadius: '0 0 10px 10px', whiteSpace: 'pre-wrap' }}>{n.transcript}</div>}
    </div>}
  </div>

  const rail = (n.related || []).length > 0 ? <div>
    <Label style={{ marginBottom: 11 }}>Related</Label>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {n.related.map((r, i) => { const tgt = noteByTitle(r.title)
        return <div key={i} onClick={() => tgt && go({ screen: 'note', id: tgt.id })} style={{ display: 'flex', alignItems: 'flex-start',
          gap: 9, padding: '9px 10px', borderRadius: 9, cursor: tgt ? 'pointer' : 'default' }}
          onMouseEnter={(e) => { if (tgt) e.currentTarget.style.background = t.sel }}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <Icon n={(KIND[r.kind] || KIND.note).icon} s={14} c={t.t3} style={{ marginTop: 2 }} />
          <div><div style={{ fontFamily: f.body, fontSize: 13, color: t.t1, lineHeight: 1.35 }}>{r.title}</div>
            <div style={{ fontFamily: f.ui, fontSize: 10.5, color: t.t3, marginTop: 1 }}>{r.reason}</div></div></div> })}
    </div>
  </div> : null

  return <div data-screen-label={'Note · ' + n.title} style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '24px 18px 80px' : '30px 36px 90px' }}>
    <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: rail ? 'minmax(0,1fr) 250px' : '1fr', gap: 40 }}>
      {main}{rail && <div style={{ marginTop: isMobile ? 28 : 56 }}>{rail}</div>}
    </div>
    {railOpen && <div onClick={() => setRailOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 310, background: 'rgba(0,0,0,0.35)' }}>
      <div onClick={(e) => e.stopPropagation()}><ClaudeRail note={n} onClose={() => setRailOpen(false)} onReload={reload} /></div></div>}
  </div>
}
