// Order for the "move to project" pickers (Task Sheet, Add task).
// Projects are grouped under their pillar, and inside each pillar the ones
// being worked now come first. Order within a status keeps the pillar's own
// (sidebar) order, so nothing jumps around unexpectedly.

const RANK = { active: 0, sent: 0, idea: 1, 'on-hold': 2, done: 3, completed: 3, archived: 4 }
const HINT = { idea: 'idea', 'on-hold': 'on hold', done: 'done', completed: 'done', archived: 'archived' }

export const isActiveProject = (p) => (RANK[p?.status] ?? 1) === 0

// Small right-hand label for a project that is not active ('' when it is).
export const projectStatusHint = (p) => (isActiveProject(p) ? '' : HINT[p?.status] || '')

// areas: [{ id, name, projects: [{ id, name, status }] }]
// -> [{ id, name, projects: [...active first] }], pillars with no projects dropped.
export function groupProjectsForPicker(areas) {
  return (areas || [])
    .map((a) => ({
      id: a.id,
      name: a.name,
      projects: (a.projects || [])
        .map((p, i) => ({ p, i, r: RANK[p.status] ?? 1 }))
        .sort((x, y) => x.r - y.r || x.i - y.i)
        .map((x) => x.p),
    }))
    .filter((a) => a.projects.length > 0)
}
