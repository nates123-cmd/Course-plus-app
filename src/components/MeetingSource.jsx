// "Where did this come from?" — for a task or suggestion born in a meeting.
// Shows the meeting it came from, the stretch of transcript it most likely
// came out of, the suggestion in full, and the meeting's summary, with a way
// into the full transcript. Everything here is already loaded (notes carry
// their transcript), so opening it costs no requests and no AI call.
import { useState, useEffect } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, IconBtn, Btn } from '../kit'
import { RichText } from './RichText'
import { transcriptExcerpt } from '../lib/nextSteps'

const SUMMARY_PREVIEW = 520

export function MeetingSource({ noteId, label, detail, onClose }) {
  const { t, f, go } = useApp()
  const { noteById, projectName } = useData()
  const n = noteById(noteId)
  const [mounted, setMounted] = useState(false)
  const [fullSummary, setFullSummary] = useState(false)
  useEffect(() => { const r = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(r) }, [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }; document.addEventListener('keydown', k, true); return () => document.removeEventListener('keydown', k, true) }, [])
  const close = () => { setMounted(false); setTimeout(onClose, 160) }
  const open = (transcript) => { onClose(); go({ screen: 'note', id: noteId, ...(transcript ? { transcript: true } : {}) }) }

  const excerpt = n ? transcriptExcerpt(n.transcript, [label, detail].filter(Boolean).join(' ')) : []
  const summary = (n && n.summary) || ''
  const long = summary.length > SUMMARY_PREVIEW
  const shown = fullSummary || !long ? summary : summary.slice(0, SUMMARY_PREVIEW).replace(/\s+\S*$/, '') + '…'
  const lbl = { fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.t3, marginBottom: 8 }

  return <div onClick={(e) => { e.stopPropagation(); close() }} onMouseDown={(e) => e.stopPropagation()}
    style={{ position: 'fixed', inset: 0, zIndex: 520, background: 'rgba(0,0,0,0.38)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      opacity: mounted ? 1 : 0, transition: 'opacity .16s ease' }}>
    <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '96vw', maxHeight: '84vh', display: 'flex', flexDirection: 'column',
      background: t.card, border: '1px solid ' + t.line, borderRadius: '18px 18px 0 0', boxShadow: t.shadow, overflow: 'hidden',
      transform: mounted ? 'translateY(0)' : 'translateY(24px)', transition: 'transform .2s cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px 20px', borderBottom: '1px solid ' + t.line, flex: 'none' }}>
        <Icon n="users" s={16} c={t.accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>Where this came from</div>
          <div style={{ fontFamily: f.body, fontSize: 15, fontWeight: 600, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n ? n.title : 'Meeting not found'}</div>
          {n && <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 1 }}>
            {[n.date, n.project ? projectName(n.project) : null].filter(Boolean).join(' · ')}</div>}
        </div>
        <IconBtn n="x" s={18} onClick={close} />
      </div>

      <div style={{ overflowY: 'auto', padding: '16px 20px 6px' }}>
        {!n && <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3, lineHeight: 1.5, paddingBottom: 12 }}>
          The meeting this came from has been deleted.</div>}

        {n && detail && detail !== label && <div style={{ marginBottom: 18 }}>
          <div style={lbl}>The suggestion in full</div>
          <div className="selectable" style={{ fontFamily: f.body, fontSize: 14, lineHeight: 1.5, color: t.t1 }}>{detail}</div>
        </div>}

        {n && excerpt.length > 0 && <div style={{ marginBottom: 18 }}>
          <div style={lbl}>What was said</div>
          <div className="selectable" style={{ borderLeft: '3px solid ' + t.accentLine, padding: '2px 0 2px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {excerpt.map((l, i) => <div key={i} style={{ fontFamily: f.body, fontSize: 13.5, lineHeight: 1.5, color: l.hit ? t.t1 : t.t3 }}>{l.text}</div>)}
          </div>
        </div>}

        {n && summary && <div style={{ marginBottom: 12 }}>
          <div style={lbl}>Meeting summary</div>
          <div style={{ fontSize: 13.5 }}><RichText text={shown} /></div>
          {long && <span onClick={() => setFullSummary((v) => !v)} style={{ display: 'inline-block', marginTop: 6, fontFamily: f.ui, fontSize: 12, fontWeight: 600, color: t.accent, cursor: 'pointer' }}>
            {fullSummary ? 'Show less' : 'Show the whole summary'}</span>}
        </div>}

        {n && !summary && !excerpt.length && <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3, lineHeight: 1.5, paddingBottom: 12 }}>
          This meeting has no summary yet. The transcript has the full context.</div>}
      </div>

      {n && <div style={{ display: 'flex', gap: 9, padding: '12px 16px', borderTop: '1px solid ' + t.line, background: t.panel, flex: 'none' }}>
        <Btn kind="ghost" size="sm" icon="file-text" onClick={() => open(false)}>Meeting notes</Btn>
        <div style={{ flex: 1 }} />
        {n.transcript && <Btn kind="primary" size="sm" icon="message-2" onClick={() => open(true)}>Read the transcript</Btn>}
      </div>}
    </div>
  </div>
}
