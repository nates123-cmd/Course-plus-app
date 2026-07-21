// Full-page artifact viewer — opens a saved artifact (manual raw file, a Claude
// deliverable, or an "Update doc" edit guide). Raw 'file' artifacts render as
// monospace pre (verbatim); Claude-composed ones render formatted via Markish.
import { useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, IconBtn, Card, Label, Markish } from '../kit'
import { deleteArtifact, updateArtifact, queueRemarkablePush, snapshotArtifact } from '../lib/db'
import { DocChat } from '../components/DocChat'
import { DocRevise, DocHistory } from '../components/DocRevise'
import { RichText } from '../components/RichText'
import { MdEditor } from '../components/MdEditor'
import { parseDelimited, handleCsvPaste } from '../lib/tablePaste'

// Render a saved CSV/TSV "file" artifact as a real table (first row = header).
function CsvTable({ grid }) {
  const { t, f } = useApp()
  const cell = { border: '1px solid ' + t.line2, padding: '7px 11px', fontFamily: f.body, fontSize: 13.5, lineHeight: 1.5, color: t.t1, textAlign: 'left', verticalAlign: 'top', whiteSpace: 'pre-wrap' }
  const cols = grid[0].length
  return (
    <div style={{ overflowX: 'auto', border: '1px solid ' + t.line, borderRadius: 12, background: t.card }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{grid[0].map((c, i) => (
          <th key={i} style={{ ...cell, fontFamily: f.ui, fontWeight: 700, fontSize: 12, background: t.sel, color: t.t2 }}>{c}</th>
        ))}</tr></thead>
        <tbody>{grid.slice(1).map((r, ri) => (
          <tr key={ri}>{Array.from({ length: cols }).map((_, ci) => <td key={ci} style={cell}>{r[ci] ?? ''}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  )
}

const ART_KIND = {
  'update-guide': { icon: 'file-diff', label: 'Edit guide' },
  file: { icon: 'file-text', label: 'File' },
  // current compose types
  auto: { icon: 'sparkles', label: 'Document' },
  brief: { icon: 'book', label: 'Study brief' },
  document: { icon: 'file-text', label: 'Document' },
  message: { icon: 'message', label: 'Message' },
  csv: { icon: 'table', label: 'CSV' },
  copilot: { icon: 'prompt', label: 'Copilot prompt' },
  // legacy compose types (kept so older artifacts still label correctly)
  onepager: { icon: 'file-text', label: 'One-pager' },
  exec: { icon: 'clipboard-text', label: 'Exec summary' },
  email: { icon: 'mail', label: 'Email draft' },
  deck: { icon: 'layout-board', label: 'Deck outline' },
  other: { icon: 'wand', label: 'Custom' },
}

export function ArtifactScreen() {
  const { t, f, go, route, isMobile, aiName } = useApp()
  const { artifactById, projectById, reload, projectDigest, areaDigest, ownedNotes, linkedMeetings } = useData()
  const [copied, setCopied] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // route.revise carries a meeting id when the project screen sends you here to
  // update this document — the panel opens straight away with it selected.
  const [reviseOpen, setReviseOpen] = useState(() => !!route.revise)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [eTitle, setETitle] = useState('')
  const [eBody, setEBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [rawView, setRawView] = useState(false)
  // 'idle' | 'sending' | 'sent'. The device may be asleep, so "sent" means
  // queued, not delivered — the label says so.
  const [rmState, setRmState] = useState('idle')
  const a = artifactById(route.id)

  if (!a) return <div style={{ padding: 40, fontFamily: f.body, color: t.t3 }}>Artifact not found.</div>
  const proj = a.project ? projectById(a.project) : null
  const kind = ART_KIND[a.artType] || { icon: 'file-export', label: 'Artifact' }
  const isFile = a.artType === 'file'
  const when = a.at ? new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  const copy = () => { try { navigator.clipboard.writeText(a.body || '') } catch {} setCopied(true); setTimeout(() => setCopied(false), 1800) }
  const sendToRm = async () => {
    if (rmState !== 'idle') return
    setRmState('sending')
    try {
      await queueRemarkablePush({
        title: a.title || 'Untitled', body: a.body || '',
        sourceKind: 'artifact', sourceRef: a.id,
      })
      setRmState('sent'); setTimeout(() => setRmState('idle'), 3000)
    } catch (e) {
      setRmState('idle')
      window.alert('Could not queue for reMarkable: ' + (e?.message || e))
    }
  }
  const del = async () => {
    if (!window.confirm(`Delete “${a.title || 'this artifact'}”? This can’t be undone.`)) return
    try { await deleteArtifact(a.id); await reload(); go(proj ? { screen: 'project', id: a.project } : { screen: 'overview' }) }
    catch (e) { window.alert('Could not delete: ' + (e?.message || e)) }
  }
  const startEdit = () => { setETitle(a.title || ''); setEBody(a.body || ''); setEditing(true) }
  const cancelEdit = () => setEditing(false)
  const saveEdit = async () => {
    setSaving(true)
    try {
      // Snapshot before overwriting so a manual edit is as reversible as an AI
      // revision — but only when the body actually moved, or every no-op save
      // would pile up junk versions.
      if ((a.body || '') !== eBody) {
        await snapshotArtifact(a.id, { title: a.title || '', body: a.body || '', reason: 'manual edit' })
      }
      await updateArtifact(a.id, { title: eTitle.trim() || a.title || 'Untitled', body: eBody })
      await reload(); setEditing(false)
    }
    catch (e) { window.alert('Could not save: ' + (e?.message || e)) }
    finally { setSaving(false) }
  }

  // Meetings available as a revision source: everything filed under this
  // project plus meetings that merely reference it.
  const meetings = a.project
    ? [...ownedNotes(a.project), ...linkedMeetings(a.project)].filter((n) => n.kind === 'meeting')
    : []

  return <div style={{ maxWidth: 840, margin: '0 auto', padding: isMobile ? '26px 18px 90px' : '30px 36px 90px' }}>
    <div onClick={() => go(proj ? { screen: 'project', id: a.project } : { screen: 'overview' })}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12.5, color: t.t3, cursor: 'pointer', marginBottom: 16 }}
      onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
      <Icon n="chevron-left" s={15} />{proj ? proj.name : 'Work'}</div>

    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <Icon n={kind.icon} s={22} c={t.accent} style={{ marginTop: 4 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing
          ? <input value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="Title"
              style={{ width: '100%', border: 0, borderBottom: '1px solid ' + t.line2, outline: 'none', background: 'transparent',
                fontFamily: f.title, fontSize: 26, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15, padding: '0 0 4px' }} />
          : <h1 style={{ margin: 0, fontFamily: f.title, fontSize: 26, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15, textWrap: 'pretty' }}>{a.title}</h1>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontFamily: f.ui, fontSize: 12, color: t.t3, flexWrap: 'wrap' }}>
          <Label style={{ margin: 0 }}>{kind.label}</Label>
          {a.provenance && <span>· {a.provenance}</span>}
          {when && <span>· {when}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
        {editing
          ? <>
              <Btn kind="ghost" size="sm" onClick={cancelEdit}>Cancel</Btn>
              <Btn kind="primary" size="sm" icon={saving ? 'loader-2' : 'circle-check'} onClick={saving ? undefined : saveEdit}>{saving ? 'Saving…' : 'Save'}</Btn>
            </>
          : <>
              <Btn kind="outline" size="sm" icon="sparkles" onClick={() => setChatOpen(true)}>Ask {aiName}</Btn>
              <Btn kind="outline" size="sm"
                icon={rmState === 'sent' ? 'check' : rmState === 'sending' ? 'loader-2' : 'device-tablet'}
                title="Render to a reMarkable-sized PDF and deliver it to the tablet"
                onClick={rmState === 'idle' ? sendToRm : undefined}>
                {rmState === 'sent' ? 'Queued' : rmState === 'sending' ? 'Sending…' : 'reMarkable'}
              </Btn>
              <Btn kind="outline" size="sm" icon="wand" title={`Revise this document with ${aiName} from a meeting or an instruction`} onClick={() => setReviseOpen(true)}>Update</Btn>
              <Btn kind="outline" size="sm" icon="pencil" onClick={startEdit}>Edit</Btn>
              <Btn kind="outline" size="sm" icon={copied ? 'check' : 'copy'} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Btn>
              <IconBtn n="history" s={17} title="Version history" onClick={() => setHistoryOpen(true)} />
              <IconBtn n="trash" s={17} title="Delete" onClick={del} />
            </>}
      </div>
    </div>

    <div style={{ marginTop: 22 }}>
      {editing
        ? (isFile
            ? <textarea value={eBody} onChange={(e) => setEBody(e.target.value)} onPaste={(e) => handleCsvPaste(e, eBody, setEBody)} autoFocus
                style={{ width: '100%', minHeight: '52vh', boxSizing: 'border-box', resize: 'vertical', background: t.card, border: '1px solid ' + t.line2,
                  borderRadius: 12, padding: '16px 18px', outline: 'none', color: t.t1, fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.6 }}
                onFocus={(e) => e.currentTarget.style.borderColor = t.accent} onBlur={(e) => e.currentTarget.style.borderColor = t.line2} />
            : <MdEditor value={eBody} onChange={setEBody} minHeight={460} />)
        : isFile
          ? (() => {
              const grid = rawView ? null : parseDelimited(a.body)
              return <>
                {(grid || rawView) && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginBottom: 8, fontFamily: f.ui, fontSize: 12, color: t.t3 }}>
                  <span onClick={() => setRawView(false)} style={{ cursor: 'pointer', fontWeight: !rawView ? 700 : 500, color: !rawView ? t.accent : t.t3 }}>Table</span>
                  <span onClick={() => setRawView(true)} style={{ cursor: 'pointer', fontWeight: rawView ? 700 : 500, color: rawView ? t.accent : t.t3 }}>Raw</span>
                </div>}
                {grid
                  ? <CsvTable grid={grid} />
                  : <pre className="selectable" style={{ margin: 0, overflow: 'auto', background: t.card, border: '1px solid ' + t.line, borderRadius: 12,
                      padding: '16px 18px', fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.6, color: t.t1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.body || '(empty)'}</pre>}
              </>
            })()
          : <Card style={{ padding: '20px 22px' }} className="selectable"><RichText text={a.body || ''} /></Card>}
    </div>

    {chatOpen && <DocChat doc={{ title: a.title || 'Untitled', kind: kind.label, content: a.body || '' }}
      projectContext={a.project ? projectDigest(a.project) : ''} projectName={proj?.name}
      areaContext={proj?.area ? areaDigest(proj.area) : ''} areaName={proj?.areaName}
      onClose={() => setChatOpen(false)} />}

    {reviseOpen && <DocRevise artifact={a} meetings={meetings}
      initialMeetingId={typeof route.revise === 'string' ? route.revise : null}
      onApplied={reload} onClose={() => setReviseOpen(false)} />}

    {historyOpen && <DocHistory artifact={a}
      onRestored={reload} onClose={() => setHistoryOpen(false)} />}
  </div>
}
