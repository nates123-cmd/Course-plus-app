// Agenda.jsx — this week's time-blocked schedule, read-only. Retrieval is ported
// from the Today app's usePlacedBlocks but widened to a 7-day window starting
// today: read `placed_blocks` for date in [today, today+6], ordered by date then
// hour. Same shared suite Supabase + per-user RLS, so Course+ sees the same
// user's blocks Today writes. Editing the schedule still lives in Today.
// Click any block → opens the meeting composer with the title pre-filled.
import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { supabase } from '../lib/supabase'
import { Icon, Card, TODAY, MONTHS } from '../kit'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEK_DAYS = 7

// local-date ISO (avoid toISOString UTC drift — TODAY/kit dates are local)
const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const weekStart = () => new Date(TODAY.y, TODAY.m, TODAY.d)
const todayISO = () => isoLocal(weekStart())
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

// "2026-06-16" -> { weekday, label, isToday }
function dayMeta(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return {
    weekday: WEEKDAYS[date.getDay()],
    label: `${MONTHS[m - 1]} ${d}`,
    isToday: iso === todayISO(),
  }
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
    id: r.id, date: r.date, hour: Number(r.hour), duration: r.duration_minutes,
    type: r.type, title: r.title, pillar: r.pillar, source: r.source,
  }
}

// Safeguard against Today writing duplicate rows: collapse blocks that are the
// SAME event on the same day at the same time — identical date + hour + duration
// + title (case/space-insensitive) + type. Keep the first occurrence. The
// underlying placed_blocks data is left untouched; this only de-dupes display.
function dedupe(blocks) {
  const seen = new Set()
  return blocks.filter((b) => {
    const key = [b.date, b.hour, b.duration, b.type, (b.title || '').trim().toLowerCase()].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// group blocks (already date+hour sorted) into [{ iso, blocks }] for days that
// have at least one block, in chronological order
function groupByDay(blocks) {
  const map = new Map()
  for (const b of blocks) {
    if (!map.has(b.date)) map.set(b.date, [])
    map.get(b.date).push(b)
  }
  return [...map.keys()].sort().map((iso) => ({ iso, blocks: map.get(iso) }))
}

function BlockRow({ block, series, onOpen, onDelete }) {
  const { t, f, go } = useApp()
  const [hover, setHover] = useState(false)
  const end = block.hour + block.duration / 60
  const badge =
    pillarLabel(block.pillar) ||
    (block.type === 'meeting' ? 'Meeting' : block.type === 'routine' ? 'Routine' : 'Open')
  return (
    <div
      onClick={() => onOpen(block)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Open a meeting for this"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 16px',
        borderBottom: '1px solid ' + t.line, cursor: 'pointer',
        background: hover ? t.tagBg : 'transparent', transition: 'background .12s' }}
    >
      <div style={{ flex: 'none', width: 96, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t2,
        fontVariantNumeric: 'tabular-nums', paddingTop: 1 }}>
        {fmtTime(block.hour)} – {fmtTime(end)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 500, color: t.t1 }}>{block.title}</div>
        {/* This block belongs to a series, so starting it here carries the
            standing agenda and the open items forward. Say so. */}
        {series && <span onClick={(e) => { e.stopPropagation(); go({ screen: 'series', id: series.id }) }}
          title="Part of a recurring series — starting it here files the meeting there"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.accent }}>
          <Icon n="repeat" s={12} c={t.accent} />{series.name}</span>}
      </div>
      <Icon n="arrow-up-right" s={15} c={hover ? t.t2 : t.t3} />
      <span style={{ flex: 'none', fontFamily: f.ui, fontSize: 11, fontWeight: 600, color: t.t2,
        background: t.tagBg, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>{badge}</span>
      <span
        onClick={(e) => { e.stopPropagation(); onDelete(block) }}
        title="Delete from agenda"
        style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, borderRadius: 7, cursor: 'pointer', opacity: hover ? 1 : 0,
          transition: 'opacity .12s, color .12s', color: t.t3 }}
        onMouseEnter={(e) => e.currentTarget.style.color = t.risk}
        onMouseLeave={(e) => e.currentTarget.style.color = t.t3}
      >
        <Icon n="trash" s={15} c="currentColor" />
      </span>
    </div>
  )
}

function DaySection({ iso, blocks, seriesFor, onOpen, onDelete }) {
  const { t, f } = useApp()
  const m = dayMeta(iso)
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, padding: '0 2px' }}>
        <span style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 700, color: m.isToday ? t.t1 : t.t2 }}>
          {m.isToday ? 'Today' : m.weekday}
        </span>
        <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>
          {m.isToday ? `${m.weekday}, ${m.label}` : m.label}
        </span>
      </div>
      <Card style={{ padding: '4px 0', overflow: 'hidden' }}>
        {blocks.map((b) => <BlockRow key={b.id} block={b} series={seriesFor(b)} onOpen={onOpen} onDelete={onDelete} />)}
      </Card>
    </div>
  )
}

export function AgendaScreen() {
  const { t, f, go } = useApp()
  const { seriesForMeetingTitle } = useData()
  const [blocks, setBlocks] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    const start = weekStart()
    const startISO = isoLocal(start)
    const endISO = isoLocal(addDays(start, WEEK_DAYS - 1))
    supabase
      .from('placed_blocks')
      .select('*')
      .gte('date', startISO)
      .lte('date', endISO)
      .order('date', { ascending: true })
      .order('hour', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setError(error.message); setStatus('error'); return }
        setBlocks(dedupe((data ?? []).map(fromRow)))
        setStatus('ready')
      })
    return () => { cancelled = true }
  }, [])

  // open the meeting composer with this block's title pre-filled
  const openMeeting = (block) => go({ screen: 'meeting', title: (block.title || '').trim() })

  // delete a scheduled block — removes the placed_blocks row (shared with Today).
  // Optimistic: drop it locally first, restore on failure.
  const deleteBlock = async (block) => {
    const prev = blocks
    setBlocks((bs) => bs.filter((b) => b.id !== block.id))
    const { error } = await supabase.from('placed_blocks').delete().eq('id', block.id)
    if (error) setBlocks(prev) // restore on failure, keep the list visible
  }

  const days = groupByDay(blocks)
  const start = weekStart()
  const end = addDays(start, WEEK_DAYS - 1)
  const rangeLabel = `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}`

  return (
    <div data-screen-label="Agenda" style={{ maxWidth: 980, margin: '0 auto', padding: '34px 36px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: f.title, fontSize: 30, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Agenda</div>
          <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, marginTop: 4 }}>
            {status === 'ready'
              ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} this week · tap one to start a meeting`
              : 'Your week ahead'}
          </div>
        </div>
        <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{rangeLabel}</span>
      </div>

      {status === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '60px 0', justifyContent: 'center',
          fontFamily: f.ui, fontSize: 13, color: t.t3 }}>
          <Icon n="loader-2" s={16} c={t.t2} />Loading your week…
        </div>
      )}

      {status === 'error' && (
        <Card style={{ padding: '22px 16px', textAlign: 'center', fontFamily: f.ui, fontSize: 13, color: t.t3 }}>
          Couldn’t load the agenda — {String(error)}.
        </Card>
      )}

      {status === 'ready' && days.length === 0 && (
        <Card style={{ padding: '40px 16px', textAlign: 'center' }}>
          <Icon n="calendar" s={24} c={t.t3} />
          <div style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 500, color: t.t2, marginTop: 10 }}>Nothing scheduled this week</div>
          <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3, marginTop: 4 }}>Plan your week in Today and it shows up here.</div>
        </Card>
      )}

      {status === 'ready' && days.map((d) => (
        <DaySection key={d.iso} iso={d.iso} blocks={d.blocks}
          seriesFor={(b) => (b.type === 'meeting' ? seriesForMeetingTitle(b.title) : null)}
          onOpen={openMeeting} onDelete={deleteBlock} />
      ))}
    </div>
  )
}
