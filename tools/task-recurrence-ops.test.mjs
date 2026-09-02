// End-to-end check of the recurring-task ops against an in-memory fake Supabase.
// Exercises the REAL createTask / updateTask / spawnNext in mcp/lib/data.js,
// including the cp_tasks column mapping — not just the date math that
// tools/recurrence.test.mjs covers.
//
//   node tools/task-recurrence-ops.test.mjs
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const D = await import(ROOT + '/mcp/lib/data.js')

let pass = 0, fail = 0
const check = (name, got, want) => {
  if (got === want) pass++
  else { fail++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`) }
}

// ── minimal fake supabase: one table, the query shapes data.js actually uses ──
function fakeSb(rows = []) {
  const store = { cp_tasks: rows }
  return {
    rows: store.cp_tasks,
    from(table) {
      const t = table
      const q = {
        _filters: [],
        select() { return q },
        eq(col, val) { q._filters.push([col, val]); return q },
        order() { return q },
        insert(row) { store[t].push({ ...row }); return Promise.resolve({ error: null }) },
        update(row) {
          q._pendingUpdate = row
          return {
            eq(col, val) {
              for (const r of store[t]) if (r[col] === val) Object.assign(r, row)
              return Promise.resolve({ error: null })
            },
          }
        },
        single() {
          const hit = store[t].find((r) => q._filters.every(([c, v]) => r[c] === v))
          return Promise.resolve({ data: hit || null, error: null })
        },
        then(res) { // awaiting the builder directly = a list query
          const out = store[t].filter((r) => q._filters.every(([c, v]) => r[c] === v))
          return Promise.resolve({ data: out, error: null }).then(res)
        },
      }
      return q
    },
  }
}
const ymd = (d) => `${d.y}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
const todayStr = () => { const d = new Date(); return ymd({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }) }

// ── 1. create a recurring task ──
{
  const sb = fakeSb()
  const r = await D.createTask(sb, { project: 'p1', label: 'Weekly report', due: '2026-09-04', repeat: { freq: 'weekly', interval: 1, weekdays: [5] } })
  check('create stores the rule', JSON.stringify(sb.rows[0].recurrence), '{"freq":"weekly","interval":1,"from":"due","weekdays":[5]}')
  check('create reports the label', r.repeats, 'Weekly on Fri')
  check('create stores due as ymd', ymd(sb.rows[0].due_date), '2026-09-04')
}

// ── 2. completing it spawns the next occurrence ──
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'Weekly report', due: '2026-09-04', priority: 2, repeat: { freq: 'weekly', interval: 1, weekdays: [5] } })
  const id = sb.rows[0].id
  const out = await D.updateTask(sb, { id, done: true })
  check('two rows after completion', sb.rows.length, 2)
  const next = sb.rows[1]
  check('spawned reported back', out.spawnedNext?.label, 'Weekly report')
  check('original is done', sb.rows[0].done, true)
  check('original stamped completed_at', typeof sb.rows[0].completed_at, 'string')
  check('original flagged spawned', sb.rows[0].recur_spawned, true)
  check('original joins the series', sb.rows[0].recur_parent, id)
  check('successor is open', next.done, false)
  check('successor inherits project', next.project_id, 'p1')
  check('successor inherits label', next.label, 'Weekly report')
  check('successor inherits priority', next.priority, 2)
  check('successor carries the rule', JSON.stringify(next.recurrence), '{"freq":"weekly","interval":1,"from":"due","weekdays":[5]}')
  check('successor points at the series', next.recur_parent, id)
  check('successor index is 1', next.recur_index, 1)
  check('successor not yet spawned', next.recur_spawned, false)
  check('successor has no completion time', next.completed_at, null)
  check('successor has a fresh id', next.id !== id, true)
}

// ── 3. re-completing must NOT fork the series again ──
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'Chore', due: '2026-09-04', repeat: { freq: 'daily', interval: 1 } })
  const id = sb.rows[0].id
  await D.updateTask(sb, { id, done: true })
  await D.updateTask(sb, { id, done: false })
  await D.updateTask(sb, { id, done: true })
  check('done->undone->done spawns once', sb.rows.length, 2)
}

// ── 4. a non-recurring task spawns nothing ──
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'One-off', due: '2026-09-04' })
  const out = await D.updateTask(sb, { id: sb.rows[0].id, done: true })
  check('plain task does not spawn', sb.rows.length, 1)
  check('plain task reports no successor', out.spawnedNext, undefined)
  check('plain task stores null rule', sb.rows[0].recurrence, null)
}

// ── 5. per-occurrence state is NOT inherited ──
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'Ask Jon', due: '2026-09-04', waiting: 'Jon', repeat: { freq: 'weekly', interval: 1 } })
  sb.rows[0].work_type = 'scheduled'; sb.rows[0].meeting_id = 'Standup'
  await D.updateTask(sb, { id: sb.rows[0].id, done: true })
  const next = sb.rows[1]
  check('waiting-on is not inherited', next.waiting, null)
  check('scheduled work type is dropped', next.work_type, null)
  check('meeting assignment is dropped', next.meeting_id, undefined)
}

// ── 6. the series can be stopped ──
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'Twice only', due: '2026-09-04', repeat: { freq: 'daily', interval: 1, count: 1 } })
  await D.updateTask(sb, { id: sb.rows[0].id, done: true })
  check('count:1 spawns nothing further', sb.rows.length, 1)
}
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'Until', due: '2026-09-04', repeat: { freq: 'daily', interval: 1, until: '2020-01-01' } })
  check('until string is parsed to ymd', ymd(sb.rows[0].recurrence.until), '2020-01-01')
  await D.updateTask(sb, { id: sb.rows[0].id, done: true })
  check('past until spawns nothing', sb.rows.length, 1)
}

// ── 7. clearing a repeat ──
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'Was recurring', due: '2026-09-04', repeat: { freq: 'daily', interval: 1 } })
  const id = sb.rows[0].id
  await D.updateTask(sb, { id, repeat: null })
  check('repeat cleared', sb.rows[0].recurrence, null)
  await D.updateTask(sb, { id, done: true })
  check('cleared task does not spawn', sb.rows.length, 1)
}

// ── 8. the successor is always in the future ──
{
  const sb = fakeSb()
  await D.createTask(sb, { project: 'p1', label: 'Long dormant', due: '2020-01-06', repeat: { freq: 'weekly', interval: 1, weekdays: [1] } })
  await D.updateTask(sb, { id: sb.rows[0].id, done: true })
  check('dormant series spawns exactly one', sb.rows.length, 2)
  check('successor is in the future', ymd(sb.rows[1].due_date) > todayStr(), true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
