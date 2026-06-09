// App shell — sidebar (work spine + persistent surfaces), top bar (global Ask +
// quick capture), routing, theme engine. Direction B only; light/dark toggles
// via [data-theme] on <html>. Ported from the prototype's course-shell.jsx,
// wired to real Supabase data + the shared Claude proxy.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CourseCtx, useApp, useIsMobile } from './ctx'
import { useData } from './DataContext'
import { t, F } from './theme/tokens'
import { Icon, IconBtn, Btn, StatusPill, AreaDot, areaColor, usePersisted, Popover, PopRow, STATUS, statusSkin } from './kit'
import { TOPICS } from './data'
import { createArea, createProject, createNote, createTask, createInbox } from './lib/db'

import { OverviewScreen, AreaScreen } from './screens/Overview'
import { ProjectScreen } from './screens/Project'
import { NoteScreen } from './screens/Note'
import { AskScreen } from './screens/Ask'
import { InboxScreen } from './screens/Inbox'
import { LibraryScreen } from './screens/Library'
import { RecordScreen } from './screens/Record'
import { RecorderProvider, FloatingRecorder } from './RecorderContext'

// ── Sidebar ─────────────────────────────────────────────────────
function SidebarContent({ onClose }) {
  const { route, go } = useApp()
  const { areas, inbox, reload } = useData()
  const [open, setOpen] = usePersisted('course.areasOpen', () => Object.fromEntries(areas.map((a) => [a.id, a.open])))
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !(o[id] ?? (areas.find((a) => a.id === id) || {}).open) }))
  const isOpen = (a) => open[a.id] ?? a.open
  const [adding, setAdding] = useState(null)
  const [newName, setNewName] = useState('')

  const commitArea = async () => {
    const nm = newName.trim(); setNewName(''); setAdding(null)
    if (!nm) return
    try { const id = await createArea(nm, areas.length); await reload(); setOpen((o) => ({ ...o, [id]: true })); go({ screen: 'area', id }); onClose && onClose() }
    catch (e) { window.alert('Could not add area: ' + (e?.message || e)) }
  }
  const commitProject = async (areaId) => {
    const nm = newName.trim(); setNewName(''); setAdding(null)
    if (!nm) return
    try { const id = await createProject(areaId, nm, { sort: (areas.find((a) => a.id === areaId)?.projects.length) || 0 }); await reload(); setOpen((o) => ({ ...o, [areaId]: true })); go({ screen: 'project', id }); onClose && onClose() }
    catch (e) { window.alert('Could not add project: ' + (e?.message || e)) }
  }
  const addInputStyle = { width: '100%', border: '1px solid ' + t.line2, borderRadius: 7, outline: 0,
    background: t.card, fontFamily: F.ui, fontSize: 12.5, color: t.t1, padding: '6px 9px' }
  const inboxCount = inbox.length

  const nav = (icon, label, screen, badge) => {
    const active = route.screen === screen
    return <div onClick={() => { go({ screen }); onClose && onClose() }}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: F.ui,
        fontSize: 13, fontWeight: active ? 600 : 500, color: active ? t.t1 : t.t2, cursor: 'pointer',
        background: active ? t.sel : 'transparent', borderRadius: 8, padding: '8px 10px', marginBottom: 1,
        borderLeft: '2px solid ' + (active ? t.accent : 'transparent') }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = t.sel }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Icon n={icon} s={16} c={active ? t.t1 : t.t2} />{label}</span>
      {badge ? <span style={{ fontFamily: F.ui, fontSize: 11, fontWeight: 600, color: t.t1,
        background: t.accentBg, border: '1px solid ' + t.accentLine, padding: '0 7px', borderRadius: 10 }}>{badge}</span> : null}
    </div>
  }

  return <>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 8px 16px' }}>
      <span onClick={() => { go({ screen: 'overview' }); onClose && onClose() }} style={{ cursor: 'pointer' }}>
        <span style={{ fontFamily: F.title, fontSize: 22, fontWeight: F.titleW, color: t.t1, letterSpacing: F.titleSpacing }}>Course</span></span>
      {onClose && <IconBtn n="x" s={20} onClick={onClose} />}
    </div>

    {nav('layout-grid', 'Work', 'overview')}
    {nav('sparkles', 'Ask', 'ask')}
    {nav('inbox', 'Inbox', 'inbox', inboxCount)}
    {nav('stack-2', 'Library', 'library')}

    <div style={{ display: 'flex', alignItems: 'center', padding: '20px 10px 8px' }}>
      <span style={{ fontFamily: F.label, fontSize: 10, fontWeight: 600, letterSpacing: F.labelSpacing,
        textTransform: 'uppercase', color: t.t3, flex: 1 }}>Areas</span>
      <span onClick={() => { setAdding('area'); setNewName('') }} title="New area"
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: t.t3, borderRadius: 5, padding: 2 }}
        onMouseEnter={(e) => e.currentTarget.style.color = t.accent} onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
        <Icon n="plus" s={14} /></span>
    </div>
    <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
      {adding === 'area' && <div style={{ padding: '0 10px 6px' }}>
        <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitArea(); if (e.key === 'Escape') { setNewName(''); setAdding(null) } }}
          onBlur={() => { if (newName.trim()) commitArea(); else setAdding(null) }}
          placeholder="New area name…" style={addInputStyle} /></div>}
      {areas.map((a) => { const areaActive = route.screen === 'area' && route.id === a.id
        return <div key={a.id}>
          <div onClick={() => { go({ screen: 'area', id: a.id }); onClose && onClose() }}
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: F.ui, fontSize: 12.5, fontWeight: 600,
              color: areaActive ? t.t1 : t.t2, cursor: 'pointer', padding: '6px 10px', borderRadius: 7,
              background: areaActive ? t.sel : 'transparent', borderLeft: '2px solid ' + (areaActive ? t.accent : 'transparent') }}
            onMouseEnter={(e) => { if (!areaActive) e.currentTarget.style.background = t.sel }}
            onMouseLeave={(e) => { if (!areaActive) e.currentTarget.style.background = 'transparent' }}>
            <span onClick={(e) => { e.stopPropagation(); toggle(a.id) }} title="Expand projects" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              <Icon n={isOpen(a) ? 'chevron-down' : 'chevron-right'} s={13} c={t.t3} /></span>
            <AreaDot areaId={a.id} s={7} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
            <span style={{ fontFamily: F.ui, fontSize: 11, color: t.t3, fontVariantNumeric: 'tabular-nums' }}>{a.projects.length || ''}</span>
          </div>
          {isOpen(a) && a.projects.map((p) => { const active = route.screen === 'project' && route.id === p.id
            return <div key={p.id} onClick={() => { go({ screen: 'project', id: p.id }); onClose && onClose() }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: F.ui, fontSize: 12.5,
                fontWeight: active ? 600 : 500, color: active ? t.t1 : t.t2, cursor: 'pointer',
                padding: '6px 10px 6px 28px', borderRadius: 7, margin: '1px 0',
                background: active ? t.sel : 'transparent', borderLeft: '2px solid ' + (active ? t.accent : 'transparent') }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = t.sel }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, flex: 'none', background: p.status === 'active' ? t.accent : t.t3, opacity: p.status === 'on-hold' ? 0.5 : 1 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </div> })}
          {isOpen(a) && (adding === a.id
            ? <div style={{ padding: '2px 10px 4px 28px' }}>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitProject(a.id); if (e.key === 'Escape') { setNewName(''); setAdding(null) } }}
                  onBlur={() => { if (newName.trim()) commitProject(a.id); else setAdding(null) }}
                  placeholder="New project…" style={addInputStyle} /></div>
            : <div onClick={() => { setAdding(a.id); setNewName('') }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: F.ui, fontSize: 12, color: t.t3,
                  cursor: 'pointer', padding: '5px 10px 5px 28px', borderRadius: 7, margin: '1px 0' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.sel; e.currentTarget.style.color = t.t2 }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.t3 }}>
                <Icon n="plus" s={12} />Add project</div>)}
        </div> })}
    </div>

    <div style={{ fontFamily: F.label, fontSize: 10, fontWeight: 600, letterSpacing: F.labelSpacing,
      textTransform: 'uppercase', color: t.t3, padding: '20px 10px 8px' }}>Topics</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 8px 6px' }}>
      {TOPICS.map((tp) => <span key={tp} onClick={() => { go({ screen: 'library', tag: tp }); onClose && onClose() }}
        style={{ fontFamily: F.ui, fontSize: 11, fontWeight: 500, color: t.tagText, background: t.tagBg, borderRadius: 6, padding: '2px 9px', cursor: 'pointer' }}>{tp}</span>)}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: F.ui, fontSize: 10.5, color: t.t3,
      padding: '14px 10px 0', marginTop: 8, borderTop: '1px solid ' + t.line }}>
      <Icon n="cloud-check" s={13} c={t.t3} />Synced just now</div>
  </>
}

function Sidebar() {
  return <div style={{ width: 244, flex: 'none', borderRight: '1px solid ' + t.line, background: t.panel,
    display: 'flex', flexDirection: 'column', padding: '18px 12px', height: '100vh' }}>
    <SidebarContent /></div>
}

// ── Global search (search-first; Ask is the fall-through) ───────
const GROUP_META = { project: 'Projects', task: 'Tasks', doc: 'Notes & docs' }
function GlobalSearch() {
  const { go } = useApp()
  const { globalSearch } = useData()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const wrapRef = useRef(null); const inputRef = useRef(null)
  const results = useMemo(() => globalSearch(q, 9), [q, globalSearch])
  const qTrim = q.trim()
  const flat = useMemo(() => [...results.map((r) => ({ ...r, _row: 'result' })), { _row: 'ask' }], [results])
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const choose = (item) => {
    if (!item || item._row === 'ask') go({ screen: 'ask', query: qTrim || 'What did Jon say about novation last week?' })
    else if (item.type === 'project') go({ screen: 'project', id: item.id })
    else if (item.type === 'task') go({ screen: 'project', id: item.projectId })
    else if (item.type === 'doc') go({ screen: 'note', id: item.id })
    setOpen(false); setQ(''); inputRef.current && inputRef.current.blur()
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current && inputRef.current.blur() }
  }
  let idx = -1
  const grouped = ['project', 'task', 'doc'].map((g) => ({ g, items: results.filter((r) => r.type === g) })).filter((x) => x.items.length)
  const matchHi = (text) => {
    if (!qTrim) return text
    const lc = text.toLowerCase(); const i = lc.indexOf(qTrim.toLowerCase())
    if (i < 0) return text
    return <>{text.slice(0, i)}<span style={{ color: t.accent, fontWeight: 700 }}>{text.slice(i, i + qTrim.length)}</span>{text.slice(i + qTrim.length)}</>
  }
  const Row = ({ item, i }) => {
    const on = i === active
    const iconN = item.type === 'project' ? 'folder' : item.type === 'task' ? (item.done ? 'square-check' : 'square') : (item.kind === 'meeting' ? 'users' : item.kind === 'artifact' ? 'file-export' : 'file-text')
    const tag = item.type === 'task' ? (item.next ? 'Next' : item.waiting ? 'Waiting · ' + item.waiting : item.due ? item.due : item.done ? 'Done' : null)
      : item.type === 'doc' ? (item.kind === 'meeting' ? 'Meeting' : item.kind === 'artifact' ? 'Artifact' : 'Note')
      : (STATUS[item.status] ? STATUS[item.status].label : null)
    return <div onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(item) }}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 12px', borderRadius: 9, cursor: 'pointer', background: on ? t.sel : 'transparent' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 7, flex: 'none', background: on ? t.card : t.sel, border: '1px solid ' + (on ? t.line2 : 'transparent') }}>
        {item.type === 'project' ? <AreaDot areaId={item.area} s={9} /> : <Icon n={iconN} s={15} c={item.done ? t.t3 : t.t2} />}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: F.ui, fontSize: 13, fontWeight: 500, color: item.done ? t.t3 : t.t1,
        textDecoration: item.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{matchHi(item.title)}</span>
      {item.sub ? <span style={{ flex: 'none', fontFamily: F.ui, fontSize: 11.5, color: t.t3, whiteSpace: 'nowrap', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sub}</span> : null}
      {tag ? <span style={{ flex: 'none', fontFamily: F.ui, fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase',
        color: item.next ? t.accent : t.t3, background: item.next ? t.accentBg : t.tagBg, border: '1px solid ' + (item.next ? t.accentLine : 'transparent'), borderRadius: 6, padding: '2px 7px' }}>{tag}</span> : null}
    </div>
  }
  const askI = flat.length - 1; const askOn = active === askI; const showPanel = open && focused
  return <div ref={wrapRef} style={{ position: 'relative', flex: 1, maxWidth: 580 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: t.card, border: '1px solid ' + (showPanel ? t.accent : t.line2),
      borderRadius: showPanel && (grouped.length || qTrim) ? '10px 10px 0 0' : 10, padding: '0 13px', height: 40, transition: 'border-color .14s' }}>
      <Icon n="search" s={15} c={showPanel ? t.accent : t.t3} />
      <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => { setFocused(true); setOpen(true) }} onBlur={() => setFocused(false)} onKeyDown={onKey}
        placeholder="Search notes, tasks, projects…" style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: F.ui, fontSize: 13, color: t.t1 }} />
      {q ? <Icon n="x" s={15} c={t.t3} style={{ cursor: 'pointer' }} onMouseDown={(e) => { e.preventDefault(); setQ(''); inputRef.current && inputRef.current.focus() }} />
        : <span style={{ fontFamily: F.ui, fontSize: 10.5, color: t.t3, border: '1px solid ' + t.line2, borderRadius: 5, padding: '1px 6px' }}>/</span>}
    </div>
    {showPanel && <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 250, background: t.card,
      border: '1px solid ' + t.accent, borderTop: 'none', borderRadius: '0 0 12px 12px', boxShadow: t.shadow, overflow: 'hidden' }}>
      <div style={{ maxHeight: '62vh', overflowY: 'auto', padding: 6 }}>
        {qTrim && grouped.map(({ g, items }) => <div key={g} style={{ marginBottom: 2 }}>
          <div style={{ fontFamily: F.label, fontSize: 10, fontWeight: 600, letterSpacing: F.labelSpacing, textTransform: 'uppercase', color: t.t3, padding: '8px 12px 4px' }}>{GROUP_META[g]}</div>
          {items.map((item) => { idx += 1; return <Row key={item.type + item.id} item={item} i={idx} /> })}
        </div>)}
        {qTrim && grouped.length === 0 && <div style={{ fontFamily: F.ui, fontSize: 12.5, color: t.t3, padding: '14px 12px 8px' }}>No titles match “{qTrim}”.</div>}
        {!qTrim && <div style={{ fontFamily: F.ui, fontSize: 12.5, color: t.t3, padding: '14px 12px 6px', lineHeight: 1.5 }}>Search across every project, task, and note by title — or ask a question to search the contents.</div>}
      </div>
      <div onMouseEnter={() => setActive(askI)} onMouseDown={(e) => { e.preventDefault(); choose(flat[askI]) }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', borderTop: '1px solid ' + t.line, background: askOn ? t.accentBg : t.panel }}>
        <Icon n="sparkles" s={16} c={t.accent} />
        <span style={{ flex: 1, fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: t.t1 }}>
          {qTrim ? <>Ask Course — “<span style={{ color: t.accent }}>{qTrim}</span>”</> : 'Ask Course across everything'}</span>
        <span style={{ fontFamily: F.ui, fontSize: 11, color: t.t3 }}>searches contents</span>
        <span style={{ fontFamily: F.ui, fontSize: 10.5, color: t.t3, border: '1px solid ' + t.line2, borderRadius: 5, padding: '1px 6px' }}>↵</span>
      </div>
    </div>}
  </div>
}

// ── Top bar ─────────────────────────────────────────────────────
function TopBar({ onMenu, onCapture, isMobile }) {
  const { mode, setMode } = useApp()
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 22px', borderBottom: '1px solid ' + t.line, background: t.bg, flex: 'none' }}>
    {isMobile && <IconBtn n="menu-2" s={21} onClick={onMenu} />}
    <GlobalSearch />
    <div style={{ flex: 1 }} />
    <IconBtn n={mode === 'dark' ? 'moon' : 'sun'} s={18} title="Toggle light / dark" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} />
    <Btn kind="primary" icon="plus" onClick={onCapture}>New</Btn>
  </div>
}

// ── Quick capture (blend model) ─────────────────────────────────
function autoClassify(text) {
  const s = (text || '').toLowerCase()
  let kind = 'note'
  if (/\b(meeting|call|sync|stand-?up|1:1|transcript|kickoff|kick-off|debrief|review with)\b/.test(s)) kind = 'meeting'
  else if (/\b(new project|spin up|kick off|launch|initiative|engagement|build out|stand up a)\b/.test(s)) kind = 'project'
  else if (/\b(todo|to-do|task|follow[- ]?up|send|email|draft|finish|finalize|review|fix|schedule|confirm|ping|chase|prep|remind|book)\b/.test(s)) kind = 'task'
  const map = [['csp', /\b(csp|citrix|novation|pricing|telemetry|arrowsphere|emea)\b/],
    ['sgs', /\b(sgs|tracker|lénaïg|lenaig|ed lewis|nathalie|mattia|diane)\b/],
    ['maggetti', /\b(maggetti|proposal|mitch|listing|retainer|cover email)\b/],
    ['accenture', /\b(accenture|haritha|revised scope)\b/]]
  let home = null
  for (const [id, re] of map) { if (re.test(s)) { home = id; break } }
  return { kind, home }
}

function QuickCapture({ onClose, initial }) {
  const { go } = useApp()
  const { allProjects, projectById, projectName, areaById, areas, reload } = useData()
  const [text, setText] = useState('')
  const [kind, setKind] = useState((initial && initial.kind) || 'auto')
  const [home, setHome] = useState((initial && initial.home) || null)
  const [homeOpen, setHomeOpen] = useState(false)
  const projects = allProjects()
  const homeProj = home ? projectById(home) : null
  const isProject = kind === 'project'
  const [area, setArea] = useState(areas[0]?.id || 'arrow')
  const [areaOpen, setAreaOpen] = useState(false)
  const areaObj = areaById(area) || areas[0]
  const [projStatus, setProjStatus] = useState('active')
  const [statusOpen, setStatusOpen] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoResult, setAutoResult] = useState(null)
  const [expanded, setExpanded] = useState((initial && initial.expanded) || false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const record = () => { onClose(); go({ screen: 'record', project: home, title: text.trim() }) }
  const file = async () => {
    if (busy) return
    if (kind === 'meeting') { record(); return }
    setBusy(true)
    try {
      if (isProject) {
        const nm = (expanded ? title : text).trim() || 'New project'
        const id = await createProject(area, nm, { status: projStatus, sort: (areaObj?.projects.length) || 0 })
        await reload(); onClose(); go({ screen: 'project', id })
      } else if (kind === 'task') {
        const label = (expanded ? title : text).trim()
        if (home && label) { await createTask(home, { label }); await reload(); onClose(); go({ screen: 'project', id: home }) }
        else { await createInbox({ title: label || 'Task', src: 'capture', srcIcon: 'square-check', snippet: label, suggest: home ? { project: home, confidence: 0.9 } : null }); await reload(); onClose(); go({ screen: 'inbox' }) }
      } else {
        const ttl = (expanded ? title : '').trim() || (text.trim().split('\n')[0].slice(0, 60)) || 'Untitled note'
        if (home) {
          const p = projectById(home)
          await createNote({ kind: 'note', title: ttl, project: home, area: p?.area || null, date: todayStr, updated: 'now', body: text ? [{ p: text }] : [], status: 2 })
          await reload(); onClose(); go({ screen: 'project', id: home })
        } else {
          await createInbox({ title: ttl, src: 'capture', srcIcon: 'clipboard', snippet: text.slice(0, 200) })
          await reload(); onClose(); go({ screen: 'inbox' })
        }
      }
    } catch (e) { window.alert('Could not save: ' + (e?.message || e)); setBusy(false) }
  }
  const leaveInbox = async () => {
    if (busy) return; setBusy(true)
    try {
      const ttl = (text.trim().split('\n')[0].slice(0, 60)) || 'Capture'
      await createInbox({ title: ttl, src: 'capture', srcIcon: 'clipboard', snippet: text.slice(0, 200) })
      await reload(); onClose(); go({ screen: 'inbox' })
    } catch (e) { window.alert('Could not save: ' + (e?.message || e)); setBusy(false) }
  }
  const autoSort = () => { setAutoBusy(true); setTimeout(() => { const r = autoClassify(text); setKind(r.kind); if (r.home) setHome(r.home); setAutoResult(r); setAutoBusy(false) }, 650) }

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: expanded ? 0 : '12vh 0 0' }}>
    <div onClick={(e) => e.stopPropagation()} style={{
      ...(expanded ? { position: 'fixed', top: '4vh', bottom: '4vh', left: 'max(26px, calc((100vw - 920px) / 2))', right: 'max(26px, calc((100vw - 920px) / 2))' } : { flex: '0 0 560px', maxWidth: '92vw' }),
      background: t.card, border: '1px solid ' + t.line, borderRadius: 16, boxShadow: t.shadow, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 14px', borderBottom: '1px solid ' + t.line, flex: 'none' }}>
        {[['auto', 'Auto', 'sparkles'], ['note', 'Note', 'file-text'], ['meeting', 'Meeting', 'users'], ['task', 'Task', 'square-check'], ['project', 'Project', 'folder']].map(([id, label, icon]) =>
          <span key={id} onClick={() => { setKind(id); if (id === 'auto') setAutoResult(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F.ui, fontSize: 12.5, fontWeight: 600, color: kind === id ? t.t1 : t.t3, background: kind === id ? t.sel : 'transparent', borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}>
            <Icon n={icon} s={14} />{label}</span>)}
        <div style={{ flex: 1 }} />
        <IconBtn n={expanded ? 'arrows-diagonal-minimize-2' : 'arrows-diagonal'} s={17} title={expanded ? 'Collapse' : 'Expand to full page'} onClick={() => setExpanded((e) => !e)} />
        <IconBtn n="x" s={18} onClick={onClose} />
      </div>
      {autoResult && kind !== 'auto' && <div style={{ margin: '12px 14px 0', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', borderRadius: 10, background: t.accentBg, border: '1px solid ' + t.accentLine }}>
        <Icon n="sparkles" s={14} c={t.accent} />
        <span style={{ fontFamily: F.ui, fontSize: 12.5, color: t.t2 }}>Sorted as <span style={{ color: t.t1, fontWeight: 600 }}>{({ note: 'Note', meeting: 'Meeting', task: 'Task', project: 'Project' })[autoResult.kind]}</span>{autoResult.home ? <> · suggested <span style={{ color: t.t1, fontWeight: 600 }}>{projectName(autoResult.home)}</span></> : ''} — adjust or confirm below.</span></div>}
      {kind === 'meeting' && <div onClick={record} style={{ margin: '12px 14px 0', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, cursor: 'pointer', background: t.accentBg, border: '1px solid ' + t.accentLine }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = t.accent} onMouseLeave={(e) => e.currentTarget.style.borderColor = t.accentLine}>
        <span style={{ width: 30, height: 30, borderRadius: 8, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.card, border: '1px solid ' + t.accentLine }}><Icon n="microphone" s={16} c={t.accent} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: t.t1 }}>Record live</div>
          <div style={{ fontFamily: F.ui, fontSize: 11.5, color: t.t3 }}>Capture audio and transcribe with speaker labels</div></div>
        <Icon n="arrow-right" s={16} c={t.accent} /></div>}
      <div style={{ flex: expanded ? 1 : 'none', display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: expanded ? 'auto' : 'visible', padding: expanded ? '6px 34px 8px' : 0 }}>
        {expanded && kind !== 'auto' && <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === 'project' ? 'Project name…' : kind === 'task' ? 'Task…' : kind === 'meeting' ? 'Meeting title…' : 'Title…'}
          style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontFamily: F.title, fontSize: 30, fontWeight: F.titleW, letterSpacing: F.titleSpacing, color: t.t1, padding: '16px 0 6px', lineHeight: 1.15 }} className="selectable" />}
        <textarea autoFocus={!expanded || kind === 'auto'} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={kind === 'auto' ? 'Capture anything — I’ll sort it into a note, task, meeting, or project…' : kind === 'meeting' ? 'Or paste a transcript to synthesize…' : kind === 'task' ? 'What needs doing?' : kind === 'project' ? (expanded ? 'What’s the outcome? Notes, scope, definition of done…' : 'Name the project — what’s the outcome?') : (expanded ? 'Start writing…' : 'Capture anything…')}
          className="selectable" style={{ width: '100%', flex: expanded ? 1 : 'none', minHeight: expanded ? 0 : 120, border: 0, outline: 0, resize: 'none', background: 'transparent', fontFamily: F.body, fontSize: expanded ? 16 : 15, lineHeight: expanded ? 1.7 : 1.55, color: t.t1, padding: expanded ? '4px 0 12px' : '16px 16px 8px' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid ' + t.line, flexWrap: 'wrap', flex: 'none' }}>
        {kind === 'auto' ? <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F.ui, fontSize: 12, color: t.t3 }}><Icon n="sparkles" s={13} c={t.accent} />I’ll detect the type and suggest where it goes</span>
          <div style={{ flex: 1 }} />
          <Btn kind="primary" size="sm" icon={autoBusy ? 'loader-2' : 'wand'} onClick={autoSort}>{autoBusy ? 'Sorting…' : 'Auto-sort'}</Btn>
        </> : isProject ? <>
          <span style={{ fontFamily: F.label, fontSize: 10, fontWeight: 600, letterSpacing: F.labelSpacing, textTransform: 'uppercase', color: t.t3, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon n="layout-grid" s={12} />Project</span>
          <span style={{ position: 'relative' }}>
            <span onClick={() => setAreaOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}>
              <AreaDot areaId={areaObj?.id} s={7} />{areaObj?.name}<Icon n="chevron-down" s={12} c={t.t3} /></span>
            {areaOpen && <Popover onClose={() => setAreaOpen(false)} width={210} bottom="calc(100% + 6px)">
              {areas.map((a) => <PopRow key={a.id} dot={areaColor(t, a.id)} label={a.name} hint={(a.projects.length || 0) + ' projects'} on={area === a.id} onClick={() => { setArea(a.id); setAreaOpen(false) }} />)}</Popover>}
          </span>
          <span style={{ position: 'relative' }}>
            <StatusPill id={projStatus} open={statusOpen} onClick={() => setStatusOpen((o) => !o)} />
            {statusOpen && <Popover onClose={() => setStatusOpen(false)} width={200} bottom="calc(100% + 6px)">
              {['idea', 'next-up', 'active', 'on-hold'].map((k) => <PopRow key={k} dot={statusSkin(t, k).dot} label={STATUS[k].label} hint={STATUS[k].hint} on={projStatus === k} onClick={() => { setProjStatus(k); setStatusOpen(false) }} />)}</Popover>}
          </span>
          <div style={{ flex: 1 }} />
          <Btn kind="primary" size="sm" icon="folder-plus" onClick={file}>{busy ? 'Creating…' : 'Create project'}</Btn>
        </> : <>
          <span style={{ fontFamily: F.label, fontSize: 10, fontWeight: 600, letterSpacing: F.labelSpacing, textTransform: 'uppercase', color: t.accent, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon n="sparkles" s={12} />Suggested home</span>
          <span style={{ position: 'relative' }}>
            <span onClick={() => setHomeOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: F.ui, fontSize: 13, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}>
              {homeProj ? <><AreaDot areaId={homeProj.area} s={7} />{homeProj.name}</> : <span style={{ color: t.t3, fontWeight: 500 }}>Choose project…</span>}<Icon n="chevron-down" s={12} c={t.t3} /></span>
            {homeOpen && <Popover onClose={() => setHomeOpen(false)} width={230} bottom="calc(100% + 6px)" maxHeight={260}>
              <PopRow icon="inbox" label="No project — leave in inbox" on={!home} onClick={() => { setHome(null); setHomeOpen(false) }} />
              {projects.map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={p.areaName} on={home === p.id} onClick={() => { setHome(p.id); setHomeOpen(false) }} />)}</Popover>}
          </span>
          <div style={{ flex: 1 }} />
          <Btn kind="ghost" size="sm" onClick={leaveInbox}>Leave in inbox</Btn>
          <Btn kind="primary" size="sm" icon={kind === 'meeting' ? 'wand' : 'corner-down-left'} onClick={file}>{busy ? 'Saving…' : kind === 'meeting' ? 'Record' : kind === 'task' ? 'Add task' : 'File note'}</Btn>
        </>}
      </div>
    </div>
  </div>
}

// ── Screen router ───────────────────────────────────────────────
function Screen() {
  const { route } = useApp()
  switch (route.screen) {
    case 'overview': return <OverviewScreen />
    case 'area':     return <AreaScreen key={route.id} />
    case 'project':  return <ProjectScreen key={route.id} />
    case 'note':     return <NoteScreen key={route.id} />
    case 'ask':      return <AskScreen />
    case 'inbox':    return <InboxScreen />
    case 'library':  return <LibraryScreen />
    case 'record':   return <RecordScreen key={route.project || 'rec'} />
    default:         return <OverviewScreen />
  }
}

function FullScreenMsg({ children, spin }) {
  return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: t.bg, color: t.t2, fontFamily: F.ui, fontSize: 14 }}>
    {spin && <Icon n="loader-2" s={18} c={t.t1} />}{children}</div>
}

export default function App() {
  const { status, error, reload } = useData()
  const isMobile = useIsMobile()
  const [drawer, setDrawer] = useState(false)
  const [capture, setCapture] = useState(false)
  const [mode, setModeRaw] = useState(() => localStorage.getItem('course.mode') || 'light')
  const [route, setRoute] = useState(() => { try { return JSON.parse(localStorage.getItem('course.route')) || { screen: 'overview' } } catch { return { screen: 'overview' } } })

  const setMode = (m) => { setModeRaw(m); localStorage.setItem('course.mode', m) }
  const go = (r) => { setRoute(r); localStorage.setItem('course.route', JSON.stringify(r)); setDrawer(false); const sc = document.getElementById('course-scroll'); if (sc) sc.scrollTop = 0 }
  useEffect(() => { document.documentElement.setAttribute('data-theme', mode) }, [mode])
  useEffect(() => { if (!isMobile) setDrawer(false) }, [isMobile])

  const ctx = useMemo(() => ({ t, f: F, mode, setMode, route, go, isMobile, openCapture: (cfg) => setCapture(cfg || true) }), [mode, route, isMobile])

  if (status === 'loading') return <FullScreenMsg spin>Loading your work…</FullScreenMsg>
  if (status === 'error') return <FullScreenMsg>Couldn’t load — {String(error?.message || error)}.&nbsp;<span onClick={reload} style={{ color: t.t1, textDecoration: 'underline', cursor: 'pointer' }}>retry</span></FullScreenMsg>

  return <CourseCtx.Provider value={ctx}>
    <RecorderProvider go={go}>
      <div style={{ display: 'flex', height: '100vh', background: t.bg, color: t.t1, fontFamily: F.body }}>
        {!isMobile && <Sidebar />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <TopBar onMenu={() => setDrawer(true)} onCapture={() => setCapture(true)} isMobile={isMobile} />
          <div id="course-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}><Screen /></div>
        </div>
        {isMobile && drawer && <div onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 288, maxWidth: '86%', height: '100%', background: t.panel, borderRight: '1px solid ' + t.line, display: 'flex', flexDirection: 'column', padding: '16px 12px', boxShadow: t.shadow }}>
            <SidebarContent onClose={() => setDrawer(false)} /></div></div>}
        {capture && <QuickCapture initial={capture === true ? null : capture} onClose={() => setCapture(false)} />}
        <FloatingRecorder />
      </div>
    </RecorderProvider>
  </CourseCtx.Provider>
}
