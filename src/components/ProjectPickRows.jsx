// The project half of the "where does this task go" popover, shared by the
// Task Sheet and the Add task bar. One block per pillar, active projects first,
// everything else (idea, on hold, done) below and dimmed.
import { useApp } from '../ctx'
import { PopRow, areaColor } from '../kit'
import { groupProjectsForPicker, isActiveProject, projectStatusHint } from '../lib/projectOrder'

export function ProjectPickRows({ areas, selectedId, onPick }) {
  const { t, f } = useApp()
  const groups = groupProjectsForPicker(areas)
  return groups.map((g, gi) => <div key={g.id}>
    <div style={{ fontFamily: f.label, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.t3,
      padding: '9px 12px 4px', borderTop: '1px solid ' + t.line, marginTop: 4 }}>
      {gi === 0 && groups.length === 1 ? 'Projects' : g.name}</div>
    {g.projects.map((p) => <PopRow key={p.id} dot={areaColor(t, g.id)} label={p.name} hint={projectStatusHint(p)}
      dim={!isActiveProject(p)} on={p.id === selectedId} onClick={() => onPick(p.id)} />)}
  </div>)
}
