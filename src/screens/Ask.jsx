// Ask — retrieval across the document corpus. One search field over the live
// askNotes() Claude surface: context chips + an Answer card + openable Sources.
// When arriving scoped to a project (route.project), the corpus narrows to that
// project's owned notes + linked meetings, with an affordance to clear scope.
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, Card, Label, KindBadge, AreaDot, areaColor } from '../kit'
import { askNotes } from '../lib/ai'
import { ASK_SUGGESTIONS } from '../data'

export function AskScreen() {
  const { t, f, go, route } = useApp()
  const { notes, noteById, projectById, ownedNotes, linkedMeetings } = useData()

  const scopeId = route.project || null
  const scopeProj = scopeId ? projectById(scopeId) : null
  // Scoped corpus: notes homed in the project + meetings linked to it.
  const scoped = scopeId
    ? (() => { const seen = new Set(); return [...ownedNotes(scopeId), ...linkedMeetings(scopeId)].filter((n) => (seen.has(n.id) ? false : seen.add(n.id))) })()
    : notes

  const [q, setQ] = useState(route.query || '')
  const [state, setState] = useState('empty') // empty | running | answered | error
  const [result, setResult] = useState(null)   // { answer, sources:[{id,label,meta}] }
  const [err, setErr] = useState(null)
  const ranSeed = useRef(false)

  const run = async (queryArg) => {
    const query = (typeof queryArg === 'string' ? queryArg : q).trim()
    if (!query) return
    setQ(query); setState('running'); setErr(null)
    try {
      const pool = scoped.length ? scoped : notes
      const { answer, sourceIds } = await askNotes(query, pool)
      const sources = (sourceIds || []).map((id) => {
        const n = noteById(id); if (!n) return null
        return { id: n.id, label: n.title, meta: n.date + ((n.people || []).length ? ' · ' + n.people.join(', ') : '') }
      }).filter(Boolean)
      setResult({ answer, sources }); setState('answered')
    } catch (e) { setErr(e); setState('error') }
  }

  // Seed from route.query and auto-run once.
  useEffect(() => {
    if (route.query && !ranSeed.current && notes.length) { ranSeed.current = true; run(route.query) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query, notes.length])

  const onSubmit = (e) => { e.preventDefault(); run() }

  const chips = result
    ? (scopeProj ? [{ icon: 'folder', text: scopeProj.name }] : [{ icon: 'stack-2', text: 'all documents' }])
        .concat([{ icon: 'sparkles', text: result.sources.length + ' source' + (result.sources.length === 1 ? '' : 's') }])
    : []

  return <div data-screen-label="Ask" style={{ maxWidth: 760, margin: '0 auto', padding: '40px 36px 90px' }}>
    <div style={{ fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Ask</div>
    <div style={{ fontFamily: f.ui, fontSize: 13.5, color: t.t2, marginTop: 5 }}>
      Retrieval across {scoped.length} document{scoped.length === 1 ? '' : 's'}
      {scopeProj && <span> · scoped to <span style={{ color: areaColor(t, scopeProj.area), fontWeight: 600 }}>{scopeProj.name}</span></span>}.
    </div>

    {scopeProj && <div style={{ marginTop: 10 }}>
      <span onClick={() => go({ screen: 'ask' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui,
        fontSize: 12, fontWeight: 600, color: t.accent, background: t.accentBg, border: '1px solid ' + t.accentLine,
        borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
        <AreaDot areaId={scopeProj.area} s={6} />{scopeProj.name}<Icon n="x" s={12} /></span>
      <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, marginLeft: 9 }}>Open in Ask to search every document</span>
    </div>}

    <form onSubmit={onSubmit} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, background: t.card,
      border: '1px solid ' + t.line2, borderRadius: 11, padding: '0 14px', height: 48 }}
      onFocusCapture={(e) => e.currentTarget.style.borderColor = t.accent}
      onBlurCapture={(e) => e.currentTarget.style.borderColor = t.line2}>
      <Icon n="sparkles" s={17} c={t.accent} />
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything across your work…"
        style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: f.ui, fontSize: 14.5, color: t.t1 }} />
      <Btn kind="primary" size="sm" type="submit">{state === 'running' ? 'Searching…' : 'Ask'}</Btn>
    </form>

    {/* Suggested questions — before first query */}
    {state === 'empty' && <div style={{ marginTop: 28 }}>
      <Label style={{ marginBottom: 10 }}>Try</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ASK_SUGGESTIONS.map((s) => <div key={s} onClick={() => run(s)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
            background: t.card, border: '1px solid ' + t.line, fontFamily: f.body, fontSize: 14, color: t.t1 }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = t.line2}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = t.line}>
          <Icon n="arrow-right" s={15} c={t.t3} />{s}</div>)}
      </div>
    </div>}

    {state === 'running' && <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '34px 4px', color: t.t2, fontFamily: f.ui, fontSize: 14 }}>
      <Icon n="loader-2" s={16} c={t.t1} />Retrieving across your notes…</div>}

    {state === 'error' && <div style={{ padding: '28px 4px', color: t.t2, fontFamily: f.ui, fontSize: 14 }}>
      Couldn’t retrieve — {String(err?.message || err)}.
      <span onClick={() => run()} style={{ color: t.accent, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }}>Retry</span>
    </div>}

    {state === 'answered' && result && <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
        {chips.map((c, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui,
          fontSize: 11.5, fontWeight: 500, color: t.t2, background: t.tagBg, borderRadius: 7, padding: '4px 10px' }}>
          {c.icon && <Icon n={c.icon} s={12} c={t.t3} />}{c.text}</span>)}
      </div>
      <Card style={{ padding: '20px 22px', borderColor: t.accentLine }}>
        <Label style={{ color: t.accent, marginBottom: 10 }}>Answer</Label>
        <div className="selectable" style={{ fontFamily: f.body, fontSize: 16, lineHeight: 1.66, color: t.t1, textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>{result.answer}</div>
      </Card>

      {result.sources.length > 0 && <>
        <Label style={{ margin: '22px 0 11px' }}>Sources · {result.sources.length}</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.sources.map((s) => { const note = noteById(s.id)
            return <Card key={s.id} hover onClick={() => go({ screen: 'note', id: s.id })} style={{ padding: '13px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <KindBadge kind={note ? note.kind : 'note'} withLabel={false} s={16} />
                <span style={{ flex: 1, minWidth: 0, fontFamily: f.body, fontSize: 14.5, fontWeight: 500, color: t.t1 }}>{s.label}</span>
                <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>{s.meta}</span>
                <Icon n="arrow-up-right" s={15} c={t.t3} />
              </div>
              {note && note.summary && <div style={{ fontFamily: f.body, fontSize: 13, color: t.t2, marginTop: 7, lineHeight: 1.5,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{note.summary}</div>}
            </Card> })}
        </div>
      </>}
    </div>}
  </div>
}
