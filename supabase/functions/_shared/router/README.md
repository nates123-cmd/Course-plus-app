# Capture router

Dictated text in, real records out. A capture is classified into the app it
belongs to and written as a finished record — a Course+ task, a Stock shopping
item, an Ink thought, a Break look-up — instead of always landing as an
untriaged `cp_inbox` row.

The point is not faster capture. It is that a capture stops creating a chore.

## Why this is possible at all

Every app in the suite lives in the same Supabase project
(`xsmnfcmtbpeaccnyinkr`). So the router is one edge function doing plain
inserts under the service key — no MCP, no per-app API, no cross-service auth.
Tick is the only suite app in a separate project, and nothing here targets it.

## Files

| File | Owns |
| --- | --- |
| `classify.ts` | The single model call. Picks a `kind` from a closed set and fills plain text fields. Never sees a table or column name. |
| `writers.ts` | One writer per destination, each encoding its app's storage shape and landmines. |
| `index.ts` | `route()` — project lookup, dispatch, fallback, capture log, confirmation line. |

## The kinds

| Kind | Lands in | Said like |
| --- | --- | --- |
| `course_task` | `cp_tasks` | "course plus, hawaii trip, figure out activities for big island" |
| `course_note` | `cp_notes` | "note for the CSA program, Mayra said the deadline moved" |
| `stock_out` | `pantry_items` -> out, else `extras` | "I'm out of butter" |
| `stock_staple` | `pantry_items` (`isStaple`) | "add butter to stock staples" |
| `stock_idea` | `pipeline_ideas` | "stock idea: steak butter" |
| `ink_thought` | `entries` + `thoughts` | "ink - I feel better in the morning when I hydrate" |
| `break_lookup` | `look_up_later` | "look up what a mansard roof is" |
| `break_flashcard` | `flashcards` | "add tendentious to break flashcards" |
| `unknown` | `cp_inbox` | anything ambiguous |

Three distinctions the prompt works hard to hold, because the tables are
different and the mistake is silent:

- **`stock_out` vs `stock_staple`** — one changes what he buys this week, the
  other what he keeps permanently. Being out of butter is not the same as
  butter being a staple, and `stock_staple` deliberately does not touch
  `status`: marking a staple must never put a jar he already has on the list.
- **`stock_out` vs `stock_idea`** — "steak butter" is a dish to make, not an
  ingredient to buy. Ingredient-shaped idea names are the easy misroute.
- **`break_lookup` vs `break_flashcard`** — the word "flashcard" is the tell.

`break_flashcard` is the only kind whose content is **model-authored**: Nate
dictates one word, so the classifier writes the answer side. `flashcards.back`
is NOT NULL and the writer refuses a null rather than inventing a placeholder —
an empty card enters the review rotation and has to be fixed mid-session.

The split matters: table shapes in this suite are full of traps (below), and
none of them should be re-derived by a model on every call.

## The contract

**`route()` never throws and never loses a capture.** Classifier down, writer
rejects the row, confidence too low — every path ends with the text in
`cp_inbox`, which is where it landed before the router existed. Misfiling is
recoverable; a dropped thought Nate believes he saved is not.

Items below `CONFIDENCE_FLOOR` (0.6) and items classified `unknown` are demoted
to the inbox on purpose. An honest `unknown` beats a confident wrong route,
because a wrong route hides the capture in an app he will not think to open.

One utterance can produce several records — "I'm out of butter and eggs, and
remind me to call the vendor" is three items — and they are routed
independently, so one failing writer cannot take the others down.

## The confirmation line

The response is one line of `text/plain`, rendered verbatim in the watch
notification. It names the outcome (`Stock: butter -> shopping list`), never
just "Captured". That notification is the only place a misroute gets caught at
the wrist rather than three days later.

## capture_log

Writing straight into real tables is only safe to rely on because every capture
is logged: what he actually said, what the router decided, and the
`table` + `record_id` of each row it made. That is what lets "recent captures"
become a reviewable strip with re-file and undo.

A logging failure is non-fatal by design — the record is already written, and
erroring here would report a lost capture that was not lost. This also means
**deploy order does not matter**: the router works before the table exists.

## Landmines

Each is encoded in the relevant writer. They are why writers own storage.

- **`cp_tasks.due_date` months are ZERO-INDEXED.** jsonb `{d, m, y}` written by
  a JS client storing `Date.getMonth()`, so August is `m: 7`. Writing `m: 8`
  files the task in September and nothing errors. The sibling `due` text column
  is legacy and null on every current row.
- **`cp_notes.body` is `[{ "md": "..." }]`**, not a string. `project` holds a
  project *ID* even though `cp_tasks` calls the same thing `project_id`. `date`
  is TEXT in `Aug 3, 2026` form.
- **Stock `originId` must be `'manual'`.** `isDeliberateExtra()` in the Stock
  app routes rows with an unrecognised originId into the Already-have bucket
  when the name is pinned always-have or flagged a pantry staple — so a voice
  add tagged `capture` or `voice` would *vanish* from the list for exactly the
  staples he most often runs out of. Provenance goes in `originLabel`, which is
  display-only.
- **Stock pantry matching is exact-only.** Pantry names are specific ("fine sea
  salt"), so fuzzy-matching "salt" could flip the wrong jar to `out`. An
  unmatched name goes to the shopping list instead — the harmless failure. Both
  outcomes put the item in front of him when he shops.
- **`entries.source_surface` is CHECK-constrained.** `'capture'` and `'watch'`
  are rejected; `'mcp'` is the accepted value for programmatic writes. An Ink
  thought is a DUAL write — `entries` is canonical, `thoughts` is what the Mind
  stream reads, linked by `source_entry_id`. Writing one without the other
  produces a thought that exists but never appears.
- **`cp_inbox` has no `body` and no `source` column.** Provenance is `src`, full
  text is `snippet`, `title` is not-null. Composite PK `(user_id, id)` with `id`
  text and no default, and `user_id` defaults to `auth.uid()` — null under the
  service key — so both must be passed explicitly.
- **`flashcards.user_id` is NULLABLE and defaults to `auth.uid()`** — null under
  the service key. Omitting it inserts a card owned by nobody: no error, no
  failed constraint, and the row is invisible to Break's RLS-filtered reads
  forever. Every other suite table with this shape is not-null and fails loudly;
  this one does not. `context` is separately CHECK-constrained to
  `'fun' | 'work' | 'both'` and is the deck selector, so a wrong value files the
  card in a deck he does not review.
- **`pipeline_ideas.data.references` must be an array, never null.** The
  pipeline *list* guards it (`idea.references?.length ?? 0`) so a bad row looks
  fine there and stays hidden; the idea *detail* screen reads `.length` and
  `.map` straight, so opening that one idea is what crashes.
- **New `pantry_items` rows need a real `acquiredAt` and
  `defaultFreshnessDays`.** `freshnessStatus()` does arithmetic on both, and a
  null `acquiredAt` throws on `.getTime()`. An `isStaple` row returns 'fresh'
  before either is read, so `writeStockStaple` is safe by luck — any future
  writer adding a non-staple row is not. `location` genuinely is optional
  (`row.location ?? defaultLocation(cat)` on read), but the app's own add path
  always writes one.
- **Relative dates resolve in `America/New_York`.** Supabase runs UTC; a 9pm
  capture saying "tomorrow" files a day late if resolved server-side.
- **Project lookup must not filter to `status = 'active'`.** Nate captures
  against trips and side projects sitting at `on-hold` or `idea` for months
  ("Hawaii Trip" is on-hold), and filtering them out meant the name was never
  offered to the classifier, so the task silently landed with no project —
  invisible, because the task does exist. Duplicate names across statuses are
  real ("Stock", "Crate", "Cue" each exist twice), so ties rank
  active > on-hold > idea instead of letting read order decide.

## Deploying

Two steps. There is **no new secret** — `ANTHROPIC_API_KEY` is already set on
this project (the suite's `claude` proxy uses it), and Supabase secrets are
project-wide, so this function reads the same one. `CAPTURE_KEY` and `OWNER_ID`
are likewise already there.

Nothing runs on the Mac or the Beelink. The function executes on Supabase's
servers and calls `api.anthropic.com` over HTTPS itself.

1. **Create `capture_log`.** `supabase db push` is unusable on this shared
   project (~69 sibling migrations across the suite), so apply the migration
   body directly:

   ```sh
   supabase db query --project-ref xsmnfcmtbpeaccnyinkr \
     < supabase/migrations/20260803120000_capture_log.sql
   ```

2. **Deploy:**

   ```sh
   supabase functions deploy capture --no-verify-jwt --project-ref xsmnfcmtbpeaccnyinkr
   ```

   `--no-verify-jwt` is required — Shortcuts carries no Supabase JWT.

`CAPTURE_KEY`, `OWNER_ID`, and the "Capture" Shortcut are unchanged. Nothing on
the watch needs rebuilding.

## Verified so far

- `deno check` passes on the whole function graph.
- All six writer shapes were executed against the live schema inside a
  transaction and rolled back — every insert was accepted, nothing persisted.
- The `capture_log` migration plus the exact insert `route()` makes were
  validated the same way.

**Not yet verified: a real end-to-end capture.** The classifier has never been
called — `ANTHROPIC_API_KEY` is not set on the project yet — so routing
accuracy, latency, and the wording of the confirmation line are all untested on
a live utterance.

## Pick up here

1. Set `ANTHROPIC_API_KEY`, apply the migration, deploy.
2. `curl` a few captures and check where they land:

   ```sh
   curl -X POST https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture \
     -H "x-capture-key: $CAPTURE_KEY" -H "content-type: text/plain" \
     --data "I'm out of butter"
   ```

   Try one per kind, one multi-item utterance, and one deliberately vague one
   that *should* demote to the inbox.
3. Watch the latency. The Shortcut blocks on this response. If it feels slow at
   the wrist, `effort` in `classify.ts` is the first dial.
4. Then the review strip — `capture_log` is populated from day one, but nothing
   reads it yet. Undo is the feature that makes direct writes fully trustworthy.

## Deliberately not in v1

**Tide food logging.** Routing "two eggs and toast" to `tide_intake_logs` with a
raw insert would write calorie data that bypasses the Atwater guard and USDA
fallback in `usda-proxy`, so the numbers would be wrong in a table Nate makes
decisions from. It needs to call that existing pipeline, not a new insert —
worth doing, but as its own piece of work.

## Adding a destination

1. Add the `kind` to the enum in `classify.ts` and describe it in the system
   prompt, in Nate's own words for how he would say it out loud.
2. Add a writer in `writers.ts` that owns that table's shape, with its landmines
   in comments.
3. Add the case to `dispatch()` in `index.ts`.

Then validate the insert against the live schema in a rolled-back transaction
before shipping — every landmine above was found that way, and eyeballing the
column list would have missed most of them.
