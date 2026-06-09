// Loads the user's Course+ data from Supabase (seeding demo fixtures on first
// run) and exposes it + the prototype data helpers, bound to the loaded data,
// via context. Replaces the prototype's window.* module-level fixtures.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { loadAll, seedIfEmpty } from './lib/db'

const DataCtx = createContext(null)
export function useData() { return useContext(DataCtx) }

export function DataProvider({ children }) {
  const [areas, setAreas] = useState([])
  const [notes, setNotes] = useState([])
  const [inbox, setInbox] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      setStatus('loading')
      await seedIfEmpty()
      const data = await loadAll()
      setAreas(data.areas); setNotes(data.notes); setInbox(data.inbox)
      setStatus('ready')
    } catch (e) {
      setError(e); setStatus('error')
    }
  }
  useEffect(() => { load() }, [])

  const value = useMemo(() => {
    const allProjects = () => areas.flatMap((a) => a.projects.map((p) => ({ ...p, area: a.id, areaName: a.name })))
    const projectById = (id) => allProjects().find((p) => p.id === id) || null
    const areaById = (id) => areas.find((a) => a.id === id) || null
    const noteById = (id) => notes.find((n) => n.id === id)
    const noteByTitle = (title) => notes.find((n) => n.title === title)
    const projectName = (id) => { const p = projectById(id); return p ? p.name : null }
    const areaName = (id) => { const a = areas.find((x) => x.id === id); return a ? a.name : null }
    const areaOfProject = (id) => areas.find((a) => a.projects.some((p) => p.id === id))
    const ownedNotes = (id) => notes.filter((n) => n.project === id)
    const linkedMeetings = (id) => notes.filter((n) => n.project !== id && (n.projects || []).includes(id))
    const notesInArea = (areaId) => notes.filter((n) => n.area === areaId)
    const actionsForProject = (id) => {
      const out = []
      notes.forEach((n) => {
        if (n.kind !== 'meeting' || !n.actions) return
        n.actions.forEach((a) => {
          const belongs = a.project ? a.project === id : n.project === id
          if (belongs) out.push({ ...a, meeting: n.title, mid: n.id, linked: n.project !== id })
        })
      })
      return out
    }
    const notesByTag = (tag) => notes.filter((n) => (n.tags || []).includes(tag))
    const ALL_TAGS = [...new Set(notes.flatMap((n) => n.tags || []))].sort()

    // Global search across everything with a title (projects, tasks, docs).
    const globalSearch = (query, limit = 9) => {
      const q = (query || '').trim().toLowerCase()
      if (!q) return []
      const score = (text) => {
        const s = (text || '').toLowerCase(); const i = s.indexOf(q)
        if (i < 0) return -1
        return (i === 0 ? 0 : 100) + i + (/\b/.test(s[i - 1] || ' ') ? 0 : 30)
      }
      const out = []
      allProjects().forEach((p) => {
        const sc = score(p.name)
        if (sc >= 0) out.push({ type: 'project', id: p.id, title: p.name, area: p.area, sub: p.areaName, status: p.status, _s: sc })
        ;(p.tasks || []).forEach((tsk) => {
          const ts = score(tsk.label)
          if (ts >= 0) out.push({ type: 'task', id: tsk.id, projectId: p.id, title: tsk.label, sub: p.name,
            area: p.area, done: !!tsk.done, next: !!tsk.next, waiting: tsk.waiting, due: tsk.due, _s: ts + 5 })
        })
      })
      notes.forEach((n) => {
        const sc = score(n.title)
        if (sc >= 0) out.push({ type: 'doc', id: n.id, kind: n.kind, title: n.title,
          sub: (n.project ? (projectName(n.project) || '') : (n.area ? '' : 'Unfiled')), area: n.area, date: n.date, _s: sc + 2 })
      })
      out.sort((a, b) => a._s - b._s)
      return out.slice(0, limit)
    }

    return {
      areas, notes, inbox, status, error, reload: load,
      allProjects, projectById, areaById, noteById, noteByTitle, projectName, areaName, areaOfProject,
      ownedNotes, linkedMeetings, notesInArea, actionsForProject, notesByTag, ALL_TAGS, globalSearch,
    }
  }, [areas, notes, inbox, status, error])

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}
