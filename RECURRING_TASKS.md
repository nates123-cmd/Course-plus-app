# Recurring tasks

Any task can carry a repeat rule. **Completing it creates the next occurrence as
a new task; the finished one stays in history.**

## Why spawn instead of rolling the due date forward

The obvious alternative — keep one row and push its `due_date` forward on each
completion — was rejected because `cp_goals` builds the wins ledger from
completed tasks, deduped on task id (`src/lib/goals.js`, `keyOf`). One rolling
row is one task id, so a chore done every week for a year would have recorded a
single win. Spawning gives each completion its own row, its own `completed_at`,
and its own win.

It also means a single occurrence can be moved, re-labelled, or stopped without
disturbing the rest of the series, and the history of what actually got done
survives.

## The rule

Stored on every occurrence in `cp_tasks.recurrence` (jsonb) — it travels with the
task, so any occurrence can be edited or stopped on its own.

```jsonc
{
  "freq": "daily" | "weekly" | "monthly" | "yearly",
  "interval": 1,                // every N units
  "weekdays": [1,2,3,4,5],      // weekly only. 0 = Sunday. Weekdays-only is [1,2,3,4,5].
  "monthDay": 15,               // monthly only. 1-31, or "last".
  "from": "due" | "completion",
  "until": { "y": 2026, "m": 11, "d": 25 },  // optional end date (m is 0-based)
  "count": 12                   // optional total number of occurrences
}
```

`from` is the one that matters in daily use:

- **`due`** (default) — the next one is counted off the previous **due date**. A
  Friday report stays due on Fridays even when you file it on Sunday.
- **`completion`** — counted off the day you **ticked it off**. Water the plants
  10 days after the last watering, not 10 days after a date you missed.

Supporting columns on `cp_tasks`:

| column          | meaning |
| --------------- | ------- |
| `recur_parent`  | id of the first task in the series — series identity |
| `recur_index`   | 0-based occurrence number, so `count` can be enforced |
| `recur_spawned` | this occurrence already produced its successor |

`recur_spawned` is the idempotency guard: ticking a task done → undone → done
must not fork the series a second time.

## Behaviour worth knowing

- **The successor is always in the future.** A due-anchored series left dormant
  for months rolls forward to the first date after today rather than spawning
  every occurrence it missed — you owe the chore once, not twenty times.
- **Only the work is inherited.** The new task takes the project/pillar, label,
  priority, work type, notes and group. It does *not* take waiting-on, the
  meeting assignment, or the reschedule count — those described the instance you
  just finished, not the chore.
- **Short months clamp, then recover.** The intended day of month lives in the
  rule, so a monthly-on-the-31st series shows Feb 28 and then goes back to the
  31st in March instead of permanently degrading.
- **Undo takes the successor with it.** Cmd+Z on a completion deletes the
  spawned occurrence and reopens the series.

## Where the code lives

| file | role |
| ---- | ---- |
| `src/lib/recurrence.js` | the engine — rule shape, date math, labels, presets. **Canonical.** |
| `src/DataContext.jsx` | `spawnNextOccurrence`, called from `patchTask` so *every* completion path repeats |
| `src/screens/TaskSheet.jsx` | the "Repeats" row (presets + custom editor) |
| `mcp/lib/data.js` | local MCP server — imports the engine directly |
| `supabase/functions/_shared/recurrence.ts` | **a port** of the engine for the remote MCP edge function |
| `supabase/migrations/20260902120000_task_recurrence.sql` | the columns |

The spawn lives in `patchTask`, not at the call sites, so the pull board, the
task sheet, the Overview roll-ups and the meeting recorder all repeat without
each needing to know about recurrence.

### The one duplicated file

A Supabase edge function is bundled from its own directory and cannot reliably
import out of `src/`, so `supabase/functions/_shared/recurrence.ts` is a
hand-kept port. **`tools/recurrence.test.mjs` runs the same assertions against
both implementations**, so drift fails the test instead of quietly giving Claude
a different answer than the app. Change one, change the other, run the test.

## Tests

```sh
node tools/recurrence.test.mjs           # date math, both implementations
node tools/task-recurrence-ops.test.mjs  # create → complete → spawn, against a fake Supabase
```

## Over MCP

`create_task` and `update_task` take a `repeat` object (same shape, but `until`
is a `YYYY-MM-DD` string). `update_task` with `repeat: null` stops a task
recurring. `complete_task` returns the new occurrence as `spawnedNext`.
