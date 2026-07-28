// Tune + Ask for a Study drill.
//
// A generated drill is wrong in the ordinary way generated things are wrong: it
// weights the wrong thing. So the drill has to be argued with. Two separate
// surfaces, deliberately not one:
//
//   Tune — change the drill. Per-point marks (core / minor / drop), a note on
//          any single point, free-text steer for the whole thing, and manual
//          editing of the text itself. Corrections accumulate into the dive's
//          `guidance`, which is replayed into every later rebuild AND into
//          grading, so a correction never has to be made twice.
//   Ask  — ask about the material without touching the drill. Asking "what did
//          Ed's deck actually say" must never silently rewrite what you are
//          being tested on.
//
// Per-point controls are inline chips rather than a long-press: long-press has
// no desktop equivalent and hides the one interaction the feature exists for.
import { useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Icon, IconBtn, Btn, Label } from '../kit'
import { reviseDive, askAboutDive } from '../lib/study'

const WEIGHTS = [
  ['core', 'Must hit', 'target-arrow'],
  ['minor', 'Barely matters', 'arrow-down'],
]

function Sheet({ title, sub, onClose, children, footer }) {
  const { t, f } = useApp()
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 420, background: 'rgba(0,0,0,0.42)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px 0' }}>
    <div onClick={(e) => e.stopPropagation()} style={{ flex: '0 0 660px', maxWidth: '95vw', maxHeight: '84vh',
      background: t.card, border: '1px solid ' + t.line, borderRadius: 16, boxShadow: t.shadow,
      display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 10px 12px 16px',
        borderBottom: '1px solid ' + t.line, flex: 'none' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: f.ui, fontSize: 14.5, fontWeight: 700, color: t.t1 }}>{title}</div>
          {sub ? <div style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginTop: 3, lineHeight: 1.45 }}>{sub}</div> : null}
        </div>
        <IconBtn n="x" s={18} onClick={onClose} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px' }}>{children}</div>
      {footer ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
        borderTop: '1px solid ' + t.line, flex: 'none' }}>{footer}</div> : null}
    </div>
  </div>
}

// ── Tune ─────────────────────────────────────────────────────────
export function TunePanel({ dive, sourceText, onClose, onSaved }) {
  const { t, f } = useApp()
  // Local working copy. Nothing persists until Save, so an abandoned tune
  // leaves the drill exactly as it was.
  const [points, setPoints] = useState(() => (dive.keyPoints || []).map((k) => ({ ...k })))
  const [guidance, setGuidance] = useState(dive.guidance || '')
  const [steer, setSteer] = useState('')
  const [openNote, setOpenNote] = useState(null)
  const [busy, setBusy] = useState(null)   // 'revise' | 'save'
  const [err, setErr] = useState(null)
  const [revised, setRevised] = useState(null)

  const patch = (i, p) => setPoints((ps) => ps.map((k, j) => (j === i ? { ...k, ...p } : k)))
  const toggleWeight = (i, w) => patch(i, { weight: points[i].weight === w ? undefined : w })
  const addPoint = () => { setPoints((ps) => [...ps, { text: '' }]); setOpenNote(null) }

  const inputStyle = { width: '100%', border: '1px solid ' + t.line2, borderRadius: 9, outline: 0,
    background: t.bg, fontFamily: f.ui, fontSize: 13, color: t.t1, padding: '8px 10px' }

  const runRevise = async () => {
    if (!steer.trim() && !points.some((k) => k.note || k.drop || k.weight)) {
      setErr('Say what to change first - mark a point, add a note, or write a steer.'); return
    }
    setBusy('revise'); setErr(null)
    try {
      const out = await reviseDive({ dive: { ...dive, keyPoints: points, guidance }, steer, sourceText })
      if (!out.keyPoints.length) throw new Error('came back empty - try saying it differently')
      setRevised(out)
    } catch (e) { setErr(String(e?.message || e)) }
    setBusy(null)
  }

  // Save what is on screen. After a revise this is the revised set; otherwise it
  // is the hand-edited one. Dropped points are discarded here, not before, so
  // "drop" stays undoable right up until save.
  const save = async () => {
    setBusy('save'); setErr(null)
    try {
      const src = revised || { keyPoints: points, guidance }
      const clean = (src.keyPoints || [])
        .filter((k) => !k.drop && String(k.text || '').trim())
        .map((k) => {
          const out = { text: String(k.text).trim() }
          if (k.weight === 'core' || k.weight === 'minor') out.weight = k.weight
          if (k.note && String(k.note).trim()) out.note = String(k.note).trim()
          return out
        })
      if (!clean.length) throw new Error('a drill needs at least one key point')
      await onSaved({
        keyPoints: clean,
        guidance: (src.guidance || '').trim(),
        ...(revised ? { title: revised.title, prompt: revised.prompt, summary: revised.summary } : {}),
      })
      onClose()
    } catch (e) { setErr(String(e?.message || e)); setBusy(null) }
  }

  const chip = (on, label, icon, onClick, tone) => (
    <span onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
      fontFamily: f.ui, fontSize: 11, fontWeight: 600, borderRadius: 7, padding: '3px 8px',
      color: on ? (tone === 'risk' ? t.risk : t.accent) : t.t3,
      background: on ? (tone === 'risk' ? t.riskBg : t.accentBg) : 'transparent',
      border: '1px solid ' + (on ? (tone === 'risk' ? t.riskLine : t.accentLine) : t.line2) }}>
      <Icon n={icon} s={12} />{label}</span>
  )

  return <Sheet title="Tune this drill" onClose={onClose}
    sub="Tell it what it got wrong. What you say here is remembered and applied every time this drill is rebuilt or graded."
    footer={<>
      <span style={{ flex: 1, fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>
        {revised ? 'Rewritten below. Nothing is saved until you keep it.' : 'Nothing is saved until you press Save.'}</span>
      {revised
        ? <>
            <Btn kind="ghost" size="sm" onClick={() => setRevised(null)}>Back to my edits</Btn>
            <Btn kind="primary" size="sm" icon={busy === 'save' ? 'loader-2' : 'circle-check'} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Keep this version'}</Btn>
          </>
        : <>
            <Btn kind="ghost" size="sm" icon={busy === 'save' ? 'loader-2' : null} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save as is'}</Btn>
            <Btn kind="primary" size="sm" icon={busy === 'revise' ? 'loader-2' : 'wand'} onClick={runRevise}>
              {busy === 'revise' ? 'Rewriting…' : 'Rewrite with this'}</Btn>
          </>}
    </>}>

    {revised ? <>
      <Label>Rewritten</Label>
      <div style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 600, color: t.t1, marginTop: 8 }}>{revised.title}</div>
      {revised.summary ? <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2, marginTop: 4, lineHeight: 1.5 }}>{revised.summary}</div> : null}
      <div style={{ marginTop: 12 }}>
        {revised.keyPoints.map((k, i) => <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9,
          padding: '10px 0', borderBottom: '1px solid ' + t.line }}>
          <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, width: 16, flex: 'none', paddingTop: 2 }}>{i + 1}</span>
          <span style={{ flex: 1, fontFamily: f.ui, fontSize: 13.5, color: t.t1, lineHeight: 1.5 }}>{k.text}</span>
          {k.weight === 'core' ? <Icon n="target-arrow" s={14} c={t.accent} title="Must hit" /> : null}
        </div>)}
      </div>
      {revised.guidance ? <div style={{ marginTop: 18 }}>
        <Label>What it will remember</Label>
        <div style={{ whiteSpace: 'pre-wrap', fontFamily: f.ui, fontSize: 12.5, color: t.t2, marginTop: 7,
          lineHeight: 1.55, background: t.panel, border: '1px solid ' + t.line, borderRadius: 10, padding: '11px 13px' }}>{revised.guidance}</div>
      </div> : null}
    </> : <>
      {guidance ? <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Label style={{ flex: 1 }}>What it already remembers</Label>
          <span onClick={() => setGuidance('')} style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, cursor: 'pointer' }}>Clear</span>
        </div>
        <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} className="selectable"
          style={{ ...inputStyle, marginTop: 7, minHeight: 62, resize: 'vertical', lineHeight: 1.55, background: t.panel }} />
      </div> : null}

      <Label>Key points</Label>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {points.map((k, i) => {
          const dropped = !!k.drop
          return <div key={i} style={{ padding: '9px 10px', borderRadius: 10, border: '1px solid ' + t.line,
            background: dropped ? 'transparent' : t.panel, opacity: dropped ? 0.5 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, width: 14, flex: 'none', paddingTop: 8 }}>{i + 1}</span>
              <textarea value={k.text} onChange={(e) => patch(i, { text: e.target.value })} className="selectable"
                rows={Math.max(1, Math.ceil((k.text || '').length / 70))}
                placeholder="What a strong answer has to say…"
                style={{ ...inputStyle, flex: 1, resize: 'vertical', lineHeight: 1.5,
                  textDecoration: dropped ? 'line-through' : 'none', background: t.bg }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, paddingLeft: 22, flexWrap: 'wrap' }}>
              {WEIGHTS.map(([w, label, icon]) => chip(k.weight === w, label, icon, () => toggleWeight(i, w)))}
              {chip(!!k.note || openNote === i, k.note ? 'Note added' : 'Add a note', 'message-2',
                () => setOpenNote(openNote === i ? null : i))}
              <div style={{ flex: 1 }} />
              {chip(dropped, dropped ? 'Dropped - undo' : 'Not relevant', 'trash', () => patch(i, { drop: !dropped }), 'risk')}
            </div>
            {openNote === i && <input autoFocus value={k.note || ''} onChange={(e) => patch(i, { note: e.target.value })}
              className="selectable" placeholder="What's wrong with this point, or what it should say instead…"
              style={{ ...inputStyle, marginTop: 8, marginLeft: 22, width: 'calc(100% - 22px)' }} />}
          </div>
        })}
      </div>
      <div onClick={addPoint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
        fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t3, cursor: 'pointer' }}>
        <Icon n="plus" s={13} />Add a point</div>

      <div style={{ marginTop: 20 }}><Label>Tell it what to fix</Label></div>
      <textarea value={steer} onChange={(e) => setSteer(e.target.value)} className="selectable"
        placeholder={'Talk to it plainly. "No, that\'s not the top priority - reference the powerpoint Ed shared. Forecasting is the number one thing."'}
        style={{ ...inputStyle, marginTop: 8, minHeight: 96, resize: 'vertical', lineHeight: 1.55 }} />
      {!sourceText ? <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 7, lineHeight: 1.5 }}>
        This drill has no source record attached, so it can only work from what you type here.
      </div> : null}
      {err ? <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, marginTop: 12 }}>{err}</div> : null}
    </>}
  </Sheet>
}

// ── Ask ──────────────────────────────────────────────────────────
export function AskPanel({ dive, sourceText, onClose }) {
  const { t, f } = useApp()
  const [q, setQ] = useState('')
  const [shown, setShown] = useState([])   // what the user sees
  const histRef = useRef([])               // what the model sees (turn 0 carries the context)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const ask = async () => {
    const question = q.trim()
    if (!question || busy) return
    setQ(''); setErr(null)
    setShown((s) => [...s, { role: 'user', content: question }])
    setBusy(true)
    try {
      const answer = await askAboutDive({ dive, sourceText, history: histRef.current, question })
      // Mirror the model's own view of the exchange so follow-ups keep context.
      if (!histRef.current.length) {
        histRef.current = [{ role: 'user', content: question }, { role: 'assistant', content: answer }]
      } else {
        histRef.current = [...histRef.current, { role: 'user', content: question }, { role: 'assistant', content: answer }]
      }
      setShown((s) => [...s, { role: 'assistant', content: answer }])
    } catch (e) {
      setErr(String(e?.message || e))
      setShown((s) => s.slice(0, -1))
      setQ(question)
    }
    setBusy(false)
  }

  const inputStyle = { flex: 1, border: '1px solid ' + t.line2, borderRadius: 10, outline: 0,
    background: t.bg, fontFamily: f.ui, fontSize: 13, color: t.t1, padding: '10px 12px' }

  return <Sheet title={'Ask about ' + dive.title} onClose={onClose}
    sub="Questions about the material behind this drill. Asking here never changes what you are tested on."
    footer={<>
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask() }}
        autoFocus className="selectable" placeholder="What did Ed's deck say about forecasting?" style={inputStyle} />
      <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : 'arrow-up'} onClick={ask}>{busy ? 'Thinking…' : 'Ask'}</Btn>
    </>}>
    {!shown.length && !busy && <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3, lineHeight: 1.6 }}>
      {sourceText
        ? 'Ask anything about the record this drill was built from - what a document actually said, why a number is what it is, what you are still missing.'
        : 'This drill has no source record attached, so answers here come from the drill itself only.'}
    </div>}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {shown.map((m, i) => m.role === 'user'
        ? <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', fontFamily: f.ui, fontSize: 13,
            color: t.t1, background: t.sel, borderRadius: '12px 12px 4px 12px', padding: '9px 12px', lineHeight: 1.5 }}>{m.content}</div>
        : <div key={i} style={{ whiteSpace: 'pre-wrap', fontFamily: f.body, fontSize: 14, color: t.t1, lineHeight: 1.62 }}>{m.content}</div>)}
      {busy && <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>Reading your material…</div>}
    </div>
    {err ? <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, marginTop: 12 }}>{err}</div> : null}
  </Sheet>
}
