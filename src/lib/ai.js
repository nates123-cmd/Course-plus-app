// Scribe AI surfaces — real Claude calls (via the JWT-gated `claude` proxy)
// that replace the prototype's setTimeout fakes.
import { claudeComplete, claudeChat, extractJSON, pickModel } from './claude'

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
  const model = pickModel(firstTurn.length > 12000 ? 'heavy' : 'light')
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
  auto: 'the single most useful deliverable for this material — choose the best format yourself (document, table, list, email, etc.)',
  document: 'a clean, well-structured written document',
  message: 'a ready-to-send message - either an email or a Teams/chat message as the instructions imply - that is concise, natural, and written in Nate\'s own voice (see the WRITING VOICE brief below). Lead with the point, keep it skimmable.',
  csv: 'a CSV table whose columns are ALWAYS separated by the pipe character "|" (never commas). First line is the header row, then one record per line. Output raw pipe-delimited text only — no markdown table syntax, no code fences, no commentary',
  copilot: 'a single ready-to-paste Microsoft 365 Copilot prompt that, given this context, will generate the intended deliverable inside Office (Word / Excel / PowerPoint / Outlook). Output ONLY the prompt text the user would paste into Copilot',
}

// Nate's personal writing voice. Appended to the system prompt whenever the
// deliverable is a 'message' (email/Teams), so drafts sound like him. Lives in
// the prompt (not provider code) so it applies under BOTH AI engines — Claude
// and Gemini route through the same pickModel/claudeComplete path.
const NATE_STYLE_BRIEF =
  '\n\nWRITING VOICE — write this message as Nate would write it himself:\n' +
  '- Greeting: "Hi [Name]," (groups: "Hi team," / "Hi all,"). Never "Dear" or a bare "Hello,".\n' +
  '- Pick the register from the recipient/context (default to WORK if unclear):\n' +
  '  • WORK (colleagues, boss, partners, anything professional): state the purpose in sentence one — no warm-up, small talk, or flattery. Restrained: exclamation marks rare, NO emoji. Light softeners ("I\'m reaching out to", "I\'m looking to", "Let me know what you think", "Please feel free to"). Use a colon to introduce a short list.\n' +
  '  • PERSONAL (friends, family, vendors, reservations, support): warm and upbeat — exclamation marks and an occasional ":)" are welcome. One thought per line with blank lines between (no dense paragraphs). Heavier softeners ("by any chance", "I was wondering if", "Would it be possible", "Please let me know"). Often writes as "we".\n' +
  '- Always true: contractions (I\'m, don\'t, we\'re); NO em-dashes (use short sentences, colons, or *word* emphasis); concise short-to-medium sentences; CLOSE on a clear ask or next step.\n' +
  '- Sign-off: "Thanks," / "Thank you," / "All the best," then "Nate".\n' +
  '- Avoid: corporate stiffness ("Kindly advise", "Best regards"), dense unbroken paragraphs, over-explaining.'
// Compose a paste-ready deliverable from the FULL material — note bodies AND
// meeting transcripts, not just summaries (a transcript is far richer source for
// building an artifact than a lossy summary). Escalates to Sonnet for big inputs.
//
// `opts` widens what the model sees beyond the note corpus:
//   contextText  — a structured digest of the whole project (status, where-it-
//                  stands, milestones, tasks, artifacts) and, at pillar scope,
//                  every sibling project in the area. Authoritative background.
//   contextLabel — name of the project / pillar the context describes.
//   scope        — 'project' (default) | 'pillar'. Only changes the framing word.
//   onUsage      — usage callback (token/cost accounting).
export async function composeDeliverable(typeId, instructions, sourceLabel, notes, opts = {}) {
  // Back-compat: old callers passed the usage callback as the 5th positional arg.
  const { contextText = '', contextLabel = '', scope = 'project', onUsage } =
    typeof opts === 'function' ? { onUsage: opts } : opts
  const corpus = notes.map((n) => {
    const body = (n.body || []).map((b) => b.p
      || (b.ul ? b.ul.map((i) => '- ' + i).join('\n')
      : (b.ol ? b.ol.map((i, k) => (k + 1) + '. ' + i).join('\n') : ''))).filter(Boolean).join('\n')
    const tx = n.transcript ? `\nTranscript:\n${n.transcript}` : ''
    return `## ${n.title}${n.summary ? '\nSummary: ' + n.summary : ''}${body ? '\n' + body : ''}${tx}`
  }).join('\n\n---\n\n')
  const ctx = contextText && contextText.trim()
  const scopeWord = scope === 'pillar' ? 'pillar / area' : 'project'
  // Escalate to the heavy model for big inputs OR whenever the whole pillar is in scope.
  const big = (corpus.length + (ctx ? ctx.length : 0)) > 12000 || notes.length > 6 || scope === 'pillar'
  const model = pickModel(big ? 'heavy' : 'light')
  const system =
    'You compose clean, paste-ready business deliverables. Work from the FULL source material ' +
    '(note bodies and meeting transcripts) — use the detail, not just the summaries. ' +
    (ctx
      ? `The ${scopeWord.toUpperCase()} CONTEXT below is the authoritative picture of ${scope === 'pillar' ? 'the whole pillar' : 'this project'} — ` +
        'its status, where it stands, milestones, tasks, and related work. Treat it as ground truth and draw on ANY of it the deliverable needs. '
      : '') +
    'Output ONLY the deliverable content in plain markdown — no preamble, no "here is".' +
    // For email/Teams messages, write in Nate's own voice (applies to Claude + Gemini).
    (typeId === 'message' ? NATE_STYLE_BRIEF : '')
  // Context FIRST (background), source material SECOND, instruction LAST so the
  // model anchors on the task, not the longest block.
  const user =
    (ctx ? `${scope === 'pillar' ? 'PILLAR' : 'PROJECT'} CONTEXT — "${contextLabel}":\n${ctx}\n\n---\n\n` : '') +
    `Source: ${sourceLabel}\nMaterial:\n${corpus}\n\n` +
    `Produce ${TYPE_BRIEF[typeId] || 'a brief'}.` +
    (instructions ? ` Instructions: ${instructions}` : '')
  return (await claudeComplete(user, { system, model, max_tokens: 8000, onUsage })).trim()
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
  const guide = (await claudeComplete(user, { system, model: pickModel('heavy'), max_tokens: 4096, onUsage: (u) => { usage = u } })).trim()
  return { guide, usage }
}

// Synthesize a meeting into exactly three things the user wants: a bullet-point
// topic summary (for fast orientation), action items, and smart searchable tags.
// The user's OWN live notes are the highest-signal input — they wrote those down
// because they mattered — so they're weighted above the transcript. Long
// transcripts escalate to Sonnet for whole-meeting recall.
export async function synthesizeMeeting({ liveNotes = '', agenda = '', transcript = '', people = [], speakerLabels = [], detail = 'low', pins = [], projectOptions = [] } = {}) {
  const tx = transcript || ''
  const long = tx.length > 18000
  const model = pickModel((detail === 'high' || long) ? 'heavy' : 'light')
  // detail='high' is a THOROUGH briefing returned as ONE JSON blob (summary +
  // actions + next_steps + tags + speakers) — 4096 truncated the JSON mid-summary
  // (salvaged partial = a cut-off summary). 8000 sits just under the proxy's
  // 8192 cap. Proxy already runs Gemini with thinking OFF, so the whole budget
  // is visible output. low/medium stay tight on purpose.
  const maxTok = detail === 'high' ? 8000 : detail === 'low' ? 1100 : 2400
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
  if (pins.length) parts.push(`MOMENTS I FLAGGED as important while recording (timestamps ${pins.join(', ')}): make sure the summary and next steps explicitly address whatever was being discussed around each of these — I marked them because they matter.`)
  if (tx.trim()) parts.push(`Transcript (${tx.length} chars, supporting context):\n${tx.trim()}`)
  // Quick mode: hand the model the existing projects so it can file the meeting
  // under the single best match (returned as an exact id in "project").
  const wantProject = (projectOptions || []).length > 0
  if (wantProject) parts.push('Existing projects I could file this meeting under (id — name [pillar]):\n' +
    projectOptions.map((p) => `${p.id} — ${p.name}${p.area ? ` [${p.area}]` : ''}`).join('\n'))
  const labelList = (speakerLabels || []).filter(Boolean)
  const speakerAsk = labelList.length
    ? `\n\nThe transcript labels speakers as: ${labelList.join(', ')}. In "speakers", map EACH of those labels to the most likely real first name (lead with the people list above; otherwise infer; the first-person speaker is Nate). Only include confident guesses.`
    : ''
  const user =
    parts.join('\n\n---\n\n') + '\n\n' +
    'Return ONLY JSON (no markdown fences, no prose around it). Use real "\\n" in strings for line ' +
    'breaks and "- " for bullets. Shape: {' +
    '"title": string (a concise, specific meeting title — 4 to 8 words, Title Case, no surrounding quotes), ' +
    (wantProject ? '"project": string (the id — copied EXACTLY — of the single best-matching project from the "Existing projects" list above for THIS meeting; "" if none clearly fits — never invent an id), ' : '') +
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
    title: (typeof j.title === 'string' ? j.title.trim() : ''),
    project: (typeof j.project === 'string' ? j.project.trim() : ''),
    summary: summary || '', nextSteps: nextSteps || '',
    actions: Array.isArray(j.actions) ? j.actions : [],
    tags: Array.isArray(j.tags) ? j.tags : [],
    speakers: (j.speakers && typeof j.speakers === 'object') ? j.speakers : {},
    people: [], terms: [], usage,
  }
}

// ── Meeting Series (recurring meetings) ────────────────────────────
// Render a list of prior instances as a compact, dated digest for the series
// AI calls. instances = [{ date, summary, nextSteps, actions? }] newest first.
function seriesInstanceDigest(instances = [], { withActions = false } = {}) {
  return (instances || []).map((n) => {
    const parts = [`### ${n.date || 'Undated'} — ${n.title || 'Meeting'}`]
    if (n.summary && n.summary.trim()) parts.push(n.summary.trim())
    if (n.nextSteps && n.nextSteps.trim()) parts.push('Next steps I noted:\n' + n.nextSteps.trim())
    if (withActions && (n.actions || []).length) parts.push('My action items: ' + n.actions.map((a) => a.text).filter(Boolean).join('; '))
    return parts.join('\n')
  }).join('\n\n---\n\n')
}

// Prep the NEXT meeting in a series: a suggested agenda built from open loops,
// follow-ups on prior commitments, and recurring topics. Light model. Returns
// { agenda } (markdown bullets) to pre-fill the composer agenda.
export async function prepFromSeries({ name = '', standingContext = '', cadence = '', instances = [] } = {}) {
  const recent = instances.slice(0, 5)
  const system =
    'You prep the next meeting in a recurring series for Nate (the note-taker, always a participant). ' +
    'From the standing context and prior meetings, produce a focused agenda for the UPCOMING meeting: ' +
    'open loops to close, follow-ups on what was promised, and recurring topics worth checking. ' +
    'Be specific and reference what actually happened. Return strict JSON only — no preamble.'
  const parts = [`Recurring meeting: "${name}"${cadence ? ` (${cadence})` : ''}`]
  if (standingContext.trim()) parts.push(`Standing context (who this is / what we always cover):\n${standingContext.trim()}`)
  if (recent.length) parts.push(`Recent meetings (newest first):\n\n${seriesInstanceDigest(recent)}`)
  else parts.push('No prior meetings recorded yet — propose a sensible first-meeting agenda from the standing context.')
  const user = parts.join('\n\n---\n\n') + '\n\n' +
    'Return ONLY JSON: {"agenda": string (markdown "- " bullets — the agenda for the next meeting; ' +
    'group under short "## Heading" sections only if it helps; lead with anything left open)}'
  const raw = await claudeComplete(user, { system, model: pickModel('light'), max_tokens: 900 })
  const j = extractJSON(raw) || {}
  return { agenda: (typeof j.agenda === 'string' && j.agenda) ? j.agenda : (raw || '').trim() }
}

// Synthesize the whole SERIES across its instances: the arc over time, still-open
// threads, commitments (mine) and their status, and decisions. Heavy model.
export async function synthesizeSeries({ name = '', standingContext = '', instances = [] } = {}) {
  const recent = instances.slice(0, 12)
  const system =
    'You synthesize a recurring meeting series for Nate (the note-taker, always a participant). ' +
    'Read the standing context and the chronological meetings, then surface the THROUGH-LINE: how the ' +
    'relationship/work has moved, what is still unresolved, what Nate committed to and whether it got done, ' +
    'and key decisions. Be concrete and cite which meeting things came from by date. Return strict JSON only.'
  const parts = [`Recurring meeting: "${name}"`]
  if (standingContext.trim()) parts.push(`Standing context:\n${standingContext.trim()}`)
  parts.push(`Meetings (newest first):\n\n${seriesInstanceDigest(recent, { withActions: true })}`)
  const user = parts.join('\n\n---\n\n') + '\n\n' +
    'Return ONLY JSON (no fences). Use real "\\n" and "- " for bullets. Shape: {' +
    '"arc": string (markdown — the narrative of this series over time, a few short paragraphs or bullets), ' +
    '"openThreads": [{"text": string, "sinceDate": string}] (loops still genuinely open — dedupe across meetings, drop anything later resolved), ' +
    '"commitments": [{"text": string, "done": boolean}] (things NATE committed to — done=true only if a later meeting shows it happened), ' +
    '"decisions": string[] (concrete decisions reached)}'
  const raw = await claudeComplete(user, { system, model: pickModel('heavy'), max_tokens: 4000 })
  const j = extractJSON(raw) || {}
  return {
    arc: typeof j.arc === 'string' ? j.arc : '',
    openThreads: Array.isArray(j.openThreads) ? j.openThreads : [],
    commitments: Array.isArray(j.commitments) ? j.commitments : [],
    decisions: Array.isArray(j.decisions) ? j.decisions : [],
  }
}

// Ask across ALL recurring series at once — the Series-tab assistant. Builds a
// corpus of every series (standing context + recent instances + open threads)
// and answers questions that may span them ("what's open with Jon?", "which
// 1:1s have stalled commitments?", "who owes me follow-ups?"). Multi-turn.
// `series` = [{ name, cadence, standingContext, instances:[{date,title,summary,
// nextSteps,actions}], openThreads:[{text,date}] }]; `history` = prior turns.
export async function askAcrossSeries(series = [], history, question) {
  const corpus = (series || []).map((s) => {
    const head = `## ${s.name}${s.cadence ? ` (${s.cadence})` : ''} — ${(s.instances || []).length} meeting(s)`
    const parts = [head]
    if (s.standingContext && s.standingContext.trim()) parts.push('Standing context: ' + s.standingContext.trim())
    const open = (s.openThreads || []).filter((o) => o && o.text)
    if (open.length) parts.push('Open threads:\n' + open.map((o) => `- ${o.text}${o.date ? ` (since ${o.date})` : ''}`).join('\n'))
    const recent = (s.instances || []).slice(0, 5)
    if (recent.length) parts.push('Recent meetings (newest first):\n\n' + seriesInstanceDigest(recent, { withActions: true }))
    return parts.join('\n\n')
  }).join('\n\n═══════════\n\n')
  const system =
    'You are the assistant for the Series tab of a personal work app — the home of Nate\'s recurring meetings ' +
    '(1:1s, standups, weekly syncs). Nate is the note-taker and a participant in every one. ' +
    'Answer using ONLY the series provided below; you may reason ACROSS series (compare, aggregate, find what is ' +
    'stalled or owed). Name the series and cite meeting dates when relevant. If the answer is not in the material, ' +
    'say so plainly. Be concise and specific. Reply in clean markdown, no preamble.'
  const firstTurn = `ALL RECURRING SERIES:\n\n${corpus || '(no series yet)'}`
  const model = pickModel(firstTurn.length > 12000 ? 'heavy' : 'light')
  const messages = [{ role: 'user', content: firstTurn }, ...(history || []), { role: 'user', content: question }]
  return (await claudeChat(messages, { system, model, max_tokens: 1400 })).trim()
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
