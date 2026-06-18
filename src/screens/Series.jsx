// Series.jsx — a recurring meeting (e.g. "Jon 1:1"). Owns its instances
// (cp_notes kind='meeting' with series_id), holds standing context + default
// attendees/links, rolls up open next-steps across instances, and offers AI prep
// for the next meeting + cross-instance synthesis (the arc, open threads,
// commitments). New meetings launch the composer pre-filled from the defaults.
import { useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, IconBtn, Card, Label, Person, AreaDot, areaColor, Popover, PopRow, STATUS } from '../kit'
import { updateSeries, deleteSeries } from '../lib/db'
import { prepFromSeries, synthesizeSeries } from '../lib/ai'
import { RichText } from '../components/RichText'
import { MdEditor } from '../components/MdEditor'

const STATUS_RANK = { active: 0, sent: 1, 'on-hold': 2, idea: 3, archived: 4 }

export function SeriesScreen() {
  const { t, f, go, route, isMobile, aiName } = useApp()
  const { seriesById, instancesForSeries, openThreadsForSeries, projectById, areaOfProject, allProjects, reload } = useData()
  const s = seriesById(route.id)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [cadence, setCadence] = useState('')
  const [stand, setStand] = useState('')
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

  if (!s) return <div style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '24px 18px 80px' : '30px 36px 90px', fontFamily: f.ui, color: t.t3 }}>
    Series not found. <span onClick={() => go({ screen: 'overview' })} style={{ color: t.accent, cursor: 'pointer' }}>Back to Work</span>
  </div>

  const instances = instancesForSeries(s.id)
  const openThreads = openThreadsForSeries(s.id)
  const pickerProjects = [...allProjects()].sort((a, b) => (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5))

  const startEdit = () => {
    setName(s.name || ''); setCadence(s.cadence || ''); setStand(s.standingContext || '')
    setPeople(s.people || []); setEProject(s.project || null); setEProjects(s.projects || [])
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
        standingContext: stand, people, project: eProject || null,
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
      const r = await prepFromSeries({ name: s.name, standingContext: s.standingContext, cadence: s.cadence, instances: aiInstances })
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
  const newMeeting = () => {
    const fallback = openThreads.map((o) => `From ${o.date || 'last time'}:\n${o.text}`).join('\n\n')
    const agenda = (prep && prep.trim()) || fallback || ''
    go({ screen: 'meeting', series: s.id, agenda })
  }

  const defProj = projectById(s.project)
  const cardP = { padding: '16px 18px' }

  return <div data-screen-label={'Series · ' + s.name} style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? '24px 18px 80px' : '30px 36px 90px' }}>
    {/* breadcrumb */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: f.ui, fontSize: 12, color: t.t3, marginBottom: 14 }}>
      <span onClick={() => go({ screen: 'overview' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
        <Icon n="chevron-left" s={15} />Work</span>
    </div>

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
      {/* standing context */}
      <div>
        <Label style={{ marginBottom: 9 }}>Standing context</Label>
        <span style={{ display: 'block', fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginBottom: 8 }}>Who they are, the standing agenda, ongoing threads — fed to every prep + synthesis.</span>
        <MdEditor value={stand} onChange={setStand} minHeight={200} />
      </div>
    </div>}

    {err && <div style={{ marginTop: 14, fontFamily: f.ui, fontSize: 12.5, color: t.risk }}>{String(err?.message || err)}</div>}

    {!editing && <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
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
        {prep
          ? <RichText text={prep} />
          : <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.t2 }}>Generate a focused agenda from open threads + prior commitments, or start a meeting now (open threads carry forward automatically).</span>}
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
                <Icon n="chevron-right" s={16} c={t.t3} style={{ marginTop: 2 }} />
              </div>)}
            </Card>}
      </div>
    </div>}
  </div>
}
