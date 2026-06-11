// "Ask Claude about this document" — a docked, ephemeral chat panel grounded in
// ONE document (artifact, note, or meeting). Thread lives in local state only:
// it clears on close / reload (by design). Multi-turn via askDocument().
//   Props: doc = { title, kind, content }, onClose(),
//   projectContext? (string digest of the surrounding project),
//   projectName? (label for the scope toggle)
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { Icon, IconBtn, Markish } from '../kit'
import { askDocument } from '../lib/ai'

export function DocChat({ doc, onClose, projectContext = '', projectName = '' }) {
  const { t, f, isMobile } = useApp()
  const hasProject = !!(projectContext && projectContext.trim())
  const [useProject, setUseProject] = useState(hasProject) // include whole-project context
  const [messages, setMessages] = useState([]) // [{role:'user'|'assistant', content}]
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const threadRef = useRef(null)
  const inputRef = useRef(null)

  // Keep the thread pinned to the latest turn.
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, busy])
  useEffect(() => { inputRef.current?.focus() }, [])

  const send = async (retryQ) => {
    const q = (typeof retryQ === 'string' ? retryQ : input).trim()
    if (!q || busy) return
    setErr(null)
    // History is everything before this turn; append the user turn optimistically.
    const history = messages
    setMessages([...history, { role: 'user', content: q }])
    setInput(''); setBusy(true)
    try {
      const reply = await askDocument(doc, history, q, useProject ? projectContext : '')
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      setErr({ q, message: String(e?.message || e) })
    } finally { setBusy(false) }
  }

  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  const panelStyle = isMobile
    ? { position: 'fixed', inset: 0, zIndex: 60 }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 60, borderLeft: '1px solid ' + t.line2 }

  return <div style={{ ...panelStyle, background: t.panel, display: 'flex', flexDirection: 'column', boxShadow: isMobile ? 'none' : '-8px 0 32px ' + t.shadow }}>
    {/* Header */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 16px', borderBottom: '1px solid ' + t.line }}>
      <Icon n="sparkles" s={17} c={t.accent} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>Ask Claude</div>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>about “{doc.title}”</div>
      </div>
      <IconBtn n="x" s={18} title="Close" onClick={onClose} />
    </div>

    {/* Scope toggle — widen context to the whole project */}
    {hasProject && <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderBottom: '1px solid ' + t.line, flex: 'none' }}>
      <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>Context</span>
      {[{ on: false, label: 'This doc', icon: 'file-text' }, { on: true, label: projectName || 'Whole project', icon: 'folder' }].map((opt) => {
        const active = useProject === opt.on
        return <span key={String(opt.on)} onClick={() => setUseProject(opt.on)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontFamily: f.ui, fontSize: 11.5, fontWeight: 600,
            color: active ? t.accent : t.t3, background: active ? t.accentBg : t.sel, border: '1px solid ' + (active ? t.accentLine : 'transparent'),
            borderRadius: 7, padding: '4px 9px' }}>
          <Icon n={opt.icon} s={12} c={active ? t.accent : t.t3} />{opt.label}</span>
      })}
    </div>}

    {/* Thread */}
    <div ref={threadRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {messages.length === 0 && !busy && <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 240, color: t.t3, fontFamily: f.ui, fontSize: 13, lineHeight: 1.5 }}>
        <Icon n="message-circle" s={22} c={t.t3} style={{ marginBottom: 8 }} />
        <div>Ask anything about this document{hasProject && useProject ? ' or its project' : ''} — Claude answers from {hasProject && useProject ? 'this work' : 'its contents'}.</div>
      </div>}

      {messages.map((m, i) => m.role === 'user'
        ? <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: t.accentBg, border: '1px solid ' + t.accentLine,
            borderRadius: '12px 12px 3px 12px', padding: '9px 13px', fontFamily: f.body, fontSize: 14.5, lineHeight: 1.5, color: t.t1, whiteSpace: 'pre-wrap' }}>{m.content}</div>
        : <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '92%' }}><Markish text={m.content} /></div>)}

      {busy && <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, color: t.t2, fontFamily: f.ui, fontSize: 13 }}>
        <Icon n="loader-2" s={15} c={t.t1} />Thinking…</div>}

      {err && <div style={{ alignSelf: 'flex-start', color: t.t2, fontFamily: f.ui, fontSize: 13 }}>
        Couldn’t answer — {err.message}.
        <span onClick={() => send(err.q)} style={{ color: t.accent, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }}>Retry</span>
      </div>}
    </div>

    {/* Composer */}
    <div style={{ padding: '12px 14px', borderTop: '1px solid ' + t.line, display: 'flex', alignItems: 'flex-end', gap: 9 }}>
      <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} rows={1}
        placeholder="Ask about this document…"
        style={{ flex: 1, resize: 'none', maxHeight: 120, border: '1px solid ' + t.line2, borderRadius: 10, background: t.card,
          padding: '9px 12px', fontFamily: f.ui, fontSize: 14, lineHeight: 1.45, color: t.t1, outline: 'none' }}
        onFocus={(e) => e.currentTarget.style.borderColor = t.accent}
        onBlur={(e) => e.currentTarget.style.borderColor = t.line2} />
      <button onClick={() => send()} disabled={busy || !input.trim()} title="Send"
        style={{ flex: 'none', width: 38, height: 38, borderRadius: 10, border: 0, cursor: busy || !input.trim() ? 'default' : 'pointer',
          background: input.trim() ? t.accent : t.sel, color: input.trim() ? '#fff' : t.t3, display: 'grid', placeItems: 'center', opacity: busy ? 0.6 : 1 }}>
        <Icon n="arrow-up" s={18} c={input.trim() ? '#fff' : t.t3} />
      </button>
    </div>
  </div>
}
