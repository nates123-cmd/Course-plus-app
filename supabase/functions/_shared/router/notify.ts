// supabase/functions/_shared/router/notify.ts
//
// Escalation for captures the router could not confidently file.
//
// The router already guarantees nothing is LOST — every failure path writes to
// cp_inbox. What it cannot do is tell Nate that it happened. A demoted capture
// looks identical to a capture he never made until he opens the Inbox, which
// is exactly the app the router exists to stop him having to open. So the
// demotion itself is the notification trigger.
//
// This only fires for failures the router KNOWS about: low confidence, an
// `unknown` kind, a writer that threw, or the classifier being unreachable. A
// confident-but-wrong route cannot be detected here by construction — the
// server believes it succeeded. That case is caught by the confirmation line
// on the watch at capture time, and recovered from capture_log later.
//
// Telegram rather than web push because it is two-way: the message carries the
// text verbatim, so a reply can re-file it without Nate opening anything.

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') || ''

/** Supabase's edge runtime lets work outlive the response. */
declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined

export interface Demotion {
  kind: string
  confidence: number | null
  demoted_reason?: string
}

/** Telegram HTML mode needs these escaped or the send 400s on stray markup. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildMessage(
  text: string,
  src: string,
  demotions: Demotion[],
  logId: string | null,
): string {
  const reasons = [...new Set(demotions.map((d) => d.demoted_reason).filter(Boolean))]

  // The verbatim text is the whole point of the message: even if the row is
  // hard to find later, the words survive somewhere he already reads.
  const lines = [
    `<b>Capture needs filing</b> (${esc(src)})`,
    '',
    `<i>${esc(text)}</i>`,
    '',
    `Filed to Inbox instead — ${esc(reasons.join(', ') || 'could not route')}.`,
    'Reply to this message with where it should go.',
  ]
  // The ref is what the re-file skill matches on. Kept to 8 characters because
  // it is read on a phone, and prefix-matched server-side; a full uuid on
  // every alert is noise in a message meant to be glanceable.
  if (logId) lines.push('', `<code>ref ${esc(logId.slice(0, 8))}</code>`)
  return lines.join('\n')
}

/**
 * Send the escalation. Never throws and never delays the capture response.
 *
 * Failing to notify must not fail the capture: the record is already written,
 * and surfacing an error here would report a lost capture that was not lost —
 * the same reasoning that makes capture_log logging non-fatal.
 *
 * The watch Shortcut blocks on the HTTP response, so this is handed to
 * `waitUntil` where the runtime supports it and the send finishes after Nate
 * already has his confirmation. Without waitUntil it is awaited, because a
 * floating promise in an edge function is killed when the response returns and
 * the notification would silently never arrive.
 */
export async function escalate(
  text: string,
  src: string,
  demotions: Demotion[],
  logId: string | null = null,
): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return // not configured — stay silent, stay harmless
  if (demotions.length === 0) return

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`

  const post = (body: Record<string, unknown>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, ...body }),
    })

  const send = post({ text: buildMessage(text, src, demotions, logId), parse_mode: 'HTML' })
    .then(async (res) => {
      if (res.ok) return
      console.error(`telegram ${res.status}: ${(await res.text()).slice(0, 200)}`)

      // Telegram rejects the whole message when its HTML will not parse, so a
      // formatting bug would silently swallow the one alert that exists to say
      // a capture needs attention. Retry unformatted: ugly beats unsent.
      const plain = await post({
        text:
          `Capture needs filing (${src})\n\n${text}\n\n` +
          `Filed to Inbox instead. Reply with where it should go.` +
          (logId ? `\n\nref ${logId.slice(0, 8)}` : ''),
      })
      if (!plain.ok) {
        console.error(`telegram plain retry ${plain.status}`)
      }
    })
    .catch((err) => {
      console.error('telegram send failed:', err instanceof Error ? err.message : err)
    })

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(send)
    return
  }
  // No waitUntil: await it. Letting the promise float would hand Nate his
  // confirmation and then kill the send with the response, so the one capture
  // that most needed a notification would be the one that never sent it.
  await send
}
