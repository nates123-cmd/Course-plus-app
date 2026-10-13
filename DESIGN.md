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
| Ground, palette | **Grey engineering pad** ("Graphite", picked 2026-10-01) | Graphite cover `#2b2d2e`, grey paper `#f2f2f0`, pencil-black ink, classic's green as accent. Replaced the original Field Notes cream/kraft, which Nate rejected. |
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

## Colour (memo, light) = Graphite

Nate kept the memo type but rejected the cream paper (2026-10-01) and picked
Graphite from four options (Index card, Steel, Rhodia, Graphite). Light mode is
where he lives; dark must still work. The `--kraft*` token names are kept for the
cover band so components did not change.

| Token | Value | Role |
| --- | --- | --- |
| `--bg` / `--card` | `#f2f2f0` | Grey pad paper. Cards sit flush on it. |
| `--panel` | `#e9e9e6` | Sidebar / bands. |
| `--t1` | `#1e1f1f` | Pencil-black ink. Titles, task text, section rules. |
| `--t2` | `#535553` | Supporting prose. |
| `--t3` | `#898b88` | Counts, chrome, meta. |
| `--line` / `--line2` | `#dcdcd8` / `#bdbdb7` | Row hairlines / section rules. |
| `--accent` | `#2f6b4f` | Classic's green, deepened. Active chip, status circles. |
| `--kraft` | `#2b2d2e` | The graphite cover. Header band only. |
| `--kraftInk` / `--kraftRule` | `#f2f2f0` / `#9fa3a5` | Ink and fill-in lines printed on the cover. |
| `--risk` | `#bf4320` | Due / overdue. |
| `--area_arrow` / `_sds` / `_brain` | `#3b6680` / `#8a6a3c` / `#6b4f5e` | Area labels. |

Dark: ground `#141515`, ink `#e8e8e5`, green accent `#62b08b`, cover band
`#303335`. Full sets live in `src/styles.css` under
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
- The cover colour as a page ground (it is the cover, not the paper).
- Cream / warm paper grounds (rejected 2026-10-01).
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
