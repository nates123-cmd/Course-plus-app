// HoldSheet — the gate for putting a project on hold. Ported from /course:
// "on hold" is a timer, not a trash can. Forces TWO answers — a reason (why is
// this set down) and a resurface date (when it should come back and force a
// decision). Both required; confirm stays disabled until they're filled. On
// confirm the caller writes { reason, resurfaceOn, setAt } to project.hold and
// logs an update; held projects whose resurfaceOn arrives surface on Work.
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Icon, Btn, DatePill, fmtDate, holdView, holdDue, addDays, TODAY } from '../kit'

export function HoldSheet({ project, onConfirm, onClose }) {
  const { t, f, isMobile } = useApp()
  const prev = holdView(project.hold)
  // Re-opened on an already-held project = "keep on hold" (the resurface date came
  // due and Nate chose to keep waiting), not a fresh hold.
  const extending = project.status === 'on-hold' && !!project.hold
  const [reason, setReason] = useState(prev?.reason || '')
  // Never prefill a date that's already come and gone — re-arming an expired hold
  // would just make it due again on the spot. Ask for a real new date.
  const stale = holdDue(project.hold)
  const [resurfaceOn, setResurfaceOn] = useState(
    (!stale && prev?.resurfaceOn) || addDays(TODAY, 14))
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const armed = useRef(false)

  useEffect(() => { const r = requestAnimationFrame(() => setMounted(true)); const a = setTimeout(() => { armed.current = true }, 300); return () => { cancelAnimationFrame(r); clearTimeout(a) } }, [])
  const close = () => { setMounted(false); setTimeout(onClose, 180) }
  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') close() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [])

  const ready = reason.trim().length > 0 && !!resurfaceOn
  const confirm = async () => {
    if (!ready || busy) return
    setBusy(true)
    try { await onConfirm({ reason: reason.trim(), resurfaceOn, setAt: new Date().toISOString() }); close() }
    finally { setBusy(false) }
  }

  return <div onClick={() => { if (armed.current) close() }} style={{ position: 'fixed', inset: 0, zIndex: 460, background: 'rgba(0,0,0,0.44)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', opacity: mounted ? 1 : 0, transition: 'opacity .18s ease' }}>
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '96vw', background: t.card, border: '1px solid ' + t.line,
      borderRadius: isMobile ? '20px 20px 0 0' : '18px 18px 0 0', boxShadow: t.shadow, overflow: 'hidden', maxHeight: '86vh',
      display: 'flex', flexDirection: 'column', transform: mounted ? 'translateY(0)' : 'translateY(24px)', transition: 'transform .2s cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '9px 0 2px', flex: 'none' }}>
        <span style={{ width: 38, height: 4, borderRadius: 3, background: t.line2 }} /></div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '8px 20px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
          <Icon n="player-pause" s={17} c={t.risk} />
          <span style={{ fontFamily: f.title, fontSize: 19, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>
            {extending ? 'Keep on hold' : 'Put on hold'}</span>
        </div>
        <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, marginBottom: 18 }}>
          {extending
            ? `${project.name} stays off the active board. Still waiting on the same thing, or has that changed?`
            : `${project.name} steps off the active board until it resurfaces.`}</div>

        <FieldLabel t={t} f={f}>{extending ? 'Still on hold because…' : 'Why on hold?'}</FieldLabel>
        <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') confirm() }}
          placeholder="What's it waiting on? (e.g. revised scope from Haritha)"
          rows={2} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + t.line2, borderRadius: 10, outline: 0,
            background: t.bg, fontFamily: f.body, fontSize: 14, color: t.t1, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }} />

        <div style={{ marginTop: 18 }}>
          <FieldLabel t={t} f={f}>Resurface on</FieldLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <DatePill value={resurfaceOn} onChange={(d) => setResurfaceOn(d)} label="" empty="+ Pick a date"
              icon="calendar" variant="accent" bottom />
            {[['+1 wk', 7], ['+2 wks', 14], ['+1 mo', 30], ['+3 mos', 90]].map(([lbl, n]) =>
              <span key={lbl} onClick={() => setResurfaceOn(addDays(TODAY, n))} style={{ cursor: 'pointer',
                fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.t3, background: t.sel, borderRadius: 7, padding: '4px 8px' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.tagBg; e.currentTarget.style.color = t.t2 }}
                onMouseLeave={(e) => { e.currentTarget.style.background = t.sel; e.currentTarget.style.color = t.t3 }}>{lbl}</span>)}
          </div>
          <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 9 }}>
            {resurfaceOn ? `Comes back ${fmtDate(resurfaceOn)} — you'll be asked to reactivate, snooze, or keep holding.` : "No date — it won't auto-resurface."}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: '1px solid ' + t.line, flex: 'none' }}>
        <Btn kind="ghost" onClick={close}>Cancel</Btn>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" icon={busy ? 'loader-2' : 'player-pause'} onClick={ready ? confirm : undefined}
          style={!ready ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>{extending ? 'Keep on hold' : 'Put on hold'}</Btn>
      </div>
    </div>
  </div>
}

function FieldLabel({ t, f, children }) {
  return <div style={{ fontFamily: f.label, fontSize: 10.5, fontWeight: 600, letterSpacing: f.labelSpacing,
    textTransform: 'uppercase', color: t.t3, marginBottom: 8 }}>{children}</div>
}
