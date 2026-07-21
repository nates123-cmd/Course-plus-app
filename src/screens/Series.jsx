// Series.jsx — a recurring meeting (e.g. "Jon 1:1"). Owns its instances
// (cp_notes kind='meeting' with series_id), holds standing context + default
// attendees/links, rolls up open next-steps across instances, and offers AI prep
// for the next meeting + cross-instance synthesis (the arc, open threads,
// commitments). New meetings launch the composer pre-filled from the defaults.
import { useEffect, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, IconBtn, Card, Label, Person, AreaDot, areaColor, Popover, PopRow, STATUS, TODAY, MONTHS } from '../kit'
import { createSeries, updateSeries, deleteSeries, updateNote } from '../lib/db'
import { prepFromSeries, synthesizeSeries, askAcrossSeries } from '../lib/ai'
import { buildSeriesAgenda, titlesForSeries, normalizeTitle } from '../lib/seriesAgenda'
import { supabase } from '../lib/supabase'
import { RichText } from '../components/RichText'
import { MdEditor } from '../components/MdEditor'

const STATUS_RANK = { active: 0, sent: 1, 'on-hold': 2, idea: 3, archived: 4 }

// ── the real recurrence: this user's calendar ───────────────────────
// placed_blocks is written by the Today app's ical ingest and read by the
// Agenda screen. A series binds to it BY TITLE (see lib/seriesAgenda) because
// Today regenerates the rows, so block ids aren't stable — the same reason
// cp_tasks.meeting_id stores a title.
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmtHour = (h) => {
  const hr = Math.floor(h), m = String(Math.round((h - hr) * 60)).padStart(2, '0')
  return `${hr > 12 ? hr - 12 : hr === 0 ? 12 : hr}:${m}${hr < 12 ? 'a' : 'p'}`
}
const fmtWhen = (b) => {
  const [y, m, d] = (b.date || '').split('-').map(Number)
  if (!y) return ''
  return `${MONTHS[m - 1]} ${d} · ${fmtHour(b.hour)}`
}
function useUpcomingMeetings(days = 42) {
  const [blocks, setBlocks] = useState([])
  useEffect(() => {
    let cancelled = false
    const start = new Date(TODAY.y, TODAY.m, TODAY.d)
    const end = new Date(TODAY.y, TODAY.m, TODAY.d + days)
    supabase.from('placed_blocks').select('*').eq('type', 'meeting')
      .gte('date', isoLocal(start)).lte('date', isoLocal(end))
      .order('date', { ascending: true }).order('hour', { ascending: true })
      .then(({ data, error }) => {
        // A calendar read failing must never break the series screen — it only
        // costs the "next meeting" line and the title suggestions.
        if (cancelled || error) return
        setBlocks((data || []).map((r) => ({ id: r.id, date: r.date, hour: Number(r.hour), title: (r.title || '').trim() })))
      })
    return () => { cancelled = true }
  }, [days])
  return blocks
}

export function SeriesScreen() {
  const { t, f, go, route, isMobile, aiName } = useApp()
  const { seriesById, instancesForSeries, openThreadsForSeries, openTasksForSeries, projectById, areaOfProject, allProjects, notes, reload } = useData()
  if (!route.id) return <SeriesIndex />
  const s = seriesById(route.id)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [cadence, setCadence] = useState('')
  const [stand, setStand] = useState('')
  const [tpl, setTpl] = useState('')
  const [people, setPeople] = useState([])
  const [eProject, setEProject] = useState(null)
  const [eProjects, setEProjects] = useState([])
  const [personDraft, setPersonDraft] = useState('')
  const [homeOpen, setHomeOpen] = useState(false)
  const [projOpen, setProjOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [prep, setPrep] = useState('')
  const [prepBusy, setPrepBusy] = useState(false)
  const [syn, setSyn] = useState(null)
  const [synBusy, setSynBusy] = useState(false)
  const [err, setErr] = useState(null)

  const [calTitles, setCalTitles] = useState([])
  const [calOpen, setCalOpen] = useState(false)
  const [calDraft, setCalDraft] = useState('')
  const upcoming = useUpcomingMeetings()

  const [pickOpen, setPickOpen] = useState(false)
  const [pickSel, setPickSel] = useState(() => new Set())
  const [pickQ, setPickQ] = useState('')
  const [attaching, setAttaching] = useState(false)

  if (!s) return <div style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '24px 18px 80px' : '30px 36px 90px', fontFamily: f.ui, color: t.t3 }}>
    Series not found. <span onClick={() => go({ screen: 'overview' })} style={{ color: t.accent, cursor: 'pointer' }}>Back to Work</span>
  </div>

  const instances = instancesForSeries(s.id)
  const openThreads = openThreadsForSeries(s.id)
  const openTasks = openTasksForSeries(s.id)
  // The calendar side of this series: its own upcoming blocks, and the distinct
  // meeting titles on the calendar that could be bound to it.
  const myTitles = titlesForSeries(s)
  const mine = upcoming.filter((b) => myTitles.has(normalizeTitle(b.title)))
  const nextBlock = mine[0] || null
  const suggestTitles = [...new Map(upcoming
    .filter((b) => b.title && !myTitles.has(normalizeTitle(b.title)))
    .map((b) => [normalizeTitle(b.title), b.title])).values()]
  const pickerProjects = [...allProjects()].sort((a, b) => (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5))

  const startEdit = () => {
    setName(s.name || ''); setCadence(s.cadence || ''); setStand(s.standingContext || ''); setTpl(s.standingAgenda || '')
    setPeople(s.people || []); setEProject(s.project || null); setEProjects(s.projects || [])
    setCalTitles(s.calendarTitles || []); setCalDraft('')
    setEditing(true)
  }
  const addPerson = () => { const nm = personDraft.trim(); setPersonDraft(''); if (nm && !people.includes(nm)) setPeople([...people, nm]) }
  const addProj = (id) => setEProjects((xs) => xs.includes(id) ? xs : [...xs, id])
  const removeProj = (id) => setEProjects((xs) => xs.filter((x) => x !== id))
  const saveEdit = async () => {
    setSaving(true); setErr(null)
    try {
      const linked = [...new Set([eProject, ...eProjects].filter(Boolean))]
      await updateSeries(s.id, {
        name: name.trim() || 'Untitled series', cadence: cadence.trim() || null,
        standingContext: stand, standingAgenda: tpl, calendarTitles: calTitles, people, project: eProject || null,
        area: eProject ? (areaOfProject(eProject)?.id || null) : (s.area || null),
        projects: linked,
      })
      await reload(); setEditing(false)
    } catch (e) { setErr(e) } finally { setSaving(false) }
  }
  const removeThis = async () => {
    if (!window.confirm(`Delete the series "${s.name}"? Its ${instances.length} meeting${instances.length === 1 ? '' : 's'} are kept (just unlinked).`)) return
    try { await deleteSeries(s.id); await reload(); go({ screen: 'overview' }) }
    catch (e) { window.alert('Could not delete: ' + (e?.message || e)) }
  }

  // Instances as the {date,summary,nextSteps,actions} digest the AI calls expect.
  const aiInstances = instances.map((n) => ({ date: n.date, title: n.title, summary: n.summary || '', nextSteps: n.nextSteps || '', actions: n.actions || [] }))

  const genPrep = async () => {
    setPrepBusy(true); setErr(null)
    try {
      const r = await prepFromSeries({
        name: s.name, standingContext: s.standingContext, standingAgenda: s.standingAgenda,
        cadence: s.cadence, instances: aiInstances, openTasks: openTasks.map((tk) => tk.label),
      })
      setPrep(r.agenda || '')
    } catch (e) { setErr(e) } finally { setPrepBusy(false) }
  }
  const genSyn = async () => {
    setSynBusy(true); setErr(null)
    try {
      const r = await synthesizeSeries({ name: s.name, standingContext: s.standingContext, instances: aiInstances })
      setSyn(r)
    } catch (e) { setErr(e) } finally { setSynBusy(false) }
  }
  // Composition of the pre-fill lives in lib/seriesAgenda so the composer builds
  // the identical agenda when a meeting is opened from the calendar instead.
  const newMeeting = () => go({
    screen: 'meeting', series: s.id,
    title: nextBlock?.title || undefined,
    agenda: buildSeriesAgenda({ series: s, openTasks, openThreads, prep }),
  })

  // Existing meeting notes not already in THIS series — candidates to attach.
  const candidates = notes
    .filter((n) => n.kind === 'meeting' && n.seriesId !== s.id)
    .filter((n) => { const q = pickQ.trim().toLowerCase(); return !q || (n.title || '').toLowerCase().includes(q) })
  const togglePick = (id) => setPickSel((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const openPicker = () => { setPickSel(new Set()); setPickQ(''); setPickOpen(true) }
  const attachPicked = async () => {
    if (!pickSel.size || attaching) return
    setAttaching(true); setErr(null)
    try {
      for (const id of pickSel) await updateNote(id, { seriesId: s.id })
      await reload(); setPickOpen(false); setPickSel(new Set())
    } catch (e) { setErr(e) } finally { setAttaching(false) }
  }
  const detachOne = async (id) => {
    if (!window.confirm('Remove this meeting from the series? The meeting note is kept.')) return
    try { await updateNote(id, { seriesId: null }); await reload() }
    catch (e) { window.alert('Could not detach: ' + (e?.message || e)) }
  }

  const defProj = projectById(s.project)
  const cardP = { padding: '16px 18px' }

  return <div data-screen-label={'Series · ' + s.name} style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '24px 18px 80px' : '30px 36px 90px' }}>
    {/* breadcrumb */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: f.ui, fontSize: 12, color: t.t3, marginBottom: 14 }}>
      <span onClick={() => go({ screen: 'overview' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
        <Icon n="chevron-left" s={15} />Work</span>
    </div>

    {/* attach-existing picker */}
    {pickOpen && <div onClick={() => !attaching && setPickOpen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.bg, border: '1px solid ' + t.line, borderRadius: isMobile ? '16px 16px 0 0' : 14, width: '100%', maxWidth: 560, maxHeight: isMobile ? '85vh' : '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid ' + t.line }}>
          <Icon n="link" s={18} c={t.accent} />
          <span style={{ fontFamily: f.title, fontSize: 17, fontWeight: f.titleW, color: t.t1, flex: 1 }}>Add existing meetings</span>
          <IconBtn n="x" s={20} onClick={() => !attaching && setPickOpen(false)} />
        </div>
        <div style={{ padding: '12px 18px 0' }}>
          <input value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder="Search meetings…"
            style={{ width: '100%', border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 14, color: t.t1, padding: '8px 11px' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 0', minHeight: 0 }}>
          {candidates.length === 0
            ? <div style={{ padding: '24px 8px', textAlign: 'center', fontFamily: f.ui, fontSize: 13, color: t.t3 }}>No meetings to add.</div>
            : candidates.map((n) => { const on = pickSel.has(n.id); const other = n.seriesId && n.seriesId !== s.id
                return <div key={n.id} onClick={() => togglePick(n.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 8, cursor: 'pointer', background: on ? t.sel : 'transparent' }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = t.sel }} onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent' }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid ' + (on ? t.accent : t.line2), background: on ? t.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {on && <Icon n="check" s={13} c="#fff" />}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                    <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>{n.date}{other ? ' · in another series' : ''}</div>
                  </div>
                </div> })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: '1px solid ' + t.line }}>
          <span style={{ flex: 1, fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>{pickSel.size} selected</span>
          <Btn kind="ghost" size="sm" onClick={() => !attaching && setPickOpen(false)}>Cancel</Btn>
          <Btn kind="primary" size="sm" icon={attaching ? 'loader-2' : 'link'} onClick={attachPicked}>{attaching ? 'Attaching…' : `Attach${pickSel.size ? ' ' + pickSel.size : ''}`}</Btn>
        </div>
      </div>
    </div>}

    {/* header */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
      <Icon n="repeat" s={18} c={t.accent} />
      <span style={{ fontFamily: f.label, fontSize: 10.5, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent }}>Recurring meeting</span>
      <div style={{ flex: 1 }} />
      {editing
        ? <span style={{ display: 'flex', gap: 8 }}>
            <Btn kind="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Btn>
            <Btn kind="primary" size="sm" icon={saving ? 'loader-2' : 'circle-check'} onClick={saveEdit}>{saving ? 'Saving…' : 'Save'}</Btn>
          </span>
        : <span style={{ display: 'flex', gap: 8 }}>
            <IconBtn n="trash" s={17} title="Delete series" onClick={removeThis} />
            <Btn kind="outline" size="sm" icon="pencil" onClick={startEdit}>Edit</Btn>
            <Btn kind="outline" size="sm" icon="link" onClick={openPicker}>Add existing</Btn>
            <Btn kind="primary" size="sm" icon="plus" onClick={newMeeting}>New meeting</Btn>
          </span>}
    </div>

    {editing
      ? <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Series name…" className="selectable" autoFocus
          style={{ width: '100%', border: 0, outline: 0, background: 'transparent', fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15 }} />
      : <h1 style={{ margin: 0, fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15 }}>{s.name}</h1>}

    {/* meta row */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>{instances.length} meeting{instances.length === 1 ? '' : 's'}</span>
      {s.cadence && <span style={{ fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.t2, background: t.sel, borderRadius: 7, padding: '2px 9px' }}>{s.cadence}</span>}
      {nextBlock && <span onClick={() => go({ screen: 'agenda' })} title="On your calendar"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11.5, fontWeight: 600, color: t.accent, background: t.accentBg, border: '1px solid ' + t.accentLine, borderRadius: 7, padding: '2px 9px', cursor: 'pointer' }}>
        <Icon n="calendar" s={12} c={t.accent} />Next {fmtWhen(nextBlock)}</span>}
      {defProj && <span onClick={() => go({ screen: 'project', id: defProj.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12, color: t.t2, cursor: 'pointer' }}>
        · <AreaDot areaId={defProj.area} s={6} />{defProj.name}</span>}
      {!editing && (s.people || []).map((p) => <Person key={p} size="sm">{p}</Person>)}
    </div>

    {/* edit panel */}
    {editing && <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Cadence</span>
        <input value={cadence} onChange={(e) => setCadence(e.target.value)} placeholder="weekly, biweekly…"
          style={{ border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 12.5, color: t.t1, padding: '5px 10px', width: 180 }} />
      </div>
      {/* calendar binding — the series' link to the REAL recurring meeting */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
          <Label style={{ margin: 0 }}>On the calendar</Label>
          <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>opening this meeting from the Agenda files it here</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {calTitles.map((ct) => <span key={ct} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '5px 7px 5px 10px' }}>
            <Icon n="calendar" s={13} c={t.t3} />{ct}
            <span onClick={() => setCalTitles(calTitles.filter((x) => x !== ct))} title="Remove" style={{ display: 'inline-flex', cursor: 'pointer', color: t.t3 }}><Icon n="x" s={13} /></span></span>)}
          <span style={{ position: 'relative' }}>
            <span onClick={() => setCalOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.accent, background: t.accentBg, border: '1px solid ' + t.accentLine, borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
              <Icon n="plus" s={13} />Link a calendar meeting</span>
            {calOpen && <Popover onClose={() => setCalOpen(false)} width={280} maxHeight={300}>
              {suggestTitles.length === 0
                ? <div style={{ padding: '10px 12px', fontFamily: f.ui, fontSize: 12, color: t.t3 }}>No other meetings on the next 6 weeks of your calendar.</div>
                : suggestTitles.filter((ct) => !calTitles.includes(ct)).map((ct) => <PopRow key={ct} icon="calendar" label={ct}
                    onClick={() => { setCalTitles([...calTitles, ct]); setCalOpen(false) }} />)}
            </Popover>}
          </span>
          <input value={calDraft} onChange={(e) => setCalDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = calDraft.trim(); setCalDraft(''); if (v && !calTitles.includes(v)) setCalTitles([...calTitles, v]) } }}
            placeholder="or type the exact title…"
            style={{ border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 12.5, color: t.t1, padding: '5px 10px', width: 190 }} />
        </div>
        <span style={{ display: 'block', fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 8 }}>
          The series name itself always matches, so a series named exactly like the calendar block needs nothing here.
        </span>
      </div>
      {/* default project */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>Default project</span>
        <span style={{ position: 'relative' }}>
          <span onClick={() => setHomeOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: projectById(eProject) ? t.t1 : t.t3, background: projectById(eProject) ? t.sel : 'transparent', border: projectById(eProject) ? 'none' : '1px solid ' + t.line, borderRadius: 8, padding: '5px 11px', cursor: 'pointer' }}>
            {projectById(eProject) ? <AreaDot areaId={projectById(eProject).area} s={7} /> : null}{projectById(eProject) ? projectById(eProject).name : 'No project'}<Icon n="chevron-down" s={12} c={t.t3} /></span>
          {homeOpen && <Popover onClose={() => setHomeOpen(false)} width={232} maxHeight={300}>
            <PopRow icon="ban" label="No project" on={!eProject} onClick={() => { setEProject(null); setHomeOpen(false) }} />
            {pickerProjects.map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={STATUS[p.status] ? STATUS[p.status].label : ''} on={eProject === p.id}
              onClick={() => { setEProject(p.id); setHomeOpen(false) }} />)}
          </Popover>}
        </span>
      </div>
      {/* default projects discussed */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <Label style={{ margin: 0 }}>Default projects discussed</Label>
          <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>pre-tagged on every new meeting</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {eProjects.map((id) => { const p = projectById(id); if (!p) return null
            return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '5px 7px 5px 10px' }}>
              <AreaDot areaId={p.area} s={7} />{p.name}
              <span onClick={() => removeProj(id)} title="Remove" style={{ display: 'inline-flex', cursor: 'pointer', color: t.t3 }}><Icon n="x" s={13} /></span></span> })}
          <span style={{ position: 'relative' }}>
            <span onClick={() => setProjOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.accent, background: t.accentBg, border: '1px solid ' + t.accentLine, borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
              <Icon n="plus" s={13} />Add project</span>
            {projOpen && <Popover onClose={() => setProjOpen(false)} width={232} maxHeight={280}>
              {pickerProjects.filter((p) => !eProjects.includes(p.id)).map((p) => <PopRow key={p.id} dot={areaColor(t, p.area)} label={p.name} hint={p.areaName} onClick={() => { addProj(p.id); setProjOpen(false) }} />)}
            </Popover>}
          </span>
        </div>
      </div>
      {/* attendees */}
      <div>
        <Label style={{ marginBottom: 9 }}>Regular attendees</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {people.map((p) => <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, color: t.t1, background: t.sel, borderRadius: 8, padding: '5px 7px 5px 10px' }}>
            {p}<span onClick={() => setPeople(people.filter((x) => x !== p))} title="Remove" style={{ display: 'inline-flex', cursor: 'pointer', color: t.t3 }}><Icon n="x" s={13} /></span></span>)}
          <input value={personDraft} onChange={(e) => setPersonDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson() } }} onBlur={addPerson} placeholder="Add name…"
            style={{ border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 12.5, color: t.t1, padding: '5px 10px', width: 130 }} />
        </div>
      </div>
      {/* standing agenda — the literal template, not AI fuel */}
      <div>
        <Label style={{ marginBottom: 9 }}>Standing agenda</Label>
        <span style={{ display: 'block', fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginBottom: 8 }}>The checklist you walk every time. Copied into every new meeting as-is — no AI, no rewriting.</span>
        <MdEditor value={tpl} onChange={setTpl} minHeight={160} />
      </div>
      {/* standing context */}
      <div>
        <Label style={{ marginBottom: 9 }}>Standing context</Label>
        <span style={{ display: 'block', fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginBottom: 8 }}>Who they are and what matters to them — background fed to every prep + synthesis, not printed into the meeting.</span>
        <MdEditor value={stand} onChange={setStand} minHeight={200} />
      </div>
    </div>}

    {err && <div style={{ marginTop: 14, fontFamily: f.ui, fontSize: 12.5, color: t.risk }}>{String(err?.message || err)}</div>}

    {!editing && <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* calendar reconciliation — a series nobody linked stays a parallel
          universe: meetings started from the Agenda never reach it. */}
      {!nextBlock && upcoming.length > 0 && <Card style={{ ...cardP, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon n="calendar-off" s={17} c={t.t3} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>Not linked to your calendar</div>
          <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>Link the recurring block and starting it from the Agenda files the meeting here, with this agenda.</span>
        </div>
        <Btn kind="outline" size="sm" icon="link" onClick={startEdit}>Link it</Btn>
      </Card>}

      {/* standing agenda — what every instance opens with */}
      {s.standingAgenda && s.standingAgenda.trim()
        ? <Card style={cardP}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Label style={{ margin: 0, flex: 1 }}>Standing agenda</Label>
              <span style={{ fontFamily: f.ui, fontSize: 11, color: t.t3 }}>copied into every new meeting</span>
            </div>
            <RichText text={s.standingAgenda} />
          </Card>
        : <Card style={{ ...cardP, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Label style={{ marginBottom: 4 }}>Standing agenda</Label>
              <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>The checklist you walk every time. Set one and every new meeting opens with it.</span>
            </div>
            <Btn kind="outline" size="sm" icon="pencil" onClick={startEdit}>Set one</Btn>
          </Card>}

      {/* standing context */}
      {s.standingContext && s.standingContext.trim() && <Card style={cardP}>
        <Label style={{ marginBottom: 10 }}>Standing context</Label>
        <RichText text={s.standingContext} />
      </Card>}

      {/* prep next meeting */}
      <Card style={{ ...cardP, background: t.accentBg, borderColor: t.accentLine }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: prep ? 12 : 0, flexWrap: 'wrap' }}>
          <Label style={{ color: t.accent, margin: 0, flex: 1 }}>Prep the next meeting</Label>
          <Btn kind="outline" size="sm" icon={prepBusy ? 'loader-2' : 'sparkles'} onClick={() => !prepBusy && genPrep()}>{prepBusy ? 'Thinking…' : prep ? 'Regenerate' : `Draft agenda with ${aiName}`}</Btn>
          <Btn kind="primary" size="sm" icon="plus" onClick={newMeeting}>Start meeting</Btn>
        </div>
        {prep && <RichText text={prep} />}
        {/* Spell out exactly what "Start meeting" will put in the composer, so the
            pre-fill is never a surprise. */}
        <div style={{ marginTop: prep ? 12 : 0, fontFamily: f.ui, fontSize: 12.5, color: t.t2, lineHeight: 1.6 }}>
          {(() => {
            const bits = []
            if (s.standingAgenda && s.standingAgenda.trim()) bits.push('your standing agenda')
            if (openTasks.length) bits.push(`${openTasks.length} open task${openTasks.length === 1 ? '' : 's'} from earlier meetings`)
            if (prep && prep.trim()) bits.push('this prep')
            else if (openThreads.length) bits.push(`next steps from ${openThreads.length} past meeting${openThreads.length === 1 ? '' : 's'}`)
            return bits.length
              ? <>Starting a meeting opens the composer with {bits.join(', ')}.</>
              : <>Nothing to carry forward yet. Set a standing agenda, or draft an agenda with {aiName}.</>
          })()}
        </div>
      </Card>

      {/* series synthesis */}
      <Card style={cardP}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: syn ? 14 : 0, flexWrap: 'wrap' }}>
          <Label style={{ margin: 0, flex: 1 }}>Across the series</Label>
          <Btn kind="outline" size="sm" icon={synBusy ? 'loader-2' : 'sparkles'} onClick={() => { if (!synBusy && instances.length) genSyn() }}>{synBusy ? 'Reading all meetings…' : syn ? 'Refresh' : 'Synthesize series'}</Btn>
        </div>
        {instances.length === 0 && !syn && <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t3 }}>No meetings yet — synthesis lights up once this series has history.</span>}
        {syn && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {syn.arc && <div><span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 700, color: t.t3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>The arc</span><div style={{ marginTop: 6 }}><RichText text={syn.arc} /></div></div>}
          {(syn.openThreads || []).length > 0 && <div>
            <span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 700, color: t.t3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Still open</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {syn.openThreads.map((o, i) => <div key={i} style={{ display: 'flex', gap: 9, fontFamily: f.ui, fontSize: 13, color: t.t1 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: t.risk, flex: 'none', marginTop: 6 }} />
                <span style={{ flex: 1 }}>{o.text}{o.sinceDate && <span style={{ color: t.t3 }}> · since {o.sinceDate}</span>}</span></div>)}
            </div></div>}
          {(syn.commitments || []).length > 0 && <div>
            <span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 700, color: t.t3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>My commitments</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {syn.commitments.map((c, i) => <div key={i} style={{ display: 'flex', gap: 9, fontFamily: f.ui, fontSize: 13, color: t.t1 }}>
                <Icon n={c.done ? 'circle-check' : 'circle'} s={15} c={c.done ? t.good : t.t3} />
                <span style={{ flex: 1, color: c.done ? t.t3 : t.t1, textDecoration: c.done ? 'line-through' : 'none' }}>{c.text}</span></div>)}
            </div></div>}
          {(syn.decisions || []).length > 0 && <div>
            <span style={{ fontFamily: f.ui, fontSize: 11, fontWeight: 700, color: t.t3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Decisions</span>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {syn.decisions.map((d, i) => <div key={i} style={{ display: 'flex', gap: 9, fontFamily: f.ui, fontSize: 13, color: t.t1 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: t.accent, flex: 'none', marginTop: 6 }} /><span style={{ flex: 1 }}>{d}</span></div>)}
            </div></div>}
        </div>}
      </Card>

      {/* open tasks born in this series — the carry-forward that already has
          status, so finishing one anywhere drops it from here and from the
          next meeting's pre-fill. */}
      {openTasks.length > 0 && <div>
        <Label style={{ marginBottom: 9 }}>Open from earlier meetings · {openTasks.length}</Label>
        <Card style={{ padding: '4px 0' }}>
          {openTasks.map((tk, i) => <div key={tk.id}
            onClick={() => tk.project && go({ screen: 'project', id: tk.project })}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 16px', borderTop: i ? '1px solid ' + t.line : 'none', cursor: tk.project ? 'pointer' : 'default' }}
            onMouseEnter={(e) => e.currentTarget.style.background = t.sel} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon n="circle" s={14} c={t.t3} style={{ marginTop: 2 }} />
            <span style={{ flex: 1, fontFamily: f.ui, fontSize: 13.5, color: t.t1 }}>{tk.label}</span>
            {tk.projectName && <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, flex: 'none' }}>{tk.projectName}</span>}
          </div>)}
        </Card>
      </div>}

      {/* open threads carry-forward (cheap, no-AI rollup) */}
      {openThreads.length > 0 && <div>
        <Label style={{ marginBottom: 9 }}>Open threads · from your notes</Label>
        <Card style={{ padding: '4px 0' }}>
          {openThreads.map((o, i) => <div key={o.noteId} onClick={() => go({ screen: 'note', id: o.noteId })}
            style={{ padding: '12px 16px', borderTop: i ? '1px solid ' + t.line : 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.background = t.sel} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginBottom: 5 }}>{o.date || 'Undated'} · {o.title}</div>
            <RichText text={o.text} />
          </div>)}
        </Card>
      </div>}

      {/* instances */}
      <div>
        <Label style={{ marginBottom: 9 }}>Meetings · {instances.length}</Label>
        {instances.length === 0
          ? <Card style={{ ...cardP, display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontFamily: f.ui, fontSize: 13, color: t.t3, flex: 1 }}>No meetings in this series yet.</span>
              <Btn kind="primary" size="sm" icon="plus" onClick={newMeeting}>New meeting</Btn>
            </Card>
          : <Card style={{ padding: '4px 0' }}>
              {instances.map((n, i) => <div key={n.id} onClick={() => go({ screen: 'note', id: n.id })}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 16px', borderTop: i ? '1px solid ' + t.line : 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => e.currentTarget.style.background = t.sel} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <Icon n="users" s={16} c={t.t3} style={{ marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>{n.title}</span>
                    <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3 }}>{n.date}</span>
                    {n.incomplete && <span style={{ fontFamily: f.ui, fontSize: 10.5, fontWeight: 700, color: t.risk, background: t.riskBg, border: '1px solid ' + t.riskLine, borderRadius: 6, padding: '1px 7px' }}>Incomplete</span>}
                  </div>
                  {n.summary && <div style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{n.summary.replace(/[#*\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}</div>}
                  {n.nextSteps && n.nextSteps.trim() && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11, color: t.t3, marginTop: 6 }}><Icon n="arrow-right" s={12} c={t.t3} />has next steps</span>}
                </div>
                <span onClick={(e) => { e.stopPropagation(); detachOne(n.id) }} title="Remove from series" style={{ marginTop: 1 }}>
                  <IconBtn n="unlink" s={15} /></span>
                <Icon n="chevron-right" s={16} c={t.t3} style={{ marginTop: 2 }} />
              </div>)}
            </Card>}
      </div>
    </div>}
  </div>
}

// SeriesIndex — list of all recurring meetings (the "Series" tab landing).
// New-series inline add; each row opens the series detail.
function SeriesIndex() {
  const { t, f, go, isMobile } = useApp()
  const { activeSeries, instancesForSeries, openThreadsForSeries, reload } = useData()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const list = activeSeries || []

  // Ask-AI across ALL series.
  const [q, setQ] = useState('')
  const [chat, setChat] = useState([]) // [{ role:'user'|'assistant', content }]
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState(null)

  const commit = async () => {
    const nm = name.trim()
    if (!nm || busy) return
    setBusy(true)
    try { const id = await createSeries({ name: nm }); setName(''); setAdding(false); await reload(); go({ screen: 'series', id }) }
    catch (e) { window.alert('Could not add series: ' + (e?.message || e)) }
    finally { setBusy(false) }
  }

  // Build the cross-series corpus once per ask.
  const seriesCtx = () => list.map((s) => ({
    name: s.name, cadence: s.cadence, standingContext: s.standingContext,
    instances: instancesForSeries(s.id).map((n) => ({ date: n.date, title: n.title, summary: n.summary || '', nextSteps: n.nextSteps || '', actions: n.actions || [] })),
    openThreads: openThreadsForSeries(s.id).map((o) => ({ text: o.text, date: o.date })),
  }))
  const ask = async (queryArg) => {
    const query = (typeof queryArg === 'string' ? queryArg : q).trim()
    if (!query || asking) return
    const history = chat.map((m) => ({ role: m.role, content: m.content }))
    setChat((c) => [...c, { role: 'user', content: query }])
    setQ(''); setAsking(true); setAskErr(null)
    try {
      const reply = await askAcrossSeries(seriesCtx(), history, query)
      setChat((c) => [...c, { role: 'assistant', content: reply }])
    } catch (e) { setAskErr(e) } finally { setAsking(false) }
  }
  const ASK_TRY = ['What’s still open across all my series?', 'Which commitments have I not followed up on?', 'Summarize what’s changed since last week.']

  return <div style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '24px 18px 80px' : '30px 36px 90px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
      <Icon n="repeat" s={22} c={t.t1} />
      <h1 style={{ fontFamily: f.title, fontSize: 26, fontWeight: f.titleW, color: t.t1, margin: 0, flex: 1, letterSpacing: f.titleSpacing }}>Series</h1>
      <Btn icon="plus" onClick={() => { setAdding(true); setName('') }}>New series</Btn>
    </div>
    <div style={{ fontFamily: f.ui, fontSize: 13, color: t.t3, marginBottom: 20 }}>Recurring meetings — standing context, carry-forward next-steps, AI prep across instances.</div>

    {/* Ask AI across all series */}
    {list.length > 0 && <Card style={{ padding: '16px 18px', marginBottom: 16, borderColor: t.accentLine }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: chat.length || asking ? 12 : 10 }}>
        <Icon n="sparkles" s={17} c={t.accent} />
        <span style={{ fontFamily: f.label, fontSize: 10.5, fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.accent, flex: 1 }}>Ask across all series</span>
        {chat.length > 0 && <span onClick={() => { setChat([]); setAskErr(null) }} style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, cursor: 'pointer' }}>Clear</span>}
      </div>

      {chat.map((m, i) => <div key={i} style={{ marginBottom: 12 }}>
        {m.role === 'user'
          ? <div style={{ display: 'flex', gap: 8 }}>
              <Icon n="user" s={15} c={t.t3} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>{m.content}</span>
            </div>
          : <div style={{ display: 'flex', gap: 8 }}>
              <Icon n="sparkles" s={15} c={t.accent} style={{ marginTop: 3, flexShrink: 0 }} />
              <div className="selectable" style={{ fontFamily: f.body, fontSize: 14.5, lineHeight: 1.62, color: t.t1, whiteSpace: 'pre-wrap', textWrap: 'pretty' }}>{m.content}</div>
            </div>}
      </div>)}
      {asking && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: t.t2, fontFamily: f.ui, fontSize: 13, marginBottom: 12 }}>
        <Icon n="loader-2" s={15} c={t.t1} />Thinking across {list.length} series…</div>}
      {askErr && <div style={{ color: t.t2, fontFamily: f.ui, fontSize: 13, marginBottom: 12 }}>Couldn’t answer — {String(askErr?.message || askErr)}.</div>}

      <form onSubmit={(e) => { e.preventDefault(); ask() }} style={{ display: 'flex', alignItems: 'center', gap: 9, background: t.bg, border: '1px solid ' + t.line2, borderRadius: 10, padding: '0 12px', height: 44 }}
        onFocusCapture={(e) => e.currentTarget.style.borderColor = t.accent} onBlurCapture={(e) => e.currentTarget.style.borderColor = t.line2}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={chat.length ? 'Ask a follow-up…' : 'Ask anything across your recurring meetings…'}
          style={{ flex: 1, border: 0, outline: 0, background: 'transparent', fontFamily: f.ui, fontSize: 14, color: t.t1 }} />
        <Btn kind="primary" size="sm" type="submit" icon={asking ? 'loader-2' : 'arrow-up'}>{asking ? '' : 'Ask'}</Btn>
      </form>

      {chat.length === 0 && !asking && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
        {ASK_TRY.map((s) => <span key={s} onClick={() => ask(s)}
          style={{ fontFamily: f.ui, fontSize: 12, color: t.t2, background: t.tagBg, borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}
          onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = t.t2}>{s}</span>)}
      </div>}
    </Card>}

    {adding && <Card style={{ padding: 14, marginBottom: 16 }}>
      <Label>Name</Label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(''); setAdding(false) } }}
          placeholder="e.g. Jon 1:1…"
          style={{ flex: 1, border: '1px solid ' + t.line2, borderRadius: 8, outline: 0, background: t.card, fontFamily: f.ui, fontSize: 14, color: t.t1, padding: '8px 11px' }} />
        <Btn onClick={commit}>Add</Btn>
        <Btn kind="ghost" onClick={() => { setName(''); setAdding(false) }}>Cancel</Btn>
      </div>
    </Card>}

    {list.length === 0 && !adding
      ? <Card style={{ padding: 28, textAlign: 'center', fontFamily: f.ui, fontSize: 13.5, color: t.t3 }}>
          No series yet. Create one for any recurring meeting — a 1:1, a standup, a weekly sync.
        </Card>
      : <div style={{ display: 'grid', gap: 10 }}>
          {list.map((s) => {
            const n = instancesForSeries(s.id).length
            const open = openThreadsForSeries(s.id).length
            return <Card key={s.id} onClick={() => go({ screen: 'series', id: s.id })}
              style={{ padding: '15px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
              onMouseEnter={(e) => e.currentTarget.style.background = t.sel} onMouseLeave={(e) => e.currentTarget.style.background = t.card}>
              <Icon n="repeat" s={18} c={t.t3} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: f.ui, fontSize: 15, fontWeight: 600, color: t.t1 }}>{s.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3, fontFamily: f.ui, fontSize: 12, color: t.t3, flexWrap: 'wrap' }}>
                  <span>{n} meeting{n === 1 ? '' : 's'}</span>
                  {s.cadence && <span>· {s.cadence}</span>}
                  {open > 0 && <span style={{ color: t.accent }}>· {open} open thread{open === 1 ? '' : 's'}</span>}
                  {(s.people || []).length > 0 && <span>· {(s.people || []).join(', ')}</span>}
                </div>
              </div>
              <Icon n="chevron-right" s={16} c={t.t3} />
            </Card>
          })}
        </div>}
  </div>
}
