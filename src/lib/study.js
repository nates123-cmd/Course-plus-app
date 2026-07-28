// Study AI — build dives out of the user's own work material, then grade an
// from-memory explanation against it.
//
// The shape is borrowed from Break's Active Recall (explain it cold, get graded
// point by point), but the substance is inverted. Break drills world knowledge
// the model already holds. Course+ drills things only the user's corpus knows:
// what a client actually agreed to, what the pricing model actually is, what Jon
// actually said. So every call here is grounded in supplied source text, and the
// grader is given that source — which lets it do the thing Break's grader
// cannot: catch a confident answer that contradicts the record.
import { claudeComplete, extractJSON, pickModel } from './claude'

const SYSTEM =
  'You are a study coach inside a personal work app. You build recall drills from a professional\'s own ' +
  'notes, meeting transcripts, and project records, and you grade their from-memory explanations. ' +
  'Return ONLY valid JSON - no markdown fences, no preamble, no commentary.'

// Long source material gets clipped rather than refused. Transcripts run long
// and the drill only needs the substance, not every "yeah, totally".
const clip = (s, n = 14000) => {
  const str = String(s || '')
  return str.length <= n ? str : str.slice(0, n) + '\n\n[…source truncated]'
}

function normalizeDive(d, fallbackTitle) {
  const title = (d?.title || fallbackTitle || 'Untitled dive').trim()
  const points = Array.isArray(d?.keyPoints) ? d.keyPoints : []
  return {
    title,
    prompt: (d?.prompt || `Explain ${title} from memory.`).trim(),
    summary: (d?.summary || '').trim(),
    keyPoints: points
      .map((k) => ({ text: typeof k === 'string' ? k : String(k?.text || '').trim() }))
      .filter((k) => k.text),
  }
}

// Split a document / project state into the drills it actually contains. A
// 90-minute transcript is rarely one topic, and a drill that spans four
// unrelated threads is ungradeable — so Claude proposes up to `max` distinct
// dives and the user picks which ones are worth keeping.
export async function proposeDives(sourceText, sourceLabel, { max = 4, onUsage } = {}) {
  const user =
    `Below is work material belonging to the user - ${sourceLabel || 'a document'}.\n\n` +
    'Identify the distinct things in it that the user would need to be able to explain OUT LOUD, cold, ' +
    'in a meeting - decisions and their reasons, mechanics of how something works, commitments and who owns them, ' +
    'numbers that matter, and open questions. Ignore small talk, scheduling, and pleasantries.\n\n' +
    `Produce between 1 and ${max} drills. Prefer FEWER, meatier drills over many thin ones; if the material really ` +
    'is one topic, return exactly one.\n\n' +
    'For each drill give:\n' +
    '- "title": short, specific, names the actual thing (not "Meeting notes")\n' +
    '- "prompt": one or two imperative sentences asking them to explain it from memory. It must NOT reveal the answer.\n' +
    '- "summary": one sentence naming what the drill covers, safe to read on a list without spoiling it\n' +
    '- "keyPoints": 3 to 6 things a strong answer must contain, each a specific claim drawn from the material ' +
    '(a real name, number, decision, or mechanism - never "understands the context")\n\n' +
    'MATERIAL:\n' + clip(sourceText) + '\n\n' +
    'Return JSON only: {"dives":[{"title":"...","prompt":"...","summary":"...","keyPoints":[{"text":"..."}]}]}'
  const raw = await claudeComplete(user, { system: SYSTEM, model: pickModel('heavy'), max_tokens: 2400, onUsage })
  const j = extractJSON(raw)
  const list = Array.isArray(j?.dives) ? j.dives : (j?.title ? [j] : [])
  return list.map((d) => normalizeDive(d, sourceLabel)).filter((d) => d.keyPoints.length).slice(0, max)
}

// A drill on a named topic, optionally grounded in context the user pasted or
// the document it came from. The manual path — used when there is no document,
// only a thing you know you have to be able to talk about on Thursday.
export async function buildDiveFromTopic(title, contextText, { onUsage } = {}) {
  const user =
    `The user has to be able to explain this cold, in a work setting: "${title}".\n\n` +
    (contextText ? 'Their own material on it:\n' + clip(contextText) + '\n\n' : '') +
    'Write: a "prompt" - one or two imperative sentences asking them to explain it from memory, revealing nothing; ' +
    'a one-sentence "summary"; and 3 to 6 "keyPoints" a strong explanation must hit. ' +
    (contextText
      ? 'Draw the key points from THEIR material, not from general knowledge. The material may hold more than ' +
        'this one topic - a whole project record, for instance - so use only the parts that bear on "' + title + '", ' +
        'and ignore the rest rather than padding the drill with it. Where sections are separated by ---, EARLIER ' +
        'sections are the more specific signal and outrank later ones on any conflict.'
      : 'Keep the key points to what a competent professional would be expected to cover.') +
    '\n\nReturn JSON only: {"prompt":"...","summary":"...","keyPoints":[{"text":"..."}]}'
  const raw = await claudeComplete(user, { system: SYSTEM, model: pickModel('heavy'), max_tokens: 1200, onUsage })
  return normalizeDive({ ...(extractJSON(raw) || {}), title }, title)
}

// Grade a from-memory explanation. `sourceText` is optional but changes the
// grade materially when present: with the record in hand the grader can mark a
// confidently-stated claim as WRONG rather than merely absent, which is the
// failure mode that actually costs you in a meeting.
export async function gradeExplanation({ prompt, keyPoints = [], answer, sourceText = '', onUsage } = {}) {
  const points = keyPoints.map((k, i) => `${i + 1}. ${k.text}`).join('\n')
  const user =
    'You are grading a from-memory explanation given by a professional preparing to discuss this at work. ' +
    'Be encouraging but honest - a soft grade here costs them in the actual meeting.\n\n' +
    `The prompt they answered: "${prompt}"\n\n` +
    `Key points a strong answer must hit (numbered from 1):\n${points}\n\n` +
    (sourceText ? 'The source record this was drawn from (ground truth):\n' + clip(sourceText, 9000) + '\n\n' : '') +
    `Their explanation:\n"${answer}"\n\n` +
    'Return JSON only with exactly four fields:\n' +
    '"feedback": 2 to 4 sentences of specific prose, second person, naming what they hit and what they missed. ' +
    'No score, grade, number, letter, or percentage.\n' +
    '"verdicts": an array of {"index": <0-based key point number>, "hit": true|false} with one entry for EVERY key point.\n' +
    '"corrections": an array of {"said":"...","actual":"..."} for anything they stated that the source ' +
    'CONTRADICTS. Only real conflicts with the record - not omissions, not phrasing. Empty array if none.\n' +
    '"bucket": one of "miss", "hard", "easy" - the overall read, used internally.'
  const raw = await claudeComplete(user, { system: SYSTEM, model: pickModel('heavy'), max_tokens: 1600, onUsage })
  const j = extractJSON(raw) || {}
  const verdicts = (Array.isArray(j.verdicts) ? j.verdicts : [])
    .filter((v) => v && Number.isInteger(v.index) && v.index >= 0 && v.index < keyPoints.length)
    .map((v) => ({ index: v.index, hit: !!v.hit }))
  const bucket = ['miss', 'hard', 'easy'].includes(j.bucket) ? j.bucket : null
  return {
    feedback: (j.feedback || '').trim(),
    verdicts,
    corrections: (Array.isArray(j.corrections) ? j.corrections : [])
      .map((c) => ({ said: String(c?.said || '').trim(), actual: String(c?.actual || '').trim() }))
      .filter((c) => c.said && c.actual),
    bucket,
    hits: verdicts.filter((v) => v.hit).length,
    total: keyPoints.length,
  }
}
