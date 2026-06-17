// Note / Meeting viewer — Direction B. Reading column + Related rail, with an
// editable title/body, a Reference bookmark toggle (replaces the legacy
// "knowledge" kind), and a Claude action rail (overlay) whose actions call the
// live AI surfaces and write back through updateNote / createTask + reload.
import { Fragment, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import {
  Icon, Btn, IconBtn, Card, Label, Tag, Person, KindBadge, SynthPill, KIND, isReference, inlineMd,
} from '../kit'
import { updateNote, createTask, deleteNote } from '../lib/db'
import { blocksToText, textToBlocks, markdownToBlocks } from '../lib/blocks'
import { RichText } from '../components/RichText'
import { MdEditor } from '../components/MdEditor'
import { Assets } from '../components/Assets'
import { summarizeNote, extractActions, suggestTags, rewriteNote, noteContext } from '../lib/ai'
import { useRecorderCtx } from '../RecorderContext'
import { DocChat } from '../components/DocChat'

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
      if (b.p) return <p key={i} style={{ margin: 0, fontFamily: f.body, fontSize: 16, lineHeight: 1.68, color: t.t1, textWrap: 'pretty' }}>{inlineMd(b.p)}</p>
      if (b.ul) return <ul key={i} style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {b.ul.map((li, j) => <li key={j} style={{ display: 'flex', gap: 11, fontFamily: f.body, fontSize: 15.5, lineHeight: 1.55, color: t.t1 }}>
          <span style={{ width: 5, height: 5, borderRadius: 3, background: t.accent, flex: 'none', marginTop: 9 }} />
          <span style={{ flex: 1 }}>{inlineMd(li)}</span></li>)}
      </ul>
      if (b.ol) return <ol key={i} style={{ margin: 0, paddingLeft: 0, listStyle: 'none', counterReset: 'ol', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {b.ol.map((li, j) => <li key={j} style={{ display: 'flex', gap: 11, fontFamily: f.body, fontSize: 15.5, lineHeight: 1.55, color: t.t1 }}>
          <span style={{ fontFamily: f.ui, fontWeight: 700, fontSize: 13, color: t.accent, flex: 'none', minWidth: 16, marginTop: 1 }}>{j + 1}.</span>
          <span style={{ flex: 1 }}>{inlineMd(li)}</span></li>)}
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

// ── Transcript turns ─────────────────────────────────────────────
// A saved transcript is "Name: text" lines. Parse it back into attributed
// speaker turns so a viewed meeting reads like the recorder/composer, not a
// raw monospace blob.
const TX_SPEAKER_KEYS = ['accent', 'area_arrow', 'area_brain', 'area_sds', 'good']
function txSpeakerColor(t, sp) {
  let h = 0; const s = String(sp || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return t[TX_SPEAKER_KEYS[h % TX_SPEAKER_KEYS.length]] || t.t2
}
function parseTranscriptTurns(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const turns = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // "Name: text" — speaker label up to ~40 chars before the first colon.
    const m = line.match(/^([A-Za-z0-9][^:]{0,40}):\s*(.*)$/)
    if (m) {
      const sp = m[1].trim()
      if (turns.length && turns[turns.length - 1].sp === sp) turns[turns.length - 1].text += (m[2] ? ' ' + m[2] : '')
      else turns.push({ sp, text: m[2] || '' })
    } else if (turns.length) {
      turns[turns.length - 1].text += ' ' + line // continuation of the prior turn
    } else {
      turns.push({ sp: null, text: line })
    }
  }
  return turns.filter((x) => (x.text || '').trim() || x.sp)
}
function MeetingTranscript({ text }) {
  const { t, f } = useApp()
  const turns = parseTranscriptTurns(text)
  if (!turns.length) return null
  const hasSpeakers = turns.some((x) => x.sp)
  return <div className="selectable" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
    {turns.map((tn, i) => <div key={i} style={{ display: 'flex', gap: 12 }}>
      {hasSpeakers && <span style={{ flex: 'none', width: 88, textAlign: 'right', fontFamily: f.ui, fontSize: 12,
        fontWeight: 700, color: tn.sp ? txSpeakerColor(t, tn.sp) : t.t3, lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tn.sp || '—'}</span>}
      <span style={{ flex: 1, fontFamily: f.body, fontSize: 14, lineHeight: 1.62, color: t.t1 }}>{tn.text}</span>
    </div>)}
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
  const { t, f, go, aiName } = useApp()
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
    try { await updateNote(note.id, { body: markdownToBlocks(preview.md) }); await onReload(); setPreview(null); setMsg('Body rewritten.') }
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
      <span style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 600, color: t.t1 }}>{aiName} actions</span>
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
  const { t, f, go, route, isMobile, aiName } = useApp()
  const { noteById, noteByTitle, projectName, reload, projectDigest, areaDigest, projectById } = useData()
  const rec = useRecorderCtx()
  const n = noteById(route.id)
  const [rawOpen, setRawOpen] = useState(false)
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [nextOpen, setNextOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [refBusy, setRefBusy] = useState(false)
  const [taskDone, setTaskDone] = useState({}) // action index -> true once filed
  const [taskBusy, setTaskBusy] = useState(null)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [eTitle, setETitle] = useState('')
  const [eBody, setEBody] = useState('')
  const [eSummary, setESummary] = useState('') // meeting summary (inline edit)
  const [eNext, setENext] = useState('')       // meeting next steps (inline edit)
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
  const dismissAction = async (i) => {
    if (taskBusy != null) return
    try { await updateNote(n.id, { actions: (n.actions || []).filter((_, idx) => idx !== i) }); await reload() }
    catch (e) { window.alert('Could not remove: ' + (e?.message || e)) }
  }

  // Meetings edit INLINE here (title, notes/body, summary, next steps). The
  // recording/transcript/re-synthesis machinery still lives in the composer —
  // reachable via "Composer" — but the everyday text edits happen in place.
  const resumeMeeting = () => { rec.loadDraftFromNote(n); go({ screen: 'meeting' }) }
  const startEdit = () => {
    setETitle(n.title); setEBody(blocksToText(n.body || [])); setErr(null)
    if (isMeeting) { setESummary(n.summary || ''); setENext(n.nextSteps || '') }
    setEditing(true)
  }
  const deleteThis = async () => {
    if (!window.confirm(`Delete “${n.title || 'this item'}”? This can’t be undone.`)) return
    try { await deleteNote(n.id); await reload(); go(n.project ? { screen: 'project', id: n.project } : { screen: 'library' }) }
    catch (e) { window.alert('Could not delete: ' + (e?.message || e)) }
  }
  const saveEdit = async () => {
    setSaving(true); setErr(null)
    try {
      const patch = { title: eTitle.trim() || 'Untitled', body: markdownToBlocks(eBody) }
      if (isMeeting) { patch.summary = eSummary; patch.nextSteps = eNext }
      await updateNote(n.id, patch); await reload(); setEditing(false)
    } catch (e) { setErr(e) } finally { setSaving(false) }
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
        : <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <IconBtn n="trash" s={17} title="Delete" onClick={deleteThis} />
            <Btn kind="outline" size="sm" icon="pencil" onClick={startEdit}>Edit</Btn>
            {isMeeting && <Btn kind="outline" size="sm" icon="microphone" onClick={resumeMeeting} title="Open the recorder/composer — transcript, re-record, re-synthesize">Composer</Btn>}
            <Btn kind="outline" size="sm" icon="message-circle" onClick={() => setChatOpen(true)}>Ask</Btn>
            <Btn kind="outline" size="sm" icon="sparkles" onClick={() => setRailOpen(true)}>{aiName}</Btn>
          </span>}
    </div>

    {/* title */}
    {editing
      ? <input value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="Untitled" className="selectable"
          style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontFamily: f.title, fontSize: 28,
            fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15, padding: 0 }} />
      : <h1 onClick={isMeeting ? undefined : startEdit} title={isMeeting ? undefined : 'Click to edit'}
          style={{ margin: 0, fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing,
            color: t.t1, lineHeight: 1.15, textWrap: 'pretty', cursor: isMeeting ? 'default' : 'text' }}>{n.title}</h1>}

    {/* date / people / words */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>{n.date}</span>
      {n.incomplete && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11, fontWeight: 700,
        letterSpacing: '0.02em', color: t.risk, background: t.riskBg, border: '1px solid ' + t.riskLine, borderRadius: 7, padding: '2px 8px' }}>
        <Icon n="alert-triangle" s={12} />Incomplete</span>}
      {(n.people || []).map((p) => <Person key={p} size="sm">{p}</Person>)}
      {words && <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3 }}>· {words} words</span>}
    </div>

    {n.incomplete && !editing && <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14, padding: '11px 14px',
      borderRadius: 11, background: t.riskBg, border: '1px solid ' + t.riskLine, flexWrap: 'wrap' }}>
      <Icon n="player-pause" s={16} c={t.risk} />
      <span style={{ flex: 1, minWidth: 160, fontFamily: f.ui, fontSize: 12.5, color: t.t1 }}>This meeting was interrupted and never finished. Resume it to add a transcript and synthesize.</span>
      <Btn kind="primary" size="sm" icon="arrow-back-up" onClick={() => { rec.loadDraftFromNote(n); go({ screen: 'meeting' }) }}>Resume</Btn>
    </div>}

    {/* meeting synthesis: summary + actions + terms */}
    {isMeeting && !editing && <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {n.summary && <Card style={{ padding: '16px 18px', background: t.accentBg, borderColor: t.accentLine }}>
        <Label style={{ color: t.accent, marginBottom: 10 }}>Summary</Label>
        <RichText text={n.summary} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none', marginTop: 1 }}>
              {n.project && (taskDone[i]
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11, fontWeight: 600, color: t.good, whiteSpace: 'nowrap' }}><Icon n="check" s={13} />Filed</span>
                : <span onClick={() => fileTask(a, i)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11, fontWeight: 600,
                      color: t.t2, whiteSpace: 'nowrap', cursor: taskBusy != null ? 'default' : 'pointer', opacity: taskBusy != null && taskBusy !== i ? 0.5 : 1 }}>
                    <Icon n={taskBusy === i ? 'loader-2' : 'plus'} s={12} />To task</span>)}
              <span onClick={() => dismissAction(i)} title="Remove this action item"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, cursor: 'pointer', color: t.t3 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.riskBg; e.currentTarget.firstChild.style.color = t.risk }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.firstChild.style.color = t.t3 }}>
                <Icon n="x" s={14} c={t.t3} /></span>
            </div>
          </div>)}
        </Card>
      </div>}
    </div>}

    {/* suggested next steps — collapsible */}
    {!editing && n.nextSteps && n.nextSteps.trim() && <div style={{ marginTop: 18 }}>
      <div onClick={() => setNextOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
        borderRadius: nextOpen ? '10px 10px 0 0' : 10, cursor: 'pointer', background: t.card, border: '1px solid ' + t.line, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1 }}>
        <Icon n={nextOpen ? 'chevron-down' : 'chevron-right'} s={14} c={t.t3} />
        <Icon n="bulb" s={14} c={t.accent} />Suggested next steps</div>
      {nextOpen && <div style={{ padding: '14px 16px', background: t.card, border: '1px solid ' + t.line, borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
        <RichText text={n.nextSteps} /></div>}
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

    {/* inline meeting editors — summary + next steps (composer owns transcript) */}
    {editing && isMeeting && <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <Label style={{ marginBottom: 8, color: t.accent }}>Summary</Label>
        <MdEditor value={eSummary} onChange={setESummary} minHeight={220} />
      </div>
      <div>
        <Label style={{ marginBottom: 8 }}>Suggested next steps</Label>
        <MdEditor value={eNext} onChange={setENext} minHeight={160} />
      </div>
    </div>}

    {/* body */}
    <div style={{ marginTop: 24 }}>
      {editing
        ? <>
            <Label style={{ marginBottom: 8 }}>{isMeeting ? 'My notes' : 'Body'}</Label>
            <MdEditor value={eBody} onChange={setEBody} minHeight={isMeeting ? 240 : 360} />
            {err && <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 10 }}>Couldn’t save - {String(err?.message || err)}.</div>}
          </>
        : <RichText text={blocksToText(n.body || [])} />}
    </div>

    {/* files / attachments */}
    {!editing && <div style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid ' + t.line }}>
      <Label style={{ marginBottom: 11 }}>Files</Label>
      <Assets noteId={n.id} />
    </div>}

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
        <Icon n="file-text" s={14} c={t.t3} />Transcript
        <span style={{ color: t.t3 }}>· {words ? words + ' words · ' : ''}source material</span></div>
      {rawOpen && <div style={{ padding: '16px 18px', background: t.panel, border: '1px solid ' + t.line, borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
        <MeetingTranscript text={n.transcript} /></div>}
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
    <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: rail ? 'minmax(0,1fr) 250px' : 'minmax(0,1fr)', gap: 40 }}>
      <div style={{ minWidth: 0 }}>{main}</div>{rail && <div style={{ marginTop: isMobile ? 28 : 56 }}>{rail}</div>}
    </div>
    {railOpen && <div onClick={() => setRailOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 310, background: 'rgba(0,0,0,0.35)' }}>
      <div onClick={(e) => e.stopPropagation()}><ClaudeRail note={n} onClose={() => setRailOpen(false)} onReload={reload} /></div></div>}
    {chatOpen && (() => { const pid = n.project || (n.projects || [])[0] || null
      const proj = pid ? projectById(pid) : null
      const areaId = n.area || proj?.area || null
      return <DocChat doc={{ title: n.title || 'Untitled', kind: n.kind || 'note', content: noteContext(n) }}
        projectContext={pid ? projectDigest(pid) : ''} projectName={pid ? projectName(pid) : ''}
        areaContext={areaId ? areaDigest(areaId) : ''} areaName={proj?.areaName || ''}
        onClose={() => setChatOpen(false)} /> })()}
  </div>
}
