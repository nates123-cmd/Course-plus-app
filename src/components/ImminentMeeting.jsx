// ImminentMeeting — a small popup that appears when a meeting on today's agenda
// is about to start (within LEAD_MIN, up to GRACE_MIN after). Clicking it opens
// the meeting composer for that meeting (where its scheduled tasks surface on
// top). Meetings come from `placed_blocks` (shared with Today), same source as
// the Agenda screen. Dismissals are remembered (localStorage) so it won't nag.
import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { supabase } from '../lib/supabase'
import { Icon } from '../kit'

const LEAD_MIN = 2 // show this many minutes before start
const GRACE_MIN = 2 // …and up to this many minutes after start
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const keyOf = (b) => `${b.date}|${b.hour}|${(b.title || '').trim().toLowerCase()}`
const loadDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem('course.mtgDismissed') || '[]')) } catch { return new Set() } }

export function ImminentMeeting() {
  const { t, f, go } = useApp()
  const [meeting, setMeeting] = useState(null)
  const [dismissed, setDismissed] = useState(loadDismissed)

  useEffect(() => {
    let live = true
    const check = async () => {
      const today = isoLocal(new Date())
      const { data } = await supabase.from('placed_blocks').select('*').eq('type', 'meeting').eq('date', today).order('hour')
      if (!live) return
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const seen = new Set()
      const soon = (data || [])
        .map((r) => ({ id: r.id, title: r.title || 'Meeting', date: r.date, hour: Number(r.hour) }))
        .filter((b) => { const k = keyOf(b); if (seen.has(k)) return false; seen.add(k); return true }) // Today writes dup rows
        .filter((b) => !dismissed.has(keyOf(b)))
        .map((b) => ({ ...b, startMin: Math.floor(b.hour) * 60 + Math.round((b.hour - Math.floor(b.hour)) * 60) }))
        .filter((b) => b.startMin - nowMin <= LEAD_MIN && nowMin - b.startMin <= GRACE_MIN)
        .sort((a, b) => a.startMin - b.startMin)
      setMeeting(soon[0] || null)
    }
    check()
    const iv = setInterval(check, 60000)
    return () => { live = false; clearInterval(iv) }
  }, [dismissed])

  if (!meeting) return null
  const dismiss = () => {
    const next = new Set(dismissed); next.add(keyOf(meeting))
    try { localStorage.setItem('course.mtgDismissed', JSON.stringify([...next])) } catch {}
    setDismissed(next); setMeeting(null)
  }
  const open = () => { dismiss(); go({ screen: 'meeting', title: meeting.title }) }
  const hr = Math.floor(meeting.hour), mm = String(Math.round((meeting.hour - hr) * 60)).padStart(2, '0')
  const h12 = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr, ap = hr < 12 ? 'a' : 'p'
  const mins = meeting.startMin - (new Date().getHours() * 60 + new Date().getMinutes())
  const when = mins <= 0 ? 'starting now' : `in ${mins} min`

  return <div style={{ position: 'fixed', top: 'max(16px, env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)',
    zIndex: 480, width: 380, maxWidth: 'calc(100vw - 24px)', background: t.card, border: '1px solid ' + t.accentLine,
    borderRadius: 14, boxShadow: t.shadow, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
    <span style={{ width: 34, height: 34, borderRadius: 9, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.accentBg }}>
      <Icon n="calendar-event" s={18} c={t.accent} /></span>
    <div onClick={open} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.accent }}>Meeting {when}</span>
        <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{h12}:{mm}{ap}</span>
      </div>
      <div style={{ fontFamily: f.body, fontSize: 14.5, fontWeight: 500, color: t.t1, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meeting.title}</div>
    </div>
    <button onClick={open} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600,
      color: t.onAccent, background: t.accent, border: 0, borderRadius: 9, padding: '7px 12px', cursor: 'pointer' }}>Open</button>
    <button onClick={dismiss} title="Dismiss" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
      borderRadius: 8, border: 0, background: 'transparent', color: t.t3, cursor: 'pointer' }}><Icon n="x" s={16} /></button>
  </div>
}
