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
  | 'ink_thought'
  | 'break_lookup'
  | 'unknown'

export interface RoutedItem {
  kind: Kind
  /** The content itself: task label, note body, item name, thought, question. */
  text: string
  /** Note headline. Null for every other kind. */
  title: string | null
  /** A Course+ project NAME copied verbatim from the list we supplied, or null. */
  project: string | null
  /** ISO `YYYY-MM-DD`, already resolved from "tomorrow"/"Thursday". */
  due: string | null
  /** 0..1. Below CONFIDENCE_FLOOR the item is demoted to the inbox. */
  confidence: number
}

/** Below this we do not trust the route and fall back to cp_inbox. */
export const CONFIDENCE_FLOOR = 0.6

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
        required: ['kind', 'text', 'title', 'project', 'due', 'confidence'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'course_task',
              'course_note',
              'stock_out',
              'ink_thought',
              'break_lookup',
              'unknown',
            ],
          },
          text: { type: 'string' },
          title: { type: ['string', 'null'] },
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
- stock_out — he is out of, low on, or wants to buy a grocery or kitchen item. \`text\` is ONLY the item name, singular and lowercase ("butter", "olive oil"). One entry per item.
- ink_thought — a personal reflection, observation, or idea. Not work, not an action.
- break_lookup — something he wants to learn about or look up later. Usually phrased as a question or an unfamiliar term.
- unknown — you cannot tell. Use this freely; an honest \`unknown\` is far better than a confident wrong route, because a wrong route hides the capture in an app he will not think to check.

If he names an app out loud ("Course Plus...", "Stock...", "Ink..."), that overrides your own read of the content.

\`confidence\` is your genuine belief that this item is routed to the right kind, 0 to 1. Use the full range. Anything below ${CONFIDENCE_FLOOR} is filed to the inbox for manual triage instead, which is a good outcome when you are unsure.

Today is ${today()} (America/New_York). Resolve every relative date against it and emit \`due\` as YYYY-MM-DD.

Active Course+ projects — \`project\` must be one of these strings exactly, or null:
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
