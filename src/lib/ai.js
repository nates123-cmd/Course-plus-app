// Scribe AI surfaces — real Claude calls (via the JWT-gated `claude` proxy)
// that replace the prototype's setTimeout fakes.
import { claudeComplete, claudeChat, extractJSON } from './claude'

// Ask-about-this-document — a short multi-turn conversation whose SCOPE the user
// chooses: just the open document, its whole project, or its whole area/pillar.
// `doc` = { title, kind, content }; `history` = prior [{role,content}] turns;
// `opts` = { scope:'document'|'project'|'area', contextText, contextLabel }.
// At project/area scope the wider context is genuinely in-scope (not background)
// so questions that reach past the doc get real answers. Returns reply text.
export async function askDocument(doc, history, question, opts = {}) {
  const { scope = 'document', contextText = '', contextLabel = '' } = opts
  const { title = 'Untitled', kind = 'document', content = '' } = doc || {}
  const wide = scope !== 'document' && !!(contextText && contextText.trim())
  const word = scope === 'area' ? 'area / pillar' : 'project'
  const system = wide
    ? `You are helping the user with their ${word} "${contextLabel}" inside a personal work app. ` +
      `The ENTIRE ${word.toUpperCase()} is in scope — its projects, notes, meetings, tasks, status, and artifacts are all provided below and you may use ANY of it to answer. ` +
      `Do NOT restrict yourself to the single document the user happens to have open (provided last) — that is one item within the ${word}, give it weight only when the question is about it. ` +
      `Ground answers in the provided material; if something genuinely isn't there, say so. Be concise and specific. Reply in clean markdown, no preamble.`
    : 'You answer questions about ONE specific document the user is reading inside a personal work app. ' +
      'Ground every answer in that document — if the answer is not in it, say so plainly. Be concise and specific. Reply in clean markdown, no preamble.'
  const docBlock = `OPEN DOCUMENT — "${title}" (${kind}):\n${content || '(empty)'}`
  // Put the wide context FIRST and the single doc LAST so the model doesn't
  // over-anchor on the open document.
  const firstTurn = wide
    ? `${scope === 'area' ? 'AREA' : 'PROJECT'} CONTEXT — "${contextLabel}":\n${contextText.trim()}\n\n---\n\n${docBlock}`
    : docBlock
  const model = firstTurn.length > 12000 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5'
  const messages = [{ role: 'user', content: firstTurn }, ...(history || []), { role: 'user', content: question }]
  return (await claudeChat(messages, { system, model, max_tokens: 1400 })).trim()
}

// Ask / retrieval — answer ONLY from the provided notes, cite note ids. Corpus
// includes people / terms / body / transcript so content questions ("what did
// X say") resolve, not just title + summary.
const askLine = (n) => {
  const body = (n.body || []).map((b) =>
    b.p || (b.ul ? b.ul.join('; ') : (b.ol ? b.ol.join('; ') : (b.links ? 'see also: ' + b.links.join(', ') : '')))
  ).filter(Boolean).join(' ')
  const people = (n.people || []).length ? ' | people: ' + n.people.join(', ') : ''
  const terms = (n.terms || []).length ? ' | terms: ' + n.terms.join(', ') : ''
  const tags = (n.tags || []).length ? ' | tags: ' + n.tags.join(', ') : ''
  const transcript = n.transcript ? '\ntranscript: ' + n.transcript : ''
  return `[${n.id}] (${n.kind}${n.project ? ', ' + n.project : ''}, ${n.date || ''})${people}${terms}${tags}\n` +
    `${n.title}\n${n.summary || ''}\n${body}${transcript}`
}

export async function askNotes(query, notes) {
  const corpus = notes.map(askLine).join('\n\n---\n\n')
  const system =
    'You are the retrieval engine for a personal notes app called Scribe. ' +
    'Answer the question using ONLY the provided notes (their people, terms, body, and transcript all count). ' +
    'Be concise and specific. Cite the ids of the notes you actually used.'
  const user =
    `Notes:\n${corpus}\n\nQuestion: ${query}\n\n` +
    'Return ONLY JSON: {"answer": string, "sources": string[] (note ids, most relevant first, max 4)}'
  const raw = await claudeComplete(user, { system, max_tokens: 900 })
  const j = extractJSON(raw)
  if (j && j.answer) return { answer: j.answer, sourceIds: (j.sources || []).slice(0, 4) }
  return { answer: raw, sourceIds: [] }
}

// Project briefing — calm current-picture prose. Does NOT auto-run (caller gates).
export async function briefingFor(projectName, notes) {
  const lines = notes.map((n) => {
    const acts = (n.actions || []).map((a) => `  - ${a.text}${a.owner ? ` (${a.owner})` : ''}`).join('\n')
    return `• ${n.title} [${n.kind}]${n.summary ? ': ' + n.summary : ''}${acts ? '\n' + acts : ''}`
  }).join('\n')
  const system =
    'You write calm, concise project briefings for a personal work app. ' +
    '3–5 sentences, plain prose, present tense, lead with the critical path. ' +
    'No headings, no preamble, no "here is".'
  const user = `Project: ${projectName}\n\nNotes & open actions:\n${lines}\n\nWrite the current-picture briefing.`
  return (await claudeComplete(user, { system, max_tokens: 500 })).trim()
}

const TYPE_BRIEF = {
  onepager: 'a tight one-page brief',
  exec: 'a decision-first executive summary of 3–5 bullets',
  email: 'a ready-to-send email draft',
  deck: 'a slide-by-slide deck outline',
}
// Compose a paste-ready deliverable from the FULL material — note bodies AND
// meeting transcripts, not just summaries (a transcript is far richer source for
// building an artifact than a lossy summary). Escalates to Sonnet for big inputs.
export async function composeDeliverable(typeId, instructions, sourceLabel, notes, onUsage) {
  const corpus = notes.map((n) => {
    const body = (n.body || []).map((b) => b.p
      || (b.ul ? b.ul.map((i) => '- ' + i).join('\n')
      : (b.ol ? b.ol.map((i, k) => (k + 1) + '. ' + i).join('\n') : ''))).filter(Boolean).join('\n')
    const tx = n.transcript ? `\nTranscript:\n${n.transcript}` : ''
    return `## ${n.title}${n.summary ? '\nSummary: ' + n.summary : ''}${body ? '\n' + body : ''}${tx}`
  }).join('\n\n---\n\n')
  const big = corpus.length > 12000 || notes.length > 6
  const model = big ? 'claude-sonnet-4-6' : 'claude-haiku-4-5'
  const system =
    'You compose clean, paste-ready business deliverables. Work from the FULL source material ' +
    '(note bodies and meeting transcripts) — use the detail, not just the summaries. ' +
    'Output ONLY the deliverable content in plain markdown — no preamble, no "here is".'
  const user =
    `Source: ${sourceLabel}\nMaterial:\n${corpus}\n\n` +
    `Produce ${TYPE_BRIEF[typeId] || 'a brief'}.` +
    (instructions ? ` Instructions: ${instructions}` : '')
  return (await claudeComplete(user, { system, model, max_tokens: 2000, onUsage })).trim()
}

// "Update Document" guide. Given an existing document + a meeting, produce a
// hand-applyable EDIT GUIDE (NOT a rewrite) — for editing the doc on a
// disconnected work machine. Hybrid output: a what/why summary, then anchored
// find/replace edits. Returns { guide, usage }.
export async function updateGuide({ documentTitle = '', document = '', meetingTitle = '', transcript = '', notes = '', instructions = '' } = {}) {
  const system =
    'You produce a precise EDIT GUIDE for a document the user will hand-edit on a DISCONNECTED ' +
    'computer. NEVER rewrite or reprint the whole document. The meeting (transcript + the user\'s ' +
    'notes) is the source of truth for what changed. Only suggest edits the meeting actually ' +
    'implies — minimal and specific. Anchor every edit to a short, unique quote of the EXISTING ' +
    'document text so it can be found by search offline. Output clean markdown only.'
  const parts = [`CURRENT DOCUMENT — "${documentTitle || 'Untitled'}":\n${document || '(empty)'}`]
  if (notes.trim()) parts.push(`MY NOTES from the meeting (high priority):\n${notes.trim()}`)
  if (transcript.trim()) parts.push(`MEETING TRANSCRIPT — "${meetingTitle || 'meeting'}":\n${transcript.trim()}`)
  if (instructions.trim()) parts.push(`EXTRA INSTRUCTIONS: ${instructions.trim()}`)
  const user = parts.join('\n\n---\n\n') + '\n\n' +
    'Produce the edit guide as markdown in TWO parts:\n\n' +
    '## Summary of changes\n' +
    'A few bullets: what you suggest changing and WHY, tied to what the meeting decided/surfaced.\n\n' +
    '## Edits\n' +
    'In document order, one block per change:\n' +
    '### <section / location heading>\n' +
    '- **Find:** "<short unique quote of the existing text>"\n' +
    '- **Action:** Replace | Insert after | Delete\n' +
    '- **New text:** <the exact text to write>\n\n' +
    'If a change can\'t be anchored to a quote, anchor to the nearest heading. Add a final ' +
    '"## New sections to add" only if needed. If nothing needs changing, say so plainly.'
  let usage = null
  const guide = (await claudeComplete(user, { system, model: 'claude-sonnet-4-6', max_tokens: 4096, onUsage: (u) => { usage = u } })).trim()
  return { guide, usage }
}

// Synthesize a meeting into exactly three things the user wants: a bullet-point
// topic summary (for fast orientation), action items, and smart searchable tags.
// The user's OWN live notes are the highest-signal input — they wrote those down
// because they mattered — so they're weighted above the transcript. Long
// transcripts escalate to Sonnet for whole-meeting recall.
export async function synthesizeMeeting({ liveNotes = '', agenda = '', transcript = '', people = [], speakerLabels = [], detail = 'low' } = {}) {
  const tx = transcript || ''
  const long = tx.length > 18000
  const model = (detail === 'high' || long) ? 'claude-sonnet-4-6' : 'claude-haiku-4-5'
  const maxTok = detail === 'high' ? 4096 : detail === 'low' ? 1100 : 2400
  const summarySpec = detail === 'high'
    ? 'a THOROUGH, in-depth briefing as markdown bullets — cover every topic, decision, number, ' +
      'commitment, and nuance, with indented sub-bullets where useful. Be detailed enough that I ' +
      'could build a deliverable from this summary alone.'
    : detail === 'low'
    ? 'a tight, highest-level digest — 3 to 6 markdown bullets, only the essentials.'
    : 'a clear markdown bullet overview — roughly one or two "- " bullets per topic discussed.'
  const system =
    'You synthesize a meeting for a personal work app used by Nate (me / the note-taker — ' +
    'always one of the participants). The USER\'S OWN NOTES are the highest-signal input — they ' +
    'wrote these down because they mattered. Lead with them and treat the transcript as supporting ' +
    'detail (cover its whole length, not just the opening). Return strict JSON only — no preamble.'
  const parts = []
  if (people.length) parts.push(`People present (use these names): ${people.join(', ')}`)
  else parts.push('No participant list was given — infer speaker names from the conversation (who they address, self-introductions, sign-offs). One speaker is always Nate.')
  if (agenda.trim()) parts.push(`Pre-meeting agenda / what I wanted to cover:\n${agenda.trim()}`)
  if (liveNotes.trim()) parts.push(`MY LIVE NOTES (highest priority — these are what I judged worth writing):\n${liveNotes.trim()}`)
  if (tx.trim()) parts.push(`Transcript (${tx.length} chars, supporting context):\n${tx.trim()}`)
  const labelList = (speakerLabels || []).filter(Boolean)
  const speakerAsk = labelList.length
    ? `\n\nThe transcript labels speakers as: ${labelList.join(', ')}. In "speakers", map EACH of those labels to the most likely real first name (lead with the people list above; otherwise infer; the first-person speaker is Nate). Only include confident guesses.`
    : ''
  const user =
    parts.join('\n\n---\n\n') + '\n\n' +
    'Return ONLY JSON (no markdown fences, no prose around it). Use real "\\n" in strings for line ' +
    'breaks and "- " for bullets. Shape: {' +
    '"summary": string (' + summarySpec + '), ' +
    '"actions": [{"text": string, "owner": string}], ' +
    '"next_steps": string (markdown bullet points — your suggested next steps / follow-ups / ' +
    'recommendations for how I should move this forward; specific and useful), ' +
    '"tags": string[] (smart, lowercase, searchable topic + key-term labels — 4 to 10), ' +
    '"speakers": object (map each transcript speaker label to a real first name)}\n\n' +
    'Format "summary" and "next_steps" as clean, well-spaced markdown: short "## Heading" sections ' +
    'where it helps, "- " bullets underneath, and a blank line between sections. Use "**bold**" for ' +
    'emphasis sparingly — never leave stray "#" or "*" that aren\'t real markdown.\n\n' +
    'IMPORTANT: "actions" must contain ONLY action items that are MINE to do — the note-taker / ' +
    'first person ("I will…", "my job is…", things assigned to me — I am Nate). OMIT other people\'s ' +
    'to-dos. Set each owner to "me". If none are mine, return [].' + speakerAsk
  let usage = null
  const raw = await claudeComplete(user, { system, model, max_tokens: maxTok, onUsage: (u) => { usage = u } })
  // Tolerant parse: if the JSON is truncated (big detailed summary hits the token
  // cap) JSON.parse fails — salvage the string fields by regex so the user never
  // sees a raw "{...\n..." blob.
  const j = extractJSON(raw) || {}
  const grab = (k) => { try { const m = raw.match(new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); return m ? JSON.parse('"' + m[1] + '"') : '' } catch { return '' } }
  const summary = (typeof j.summary === 'string' && j.summary) ? j.summary : grab('summary')
  const nextSteps = (typeof j.next_steps === 'string' && j.next_steps) ? j.next_steps : grab('next_steps')
  return {
    summary: summary || '', nextSteps: nextSteps || '',
    actions: Array.isArray(j.actions) ? j.actions : [],
    tags: Array.isArray(j.tags) ? j.tags : [],
    speakers: (j.speakers && typeof j.speakers === 'object') ? j.speakers : {},
    people: [], terms: [], usage,
  }
}

// ── Note Claude-rail actions ───────────────────────────────────────
export const noteContext = (note) => {
  const body = (note.body || []).map((b) => b.p || (b.ul ? b.ul.map((i) => '- ' + i).join('\n') : (b.ol ? b.ol.map((i, n) => (n + 1) + '. ' + i).join('\n') : ''))).join('\n')
  return `Title: ${note.title}\n${note.summary ? 'Summary: ' + note.summary + '\n' : ''}Body:\n${body}${note.transcript ? '\nTranscript:\n' + note.transcript : ''}`
}

export async function summarizeNote(note) {
  const system = 'You summarize a note in 2–3 calm sentences. Plain prose, no preamble.'
  return (await claudeComplete(noteContext(note), { system, max_tokens: 300 })).trim()
}

export async function extractActions(note) {
  const system = 'You extract concrete action items from a note. Return strict JSON only.'
  const user = noteContext(note) + '\n\nReturn ONLY JSON: {"actions":[{"text":string,"owner":string}]}'
  const j = extractJSON(await claudeComplete(user, { system, max_tokens: 600 }))
  return (j?.actions || []).map((a) => ({ text: a.text, src: 'extracted', owner: a.owner || 'open' }))
}

export async function suggestTags(note) {
  const system = 'You suggest 3–6 short lowercase topic tags for a note. Return strict JSON only.'
  const user = noteContext(note) + '\n\nReturn ONLY JSON: {"tags":string[]}'
  const j = extractJSON(await claudeComplete(user, { system, max_tokens: 200 }))
  return (j?.tags || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean)
}

export async function rewriteNote(note) {
  const system = 'You rewrite a note body to be clearer and tighter, preserving meaning, structure, ' +
    'and any [[links]]. Output ONLY the rewritten body in plain markdown (paragraphs, - lists).'
  return (await claudeComplete(noteContext(note), { system, max_tokens: 1200 })).trim()
}
