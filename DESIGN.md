# Course+ — design constraints

Read this before changing anything visual. Course+ has two looks, switched by
the notebook / grid button in the top bar:

- **`memo`** (default since 2026-09-30) — the direction below.
- **`classic`** — the original Direction B (Hanken Grotesk, grey + green, rounded
  cards). Kept untouched so the restyle is one tap to undo.

The look is `[data-look]` on `<html>`, persisted as `localStorage['course.look']`,
set before first paint by the inline script in `index.html` and kept in sync by
`App.jsx`. It is a second axis beside light/dark (`[data-theme]`), so there are
four combinations; all four must work.

## References — who owns what

From Nate's notes on the Course+ slide of the app moodboard deck: *"Linear font;
maybe Field Notes aesthetics?"* and *"research other ones potential layouts."*

| Question | Owner | What it contributes |
| --- | --- | --- |
| Type you read | **Linear** | Inter, medium weight, tight negative tracking (`-0.035em` on titles, `-0.012em` on rows). Mono for dates/times. |
| Ground, palette | **Field Notes** memo book | Kraft cover `#b09162`, paper `#f7f3ea`, brown-black print ink. |
| Labels | **Field Notes** | Futura-style bold caps, wide tracking (Jost 700, `0.18em`). Labels only. |
| The motif | **Field Notes** inside cover | The fill-in form: `DATE: ____`, `IN FOCUS: ____`. The Work header is a kraft cover whose lines hold the real counts. |
| Task state glyph | **Linear** status circle | Dashed = icebox, half = pulled into Now, quarter = waiting, filled = done (`StatusCircle` in `src/theme/memo.jsx`). |
| Layout | **Linear mobile** + **Things 3** | Plain rows under state headers, no cards. (Things' big day numeral for the Agenda is the next candidate, not built yet.) |

Measured, not recalled: Linear ships Inter Variable at weight 510 with Berkeley
Mono; Field Notes ships Futura Bold caps at +2px and New Century Schoolbook.

## Register

A working notebook you keep in your back pocket: durable, plain, practical,
filled in by hand. Not cute, not vintage-themed, not a dashboard.
**If a change makes it feel more like a SaaS dashboard, or more like a
scrapbook, it is wrong.**

## Colour (memo, light)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` / `--card` | `#f7f3ea` | Memo-book paper. Cards sit flush on it. |
| `--panel` | `#f1ebde` | Sidebar / bands. |
| `--t1` | `#2b2925` | Print ink. Titles, task text, section rules. |
| `--t2` | `#625a4c` | Supporting prose. |
| `--t3` | `#8f8676` | Counts, chrome, meta. |
| `--line` / `--line2` | `#e3d9c5` / `#cbbd9f` | Row hairlines / section rules. |
| `--accent` | `#7a5a2e` | Kraft darkened to hold text contrast. Active chip, status circles. |
| `--kraft` | `#b09162` | The cover. Header band only. |
| `--kraftInk` / `--kraftRule` | `#2b2116` / `#4c3729` | Ink and fill-in lines printed on kraft. |
| `--risk` | `#a2482a` | Due / overdue. |
| `--area_arrow` / `_sds` / `_brain` | `#3b6680` / `#8a6a3c` / `#6b4f5e` | Area labels. Field Notes steel blue first. |

Dark = the black-cover editions: ground `#1a1814`, ink `#efe7d6`, kraft accent
`#c9a46a`, cover band `#8f7448`. Full sets live in `src/styles.css` under
`:root[data-look='memo'][data-theme=…]`.

## Type

| Var | Memo | Job |
| --- | --- | --- |
| `--f-title`, `--f-body`, `--f-ui` | Inter | Everything you read. |
| `--f-label` | Jost 700, caps, `0.18em` | Section heads, project labels on rows, form labels. Nothing else. |
| `--f-meta` / `--f-mono` | JetBrains Mono | Due dates (uppercase), times, code. |

Components read these through `f.*` from `useApp()` (`src/theme/tokens.js`);
never hard-code a family.

## Devices — reach for these first

- **`MemoCover`** — kraft band with fill-in lines. Page headers.
- **`MemoHead`** — caps label + count over a 1.5px ink rule. Section heads.
- **`StatusCircle`** — task state. Never a checkbox square in memo.
- **Project as a caps label above the task title**, coloured by area. The title
  then gets the full row width and wraps to two lines instead of truncating.
- **`Card` in memo = a ruled section** (top rule, no box, no radius).
- **Radius scale** `--rs: 0.25` — every inline radius is `calc(Npx * var(--rs))`,
  so memo corners are near-square. New code must use the same form.

## Banned (memo)

- Bordered rounded cards as the grouping device.
- A checkbox square for task state.
- Truncating a task title to make room for a project chip.
- Kraft as a page ground (it is the cover, not the paper).
- Purple/blue gradients, drop shadows on rows, emoji, unicode ★/☆.
- An icon beside every section head (memo heads are type only).
- Literal font families or uncalculated `borderRadius` numbers in components.

## Honesty rules that outrank the design

- **Course+ tasks have no IDs.** Do not invent Linear-style `ABC-12` codes; that
  would be a data change.
- **Form lines show real counts only.** If a field has no data it shows `—`,
  never a placeholder that looks filled in.
- Classic must keep rendering exactly as before. Any memo change goes behind
  `look === 'memo'` or a memo-only CSS var.

## Not yet restyled

Overview (Work home) is done end to end. Every other screen picks up the memo
palette, fonts, square corners and ruled `Card`s automatically, but still uses
classic section heads and checkbox squares: Project, Agenda (candidate: Things
day numeral + mono times), Inbox, Note, Library, TaskSheet, Record.

## Looking at it

The app needs OTP login, so render screens in isolation: write a scratch
`preview.html` (copy of `index.html` pointing at `/src/preview.jsx`) that wraps a
screen in `CourseCtx.Provider` + a `DataCtx.Provider` with sample data
(`DataCtx` needs a temporary `export`). Query params `?look=memo|classic` and
`?mode=light|dark`. Then `npx vite --port 5199 --strictPort`, open
`http://localhost:5199/preview.html`, screenshot at 390px wide. Check all four
look x mode combinations. **Delete `preview.html` + `src/preview.jsx` and revert
the export before committing.**
