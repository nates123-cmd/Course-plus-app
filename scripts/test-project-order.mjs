// node scripts/test-project-order.mjs
import assert from 'node:assert/strict'
import { groupProjectsForPicker, isActiveProject, projectStatusHint } from '../src/lib/projectOrder.js'

const areas = [
  { id: 'arrow', name: 'Arrow', projects: [
    { id: 'a', name: 'Held first', status: 'on-hold' },
    { id: 'b', name: 'Active one', status: 'active' },
    { id: 'c', name: 'Idea', status: 'idea' },
    { id: 'd', name: 'Sent', status: 'sent' },
    { id: 'e', name: 'Archived', status: 'archived' },
    { id: 'f', name: 'Active two', status: 'active' },
  ] },
  { id: 'empty', name: 'Empty', projects: [] },
  { id: 'home', name: 'Home', projects: [
    { id: 'g', name: 'Done', status: 'done' },
    { id: 'h', name: 'Live', status: 'active' },
    { id: 'i', name: 'Odd', status: 'something-new' },
  ] },
]
const g = groupProjectsForPicker(areas)
assert.deepEqual(g.map((x) => x.id), ['arrow', 'home'], 'pillar order kept, empty pillar dropped')
assert.deepEqual(g[0].projects.map((p) => p.id), ['b', 'd', 'f', 'c', 'a', 'e'], 'active first, stable inside a status')
assert.deepEqual(g[1].projects.map((p) => p.id), ['h', 'i', 'g'], 'unknown status sits with ideas')
assert.equal(areas[0].projects[0].id, 'a', 'input not mutated')
assert.equal(isActiveProject({ status: 'sent' }), true)
assert.equal(projectStatusHint({ status: 'active' }), '')
assert.equal(projectStatusHint({ status: 'on-hold' }), 'on hold')
assert.deepEqual(groupProjectsForPicker(null), [])
console.log('project order: 8 checks passed')
