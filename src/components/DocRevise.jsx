// DocRevise — update a document in place. Pick a meeting and/or type
// instructions, Claude returns targeted edits, the app splices them into your
// existing text, you review the result as a diff, and applying it snapshots the
// current body into cp_artifact_versions first so the change is reversible.
//
// The model never re-emits the document (see lib/edits.js): untouched text is
// carried over character for character rather than regenerated, so nothing gets
// quietly reworded or dropped on the way past.
//
// Deliberately not the old "edit guide" flow: that produced instructions for
// hand-editing somewhere else. This writes the document.
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../ctx'
import { Icon, Btn, IconBtn, Card, Label } from '../kit'
import { RichText } from './RichText'
import { reviseDocumentBody } from '../lib/ai'
import { diffLines, collapseUnchanged, diffStat } from '../lib/diff'
import { snapshotArtifact, updateArtifact, listArtifactVersions } from '../lib/db'

// Shared shell so the revise panel and the history panel sit in the same frame.
function Sheet({ title, icon, onClose, children, footer, busy }) {
  const { t, f, isMobile } = useApp()
  return <div onClick={() => !busy && onClose()}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 24 }}>
    <div onClick={(e) => e.stopPropagation()}
      style={{ background: t.bg, border: '1px solid ' + t.line, borderRadius: isMobile ? '16px 16px 0 0' : 14, width: '100%', maxWidth: 720, maxHeight: isMobile ? '90vh' : '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid ' + t.line, flex: 'none' }}>
        <Icon n={icon} s={18} c={t.accent} />
        <span style={{ fontFamily: f.title, fontSize: 17, fontWeight: f.titleW, color: t.t1, flex: 1 }}>{title}</span>
        <IconBtn n="x" s={20} onClick={() => !busy && onClose()} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', minHeight: 0 }}>{children}</div>
      {footer && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: '1px solid ' + t.line, flex: 'none', flexWrap: 'wrap' }}>{footer}</div>}
    </div>
  </div>
}

// Unified diff, unchanged runs collapsed.
function DiffView({ before, after }) {
  const { t, f } = useApp()
  const { ops, stat } = useMemo(() => {
    const raw = diffLines(before, after)
    return { ops: collapseUnchanged(raw, 2), stat: diffStat(raw) }
  }, [before, after])

  const line = { fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.55, padding: '1px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
  return <div>
    <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginBottom: 8 }}>
      {stat.changed ? <><span style={{ color: t.good, fontWeight: 600 }}>+{stat.added}</span> · <span style={{ color: t.risk, fontWeight: 600 }}>−{stat.removed}</span> lines</> : 'No changes to the document.'}
    </div>
    <div style={{ border: '1px solid ' + t.line, borderRadius: 10, background: t.card, overflow: 'hidden', padding: '6px 0' }}>
      {ops.map((op, i) => {
        if (op.type === 'skip') return <div key={i} style={{ ...line, color: t.t3, background: t.sel, fontStyle: 'italic', padding: '3px 10px' }}>… {op.count} unchanged line{op.count === 1 ? '' : 's'}</div>
        const bg = op.type === 'add' ? t.goodBg || t.accentBg : op.type === 'del' ? t.riskBg : 'transparent'
        const fg = op.type === 'add' ? t.t1 : op.type === 'del' ? t.t2 : t.t2
        const mark = op.type === 'add' ? '+ ' : op.type === 'del' ? '− ' : '  '
        return <div key={i} style={{ ...line, background: bg, color: fg, textDecoration: op.type === 'del' ? 'line-through' : 'none' }}>{mark}{op.text || ' '}</div>
      })}
    </div>
  </div>
}

export function DocRevise({ artifact, meetings = [], initialMeetingId = null, onClose, onApplied }) {
  const { t, f, aiName } = useApp()
  const [stage, setStage] = useState('form') // 'form' | 'review'
  const [meetingId, setMeetingId] = useState(
    (initialMeetingId && meetings.some((m) => m.id === initialMeetingId) ? initialMeetingId : meetings[0]?.id) || null)
  const [instr, setInstr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null) // { body, summary, applied, failed }

  const mtg = meetings.find((m) => m.id === meetingId) || null
  const inputRow = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }

  const run = async () => {
    if (!mtg && !instr.trim()) { setErr(new Error('pick a meeting or write an instruction')); return }
    setBusy(true); setErr(null)
    try {
      // Flatten the meeting the same way the old update-guide flow did: the
      // transcript when there is one, else the summary + body blocks.
      const tx = mtg ? (mtg.transcript || [mtg.summary, (mtg.body || []).map((b) => b.p || (b.ul ? b.ul.join('; ') : (b.ol ? b.ol.join('; ') : ''))).join(' ')].filter(Boolean).join('\n')) : ''
      const noteText = mtg ? (mtg.body || []).map((b) => b.p || (b.ul ? b.ul.map((i) => '- ' + i).join('\n') : (b.ol ? b.ol.map((i, k) => (k + 1) + '. ' + i).join('\n') : ''))).filter(Boolean).join('\n') : ''
      const r = await reviseDocumentBody({
        documentTitle: artifact.title || 'Untitled', document: artifact.body || '',
        meetingTitle: mtg?.title || '', transcript: tx, notes: noteText, instructions: instr.trim(),
      })
      setResult(r); setStage('review')
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  const apply = async () => {
    setBusy(true); setErr(null)
    try {
      const reason = mtg ? `revised from ${mtg.title}` : 'revised with instructions'
      await snapshotArtifact(artifact.id, { title: artifact.title || '', body: artifact.body || '', reason })
      await updateArtifact(artifact.id, { body: result.body })
      await onApplied()
      onClose()
    } catch (e) { setErr(e); setBusy(false) }
  }

  const errLine = err && <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, marginTop: 10 }}>Couldn’t do that — {String(err?.message || err)}.</div>

  if (stage === 'review' && result) return <Sheet title="Review the revision" icon="file-diff" onClose={onClose} busy={busy}
    footer={<>
      <span style={{ flex: 1, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Applying keeps the current version in history.</span>
      <Btn kind="ghost" size="sm" onClick={() => !busy && setStage('form')}>Back</Btn>
      <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : 'circle-check'} onClick={() => !busy && apply()}>{busy ? 'Applying…' : 'Apply to document'}</Btn>
    </>}>
    {result.summary && <Card style={{ padding: '14px 16px', marginBottom: 16, background: t.accentBg, borderColor: t.accentLine }}>
      <Label style={{ color: t.accent, marginBottom: 8 }}>What changed</Label>
      <RichText text={result.summary} />
    </Card>}
    {/* Edits whose anchor text couldn't be found in the document. They are NOT
        in the diff below, so say so out loud rather than letting them vanish. */}
    {result.failed?.length > 0 && <Card style={{ padding: '14px 16px', marginBottom: 16, background: t.riskBg, borderColor: t.risk }}>
      <Label style={{ color: t.risk, marginBottom: 8 }}>{result.failed.length} change{result.failed.length === 1 ? '' : 's'} couldn’t be placed</Label>
      <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t2, lineHeight: 1.55, marginBottom: 8 }}>
        These aren’t in the diff below and won’t be applied — {aiName} couldn’t point at exactly one spot in the document for them. Make them by hand, or go back and be more specific.
      </div>
      {result.failed.map((e, i) => <div key={i} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: t.t2, lineHeight: 1.5, marginTop: 6, paddingLeft: 10, borderLeft: '2px solid ' + t.line2 }}>
        <span style={{ color: t.t3 }}>{e.reason} — </span>{(e.replace || '(deletion)').slice(0, 220)}
      </div>)}
    </Card>}
    <DiffView before={artifact.body || ''} after={result.body} />
    {errLine}
  </Sheet>

  return <Sheet title={`Update this document with ${aiName}`} icon="wand" onClose={onClose} busy={busy}
    footer={<>
      <span style={{ flex: 1 }} />
      <Btn kind="ghost" size="sm" onClick={() => !busy && onClose()}>Cancel</Btn>
      <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : 'sparkles'} onClick={() => !busy && run()}>{busy ? 'Revising…' : 'Draft the revision'}</Btn>
    </>}>
    <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2, lineHeight: 1.6, marginBottom: 16 }}>
      {aiName} edits only the lines your sources actually touch — the rest of the document is copied through word for word, not rewritten. You review the diff before anything is saved.
    </div>

    <Label style={{ marginBottom: 9 }}>From a meeting</Label>
    <div style={inputRow}>
      {meetings.length === 0
        ? <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>No meetings on this project yet.</span>
        : <select value={meetingId || ''} onChange={(e) => setMeetingId(e.target.value || null)}
            style={{ flex: 1, minWidth: 220, border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 13.5, color: t.t1, padding: '8px 10px' }}>
            <option value="">No meeting — instructions only</option>
            {meetings.map((m) => <option key={m.id} value={m.id}>{m.title}{m.date ? ` · ${m.date}` : ''}</option>)}
          </select>}
    </div>

    <Label style={{ marginBottom: 9 }}>Instructions {mtg ? '(optional)' : ''}</Label>
    <textarea value={instr} onChange={(e) => setInstr(e.target.value)} rows={3}
      placeholder={mtg ? 'Anything to emphasize or leave alone…' : 'e.g. tighten the summary and add a risks section'}
      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', border: '1px solid ' + t.line2, borderRadius: 10, background: t.card, padding: '10px 12px', outline: 'none', fontFamily: f.ui, fontSize: 13.5, lineHeight: 1.5, color: t.t1 }}
      onFocus={(e) => e.currentTarget.style.borderColor = t.accent} onBlur={(e) => e.currentTarget.style.borderColor = t.line2} />
    {errLine}
  </Sheet>
}

// Version history — every snapshot taken before an update, newest first, with a
// diff against what the document says now and a one-click restore. Restoring is
// itself a change, so it snapshots the current body before writing.
export function DocHistory({ artifact, onClose, onRestored }) {
  const { t, f } = useApp()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    listArtifactVersions(artifact.id)
      .then((r) => { if (live) setRows(r) })
      .catch((e) => { if (live) { setErr(e); setRows([]) } })
    return () => { live = false }
  }, [artifact.id])

  const restore = async (v) => {
    if (!window.confirm('Restore this version? The current text is kept in history.')) return
    setBusy(true); setErr(null)
    try {
      await snapshotArtifact(artifact.id, { title: artifact.title || '', body: artifact.body || '', reason: 'replaced by a restore' })
      await updateArtifact(artifact.id, { title: v.title || artifact.title, body: v.body })
      await onRestored()
      onClose()
    } catch (e) { setErr(e); setBusy(false) }
  }

  const when = (at) => { try { return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return at } }

  return <Sheet title="Version history" icon="history" onClose={onClose} busy={busy}>
    {rows === null && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: f.ui, fontSize: 13, color: t.t2 }}><Icon n="loader-2" s={15} c={t.t1} />Loading…</div>}
    {rows !== null && rows.length === 0 && <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3 }}>No earlier versions yet. One is saved every time this document is updated.</div>}
    {(rows || []).map((v) => <Card key={v.id} style={{ padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>{when(v.at)}</div>
          {v.reason && <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 2 }}>{v.reason}</div>}
        </div>
        <Btn kind="ghost" size="sm" onClick={() => setOpenId(openId === v.id ? null : v.id)}>{openId === v.id ? 'Hide diff' : 'Diff'}</Btn>
        <Btn kind="outline" size="sm" icon="arrow-back-up" onClick={() => !busy && restore(v)}>Restore</Btn>
      </div>
      {openId === v.id && <div style={{ marginTop: 12 }}>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginBottom: 6 }}>This version → the document now</div>
        <DiffView before={v.body || ''} after={artifact.body || ''} />
      </div>}
    </Card>)}
    {err && <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, marginTop: 10 }}>{String(err?.message || err)}</div>}
  </Sheet>
}
