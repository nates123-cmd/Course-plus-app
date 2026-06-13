// Agenda.jsx — today's time-blocked day schedule, read-only. The retrieval is
// ported from the Today app's usePlacedBlocks: read `placed_blocks` for the
// current date, ordered by hour. Same shared suite Supabase + per-user RLS, so
// Course+ sees the same user's blocks Today writes. Display only here — editing
// the schedule still lives in Today.
import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { supabase } from '../lib/supabase'
import { Icon, Card, TODAY, MONTHS } from '../kit'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const todayISO = () => new Date().toISOString().slice(0, 10)
const todayLabel = () => {
  const d = new Date(TODAY.y, TODAY.m, TODAY.d)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[TODAY.m]} ${TODAY.d}`
}

// decimal hour -> "9:30a" (ported from Today's Live.jsx fmtTime)
function fmtTime(h) {
  const hr = Math.floor(h)
  const m = Math.round((h - hr) * 60)
  const mm = String(m).padStart(2, '0')
  const hr12 = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr
  const ap = hr < 12 ? 'a' : 'p'
  return `${hr12}:${mm}${ap}`
}
const pillarLabel = (id) => (id ? id.charAt(0).toUpperCase() + id.slice(1) : null)

// placed_blocks row -> UI block (mirrors Today's fromRow, read-only fields)
function fromRow(r) {
  return {
    id: r.id, hour: Number(r.hour), duration: r.duration_minutes,
    type: r.type, title: r.title, pillar: r.pillar, source: r.source,
  }
}

// Safeguard against Today writing duplicate rows: collapse blocks that are the
// SAME event at the same time — identical hour + duration + title (case/space-
// insensitive) + type. Keep the first occurrence. The underlying placed_blocks
// data is left untouched; this only de-dupes what the agenda shows.
function dedupe(blocks) {
  const seen = new Set()
  return blocks.filter((b) => {
    const key = [b.hour, b.duration, b.type, (b.title || '').trim().toLowerCase()].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function BlockRow({ block }) {
  const { t, f } = useApp()
  const end = block.hour + block.duration / 60
  const badge =
    pillarLabel(block.pillar) ||
    (block.type === 'meeting' ? 'Meeting' : block.type === 'routine' ? 'Routine' : 'Open')
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 16px', borderBottom: '1px solid ' + t.line }}>
      <div style={{ flex: 'none', width: 96, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t2,
        fontVariantNumeric: 'tabular-nums', paddingTop: 1 }}>
        {fmtTime(block.hour)} – {fmtTime(end)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 500, color: t.t1 }}>{block.title}</div>
      </div>
      <span style={{ flex: 'none', fontFamily: f.ui, fontSize: 11, fontWeight: 600, color: t.t2,
        background: t.tagBg, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>{badge}</span>
    </div>
  )
}

export function AgendaScreen() {
  const { t, f } = useApp()
  const [blocks, setBlocks] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    supabase
      .from('placed_blocks')
      .select('*')
      .eq('date', todayISO())
      .order('hour', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setError(error.message); setStatus('error'); return }
        setBlocks(dedupe((data ?? []).map(fromRow)))
        setStatus('ready')
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div data-screen-label="Agenda" style={{ maxWidth: 980, margin: '0 auto', padding: '34px 36px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: f.title, fontSize: 30, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Agenda</div>
          <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 4 }}>
            {status === 'ready'
              ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} scheduled today`
              : 'Your time-blocked day'}
          </div>
        </div>
        <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{todayLabel()}</span>
      </div>

      {status === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '60px 0', justifyContent: 'center',
          fontFamily: f.ui, fontSize: 13, color: t.t3 }}>
          <Icon n="loader-2" s={16} c={t.t2} />Loading your day…
        </div>
      )}

      {status === 'error' && (
        <Card style={{ padding: '22px 16px', textAlign: 'center', fontFamily: f.ui, fontSize: 13, color: t.t3 }}>
          Couldn’t load the agenda — {String(error)}.
        </Card>
      )}

      {status === 'ready' && blocks.length === 0 && (
        <Card style={{ padding: '40px 16px', textAlign: 'center' }}>
          <Icon n="calendar" s={24} c={t.t3} />
          <div style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 500, color: t.t2, marginTop: 10 }}>No blocks scheduled today</div>
          <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, marginTop: 4 }}>Plan your day in Today and it shows up here.</div>
        </Card>
      )}

      {status === 'ready' && blocks.length > 0 && (
        <Card style={{ padding: '4px 0', overflow: 'hidden' }}>
          {blocks.map((b) => <BlockRow key={b.id} block={b} />)}
        </Card>
      )}
    </div>
  )
}
