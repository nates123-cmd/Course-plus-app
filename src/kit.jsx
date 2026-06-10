// kit.jsx — merged Course × Scribe design system (Direction B), ported from the
// prototype's course-kit.jsx to ESM. Components read { t, f } from useApp().
// Styles are inline against the token var-map `t`; `f` is the Direction-B font
// role object. This is the work (status-forward) + document (calm) shared kit.
import { Fragment, useState, useEffect, useRef } from 'react'
import { useApp } from './ctx'

// ── Area accent lookup ──────────────────────────────────────────
const AREA_HUE = { arrow: 'area_arrow', sds: 'area_sds', brain: 'area_brain' }
export function areaColor(t, areaId) { return t[AREA_HUE[areaId]] || t.t3 }

// ── Icons (Tabler webfont) ──────────────────────────────────────
export function Icon({ n, s = 16, c, style, onClick, title }) {
  return <i className={'ti ti-' + n} title={title} onClick={onClick} style={{ fontSize: s, color: c || 'inherit',
    lineHeight: 1, display: 'inline-flex', flex: 'none', ...style }} />
}

export const KIND = {
  note:       { icon: 'file-text',   label: 'Note' },
  meeting:    { icon: 'users',       label: 'Meeting' },
  knowledge:  { icon: 'file-text',   label: 'Note' },
  brainstorm: { icon: 'bolt',        label: 'Brainstorm' },
  artifact:   { icon: 'file-export', label: 'Artifact' },
}

// ── Primitives ──────────────────────────────────────────────────
export function Label({ children, style }) {
  const { t, f } = useApp()
  return <div style={{ fontFamily: f.label, fontSize: 10.5, fontWeight: 600, letterSpacing: f.labelSpacing,
    textTransform: 'uppercase', color: t.t3, ...style }}>{children}</div>
}

export function Tag({ children, onClick, active }) {
  const { t, f } = useApp()
  return <span onClick={onClick} style={{ fontFamily: f.ui, fontSize: 11.5, fontWeight: 500,
    color: active ? t.onAccent : t.tagText, background: active ? t.accent : t.tagBg,
    borderRadius: 6, padding: '2px 9px', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default' }}>{children}</span>
}

export function Person({ children, size = 'md' }) {
  const { t, f } = useApp()
  const fs = size === 'sm' ? 11 : 11.5
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: fs,
    fontWeight: 600, color: t.t1, background: t.accentBg, border: '1px solid ' + t.accentLine,
    borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' }}>
    <Icon n="user" s={11} c={t.t2} />{children}</span>
}

export function KindBadge({ kind, withLabel = true, s = 14 }) {
  const { t, f } = useApp(); const k = KIND[kind] || KIND.note
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 11.5,
    fontWeight: 500, color: t.t2 }}><Icon n={k.icon} s={s} c={t.t2} />{withLabel && k.label}</span>
}

export function AreaDot({ areaId, s = 8 }) {
  const { t } = useApp()
  return <span style={{ width: s, height: s, borderRadius: s, background: areaColor(t, areaId), flex: 'none', display: 'inline-block' }} />
}

export function Btn({ children, icon, iconRight, kind = 'ghost', onClick, size = 'md', style, title, type }) {
  const { t, f } = useApp()
  const pad = size === 'sm' ? '6px 11px' : size === 'lg' ? '10px 18px' : '8px 14px'
  const fs = size === 'sm' ? 12 : size === 'lg' ? 14 : 13
  const base = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    fontFamily: f.ui, fontSize: fs, fontWeight: 600, letterSpacing: f.uiSpacing, borderRadius: 9, padding: pad,
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .14s, border-color .14s, color .14s',
    border: '1px solid transparent', ...style }
  const skin = kind === 'primary' ? { background: t.accent, color: t.onAccent }
    : kind === 'outline' ? { background: 'transparent', color: t.t1, borderColor: t.line2 }
    : kind === 'soft' ? { background: t.sel, color: t.t1 }
    : { background: 'transparent', color: t.t2 }
  return <button title={title} type={type} onClick={onClick} style={{ ...base, ...skin }}
    onMouseEnter={(e) => { if (kind === 'ghost') e.currentTarget.style.background = t.sel
      if (kind === 'outline') e.currentTarget.style.borderColor = t.accent
      if (kind === 'primary') e.currentTarget.style.filter = 'brightness(1.06)' }}
    onMouseLeave={(e) => { if (kind === 'ghost') e.currentTarget.style.background = 'transparent'
      if (kind === 'outline') e.currentTarget.style.borderColor = t.line2
      if (kind === 'primary') e.currentTarget.style.filter = 'none' }}>
    {icon && <Icon n={icon} s={fs + 2} />}{children}{iconRight && <Icon n={iconRight} s={fs + 1} />}</button>
}

export function IconBtn({ n, s = 18, onClick, title, badge, active }) {
  const { t } = useApp()
  return <button title={title} onClick={onClick} style={{ position: 'relative', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 9,
    background: active ? t.sel : 'transparent', border: 0, cursor: 'pointer', color: t.t2,
    transition: 'background .14s, color .14s' }}
    onMouseEnter={(e) => { e.currentTarget.style.background = t.sel; e.currentTarget.style.color = t.t1 }}
    onMouseLeave={(e) => { e.currentTarget.style.background = active ? t.sel : 'transparent'; e.currentTarget.style.color = t.t2 }}>
    <Icon n={n} s={s} />
    {badge ? <span style={{ position: 'absolute', top: 5, right: 4, minWidth: 15, height: 15, borderRadius: 8,
      background: t.accent, color: t.onAccent, fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '0 4px', fontFamily: "'Hanken Grotesk', sans-serif" }}>{badge}</span> : null}
  </button>
}

// ── Status system (project status) ──────────────────────────────
export const STATUS = {
  active:    { label: 'Active',  hint: 'Working on it' },
  'on-hold': { label: 'On hold', hint: 'Paused / blocked' },
  idea:      { label: 'Idea',    hint: 'Not started, not blocked' },
  sent:      { label: 'Sent',    hint: 'Out, awaiting reply' },
  archived:  { label: 'Archived', hint: 'Out of view' },
}

export function statusSkin(t, id) {
  switch (id) {
    case 'active':   return { color: t.onAccent, bg: t.accent, dot: t.accent }
    case 'next-up':  return { color: t.accent, bg: t.accentBg, line: t.accentLine, dot: t.accent }
    case 'sent':     return { color: t.good, bg: t.goodBg, dot: t.good }
    case 'on-hold':  return { color: t.t2, bg: t.tagBg, dot: t.t2 }
    case 'idea':     return { color: t.area_brain, bg: 'transparent', line: t.line2, dot: t.area_brain }
    default:         return { color: t.t3, bg: t.tagBg, dot: t.t3 }
  }
}

export function StatusPill({ id, onClick, open, size = 'md' }) {
  const { t, f } = useApp()
  const s = STATUS[id] || STATUS.idea; const sk = statusSkin(t, id)
  const fs = size === 'sm' ? 10.5 : 11
  return <span onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
    fontFamily: f.ui, fontSize: fs, fontWeight: 600, letterSpacing: '0.02em', borderRadius: 7,
    border: '1px solid ' + (sk.line || 'transparent'), padding: '3px 9px', color: sk.color, background: sk.bg,
    cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
    {s.label}{onClick && <Icon n={open ? 'chevron-up' : 'chevron-down'} s={11} style={{ opacity: 0.7 }} />}</span>
}

// Synthesis state: Raw → Ready → Indexed
export const SYNTH = ['Raw', 'Ready', 'Indexed']
export function SynthPill({ status }) {
  const { t, f } = useApp()
  const idx = typeof status === 'number' ? status : 2
  const label = SYNTH[idx]; const accent = idx === 2
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 10.5,
    fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: accent ? t.accent : t.t3,
    background: accent ? t.accentBg : 'transparent', border: '1px solid ' + (accent ? t.accentLine : t.line2),
    borderRadius: 6, padding: '2px 8px' }}>
    <span style={{ width: 5, height: 5, borderRadius: 3, background: accent ? t.accent : t.t3 }} />{label}</span>
}

// Priority dot (P1/P2/P3)
export function Priority({ level }) {
  const { t, f } = useApp()
  if (!level) return null
  const c = level === 1 ? t.risk : level === 2 ? t.accent : t.t3
  return <span title={'P' + level} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
    fontFamily: f.ui, fontSize: 10.5, fontWeight: 700, color: c, letterSpacing: '0.04em' }}>
    <span style={{ width: 6, height: 6, borderRadius: 3, background: c }} />P{level}</span>
}

// ── Generic popover (anchored) ──────────────────────────────────
export function Popover({ children, onClose, align = 'left', width = 220, top = 'calc(100% + 6px)', bottom, maxHeight }) {
  const { t } = useApp()
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose && onClose() }
    const id = setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', h) }
  }, [])
  const pos = bottom != null ? { bottom } : { top }
  return <div ref={ref} style={{ position: 'absolute', ...pos, [align]: 0, zIndex: 200, minWidth: width,
    background: t.card, border: '1px solid ' + t.line, borderRadius: 12, padding: 6, boxShadow: t.shadow,
    maxHeight, overflowY: maxHeight ? 'auto' : 'visible' }}>{children}</div>
}

export function PopRow({ icon, dot, label, hint, on, onClick }) {
  const { t, f } = useApp()
  return <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
    borderRadius: 8, cursor: 'pointer', background: on ? t.sel : 'transparent' }}
    onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
    onMouseLeave={(e) => e.currentTarget.style.background = on ? t.sel : 'transparent'}>
    {dot && <span style={{ width: 8, height: 8, borderRadius: 4, background: dot, flex: 'none' }} />}
    {icon && <Icon n={icon} s={15} c={t.t2} />}
    <span style={{ fontFamily: f.ui, fontSize: 13, fontWeight: 500, color: on ? t.accent : t.t1 }}>{label}</span>
    {hint && <span style={{ marginLeft: 'auto', fontFamily: f.ui, fontSize: 11, color: t.t3 }}>{hint}</span>}
  </div>
}

export function Card({ children, style, onClick, hover, className }) {
  const { t } = useApp()
  return <div className={className} onClick={onClick} style={{ background: t.card, border: '1px solid ' + t.line, borderRadius: 14,
    transition: 'border-color .14s, background .14s', cursor: onClick ? 'pointer' : 'default', ...style }}
    onMouseEnter={hover ? (e) => e.currentTarget.style.borderColor = t.line2 : undefined}
    onMouseLeave={hover ? (e) => e.currentTarget.style.borderColor = t.line : undefined}>
    {children}</div>
}

export function Avatar({ name, s = 24 }) {
  const { t, f } = useApp()
  const initials = (name || '?').split(/[\s—-]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
  return <span style={{ width: s, height: s, borderRadius: s, flex: 'none', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', background: t.accentBg, border: '1px solid ' + t.accentLine,
    color: t.t1, fontFamily: f.ui, fontWeight: 700, fontSize: s * 0.38 }}>{initials}</span>
}

// usePersisted — localStorage-backed state
export function usePersisted(key, initial) {
  const [v, setV] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw != null ? JSON.parse(raw) : (typeof initial === 'function' ? initial() : initial) }
    catch { return typeof initial === 'function' ? initial() : initial }
  })
  const set = (next) => setV((prev) => {
    const val = typeof next === 'function' ? next(prev) : next
    try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
    return val
  })
  return [v, set]
}

// Reference flag — folds the legacy "knowledge" kind into notes. A note is
// reference if it carries reference:true, is the legacy knowledge kind, or is
// tagged 'reference'. Persistence is via updateNote (real column); no localStorage.
export function isReference(n) {
  if (!n) return false
  if (typeof n.reference === 'boolean') return n.reference
  return n.kind === 'knowledge' || (n.tags || []).includes('reference')
}

// ── Dates ───────────────────────────────────────────────────────
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const _now = new Date()
export const TODAY = { y: _now.getFullYear(), m: _now.getMonth(), d: _now.getDate() }
export function fmtDate(d) { return d ? MONTHS[d.m] + ' ' + d.d : null }

// Inline month calendar
export function MiniCal({ value, onPick, onClear }) {
  const { t, f } = useApp()
  const init = value || TODAY
  const [view, setView] = useState({ y: init.y || TODAY.y, m: init.m })
  const firstDow = new Date(view.y, view.m, 1).getDay()
  const dim = new Date(view.y, view.m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push(d)
  const selOn = value && (value.y || TODAY.y) === view.y && value.m === view.m ? value.d : null
  const isToday = (d) => view.y === TODAY.y && view.m === TODAY.m && d === TODAY.d
  const shift = (n) => setView((vw) => { let m = vw.m + n, y = vw.y; if (m < 0) { m = 11; y-- } if (m > 11) { m = 0; y++ } return { y, m } })
  return <div style={{ width: 250 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 2px 8px' }}>
      <IconBtn n="chevron-left" s={16} onClick={() => shift(-1)} />
      <span style={{ flex: 1, textAlign: 'center', fontFamily: f.ui, fontSize: 13, fontWeight: 600, color: t.t1 }}>{MONTHS[view.m]} {view.y}</span>
      <IconBtn n="chevron-right" s={16} onClick={() => shift(1)} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 3 }}>
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i} style={{ textAlign: 'center',
        fontFamily: f.label, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', color: t.t3 }}>{w}</span>)}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
      {cells.map((d, i) => d == null ? <span key={i} /> :
        <span key={i} onClick={() => onPick({ y: view.y, m: view.m, d })} style={{ height: 30, display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 7,
          fontFamily: f.ui, fontSize: 12.5, fontWeight: selOn === d ? 700 : isToday(d) ? 600 : 500,
          color: selOn === d ? t.onAccent : isToday(d) ? t.accent : t.t1,
          background: selOn === d ? t.accent : 'transparent',
          border: '1px solid ' + (isToday(d) && selOn !== d ? t.accentLine : 'transparent') }}
          onMouseEnter={(e) => { if (selOn !== d) e.currentTarget.style.background = t.sel }}
          onMouseLeave={(e) => { if (selOn !== d) e.currentTarget.style.background = 'transparent' }}>{d}</span>)}
    </div>
    {onClear && value && <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
      <span onClick={onClear} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui,
        fontSize: 11.5, color: t.t3, cursor: 'pointer' }}><Icon n="x" s={12} />Clear date</span></div>}
  </div>
}

// A clickable date pill that opens MiniCal. value = {y,m,d} | null.
export function DatePill({ value, onChange, label = 'Due', empty = '+ Add date', icon = 'flag', bottom, variant = 'risk' }) {
  const { t, f } = useApp()
  const [open, setOpen] = useState(false)
  const has = !!value
  const skin = variant === 'accent' ? { c: t.accent, bg: t.accentBg, ln: t.accentLine }
    : variant === 'neutral' ? { c: t.t2, bg: t.sel, ln: 'transparent' }
    : { c: t.risk, bg: t.riskBg, ln: t.riskLine }
  return <span style={{ position: 'relative', display: 'inline-flex' }}>
    <span onClick={() => setOpen((o) => !o)} title="Set date" style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      cursor: 'pointer', fontFamily: f.ui, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
      color: has ? skin.c : t.t3, background: has ? skin.bg : t.sel,
      border: '1px solid ' + (has ? skin.ln : 'transparent'), borderRadius: 7, padding: '3px 9px',
      transition: 'background .14s, border-color .14s' }}
      onMouseEnter={(e) => { if (!has) e.currentTarget.style.background = t.tagBg }}
      onMouseLeave={(e) => { if (!has) e.currentTarget.style.background = t.sel }}>
      <Icon n={has ? icon : 'calendar-plus'} s={12} />{has ? (label ? label + ' ' : '') + fmtDate(value) : empty}</span>
    {open && <Popover onClose={() => setOpen(false)} width={262} bottom={bottom}>
      <MiniCal value={value} onPick={(d) => { onChange(d); setOpen(false) }} onClear={() => { onChange(null); setOpen(false) }} />
    </Popover>}
  </span>
}
