// supabase/functions/_shared/router/classify.ts
//
// Turns one dictated capture into a list of routed items. This is the only
// place in the router that talks to a model; everything downstream is plain
// table writes, so a classification bug can never corrupt a record shape.
//
// One utterance can produce several items ("I'm out of butter and eggs, and
// remind me to call the vendor"), so the return is always an array. An empty
// array is a legitimate answer and means "file this verbatim to the inbox".
//
// The model never sees credentials, never picks a table, and never writes a
// column name. It picks a `kind` from a closed set and fills in plain text
// fields; writers.ts owns the mapping from `kind` to storage. That split is
// deliberate: table shapes in this suite are full of landmines (see
// writers.ts) and none of them should be re-derived by a model on every call.

// Raw HTTP rather than @anthropic-ai/sdk on purpose. Every esm.sh build of the
// SDK (including ?target=denonext) ships typings that reference
// `npm:@types/node`, which `deno check` cannot resolve in this repo — no
// node_modules, no deno.json — and adding either just to type one POST is a
// worse trade than writing the POST. The rest of the repo type-checks clean
// and this keeps it that way.
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const ANTHROPIC_VERSION = '2023-06-01'

// Nate is in New York; Supabase runs UTC. Relative dates ("tomorrow") are
// resolved against HIS day, not the server's, or a 9pm capture files a task
// one day late.
const TZ = 'America/New_York'

export type Kind =
  | 'course_task'
  | 'course_note'
  | 'stock_out'
  | 'stock_staple'
  | 'stock_idea'
  | 'ink_thought'
  | 'break_lookup'
  | 'break_flashcard'
  | 'unknown'

export interface RoutedItem {
  kind: Kind
  /** The content itself: task label, note body, item name, thought, question. */
  text: string
  /** Note headline. Null for every other kind. */
  title: string | null
  /**
   * A flashcard's answer side. Null for every other kind.
   *
   * This is the one field the model AUTHORS rather than extracts: Nate
   * dictates only the front ("add tendentious to break flashcards"), so the
   * back has to be written here. `flashcards.back` is NOT NULL, so an item
   * that arrives with a null back cannot be written and is demoted.
   */
  back: string | null
  /** A Course+ project NAME copied verbatim from the list we supplied, or null. */
  project: string | null
  /** ISO `YYYY-MM-DD`, already resolved from "tomorrow"/"Thursday". */
  due: string | null
  /** 0..1. Below CONFIDENCE_FLOOR the item is demoted to the inbox. */
  confidence: number
}

/** Below this we do not trust the route and fall back to cp_inbox. */
export const CONFIDENCE_FLOOR = 0.6

/**
 * Names Apple's dictation reliably gets wrong, because the wrong spelling is
 * the ordinary English word and the right one is a proper noun it has never
 * seen. No amount of context lets a model infer these — "Myra" and "Mayra" are
 * both real names — so they have to be told.
 *
 * This corrects the RECORD, never the capture. `capture_log.raw_text` keeps
 * what was actually dictated, so a bad substitution here stays traceable
 * rather than overwriting the only copy of what he said.
 *
 * Add to this list as new ones show up; it is read straight into the prompt.
 */
export const DICTATION_FIXES: Array<{ heard: string; write: string; note?: string }> = [
  { heard: 'Myra', write: 'Mayra', note: 'colleague; spelled Mayra, pronounced Myra' },
  { heard: 'John', write: 'Jon', note: 'colleague; always the short spelling' },
  { heard: 'Aerosphere', write: 'Arrowsphere', note: 'the CSP platform, not anything aerospace' },
]

// Every field is required and explicitly nullable rather than optional:
// structured outputs enforce `required` + `additionalProperties: false`, and a
// nullable-but-present field is far more reliable than an omitted one.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text', 'title', 'back', 'project', 'due', 'confidence'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'course_task',
              'course_note',
              'stock_out',
              'stock_staple',
              'stock_idea',
              'ink_thought',
              'break_lookup',
              'break_flashcard',
              'unknown',
            ],
          },
          text: { type: 'string' },
          title: { type: ['string', 'null'] },
          back: { type: ['string', 'null'] },
          project: { type: ['string', 'null'] },
          due: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
      },
    },
  },
}

/** Today's date in Nate's timezone, as `YYYY-MM-DD`. */
export function today(): string {
  // en-CA formats as YYYY-MM-DD, which is the one locale that gives us ISO
  // ordering for free without hand-assembling the parts.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function systemPrompt(projectNames: string[]): string {
  return `You route one short voice capture into the right app in Nate's personal software suite. He dictated it on a watch or phone while away from a screen, so it is casual, unpunctuated, and may contain several unrelated items at once.

Return one entry per distinct item. Most captures contain exactly one.

The kinds:

- course_task — an action he or someone else needs to take. Work items, follow-ups, errands with a clear verb. Put the action in \`text\`, written as a task ("Ask Mayra to register the CSA deal"), not as he said it. Set \`project\` only when the capture clearly names one of the projects listed below, copied verbatim. Set \`due\` when a time is stated or implied.
- course_note — information worth keeping about work, with no action attached. A decision, a number, something someone said. \`title\` is a short headline; \`text\` is the body.
- stock_out — he is out of, low on, or wants to buy a grocery or kitchen item RIGHT NOW. \`text\` is ONLY the item name, singular and lowercase ("butter", "olive oil"). One entry per item.
- stock_staple — he wants an item to become part of his standing pantry list, not a one-off purchase. Signalled by the word "staple" or "always keep" ("add butter to stock staples"). This is about the item's STANDING, not about being out of it right now. \`text\` is ONLY the item name, singular and lowercase.
- stock_idea — a meal, dish, or cooking idea to try later, NOT a shopping need. Usually a dish name rather than an ingredient ("stock idea: steak butter", "we should try smash burgers"). \`text\` is the idea itself; \`title\` is a short name for it.
- ink_thought — a personal reflection, observation, or idea about himself. Not work, not an action.
- break_lookup — something he wants to LOOK UP or learn about later. Usually phrased as a question or a term he does not know yet.
- break_flashcard — he wants a flashcard MADE, signalled by the word "flashcard". \`text\` is the front (the prompt side: the word, term, or question, exactly as he said it). \`back\` is the answer side, which you must WRITE yourself — he only ever dictates the front. For a vocabulary word, the back is a concise definition, part of speech first ("adj. — biased toward a particular viewpoint"). For a question, the back is the answer. Keep it to one or two lines; it is read on a phone. \`back\` must never be null for this kind.
- unknown — you cannot tell. Use this freely; an honest \`unknown\` is far better than a confident wrong route, because a wrong route hides the capture in an app he will not think to check.

The difference between stock_out, stock_staple, and stock_idea matters: stock_out changes what he buys this week, stock_staple changes what he keeps forever, stock_idea is a dish he might cook. "I'm out of butter" is stock_out. "Add butter to my staples" is stock_staple. "Steak butter" is stock_idea — a thing to make, not a thing to buy.

Likewise break_lookup vs break_flashcard: "look up what a mansard roof is" is break_lookup, "add mansard roof to my flashcards" is break_flashcard. The word "flashcard" is the tell.

If he names an app out loud ("Course Plus...", "Stock...", "Ink...", "Break..."), that overrides your own read of the content. He often leads with the app name and then the content ("course plus, hawaii trip, figure out activities for big island"), and he may say "Course Plus" as "course+".

\`confidence\` is your genuine belief that this item is routed to the right kind, 0 to 1. Use the full range. Anything below ${CONFIDENCE_FLOOR} is filed to the inbox for manual triage instead, which is a good outcome when you are unsure.

Today is ${today()} (America/New_York). Resolve every relative date against it and emit \`due\` as YYYY-MM-DD.

Dictation spells these wrong every time, because the wrong spelling is the more common word. Whenever one is clearly what he said, write the RIGHT-hand spelling in every field you emit:
${DICTATION_FIXES.map((f) => `- heard "${f.heard}" -> write "${f.write}"${f.note ? ` (${f.note})` : ''}`).join('\n')}

Correct these ONLY when the context makes it obvious he means that person or thing. A capture genuinely about aerospace still says aerospace.

Open Course+ projects — \`project\` must be one of these strings exactly, or null. Match loosely on what he says ("hawaii trip" -> "Hawaii Trip") but emit the name EXACTLY as written here:
${projectNames.map((n) => `- ${n}`).join('\n')}`
}

/**
 * Classify one capture. Throws on any model or parse failure — the caller is
 * responsible for falling back to the inbox, because losing a capture is worse
 * than misfiling one.
 */
export async function classify(
  text: string,
  projectNames: string[],
): Promise<RoutedItem[]> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      // Thinking is on by default on this model and max_tokens caps thinking
      // plus text together, so this is sized well above the tiny JSON payload.
      max_tokens: 16000,
      // Low effort keeps the round trip short. The watch Shortcut blocks on
      // this response, and the notification it renders is the only proof a
      // capture landed, so latency here is user-visible in a way cost is not.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      system: systemPrompt(projectNames),
      messages: [{ role: 'user', content: text }],
    }),
  })

  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const response = await res.json() as {
    stop_reason?: string
    content?: Array<{ type: string; text?: string }>
  }

  // A safety refusal returns HTTP 200 with an empty content array, so this has
  // to be checked before reading content or it looks like a malformed reply.
  if (response.stop_reason === 'refusal') throw new Error('classifier refused')

  const block = response.content?.find((b) => b.type === 'text')
  if (!block?.text) throw new Error('no text block returned')

  const parsed = JSON.parse(block.text) as { items?: RoutedItem[] }
  return Array.isArray(parsed.items) ? parsed.items : []
}
