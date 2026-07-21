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
import { Icon, Card, Btn, TODAY, MONTHS } from '../kit'
import { useLongPress } from './TaskSheet'
import { createSeries } from '../lib/db'

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

function BlockRow({ block, series, onOpen, onHold, onDelete }) {
  const { t, f, go } = useApp()
  const [hover, setHover] = useState(false)
  const end = block.hour + block.duration / 60
  const isMeeting = block.type === 'meeting'
  // A block that belongs to a series says so IN PLACE OF its pillar/type badge —
  // that's the fact worth surfacing here: opening it carries the standing agenda.
  const badge = series ? 'Series'
    : pillarLabel(block.pillar) ||
      (isMeeting ? 'Meeting' : block.type === 'routine' ? 'Routine' : 'Open')
  // Hold a meeting to make it recurring (or jump to the series it's already in).
  const { pressing, handlers } = useLongPress(
    () => { if (isMeeting) onHold(block) },
    () => onOpen(block), 450)
  return (
    <div
      {...(isMeeting ? handlers : { onClick: () => onOpen(block) })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={isMeeting ? 'Tap to start this meeting · hold to make it a series' : 'Open a meeting for this'}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '12px 16px',
        borderBottom: '1px solid ' + t.line, cursor: 'pointer', userSelect: 'none',
        background: pressing ? t.sel : hover ? t.tagBg : 'transparent',
        transform: pressing ? 'scale(0.995)' : 'none',
        transition: 'background .12s, transform .12s' }}
    >
      <div style={{ flex: 'none', width: 96, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t2,
        fontVariantNumeric: 'tabular-nums', paddingTop: 1 }}>
        {fmtTime(block.hour)} – {fmtTime(end)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 14, fontWeight: 500, color: t.t1 }}>{block.title}</div>
        {/* This block belongs to a series, so starting it here carries the
            standing agenda and the open items forward. Say so. */}
        {series && series.name !== block.title && <span onClick={(e) => { e.stopPropagation(); go({ screen: 'series', id: series.id }) }}
          title="Part of a recurring series — starting it here files the meeting there"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.accent }}>
          <Icon n="repeat" s={12} c={t.accent} />{series.name}</span>}
      </div>
      <Icon n="arrow-up-right" s={15} c={hover ? t.t2 : t.t3} />
      <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
        fontFamily: f.ui, fontSize: 11, fontWeight: 600,
        color: series ? t.accent : t.t2, background: series ? t.accentBg : t.tagBg,
        border: '1px solid ' + (series ? t.accentLine : 'transparent'),
        borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
        {series && <Icon n="repeat" s={11} c={t.accent} />}{badge}</span>
      <span
        className="task-grip"
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

function DaySection({ iso, blocks, seriesFor, onOpen, onHold, onDelete }) {
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
        {blocks.map((b) => <BlockRow key={b.id} block={b} series={seriesFor(b)} onOpen={onOpen} onHold={onHold} onDelete={onDelete} />)}
      </Card>
    </div>
  )
}

// ── hold-a-meeting sheet ────────────────────────────────────────
// Promote a calendar block to a recurring series without leaving the Agenda.
// The new series binds to this block's TITLE (see lib/seriesAgenda), so every
// future occurrence of the same event lands in it — the block itself is left
// completely alone, since Today owns placed_blocks.
function SeriesSheet({ block, series, onClose, onCreated }) {
  const { t, f, go, isMobile } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const create = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      // Store the title explicitly even though the name alone would match —
      // otherwise renaming the series later would silently break the link.
      const id = await createSeries({ name: block.title, calendarTitles: [block.title] })
      await onCreated()
      onClose()
      go({ screen: 'series', id })
    } catch (e) { setErr(e); setBusy(false) }
  }

  return <div onClick={() => !busy && onClose()}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90, display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 24 }}>
    <div onClick={(e) => e.stopPropagation()}
      style={{ background: t.bg, border: '1px solid ' + t.line, borderRadius: isMobile ? '16px 16px 0 0' : 14,
        width: '100%', maxWidth: 460, padding: '18px 20px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <Icon n="repeat" s={17} c={t.accent} />
        <span style={{ fontFamily: f.label, fontSize: 10.5, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent }}>
          {series ? 'Recurring meeting' : 'Make it recurring'}</span>
      </div>
      <div style={{ fontFamily: f.title, fontSize: 18, fontWeight: f.titleW, color: t.t1, lineHeight: 1.2 }}>{block.title}</div>

      <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t2, lineHeight: 1.6, margin: '12px 0 18px' }}>
        {series
          ? <>Already a series. It keeps its standing agenda and carries open items forward, and every meeting you start from this block files into it.</>
          : <>Creates a series for this meeting. It stays on your calendar exactly as it is — and it also gets a standing agenda, a history of every instance, and open items carried between them.</>}
      </div>

      {err && <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk, marginBottom: 12 }}>Couldn’t do that — {String(err?.message || err)}.</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn kind="ghost" size="sm" onClick={() => !busy && onClose()}>Cancel</Btn>
        {series
          ? <Btn kind="primary" size="sm" icon="arrow-right" onClick={() => { onClose(); go({ screen: 'series', id: series.id }) }}>Open the series</Btn>
          : <Btn kind="primary" size="sm" icon={busy ? 'loader-2' : 'repeat'} onClick={create}>{busy ? 'Creating…' : 'Make it a series'}</Btn>}
      </div>
    </div>
  </div>
}

export function AgendaScreen() {
  const { t, f, go } = useApp()
  const { seriesForMeetingTitle, reload } = useData()
  const [holdBlock, setHoldBlock] = useState(null)
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
              ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} this week · tap to start a meeting, hold to make it a series`
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

      {holdBlock && <SeriesSheet block={holdBlock} series={seriesForMeetingTitle(holdBlock.title)}
        onCreated={reload} onClose={() => setHoldBlock(null)} />}

      {status === 'ready' && days.map((d) => (
        <DaySection key={d.iso} iso={d.iso} blocks={d.blocks}
          seriesFor={(b) => (b.type === 'meeting' ? seriesForMeetingTitle(b.title) : null)}
          onOpen={openMeeting} onHold={setHoldBlock} onDelete={deleteBlock} />
      ))}
    </div>
  )
}
